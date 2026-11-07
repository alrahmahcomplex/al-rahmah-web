-- Roles v2 (#241, owner decision 44 of 2026-11-07). Roles become the Super
-- Admin's data, created from templates the app defines
-- (lib/role-templates.ts), and staff management is delegated by a managed
-- set: the roles whose staff a role's holders may invite, resend an invite
-- to, deactivate, reactivate, reassign within the set, and correct the name
-- of.
--
-- On hosted this runs after 20261130990100_hosted_test_data_reset.sql and
-- 20261130990300_super_admin_role.sql, so it meets the three seeded roles,
-- the Super Admin role and its holder, and nobody else. On a fresh local or
-- CI database it meets the same, since seeds load after migrations;
-- supabase/seeds/00_base.sql then recreates the three roles for fixtures.
--
-- 1. The two guards that assumed a role other than the Super Admin
--    administers go: refuse_no_administrator_left (the Super Admin is the
--    permanent administrator) and administer_role_frozen (the Super Admin
--    edits every role, the Admissions Manager's included).
-- 2. staff.administer is retired. The managed set is the only thing that
--    grants staff management; the Super Admin needs no permission name.
-- 3. The three seeded roles are removed when no staff record references
--    them. They live on as templates in the app.
-- 4. The managed-set relation, role_managed_roles.
-- 5. Role writes are the Super Admin's alone, and refuse everyone else with
--    `forbidden`.
-- 6. Staff writes and reads follow the caller's managed set; a target
--    outside it is `forbidden`.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- 1. The legacy guards.
-- ---------------------------------------------------------------------------

drop trigger refuse_no_administrator_left on public.staff_members;
drop trigger refuse_no_administrator_left on public.roles;
drop function public.refuse_no_administrator_left();
drop function public.administrator_count();

-- ---------------------------------------------------------------------------
-- 2. staff.administer retired. invite_sent needed it to be recorded; its
--    kind now names no permission, and record_action accepts such a kind
--    from anyone who manages staff.
-- ---------------------------------------------------------------------------

update public.roles
set permissions = array_remove(permissions, 'staff.administer')
where 'staff.administer' = any (permissions);

alter table public.audit_action_kinds alter column permission drop not null;
update public.audit_action_kinds set permission = null where kind = 'invite_sent';

delete from public.permissions where name = 'staff.administer';

-- ---------------------------------------------------------------------------
-- 3. The seeded roles become templates. A role a staff record references,
--    active or not, stays: its holders keep it. The removal is recorded as
--    one system audit row, since the history is otherwise append-only and a
--    delete writes nothing.
-- ---------------------------------------------------------------------------

do $$
declare
    removed text[];
begin
    alter table public.roles disable trigger refuse_delete;

    with gone as (
        delete from public.roles r
        where r.name in ('Admissions Staff', 'Admissions Manager', 'Accountant')
          and not exists (select 1 from public.staff_members s where s.role_id = r.id)
        returning r.name
    )
    select array_agg(name order by name) into removed from gone;

    alter table public.roles enable trigger refuse_delete;

    if removed is not null then
        insert into public.audit_log (action, new_values, scope, actor_kind)
        values ('roles_became_templates', jsonb_build_object('ticket', '#241', 'removed', to_jsonb(removed)), 'staff_admin', 'system');
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The managed set: which roles' staff a role's holders manage. A pair is
--    switched off rather than deleted, so its history stays.
-- ---------------------------------------------------------------------------

create table public.role_managed_roles (
    id uuid primary key default gen_random_uuid(),
    role_id uuid not null references public.roles (id),
    managed_role_id uuid not null references public.roles (id),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (role_id, managed_role_id),
    check (role_id <> managed_role_id)
);

create index role_managed_roles_managed_role_id_idx on public.role_managed_roles (managed_role_id);

insert into public.audit_scopes (table_name, scope) values ('public.role_managed_roles', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.role_managed_roles
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.role_managed_roles
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.role_managed_roles
    for each statement
    execute function public.refuse_delete();

-- The Super Admin role neither manages nor is managed: it already reaches
-- everyone, and no holder of another role may touch its holder. Trigger
-- functions run with the writer's rights, so the id is spelled out, as in
-- 20261130990300_super_admin_role.sql.
create function public.refuse_super_admin_managed_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.role_id = '5a000000-0000-4000-8000-000000000001'::uuid
       or new.managed_role_id = '5a000000-0000-4000-8000-000000000001'::uuid then
        raise exception 'super_admin_frozen' using detail = 'managed_set';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_super_admin_managed_set() from public, anon, authenticated;

create trigger refuse_super_admin_managed_set
    before insert or update on public.role_managed_roles
    for each row
    execute function public.refuse_super_admin_managed_set();

alter table public.role_managed_roles enable row level security;

create policy "Active staff read the managed sets"
    on public.role_managed_roles for select
    to authenticated
    using ((select public.is_active_staff()));

revoke insert, update, delete, truncate on public.role_managed_roles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The checks.
-- ---------------------------------------------------------------------------

-- True when the signed-in person may manage staff on `role_id`: the active
-- Super Admin for any role, or an active holder of an unretired role whose
-- managed set holds it. Row security on staff_members asks it per row.
create function public.manages_role(role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_super_admin() or exists (
        select 1
        from public.staff_members s
        join public.roles r on r.id = s.role_id
        join public.role_managed_roles m on m.role_id = r.id
        where s.id = public.current_staff_id()
          and s.active
          and not r.retired
          and m.active
          and m.managed_role_id = manages_role.role_id
    );
$$;

revoke execute on function public.manages_role(uuid) from public, anon;
grant execute on function public.manages_role(uuid) to authenticated;

-- True when the signed-in person manages anyone at all.
create function public.manages_any_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_super_admin() or exists (
        select 1
        from public.staff_members s
        join public.roles r on r.id = s.role_id
        join public.role_managed_roles m on m.role_id = r.id
        where s.id = public.current_staff_id()
          and s.active
          and not r.retired
          and m.active
    );
$$;

revoke execute on function public.manages_any_staff() from public, anon, authenticated;

-- The caller's staff id, if they manage anyone. Someone who manages nobody
-- is refused as before, `not_permitted`, with their role's name.
create or replace function public.require_staff_administrator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    caller_role text;
begin
    if public.manages_any_staff() then
        return public.current_staff_id();
    end if;

    select r.name into caller_role
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.id = public.current_staff_id();
    raise exception 'not_permitted'
        using detail = jsonb_strip_nulls(jsonb_build_object('role', caller_role))::text;
end;
$$;

-- Refuses, as `forbidden`, a staff change on a role outside the caller's
-- managed set.
create function public.require_manages(role_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.manages_role(require_manages.role_id) then
        raise exception 'forbidden';
    end if;
end;
$$;

revoke execute on function public.require_manages(uuid) from public, anon, authenticated;

-- The caller's staff id, if they are the Super Admin; `forbidden` for
-- everyone else, the secret key and the database roles included, since
-- none of them is signed in as the holder.
create function public.require_super_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_super_admin() then
        raise exception 'forbidden';
    end if;
    return public.current_staff_id();
end;
$$;

revoke execute on function public.require_super_admin() from public, anon, authenticated;

-- record_action as 20260928000000_staff_members_and_roles.sql made it. A
-- kind that names no permission (invite_sent) is open to anyone who manages
-- staff.
create or replace function public.record_action(kind text, lead_id uuid default null, details jsonb default '{}')
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

    if action_kind.permission is null then
        if not public.manages_any_staff() then
            raise exception 'not_permitted' using detail = record_action.kind;
        end if;
    elsif not public.has_permission(action_kind.permission) then
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

-- current_staff_member as 20261130990300_super_admin_role.sql made it, plus
-- whether the person is the Super Admin and the roles they manage, so the
-- app shows Staff and roles to exactly those who can use it. Dropped first:
-- the columns change.
drop function public.current_staff_member();

create function public.current_staff_member()
returns table (
    id uuid,
    full_name text,
    email text,
    active boolean,
    role_name text,
    permissions text[],
    super_admin boolean,
    managed_role_ids uuid[]
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
        end,
        s.active and not r.retired and r.id = public.super_admin_role_id(),
        case
            when not s.active or r.retired then '{}'::uuid[]
            else array(
                select m.managed_role_id from public.role_managed_roles m
                where m.role_id = r.id and m.active
                order by m.managed_role_id
            )
        end
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.id = public.current_staff_id();
$$;

revoke execute on function public.current_staff_member() from public, anon;
grant execute on function public.current_staff_member() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Role writes: the Super Admin's alone.
-- ---------------------------------------------------------------------------

-- Locks the role and refuses a change to it when it is retired. Returns the
-- role as it stood. The Super Admin role is not_found, as before.
create or replace function public.editable_role(role_id uuid)
returns public.roles
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles;
begin
    perform public.require_super_admin();

    select * into target from public.roles r where r.id = editable_role.role_id for update;
    if not found or target.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    if target.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', target.name)::text;
    end if;
    return target;
end;
$$;

-- set_role_permission as 20261130990300_super_admin_role.sql made it,
-- without the staff.administer refusal: the permission no longer exists.
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

-- One pair of the managed set, on or off, for a role that exists and is not
-- the Super Admin's. Switching a pair on needs both roles current.
create function public.write_managed_pair(manager_id uuid, managed_id uuid, manages boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    manager public.roles;
    managed public.roles;
begin
    select * into manager from public.roles r where r.id = write_managed_pair.manager_id for share;
    if not found or manager.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    select * into managed from public.roles r where r.id = write_managed_pair.managed_id for share;
    if not found or managed.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    if manager.id = managed.id then
        raise exception 'manages_itself' using detail = jsonb_build_object('role', manager.name)::text;
    end if;
    if write_managed_pair.manages and (manager.retired or managed.retired) then
        raise exception 'role_retired'
            using detail = jsonb_build_object('role', case when manager.retired then manager.name else managed.name end)::text;
    end if;

    insert into public.role_managed_roles as m (role_id, managed_role_id, active)
    values (manager.id, managed.id, write_managed_pair.manages)
    on conflict on constraint role_managed_roles_role_id_managed_role_id_key do update
        set active = excluded.active
        where m.active is distinct from excluded.active;
end;
$$;

revoke execute on function public.write_managed_pair(uuid, uuid, boolean) from public, anon, authenticated;

-- A new role, made blank or from a template: its name, its permissions, the
-- roles it manages and the roles that manage it, in one step. The app reads
-- the template and resolves the other roles by name.
drop function public.create_role(text);

create function public.create_role(
    name text,
    permissions text[] default '{}',
    manages uuid[] default '{}',
    managed_by uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_id uuid;
    other uuid;
begin
    perform public.require_super_admin();

    if 'audit.view' = any (coalesce(create_role.permissions, '{}')) then
        raise exception 'unknown_permission' using detail = 'audit.view';
    end if;

    begin
        insert into public.roles (name, permissions)
        values (public.checked_role_name(create_role.name), coalesce(create_role.permissions, '{}'))
        returning id into new_id;
    exception
        -- Two creations of the same name at once: the unique index decides.
        when unique_violation then
            raise exception 'duplicate_role_name'
                using detail = jsonb_build_object('role', btrim(create_role.name))::text;
    end;

    for other in select distinct unnest(coalesce(create_role.manages, '{}')) loop
        perform public.write_managed_pair(new_id, other, true);
    end loop;
    for other in select distinct unnest(coalesce(create_role.managed_by, '{}')) loop
        perform public.write_managed_pair(other, new_id, true);
    end loop;

    return public.role_names(new_id);
end;
$$;

revoke execute on function public.create_role(text, text[], uuid[], uuid[]) from public, anon;
grant execute on function public.create_role(text, text[], uuid[], uuid[]) to authenticated;

-- Brings a retired role back. Its earlier managed-set pairs apply again.
create function public.reactivate_role(role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles;
begin
    perform public.require_super_admin();

    select * into target from public.roles r where r.id = reactivate_role.role_id for update;
    if not found or target.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    if not target.retired then
        raise exception 'role_not_retired' using detail = jsonb_build_object('role', target.name)::text;
    end if;

    update public.roles set retired = false where id = target.id;
    return public.role_names(target.id);
end;
$$;

revoke execute on function public.reactivate_role(uuid) from public, anon;
grant execute on function public.reactivate_role(uuid) to authenticated;

-- Adds a role to another role's managed set, or takes it out.
create function public.set_role_manages(role_id uuid, managed_role_id uuid, manages boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_super_admin();

    if set_role_manages.manages is null then
        raise exception 'manages_required';
    end if;
    perform public.write_managed_pair(set_role_manages.role_id, set_role_manages.managed_role_id, set_role_manages.manages);
    return public.role_names(set_role_manages.role_id);
end;
$$;

revoke execute on function public.set_role_manages(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_role_manages(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff writes and reads, scoped by managed set. Each is as
--    20261130990300_super_admin_role.sql made it, with require_manages after
--    the hidden-holder check, so the Super Admin's role and holder still
--    read as not_found.
-- ---------------------------------------------------------------------------

drop policy "Own record; administrators read all but the Super Admin" on public.staff_members;
create policy "Own record, and the staff the caller manages"
    on public.staff_members for select
    to authenticated
    using (
        (user_id = (select auth.uid()) and active)
        or (role_id <> '5a000000-0000-4000-8000-000000000001'::uuid and public.manages_role(role_id))
    );

-- Reassigns only from and to roles in the caller's managed set.
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
    perform public.require_manages(target.role_id);
    perform public.require_manages(new_role.id);
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
    perform public.require_manages(target.role_id);
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
    perform public.require_manages(target.role_id);
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
    target public.staff_members;
begin
    perform public.require_staff_administrator();

    if corrected = '' then
        raise exception 'name_required';
    end if;
    select * into target from public.staff_members s where s.id = correct_staff_name.staff_id for update;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;
    perform public.require_manages(target.role_id);

    update public.staff_members s set full_name = corrected where s.id = target.id;
    return public.staff_member_names(target.id);
end;
$$;

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
    perform public.require_manages(target.role_id);
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
    where public.staff_member_invited(s.id)
      and not public.hidden_staff_member(s.id)
      and public.manages_role(s.role_id);
$$;

-- Invites only into a role in the caller's managed set.
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
    perform public.require_manages(invited_role.id);
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
        -- Two people inviting the same email at once: the second loses here.
        select * into existing from public.staff_members s where s.email = invited_email;
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end;

    return public.staff_member_names(new_id) || jsonb_build_object('id', new_id, 'email', invited_email);
end;
$$;

select set_config('audit.actor_kind', '', true);
