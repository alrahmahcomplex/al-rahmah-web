-- Staff members and roles replace the email allowlist (ADR 3), and every
-- change to them lands in one append-only audit log (ADR 4).
--
-- Order matters: the tables and the starting roles come first, then the
-- audit triggers are attached, then the allowlisted accounts are moved over
-- under the `system` actor, and only then is the allowlist dropped.

-- ---------------------------------------------------------------------------
-- Permissions: the fixed list from CONTEXT.md. Changed only by migration.
-- ---------------------------------------------------------------------------

create table public.permissions (
    name text primary key,
    label text not null,
    position smallint not null unique
);

insert into public.permissions (position, name, label) values
    (1, 'leads.view', 'View leads and their history'),
    (2, 'leads.create', 'Enter new leads'),
    (3, 'leads.edit', 'Edit lead details'),
    (4, 'visits.record', 'Record campus visits'),
    (5, 'interviews.record', 'Record interviews and results'),
    (6, 'interview_payments.record', 'Mark the interview fee paid'),
    (7, 'results.send', 'Send interview results'),
    (8, 'follow_ups.record', 'Add and complete follow-ups'),
    (9, 'leads.decline', 'Decline leads'),
    (10, 'leads.close', 'Mark leads inactive or archived'),
    (11, 'reopenings.approve', 'Approve reopening requests'),
    (12, 'lifecycle.intervene', 'Intervene in a lead''s lifecycle'),
    (13, 'agents.approve', 'Approve Marketing Agents'),
    (14, 'payments.view', 'View school-fee payments'),
    (15, 'payments.record', 'Record payments and maintain fees'),
    (16, 'discounts.approve', 'Approve discounts'),
    (17, 'academic_years.manage', 'Manage academic years and seats'),
    (18, 'staff.administer', 'Administer staff and roles');

-- ---------------------------------------------------------------------------
-- Roles: a named set of permissions. The set lives on the row, so unticking
-- a permission is an audited update and never needs a DELETE.
-- ---------------------------------------------------------------------------

create table public.roles (
    id uuid primary key default gen_random_uuid(),
    name text not null check (btrim(name) <> ''),
    permissions text[] not null default '{}',
    retired boolean not null default false,
    created_at timestamptz not null default now()
);

create unique index roles_name_key on public.roles (lower(name));

-- Keeps each role's permissions a real set of known names: unknown names are
-- refused, duplicates dropped and the order fixed, so the audit log shows a
-- permission change as exactly what was ticked or unticked.
create function public.normalize_role_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    unknown text;
begin
    select p into unknown
    from unnest(new.permissions) as p
    where not exists (select 1 from public.permissions where name = p)
    limit 1;
    if found then
        raise exception 'unknown_permission' using detail = unknown;
    end if;

    new.permissions := array(select distinct p from unnest(new.permissions) as p order by p);
    return new;
end;
$$;

create trigger normalize_role_permissions
    before insert or update of permissions on public.roles
    for each row
    execute function public.normalize_role_permissions();

insert into public.roles (name, permissions) values
    ('Admissions Staff', array[
        'leads.view', 'leads.create', 'leads.edit', 'visits.record', 'interviews.record',
        'results.send', 'follow_ups.record', 'leads.decline', 'leads.close', 'payments.view'
    ]),
    ('Admissions Manager', array[
        'leads.view', 'leads.create', 'leads.edit', 'visits.record', 'interviews.record',
        'results.send', 'follow_ups.record', 'leads.decline', 'leads.close',
        'reopenings.approve', 'lifecycle.intervene', 'agents.approve', 'payments.view',
        'discounts.approve', 'academic_years.manage', 'staff.administer'
    ]),
    ('Accountant', array[
        'leads.view', 'interview_payments.record', 'payments.view', 'payments.record'
    ]);

-- ---------------------------------------------------------------------------
-- Staff members. Never deleted: deactivated instead, so names stay on history.
-- ---------------------------------------------------------------------------

create table public.staff_members (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (btrim(full_name) <> ''),
    email text not null unique check (email = lower(email)),
    role_id uuid not null references public.roles (id),
    active boolean not null default true,
    -- Empty until the invite creates the account.
    user_id uuid unique references auth.users (id),
    notices_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index staff_members_role_id_idx on public.staff_members (role_id);

-- ---------------------------------------------------------------------------
-- Permission checks. Every policy from here on asks for a permission through
-- has_permission, never for a role name.
-- ---------------------------------------------------------------------------

-- True only for an active staff member whose role is not retired and holds
-- the permission. SECURITY DEFINER to read past RLS; the empty search_path
-- stops a caller from shadowing the tables with their own objects.
create function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.staff_members s
        join public.roles r on r.id = s.role_id
        where s.user_id = auth.uid()
          and s.active
          and not r.retired
          and has_permission.permission = any (r.permissions)
    );
$$;

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

create function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff_members
        where user_id = auth.uid() and active
    );
$$;

revoke execute on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;

-- The signed-in person's own staff record, with everything the app needs in
-- one call. Returns deactivated records too, so sign-in can say "deactivated"
-- instead of "not staff". Only a current role's permissions are listed.
create function public.current_staff_member()
returns table (
    id uuid,
    full_name text,
    email text,
    active boolean,
    role_name text,
    permissions text[]
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        s.id,
        s.full_name,
        s.email,
        s.active,
        r.name,
        case when s.active and not r.retired then r.permissions else '{}'::text[] end
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.user_id = auth.uid();
$$;

revoke execute on function public.current_staff_member() from public, anon;
grant execute on function public.current_staff_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log (ADR 4).
-- ---------------------------------------------------------------------------

-- One row per audited table: its read scope and, optionally, the column that
-- holds the lead id. A later migration registers its table with one insert.
create table public.audit_scopes (
    table_name regclass primary key,
    scope text not null check (scope in ('lead', 'payment', 'staff_admin')),
    lead_id_column text
);

-- Action events: things staff do that change no row. Each kind names the
-- permission needed to record it and the read scope its rows take.
create table public.audit_action_kinds (
    kind text primary key,
    permission text not null references public.permissions (name),
    scope text not null check (scope in ('lead', 'payment', 'staff_admin'))
);

insert into public.audit_action_kinds (kind, permission, scope) values
    ('invite_sent', 'staff.administer', 'staff_admin');

create table public.audit_log (
    id bigint generated always as identity primary key,
    -- Empty for action events.
    table_name text,
    row_id uuid,
    -- Slice 2 adds the foreign key once leads exist.
    lead_id uuid,
    -- insert, update, or an action kind.
    action text not null,
    old_values jsonb,
    new_values jsonb,
    scope text not null check (scope in ('lead', 'payment', 'staff_admin')),
    actor_kind text not null
        check (actor_kind in ('staff', 'public_form', 'workbook_import', 'system')),
    actor_staff_id uuid references public.staff_members (id),
    created_at timestamptz not null default now(),
    check ((actor_kind = 'staff') = (actor_staff_id is not null))
);

create index audit_log_row_idx on public.audit_log (table_name, row_id);
create index audit_log_lead_id_idx on public.audit_log (lead_id) where lead_id is not null;
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- Sets who is making the writes in the current transaction, for writes with
-- no staff session: the secret key, a migration, the SQL editor. Only the
-- service role and the database owner may call it.
create function public.set_audit_actor(kind text, staff_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if kind not in ('staff', 'public_form', 'workbook_import', 'system') then
        raise exception 'unknown_actor_kind' using detail = kind;
    end if;
    if (kind = 'staff') <> (staff_id is not null) then
        raise exception 'actor_staff_id_mismatch';
    end if;
    if staff_id is not null
       and not exists (select 1 from public.staff_members s where s.id = staff_id) then
        raise exception 'unknown_staff_member';
    end if;

    perform set_config('audit.actor_kind', kind, true);
    perform set_config('audit.actor_staff_id', coalesce(staff_id::text, ''), true);
end;
$$;

revoke execute on function public.set_audit_actor(text, uuid) from public, anon, authenticated;
grant execute on function public.set_audit_actor(text, uuid) to service_role;

-- Who is acting: the staff member behind the session, else the actor set for
-- the transaction. Empty when neither is known.
create function public.audit_actor(out kind text, out staff_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
    if staff_id is not null then
        kind := 'staff';
        return;
    end if;

    kind := nullif(current_setting('audit.actor_kind', true), '');
    staff_id := nullif(current_setting('audit.actor_staff_id', true), '')::uuid;
end;
$$;

revoke execute on function public.audit_actor() from public, anon, authenticated;

-- The one audit trigger. Writes a row per insert (the whole row) or update
-- (only the changed fields, old and new), and refuses a write with no actor.
-- An audited table needs a uuid `id` column and a row in audit_scopes.
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    registered public.audit_scopes;
    actor record;
    old_row jsonb;
    new_row jsonb := to_jsonb(new);
    old_values jsonb;
    new_values jsonb;
begin
    select * into registered from public.audit_scopes where table_name = tg_relid;
    if not found then
        raise exception 'audit_scope_missing' using detail = tg_table_name;
    end if;

    select * into actor from public.audit_actor();
    if actor.kind is null then
        raise exception 'no_audit_actor' using detail = tg_table_name;
    end if;

    if tg_op = 'INSERT' then
        new_values := new_row;
    else
        old_row := to_jsonb(old);
        select jsonb_object_agg(n.key, n.value) into new_values
        from jsonb_each(new_row) n
        where n.value is distinct from old_row -> n.key;

        -- Nothing changed, so there is nothing to record.
        if new_values is null then
            return null;
        end if;

        select jsonb_object_agg(o.key, o.value) into old_values
        from jsonb_each(old_row) o
        where new_values ? o.key;
    end if;

    insert into public.audit_log (
        table_name, row_id, lead_id, action, old_values, new_values,
        scope, actor_kind, actor_staff_id
    ) values (
        tg_table_name,
        (new_row ->> 'id')::uuid,
        case when registered.lead_id_column is not null
            then (new_row ->> registered.lead_id_column)::uuid end,
        lower(tg_op),
        old_values,
        new_values,
        registered.scope,
        actor.kind,
        actor.staff_id
    );
    return null;
end;
$$;

revoke execute on function public.audit_row_change() from public, anon, authenticated;

-- Audited rows are deactivated or retired, never erased.
create function public.refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'delete_refused' using detail = tg_table_name;
end;
$$;

-- The audit log is append-only for everyone, the secret key and the database
-- owner included. A wrong row is corrected only by a reviewed migration that
-- drops this trigger for the length of the fix.
create function public.refuse_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'audit_log_is_append_only' using detail = lower(tg_op);
end;
$$;

create trigger refuse_audit_log_change
    before update or delete on public.audit_log
    for each row
    execute function public.refuse_audit_log_change();

create trigger refuse_audit_log_truncate
    before truncate on public.audit_log
    for each statement
    execute function public.refuse_audit_log_change();

-- Records an action event. Checks the kind's permission against the caller,
-- stores the kind's scope, and takes the actor the same way the trigger does.
-- It is called on the staff member's own session, never with the secret key:
-- the invite service sends the email with the secret key, then records
-- invite_sent as the signed-in Manager, so the permission check has someone
-- to check.
create function public.record_action(kind text, lead_id uuid default null, details jsonb default '{}')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    action_kind public.audit_action_kinds;
    actor record;
    logged_id bigint;
begin
    select * into action_kind from public.audit_action_kinds k where k.kind = record_action.kind;
    if not found then
        raise exception 'unknown_action_kind' using detail = record_action.kind;
    end if;

    if not public.has_permission(action_kind.permission) then
        raise exception 'not_permitted' using detail = action_kind.permission;
    end if;

    if action_kind.scope = 'lead' and record_action.lead_id is null then
        raise exception 'lead_required' using detail = record_action.kind;
    end if;

    select * into actor from public.audit_actor();
    if actor.kind is null then
        raise exception 'no_audit_actor' using detail = record_action.kind;
    end if;

    insert into public.audit_log (lead_id, action, new_values, scope, actor_kind, actor_staff_id)
    values (
        record_action.lead_id, action_kind.kind, coalesce(details, '{}'),
        action_kind.scope, actor.kind, actor.staff_id
    )
    returning id into logged_id;
    return logged_id;
end;
$$;

revoke execute on function public.record_action(text, uuid, jsonb) from public, anon;
grant execute on function public.record_action(text, uuid, jsonb) to authenticated;

-- Register roles and staff members, and attach the audit and delete triggers.
insert into public.audit_scopes (table_name, scope) values
    ('public.roles', 'staff_admin'),
    ('public.staff_members', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.roles
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.roles
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.roles
    for each statement
    execute function public.refuse_delete();

create trigger audit_row_change
    after insert or update on public.staff_members
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.staff_members
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.staff_members
    for each statement
    execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- Row-level security. Reads only; every write to roles and staff members
-- will go through guardrailed functions, so there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.staff_members enable row level security;
alter table public.audit_scopes enable row level security;
alter table public.audit_action_kinds enable row level security;
alter table public.audit_log enable row level security;

create policy "Active staff read the permission list"
    on public.permissions for select
    to authenticated
    using ((select public.is_active_staff()));

create policy "Active staff read roles"
    on public.roles for select
    to authenticated
    using ((select public.is_active_staff()));

create policy "Staff read their own record; administrators read everyone"
    on public.staff_members for select
    to authenticated
    using (
        (user_id = (select auth.uid()) and active)
        or (select public.has_permission('staff.administer'))
    );

create policy "Active staff read the audit scopes"
    on public.audit_scopes for select
    to authenticated
    using ((select public.is_active_staff()));

create policy "Active staff read the action kinds"
    on public.audit_action_kinds for select
    to authenticated
    using ((select public.is_active_staff()));

create policy "Staff read the history of what they may read"
    on public.audit_log for select
    to authenticated
    using (
        case scope
            when 'lead' then (select public.has_permission('leads.view'))
            when 'payment' then (select public.has_permission('payments.view'))
            when 'staff_admin' then (select public.has_permission('staff.administer'))
            else false
        end
    );

-- The fixed lists and the log change only through migrations and the audit
-- functions, never through the API, whatever the key.
revoke insert, update, delete, truncate on public.permissions from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.audit_scopes from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.audit_action_kinds from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Accounts. An auth user can be created only for an email on an active staff
-- record, and is then linked to that record. Replaces enforce_staff_allowlist.
-- ---------------------------------------------------------------------------

create function public.refuse_non_staff_signups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.staff_members
        where email = lower(new.email) and active and user_id is null
    ) then
        raise exception 'This email does not belong to an active staff member.';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_non_staff_signups() from public, anon, authenticated;

-- Runs after the insert so the foreign key to auth.users can be satisfied.
-- The link is recorded under the system actor, then any actor the
-- transaction had is put back.
create function public.link_staff_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous_kind text := coalesce(current_setting('audit.actor_kind', true), '');
    previous_staff_id text := coalesce(current_setting('audit.actor_staff_id', true), '');
begin
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);

    -- Rechecks the record here, so a deactivation that lands between the
    -- before-insert check and this link still refuses the account.
    update public.staff_members
    set user_id = new.id
    where email = lower(new.email) and active and user_id is null;
    if not found then
        raise exception 'This email does not belong to an active staff member.';
    end if;

    perform set_config('audit.actor_kind', previous_kind, true);
    perform set_config('audit.actor_staff_id', previous_staff_id, true);
    return null;
end;
$$;

revoke execute on function public.link_staff_account() from public, anon, authenticated;

create trigger refuse_non_staff_signups
    before insert on auth.users
    for each row
    execute function public.refuse_non_staff_signups();

create trigger link_staff_account
    after insert on auth.users
    for each row
    execute function public.link_staff_account();

-- ---------------------------------------------------------------------------
-- Move production over. Each allowlisted email with an account becomes an
-- active Admissions Manager named after the email's local part; a Manager
-- corrects the name later. Emails with no account are dropped, because an
-- invite now creates the staff record.
-- ---------------------------------------------------------------------------

do $$
begin
    perform public.set_audit_actor('system');

    insert into public.staff_members (full_name, email, role_id, user_id)
    select distinct on (a.email)
        split_part(a.email, '@', 1),
        a.email,
        (select id from public.roles where name = 'Admissions Manager'),
        u.id
    from public.allowed_admin_emails a
    join auth.users u on lower(u.email) = a.email
    order by a.email, u.created_at;

    perform set_config('audit.actor_kind', '', true);
end;
$$;

drop trigger enforce_staff_allowlist on auth.users;
drop function public.block_unlisted_signups();
drop table public.allowed_admin_emails;
drop function public.is_admin();
