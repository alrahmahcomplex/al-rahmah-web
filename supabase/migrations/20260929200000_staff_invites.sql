-- Inviting staff from the Staff and roles screen.
--
-- The invite service works in this order: it checks the caller holds
-- staff.administer, creates the staff record through invite_staff_member on
-- the caller's session, sends the Supabase invite with the secret key, then
-- records invite_sent through record_action on the caller's session. The
-- record comes first because the sign-up trigger lets an account be created
-- only for an email on an active staff record.
--
-- Refusals follow the staff-admin functions: a stable code as the error
-- message, the names its sentence needs as JSON in the error detail.

-- A new active staff member in the given role, with no account yet. Returns
-- the names the screen's confirmation needs and the email to send to.
create function public.invite_staff_member(full_name text, email text, role_id uuid)
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
    if not found then
        raise exception 'not_found';
    end if;
    if invited_role.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', invited_role.name)::text;
    end if;

    select * into existing from public.staff_members s where s.email = invited_email;
    if found then
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
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

-- True while the staff member has no account or has not yet accepted their
-- invite. Accepting confirms the email and sets the password in the same
-- step, and a confirmed email is also what makes Supabase refuse to send the
-- invite again (email_exists), so the screen's Invited badge and its Resend
-- invite button always agree with what Supabase will do.
create function public.staff_member_invited(staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select u.email_confirmed_at is null
    from public.staff_members s
    left join auth.users u on u.id = s.user_id
    where s.id = staff_member_invited.staff_id;
$$;

revoke execute on function public.staff_member_invited(uuid) from public, anon, authenticated;

-- The last-administrator guard counts only administrators who have joined.
-- An invited Manager can't sign in yet, so leaving only them would leave
-- nobody able to manage staff or resend their invite. The first staff member
-- on a fresh database is inserted with no account, and nothing changes a
-- staff row before they join, so setting up still works.
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
      and 'staff.administer' = any (r.permissions)
      and not public.staff_member_invited(s.id);
$$;

-- Who to send a fresh invite to. Only an active staff member who has not
-- yet joined can be sent one.
create function public.resendable_invite(staff_id uuid)
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
    if not found then
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

-- The staff members still to accept their invite, for the screen's Invited
-- badge. Empty for a caller who does not administer staff.
create function public.invited_staff_members()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select s.id
    from public.staff_members s
    where public.has_permission('staff.administer')
      and public.staff_member_invited(s.id);
$$;

revoke execute on function public.invite_staff_member(text, text, uuid) from public, anon;
revoke execute on function public.resendable_invite(uuid) from public, anon;
revoke execute on function public.invited_staff_members() from public, anon;
grant execute on function public.invite_staff_member(text, text, uuid) to authenticated;
grant execute on function public.resendable_invite(uuid) to authenticated;
grant execute on function public.invited_staff_members() to authenticated;
