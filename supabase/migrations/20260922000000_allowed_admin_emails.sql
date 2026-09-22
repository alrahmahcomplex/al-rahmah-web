-- Staff allowlist. Only emails listed here can sign in to the staff side of
-- the app. Rows are added by hand (Supabase dashboard or SQL) before a staff
-- member's first sign-in.

create table public.allowed_admin_emails (
    email text primary key check (email = lower(email)),
    added_at timestamptz not null default now()
);

alter table public.allowed_admin_emails enable row level security;

-- True when the signed-in user's email is on the allowlist. SECURITY DEFINER
-- so it can read the table past RLS; the empty search_path stops a caller
-- from shadowing public.allowed_admin_emails with their own object.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.allowed_admin_emails
        where email = lower(auth.email())
    );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Staff can see and manage the allowlist. Anonymous and non-staff users
-- see no rows and cannot write.
create policy "Staff can read the allowlist"
    on public.allowed_admin_emails for select
    to authenticated
    using ((select public.is_admin()));

create policy "Staff can add to the allowlist"
    on public.allowed_admin_emails for insert
    to authenticated
    with check ((select public.is_admin()));

create policy "Staff can update the allowlist"
    on public.allowed_admin_emails for update
    to authenticated
    using ((select public.is_admin()))
    with check ((select public.is_admin()));

create policy "Staff can remove from the allowlist"
    on public.allowed_admin_emails for delete
    to authenticated
    using ((select public.is_admin()));

-- Refuse to create an auth user whose email is not on the allowlist, so
-- sign-ups through the public Auth API cannot mint accounts.
create function public.block_unlisted_signups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.allowed_admin_emails
        where email = lower(new.email)
    ) then
        raise exception 'This email is not on the staff allowlist.';
    end if;
    return new;
end;
$$;

revoke execute on function public.block_unlisted_signups() from public, anon, authenticated;

create trigger enforce_staff_allowlist
    before insert on auth.users
    for each row
    execute function public.block_unlisted_signups();
