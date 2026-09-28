-- The guardrailed writes behind the Staff and roles screen: move a staff
-- member to another role, deactivate, reactivate, correct their name.
--
-- Every write to staff_members goes through one of these functions. Each
-- refusal raises a stable code as the error message, with the names its
-- sentence needs as JSON in the error detail. The staff-admin service turns
-- the code into the sentence a person reads.

-- ---------------------------------------------------------------------------
-- Nobody writes to staff_members directly through the API. RLS already has no
-- write policies; revoking the grants as well makes an attempt fail loudly
-- instead of silently changing no rows.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.staff_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- There is always someone who can administer staff. This holds for every
-- write, the secret key and the SQL editor included, so it is a trigger
-- rather than a check inside the functions.
-- ---------------------------------------------------------------------------

create function public.administrator_count()
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
      and 'staff.administer' = any (r.permissions);
$$;

revoke execute on function public.administrator_count() from public, anon, authenticated;

create function public.refuse_no_administrator_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    was_administering boolean;
begin
    -- Only a change to a row that gave someone the power to administer can
    -- take it away, so a fresh database with no administrator yet can still
    -- be set up.
    if tg_table_name = 'staff_members' then
        was_administering := old.active and exists (
            select 1 from public.roles r
            where r.id = old.role_id and not r.retired and 'staff.administer' = any (r.permissions)
        );
    else
        was_administering := not old.retired and 'staff.administer' = any (old.permissions);
    end if;
    if not was_administering then
        return null;
    end if;

    -- Two changes that each leave one administrator behind could both pass
    -- if they counted at the same time. The lock makes the second wait for
    -- the first to commit, and its count then sees the first one's change.
    perform pg_advisory_xact_lock(hashtext('public.administrator_count'));
    if public.administrator_count() = 0 then
        raise exception 'no_administrator_left';
    end if;
    return null;
end;
$$;

revoke execute on function public.refuse_no_administrator_left() from public, anon, authenticated;

create trigger refuse_no_administrator_left
    after update of active, role_id on public.staff_members
    for each row
    when (old.active is distinct from new.active or old.role_id is distinct from new.role_id)
    execute function public.refuse_no_administrator_left();

create trigger refuse_no_administrator_left
    after update of retired, permissions on public.roles
    for each row
    when (old.retired is distinct from new.retired or old.permissions is distinct from new.permissions)
    execute function public.refuse_no_administrator_left();

-- ---------------------------------------------------------------------------
-- The write functions. SECURITY DEFINER so they can write past RLS; each one
-- checks the caller first. They run under the caller's session, so the audit
-- trigger names the caller as the actor.
-- ---------------------------------------------------------------------------

-- The caller's staff id, if their role holds staff.administer right now.
-- Otherwise refuses with not_permitted, naming the caller's role.
create function public.require_staff_administrator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    caller_id uuid;
    caller_role text;
begin
    if public.has_permission('staff.administer') then
        select s.id into caller_id from public.staff_members s where s.user_id = auth.uid();
        return caller_id;
    end if;

    select r.name into caller_role
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.user_id = auth.uid();
    raise exception 'not_permitted'
        using detail = jsonb_strip_nulls(jsonb_build_object('role', caller_role))::text;
end;
$$;

revoke execute on function public.require_staff_administrator() from public, anon, authenticated;

create function public.assign_staff_role(staff_id uuid, role_id uuid)
returns void
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
    if not found then
        raise exception 'not_found';
    end if;
    -- Held until commit, so the role can't be retired between this check and the move.
    select * into new_role from public.roles r where r.id = assign_staff_role.role_id for share;
    if not found then
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
end;
$$;

create function public.deactivate_staff_member(staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := public.require_staff_administrator();
    target public.staff_members;
begin
    select * into target from public.staff_members s where s.id = deactivate_staff_member.staff_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    if target.id = caller_id then
        raise exception 'own_account';
    end if;
    if not target.active then
        raise exception 'already_deactivated' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;

    update public.staff_members set active = false where id = target.id;
end;
$$;

create function public.reactivate_staff_member(staff_id uuid)
returns void
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
    if not found then
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
end;
$$;

-- A typo in a name should not stay on the history forever. Anyone who
-- administers staff may correct any name, their own included.
create function public.correct_staff_name(staff_id uuid, full_name text)
returns void
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

    update public.staff_members s set full_name = corrected where s.id = correct_staff_name.staff_id;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

revoke execute on function public.assign_staff_role(uuid, uuid) from public, anon;
revoke execute on function public.deactivate_staff_member(uuid) from public, anon;
revoke execute on function public.reactivate_staff_member(uuid) from public, anon;
revoke execute on function public.correct_staff_name(uuid, text) from public, anon;
grant execute on function public.assign_staff_role(uuid, uuid) to authenticated;
grant execute on function public.deactivate_staff_member(uuid) to authenticated;
grant execute on function public.reactivate_staff_member(uuid) to authenticated;
grant execute on function public.correct_staff_name(uuid, text) to authenticated;
