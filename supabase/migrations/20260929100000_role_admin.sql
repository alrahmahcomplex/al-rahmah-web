-- The guardrailed writes behind the role side of the Staff and roles screen:
-- create a role, rename it, tick and untick its permissions, retire it.
--
-- Like the staff member writes, each refusal raises a stable code as the
-- error message, with the names its sentence needs as JSON in the detail.
--
-- Roles that hold staff.administer are frozen here (administer_role_frozen,
-- an amendment to ADR 3): nobody edits, renames or retires them through the
-- app, and nobody grants or removes staff.administer on any role. They
-- change only through a reviewed migration.

-- ---------------------------------------------------------------------------
-- Nobody writes to roles directly through the API. RLS already has no write
-- policies; revoking the grants makes an attempt fail loudly.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.roles from anon, authenticated;

-- What each role write returns: the role as it stands after the change.
create function public.role_names(role_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object('id', r.id, 'role', r.name)
    from public.roles r
    where r.id = role_names.role_id;
$$;

revoke execute on function public.role_names(uuid) from public, anon, authenticated;

-- A role name, trimmed. Refuses an empty name, or one another role already
-- has ignoring case.
create function public.checked_role_name(name text, own_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    trimmed text := btrim(coalesce(checked_role_name.name, ''));
begin
    if trimmed = '' then
        raise exception 'role_name_required';
    end if;
    if exists (
        select 1 from public.roles r
        where lower(r.name) = lower(trimmed)
          and r.id is distinct from checked_role_name.own_id
    ) then
        raise exception 'duplicate_role_name' using detail = jsonb_build_object('role', trimmed)::text;
    end if;
    return trimmed;
end;
$$;

revoke execute on function public.checked_role_name(text, uuid) from public, anon, authenticated;

-- Locks the role for the rest of the transaction and refuses a change to it
-- when the caller holds it, it is retired, or it can administer staff.
-- Returns the role as it stood.
create function public.editable_role(role_id uuid)
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
    if not found then
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

revoke execute on function public.editable_role(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The write functions. They run under the caller's session, so the audit
-- trigger names the caller as the actor.
-- ---------------------------------------------------------------------------

-- A new role starts with no permissions.
create function public.create_role(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_id uuid;
begin
    perform public.require_staff_administrator();

    insert into public.roles (name, permissions)
    values (public.checked_role_name(create_role.name), '{}')
    returning id into new_id;
    return public.role_names(new_id);
exception
    -- Two Managers adding the same name at once: the unique index decides.
    when unique_violation then
        raise exception 'duplicate_role_name'
            using detail = jsonb_build_object('role', btrim(create_role.name))::text;
end;
$$;

create function public.rename_role(role_id uuid, name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles := public.editable_role(rename_role.role_id);
begin
    update public.roles
    set name = public.checked_role_name(rename_role.name, target.id)
    where id = target.id;
    return public.role_names(target.id);
exception
    when unique_violation then
        raise exception 'duplicate_role_name'
            using detail = jsonb_build_object('role', btrim(rename_role.name))::text;
end;
$$;

-- Ticks or unticks one permission. Changing one at a time, rather than
-- replacing the whole set, means two Managers ticking different boxes at
-- once never undo each other.
create function public.set_role_permission(role_id uuid, permission text, granted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles := public.editable_role(set_role_permission.role_id);
begin
    if not exists (select 1 from public.permissions p where p.name = set_role_permission.permission) then
        raise exception 'unknown_permission' using detail = set_role_permission.permission;
    end if;
    if set_role_permission.permission = 'staff.administer' then
        raise exception 'administer_role_frozen';
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

-- A retired role drops out of the choices and stays in history. Refused
-- while an active staff member holds it; deactivated holders don't count.
create function public.retire_role(role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.roles := public.editable_role(retire_role.role_id);
    holders jsonb;
begin
    -- The role is locked, so nobody can be moved onto it or reactivated on
    -- it between this count and the update.
    select jsonb_agg(s.full_name order by s.full_name) into holders
    from public.staff_members s
    where s.role_id = target.id and s.active;
    if holders is not null then
        raise exception 'role_has_active_holders'
            using detail = jsonb_build_object('role', target.name, 'names', holders)::text;
    end if;

    update public.roles set retired = true where id = target.id;
    return public.role_names(target.id);
end;
$$;

revoke execute on function public.create_role(text) from public, anon;
revoke execute on function public.rename_role(uuid, text) from public, anon;
revoke execute on function public.set_role_permission(uuid, text, boolean) from public, anon;
revoke execute on function public.retire_role(uuid) from public, anon;
grant execute on function public.create_role(text) to authenticated;
grant execute on function public.rename_role(uuid, text) to authenticated;
grant execute on function public.set_role_permission(uuid, text, boolean) to authenticated;
grant execute on function public.retire_role(uuid) to authenticated;
