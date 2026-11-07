-- The Super Admin (#237, owner decision 43 of 2026-11-06): one role that
-- exists only through migrations, holds every permission now and later,
-- administers every other role and alone reads the audit history. Its first
-- holder starts the system after the #197 reset: the owner invites the
-- holder's email under Authentication > Users, and the Super Admin invites
-- everyone else from Staff and roles.
--
-- On hosted this runs right after 20261130990100_hosted_test_data_reset.sql,
-- so it meets three seeded roles, no staff members and no logins. On a fresh
-- local or CI database it meets the same, since seeds load after migrations.
--
-- 1. The audit.view permission, which no role may hold.
-- 2. The role and its holder, under fixed ids, as `system`.
-- 3. has_permission answers true for the holder whatever the name, so no
--    later migration grants the Super Admin anything.
-- 4. Named triggers freeze the role and the holder for every database role.
-- 5. Reads and writes treat the role and the holder as missing for everyone
--    else.
-- 6. Every audit read needs audit.view.
--
-- The role carries no permissions of its own: has_permission recognises it by
-- its id. Only a migration that disables a trigger below by name can change
-- the role or the holder.

-- ---------------------------------------------------------------------------
-- 1. audit.view: the event-by-event history, held only through the Super
--    Admin role. A role that lists it is refused (refuse_audit_view_grant).
-- ---------------------------------------------------------------------------

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'audit.view', 'See the full audit history'
from public.permissions;

create function public.refuse_audit_view_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if 'audit.view' = any (new.permissions) then
        raise exception 'audit_view_reserved' using detail = new.name;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_audit_view_grant() from public, anon, authenticated;

create trigger refuse_audit_view_grant
    before insert or update of permissions on public.roles
    for each row
    execute function public.refuse_audit_view_grant();

-- ---------------------------------------------------------------------------
-- 2. The role and its holder.
-- ---------------------------------------------------------------------------

create function public.super_admin_role_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
    select '5a000000-0000-4000-8000-000000000001'::uuid;
$$;

revoke execute on function public.super_admin_role_id() from public, anon, authenticated, service_role;

do $$
begin
    if exists (select 1 from public.roles r where r.id = public.super_admin_role_id()) then
        raise exception 'super_admin_exists';
    end if;

    perform public.set_audit_actor('system');

    insert into public.roles (id, name, permissions)
    values (public.super_admin_role_id(), 'Super Admin', '{}');

    -- The first holder (decision 2). The owner may change the name or email on the next line at merge.
    insert into public.staff_members (id, full_name, email, role_id) values ('5a000000-0000-4000-8000-000000000002', 'Al-Rahmah Complex', 'alrahmahcomplex.tz@gmail.com', public.super_admin_role_id());

    perform set_config('audit.actor_kind', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The base checks.
-- ---------------------------------------------------------------------------

-- True for an active staff member on an unretired role that holds the
-- permission, and for the active Super Admin whatever the name.
create or replace function public.has_permission(permission text)
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
        where s.id = public.current_staff_id()
          and s.active
          and not r.retired
          and (r.id = public.super_admin_role_id() or has_permission.permission = any (r.permissions))
    );
$$;

-- True when the signed-in person is the active Super Admin.
create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff_members s
        where s.id = public.current_staff_id()
          and s.active
          and s.role_id = public.super_admin_role_id()
    );
$$;

revoke execute on function public.is_super_admin() from public, anon, authenticated, service_role;

-- The Super Admin's permissions are every name on the list, read when asked,
-- so the app's own checks follow a permission a later migration adds.
create or replace function public.current_staff_member()
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
        case
            when not s.active or r.retired then '{}'::text[]
            when r.id = public.super_admin_role_id()
                then array(select p.name from public.permissions p order by p.position)
            else r.permissions
        end
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.id = public.current_staff_id();
$$;

-- The Super Admin administers staff, so a joined holder counts: the last
-- Manager can be deactivated while the Super Admin remains.
create or replace function public.administrator_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.active
      and not r.retired
      and (r.id = public.super_admin_role_id() or 'staff.administer' = any (r.permissions))
      and not public.staff_member_invited(s.id);
$$;

-- ---------------------------------------------------------------------------
-- 4. The freeze. Deletes are already refused for every row of both tables
--    (refuse_delete, refuse_truncate). These refuse the rest, the SQL editor
--    and the secret key included.
-- ---------------------------------------------------------------------------

create function public.refuse_super_admin_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.id = public.super_admin_role_id() or new.id = public.super_admin_role_id() then
        raise exception 'super_admin_frozen' using detail = 'role';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_super_admin_role_change() from public, anon, authenticated;

create trigger refuse_super_admin_role_change
    before update on public.roles
    for each row
    execute function public.refuse_super_admin_role_change();

-- Nobody joins the role (one holder, decision 4), leaves it, is deactivated
-- on it, or has their name or email changed on it. The holder's row still
-- takes its first login (link_staff_account) and notices_seen_at.
create function public.refuse_super_admin_holder_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.role_id = public.super_admin_role_id() then
            raise exception 'super_admin_frozen' using detail = 'holder';
        end if;
        return new;
    end if;

    if old.role_id <> public.super_admin_role_id() and new.role_id <> public.super_admin_role_id() then
        return new;
    end if;
    if new.role_id is distinct from old.role_id
       or new.active is distinct from old.active
       or new.full_name is distinct from old.full_name
       or new.email is distinct from old.email
       or new.id is distinct from old.id
       or (new.user_id is distinct from old.user_id and old.user_id is not null) then
        raise exception 'super_admin_frozen' using detail = 'holder';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_super_admin_holder_change() from public, anon, authenticated;

create trigger refuse_super_admin_holder_change
    before insert or update on public.staff_members
    for each row
    execute function public.refuse_super_admin_holder_change();

-- ---------------------------------------------------------------------------
-- 5. Invisible. RLS hides the role from everyone and the holder from
--    administrators; the holder still reads their own record. Write
--    functions answer not_found for the role or the holder to anyone else.
--    The policies spell the role id out rather than call
--    super_admin_role_id(), which no API role may execute.
-- ---------------------------------------------------------------------------

drop policy "Active staff read roles" on public.roles;
create policy "Active staff read roles, never the Super Admin role"
    on public.roles for select
    to authenticated
    using ((select public.is_active_staff()) and id <> '5a000000-0000-4000-8000-000000000001'::uuid);

drop policy "Staff read their own record; administrators read everyone" on public.staff_members;
create policy "Own record; administrators read all but the Super Admin"
    on public.staff_members for select
    to authenticated
    using (
        (user_id = (select auth.uid()) and active)
        or ((select public.has_permission('staff.administer')) and role_id <> '5a000000-0000-4000-8000-000000000001'::uuid)
    );

drop policy "Active staff read the permission list" on public.permissions;
create policy "Active staff read the permission list, audit.view aside"
    on public.permissions for select
    to authenticated
    using ((select public.is_active_staff()) and (name <> 'audit.view' or (select public.has_permission('audit.view'))));

-- True when `staff_id` is the Super Admin and the caller is someone else.
create function public.hidden_staff_member(staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff_members s
        where s.id = hidden_staff_member.staff_id
          and s.role_id = public.super_admin_role_id()
          and s.id is distinct from public.current_staff_id()
    );
$$;

revoke execute on function public.hidden_staff_member(uuid) from public, anon, authenticated, service_role;

-- assign_staff_role, deactivate_staff_member, reactivate_staff_member and
-- correct_staff_name as 20260929000000_staff_member_admin.sql made them,
-- each answering not_found for the hidden holder, and assign_staff_role also
-- for the Super Admin role.

create or replace function public.assign_staff_role(staff_id uuid, role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := public.require_staff_administrator();
    target public.staff_members;
    new_role public.roles;
begin
    select * into target from public.staff_members s where s.id = assign_staff_role.staff_id for update;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;
    -- Held until commit, so the role can't be retired between this check and the move.
    select * into new_role from public.roles r where r.id = assign_staff_role.role_id for share;
    if not found or new_role.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;

    if target.id = caller_id then
        raise exception 'own_role';
    end if;
    if new_role.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', new_role.name)::text;
    end if;
    if target.role_id = new_role.id then
        raise exception 'same_role'
            using detail = jsonb_build_object('name', target.full_name, 'role', new_role.name)::text;
    end if;

    update public.staff_members set role_id = new_role.id where id = target.id;
    return public.staff_member_names(target.id);
end;
$$;

create or replace function public.deactivate_staff_member(staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := public.require_staff_administrator();
    target public.staff_members;
begin
    select * into target from public.staff_members s where s.id = deactivate_staff_member.staff_id for update;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;

    if target.id = caller_id then
        raise exception 'own_account';
    end if;
    if not target.active then
        raise exception 'already_deactivated' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;

    update public.staff_members set active = false where id = target.id;
    return public.staff_member_names(target.id);
end;
$$;

create or replace function public.reactivate_staff_member(staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.staff_members;
    target_role public.roles;
begin
    perform public.require_staff_administrator();

    select * into target from public.staff_members s where s.id = reactivate_staff_member.staff_id for update;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;
    select * into target_role from public.roles r where r.id = target.role_id for share;

    if target.active then
        raise exception 'already_active' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;
    if target_role.retired then
        raise exception 'retired_role_on_reactivate'
            using detail = jsonb_build_object('name', target.full_name, 'role', target_role.name)::text;
    end if;

    update public.staff_members set active = true where id = target.id;
    return public.staff_member_names(target.id);
end;
$$;

create or replace function public.correct_staff_name(staff_id uuid, full_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    corrected text := btrim(coalesce(correct_staff_name.full_name, ''));
begin
    perform public.require_staff_administrator();

    if corrected = '' then
        raise exception 'name_required';
    end if;
    if public.hidden_staff_member(correct_staff_name.staff_id) then
        raise exception 'not_found';
    end if;

    update public.staff_members s set full_name = corrected where s.id = correct_staff_name.staff_id;
    if not found then
        raise exception 'not_found';
    end if;
    return public.staff_member_names(correct_staff_name.staff_id);
end;
$$;

-- resendable_invite and invited_staff_members as
-- 20260929200000_staff_invites.sql made them, leaving the hidden holder out.

create or replace function public.resendable_invite(staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.staff_members;
begin
    perform public.require_staff_administrator();

    select * into target from public.staff_members s where s.id = resendable_invite.staff_id;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;
    if not target.active then
        raise exception 'invite_deactivated' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;
    if not public.staff_member_invited(target.id) then
        raise exception 'already_joined' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;

    return public.staff_member_names(target.id) || jsonb_build_object('id', target.id, 'email', target.email);
end;
$$;

create or replace function public.invited_staff_members()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select s.id
    from public.staff_members s
    where public.has_permission('staff.administer')
      and public.staff_member_invited(s.id)
      and not public.hidden_staff_member(s.id);
$$;

-- invite_staff_member as 20261125120950_joined_agent_auth_email.sql made it.
-- The Super Admin role reads as not_found, and the holder's email as taken,
-- with no name, to anyone but the holder.
create or replace function public.invite_staff_member(full_name text, email text, role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    invited_name text := btrim(coalesce(invite_staff_member.full_name, ''));
    invited_email text := lower(btrim(coalesce(invite_staff_member.email, '')));
    invited_role public.roles;
    existing public.staff_members;
    new_id uuid;
begin
    perform public.require_staff_administrator();

    if invited_name = '' then
        raise exception 'name_required';
    end if;
    if invited_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'email_invalid';
    end if;

    -- Staff members before roles, the order the other writes lock them in, so
    -- an invite never deadlocks against them. It is the lock the insert below
    -- takes anyway, taken early.
    lock table public.staff_members in row exclusive mode;

    -- Held until commit, so the role can't be retired between this check and the insert.
    select * into invited_role from public.roles r where r.id = invite_staff_member.role_id for share;
    if not found or invited_role.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    if invited_role.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', invited_role.name)::text;
    end if;

    select * into existing from public.staff_members s where s.email = invited_email;
    if found and public.hidden_staff_member(existing.id) then
        raise exception 'email_taken' using detail = jsonb_build_object('email', invited_email)::text;
    end if;
    if found then
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end if;

    -- An agent being created with this email holds the lock until it commits,
    -- and is then found here.
    perform public.lock_login_email(invited_email);
    if exists (select 1 from public.agent_email_holders(invited_email)) then
        raise exception 'agent_email' using detail = jsonb_build_object('email', invited_email)::text;
    end if;

    begin
        insert into public.staff_members (full_name, email, role_id)
        values (invited_name, invited_email, invited_role.id)
        returning id into new_id;
    exception when unique_violation then
        -- Two Managers inviting the same email at once: the second loses here.
        select * into existing from public.staff_members s where s.email = invited_email;
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end;

    return public.staff_member_names(new_id) || jsonb_build_object('id', new_id, 'email', invited_email);
end;
$$;

-- editable_role as 20260929100000_role_admin.sql made it, with the Super
-- Admin role not_found for everyone. rename_role, set_role_permission and
-- retire_role all start here. administer_role_frozen still holds for the
-- Super Admin (decision 1): the Admissions Manager role changes only
-- through a migration.
create or replace function public.editable_role(role_id uuid)
returns public.roles
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := public.require_staff_administrator();
    target public.roles;
begin
    select * into target from public.roles r where r.id = editable_role.role_id for update;
    if not found or target.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;

    if exists (select 1 from public.staff_members s where s.id = caller_id and s.role_id = target.id) then
        raise exception 'role_you_hold';
    end if;
    if target.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', target.name)::text;
    end if;
    if 'staff.administer' = any (target.permissions) then
        raise exception 'administer_role_frozen';
    end if;
    return target;
end;
$$;

-- set_role_permission as 20260929100000_role_admin.sql made it. audit.view
-- reads as unknown, so the screen never learns it exists.
create or replace function public.set_role_permission(role_id uuid, permission text, granted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles := public.editable_role(set_role_permission.role_id);
begin
    if set_role_permission.permission = 'audit.view'
       or not exists (select 1 from public.permissions p where p.name = set_role_permission.permission) then
        raise exception 'unknown_permission' using detail = set_role_permission.permission;
    end if;
    if set_role_permission.permission = 'staff.administer' then
        raise exception 'administer_role_frozen';
    end if;
    -- A missing answer must never fall through to the removal branch.
    if set_role_permission.granted is null then
        raise exception 'granted_required';
    end if;

    update public.roles
    set permissions = case
        when set_role_permission.granted then array_append(target.permissions, set_role_permission.permission)
        else array_remove(target.permissions, set_role_permission.permission)
    end
    where id = target.id;
    return public.role_names(target.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Every audit read needs audit.view.
-- ---------------------------------------------------------------------------

drop policy "Staff read the history of what they may read" on public.audit_log;
create policy "Only the Super Admin reads the audit history"
    on public.audit_log for select
    to authenticated
    using ((select public.has_permission('audit.view')));

-- lead_history as 20261020900400_school_fee_payments.sql made it, now for
-- audit.view alone and refusing everyone else with `forbidden`. The Super
-- Admin reads every scope, so payment rows always show.
create or replace function public.lead_history(lead_id uuid)
returns table (
    id bigint,
    created_at timestamptz,
    table_name text,
    row_id uuid,
    action text,
    old_values jsonb,
    new_values jsonb,
    actor_kind text,
    actor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if not public.has_permission('audit.view') then
        raise exception 'forbidden';
    end if;

    if not exists (select 1 from public.leads l where l.id = lead_history.lead_id) then
        raise exception 'not_found';
    end if;

    return query
    with own as (
        select a.*
        from public.audit_log a
        where a.lead_id = lead_history.lead_id
          and a.scope in ('lead', 'payment')
    ),
    contacts as (
        select (o.new_values ->> 'guardian_contact_id')::uuid as contact_id
        from own o
        where o.table_name = 'leads' and o.new_values ? 'guardian_contact_id'
        union
        select (o.old_values ->> 'guardian_contact_id')::uuid
        from own o
        where o.table_name = 'leads' and o.old_values ? 'guardian_contact_id'
    ),
    entries as (
        select * from own
        union all
        select a.*
        from public.audit_log a
        where a.table_name = 'guardian_contacts'
          and a.scope = 'lead'
          and a.row_id in (select c.contact_id from contacts c where c.contact_id is not null)
    )
    select e.id, e.created_at, e.table_name, e.row_id, e.action, e.old_values, e.new_values,
           e.actor_kind, s.full_name
    from entries e
    left join public.staff_members s on s.id = e.actor_staff_id
    order by e.created_at desc, e.id desc;
end;
$$;

-- The system audit screen: every audit row, newest first, a page at a time,
-- with the actor's name and the lead's Admission Number. Filters, each
-- optional: days in East Africa Time from and to (inclusive), the actor (a
-- staff id, or `system`, `public_form`, `workbook_import`), the area
-- (`lead`, `payment`, `staff_admin`) and the record (an Admission Number, or
-- a record id matched against the row and the lead). `total` repeats the
-- number of matching rows on every row. Refusal codes: `forbidden`, and
-- `invalid` for a bad page or filter.
create function public.audit_entries(
    from_day date default null,
    to_day date default null,
    actor text default null,
    area text default null,
    record text default null,
    page_limit integer default 50,
    page_offset integer default 0
)
returns table (
    id bigint,
    created_at timestamptz,
    scope text,
    table_name text,
    row_id uuid,
    lead_id uuid,
    admission_number text,
    action text,
    old_values jsonb,
    new_values jsonb,
    actor_kind text,
    actor_staff_id uuid,
    actor_name text,
    total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    actor_kind_filter text;
    actor_staff_filter uuid;
    record_text text := nullif(btrim(coalesce(audit_entries.record, '')), '');
    record_id uuid;
    record_lead uuid;
begin
    if not public.has_permission('audit.view') then
        raise exception 'forbidden';
    end if;

    if page_limit is null or page_limit not between 1 and 200 or page_offset is null or page_offset < 0
       or (audit_entries.area is not null and audit_entries.area not in ('lead', 'payment', 'staff_admin')) then
        raise exception 'invalid';
    end if;

    if audit_entries.actor in ('system', 'public_form', 'workbook_import') then
        actor_kind_filter := audit_entries.actor;
    elsif audit_entries.actor is not null then
        begin
            actor_staff_filter := audit_entries.actor::uuid;
        exception when invalid_text_representation then
            raise exception 'invalid';
        end;
        actor_kind_filter := 'staff';
    end if;

    if record_text is not null then
        if upper(record_text) ~ '^ADMSN-[0-9]{5}$' then
            select l.id into record_lead from public.leads l where l.admission_number = upper(record_text);
            -- An Admission Number nobody holds matches nothing.
            record_id := coalesce(record_lead, '00000000-0000-0000-0000-000000000000'::uuid);
        else
            begin
                record_id := record_text::uuid;
            exception when invalid_text_representation then
                raise exception 'invalid';
            end;
        end if;
    end if;

    return query
    select a.id, a.created_at, a.scope, a.table_name, a.row_id, a.lead_id, l.admission_number,
           a.action, a.old_values, a.new_values, a.actor_kind, a.actor_staff_id, s.full_name,
           count(*) over ()
    from public.audit_log a
    left join public.leads l on l.id = a.lead_id
    left join public.staff_members s on s.id = a.actor_staff_id
    where (from_day is null or a.created_at >= (from_day::timestamp at time zone 'Africa/Dar_es_Salaam'))
      and (to_day is null or a.created_at < ((to_day + 1)::timestamp at time zone 'Africa/Dar_es_Salaam'))
      and (actor_kind_filter is null or a.actor_kind = actor_kind_filter)
      and (actor_staff_filter is null or a.actor_staff_id = actor_staff_filter)
      and (audit_entries.area is null or a.scope = audit_entries.area)
      and (record_id is null or a.row_id = record_id or a.lead_id = record_id)
    order by a.created_at desc, a.id desc
    limit page_limit offset page_offset;
end;
$$;

revoke execute on function public.audit_entries(date, date, text, text, text, integer, integer) from public, anon;
grant execute on function public.audit_entries(date, date, text, text, text, integer, integer) to authenticated;

-- The one fact every lead reader keeps once the history is the Super
-- Admin's: when the lead's status last changed (its creation, if never).
-- For staff with leads.view; `forbidden` otherwise, `not_found` for no lead.
create function public.lead_status_since(lead_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    created timestamptz;
    changed timestamptz;
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select l.created_at into created from public.leads l where l.id = lead_status_since.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select max(a.created_at) into changed
    from public.audit_log a
    where a.table_name = 'leads'
      and a.row_id = lead_status_since.lead_id
      and a.action = 'update'
      and a.new_values ? 'status';
    return coalesce(changed, created);
end;
$$;

revoke execute on function public.lead_status_since(uuid) from public, anon;
grant execute on function public.lead_status_since(uuid) to authenticated;
