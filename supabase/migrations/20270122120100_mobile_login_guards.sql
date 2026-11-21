-- Guards for signing in with a mobile (#503 slice 2a). The sign-in page
-- checks who a login belongs to, but Supabase Auth hands out a session to
-- anyone whose phone and password match, so these rules live here too.

-- ---------------------------------------------------------------------------
-- Staff sign in with their email only (owner decision 76). No staff login
-- may carry a phone: refused when the login is created for a staff email,
-- and when a phone is put on a login linked to a staff record.
-- ---------------------------------------------------------------------------

create function public.refuse_staff_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if nullif(new.phone, '') is not null
       and (
           (tg_op = 'INSERT' and new.email is not null and public.staff_login_open(new.email))
           or exists (select 1 from public.staff_members s where s.user_id = new.id)
       ) then
        raise exception 'Staff sign in with their email only.';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_staff_phone() from public, anon, authenticated, service_role;

create trigger refuse_staff_phone_on_insert
    before insert on auth.users
    for each row
    execute function public.refuse_staff_phone();

create trigger refuse_staff_phone_on_update
    before update of phone on auth.users
    for each row
    when (new.phone is distinct from old.phone)
    execute function public.refuse_staff_phone();

-- ---------------------------------------------------------------------------
-- Only the app puts a mobile on a login. A signed-in person asking Auth to
-- change their own phone (updateUser) gets a pending phone_change, which is
-- refused here, so nobody can claim a number that isn't theirs. The app
-- sets the phone directly with the secret key, which never fills
-- phone_change.
-- ---------------------------------------------------------------------------

create function public.refuse_phone_change_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    raise exception 'A mobile is put on a login only by the app.';
end;
$$;

revoke execute on function public.refuse_phone_change_requests() from public, anon, authenticated, service_role;

create trigger refuse_phone_change_requests
    before update of phone_change on auth.users
    for each row
    when (coalesce(new.phone_change, '') <> '' and new.phone_change is distinct from old.phone_change)
    execute function public.refuse_phone_change_requests();

-- ---------------------------------------------------------------------------
-- A retired agent's login also loses its mobile. Supabase checks a ban
-- before the password, so a kept mobile would answer "banned" where an
-- unknown one says wrong details, telling anyone that the number was an
-- agent's. Freed, the number can belong to a login again.
-- ---------------------------------------------------------------------------

create or replace function public.ban_detached_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update auth.users
    set banned_until = 'infinity',
        email = new.user_id || '@retired.invalid',
        phone = null,
        phone_confirmed_at = null,
        updated_at = now()
    where id = new.user_id;
    update auth.identities
    set identity_data = identity_data || jsonb_build_object('email', new.user_id || '@retired.invalid'), updated_at = now()
    where user_id = new.user_id and provider = 'email';
    delete from auth.identities where user_id = new.user_id and provider = 'phone';
    delete from auth.sessions where user_id = new.user_id;
    return null;
end;
$$;

revoke execute on function public.ban_detached_login() from public, anon, authenticated, service_role;
