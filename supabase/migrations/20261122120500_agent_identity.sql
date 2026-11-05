-- Agent identity, the agent access switch and the ban on a retired agent's
-- login (slice 12, #188). Nothing an agent can do changes yet; this lets the
-- database recognise a signed-in agent safely. ADR 5 records the design.
--
-- - guard_login: a trigger on staff_members and marketing_agents, before an
--   email or user_id is written. It takes lock_login_email on the lowercased
--   email and refuses (`email_taken`, the email as JSON in the detail) an
--   email a staff member, a current agent or an unrelated auth user already
--   uses (a duplicate within one table meets that table's unique index, as
--   before). It also refuses a user_id the other table holds, so no login is
--   both staff and an agent. invite_staff_member and agent creation already
--   check first and give their own answers; this is the rule under them.
-- - current_principal(): who is signed in, `staff` or `agent`, from the one
--   table whose user_id matches auth.uid(). Only the base checks read
--   through it: has_permission, is_active_staff, current_staff_member,
--   audit_actor, and the new current_staff_id. The other staff lookups by
--   auth.uid() stay as they are, because an agent never matches a staff row.
--   An agent session has no audit actor, so it writes nothing audited.
-- - The auth.users triggers accept exactly one of: an active staff member
--   with no login yet, or an Approved, switched-on, non-retired agent with no
--   login yet, a confirmed email and agent access on. user_metadata.kind is
--   never read. They replace refuse_non_staff_signups and link_staff_account.
-- - agent_access_settings: one row, the agent access switch, off from setup.
--   Audited in staff_admin. agent_access() is the one reader; every agent
--   path checks it. set_agent_access changes it, for the database owner only
--   (the SQL editor or a migration, as `system` or a named staff member).
--   agent_access_status() is the Agents screen banner's read. Fees never
--   read it.
-- - A Retire that detaches a login (agent_detached_logins, #189) now bans
--   that auth user, ends their sessions and moves their email to
--   <user id>@retired.invalid, so the email is free in Supabase Auth too.

-- ---------------------------------------------------------------------------
-- One email and one login per person.
-- ---------------------------------------------------------------------------

create function public.guard_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    is_staff boolean := tg_table_name = 'staff_members';
    email_changed boolean := tg_op = 'INSERT' or new.email is distinct from old.email;
    user_changed boolean := tg_op = 'INSERT' or new.user_id is distinct from old.user_id;
begin
    -- A retired agent record holds no email or login that counts.
    if not is_staff and (to_jsonb(new) ->> 'retired_at') is not null then
        return new;
    end if;

    -- Two records of the same kind are left to that table's own unique
    -- index, so invite_staff_member and agent creation keep their answers to
    -- a duplicate; this checks the other table and Auth.
    if new.email is not null and email_changed then
        perform public.lock_login_email(new.email);
        if (not is_staff and exists (
            select 1 from public.staff_members s where s.email = lower(new.email)
        )) or (is_staff and exists (
            select 1 from public.marketing_agents a where a.email = lower(new.email) and a.retired_at is null
        )) or exists (
            select 1 from auth.users u
            where lower(u.email) = lower(new.email) and u.id is distinct from new.user_id
        ) then
            raise exception 'email_taken' using detail = jsonb_build_object('email', lower(new.email))::text;
        end if;
    end if;

    if new.user_id is not null and user_changed then
        if (is_staff and exists (select 1 from public.marketing_agents a where a.user_id = new.user_id))
           or (not is_staff and exists (select 1 from public.staff_members s where s.user_id = new.user_id)) then
            raise exception 'login_taken';
        end if;
    end if;

    return new;
end;
$$;

revoke execute on function public.guard_login() from public, anon, authenticated, service_role;

create trigger guard_login
    before insert or update of email, user_id on public.staff_members
    for each row
    execute function public.guard_login();

create trigger guard_login
    before insert or update of email, user_id on public.marketing_agents
    for each row
    execute function public.guard_login();

-- ---------------------------------------------------------------------------
-- current_principal and the base checks.
-- ---------------------------------------------------------------------------

-- Who is signed in: `staff` with their staff id, `agent` with their agent id,
-- or nothing. A login both tables claimed would be a broken state that
-- guard_login prevents; it resolves to nothing rather than to either.
create function public.current_principal(out kind text, out staff_id uuid, out agent_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
    select
        case
            when s.id is not null and a.id is null then 'staff'
            when a.id is not null and s.id is null then 'agent'
        end,
        case when a.id is null then s.id end,
        case when s.id is null then a.id end
    from (select auth.uid() as uid) me
    left join public.staff_members s on s.user_id = me.uid
    left join public.marketing_agents a on a.user_id = me.uid
    where me.uid is not null;
$$;

revoke execute on function public.current_principal() from public, anon, authenticated, service_role;

-- The signed-in staff member's id, active or not; nothing for anyone else.
create function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select p.staff_id from public.current_principal() p where p.kind = 'staff';
$$;

revoke execute on function public.current_staff_id() from public, anon, authenticated, service_role;

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
          and has_permission.permission = any (r.permissions)
    );
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff_members
        where id = public.current_staff_id() and active
    );
$$;

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
        case when s.active and not r.retired then r.permissions else '{}'::text[] end
    from public.staff_members s
    join public.roles r on r.id = s.role_id
    where s.id = public.current_staff_id();
$$;

-- Who is acting: the staff member behind the session, else the actor set for
-- the transaction. Empty when neither is known, and always empty for an
-- agent session: agents write nothing (ADR 5), so no agent actor exists.
create or replace function public.audit_actor(out kind text, out staff_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    me record;
begin
    select * into me from public.current_principal();
    if me.kind = 'staff' then
        kind := 'staff';
        staff_id := me.staff_id;
        return;
    end if;
    if me.kind = 'agent' then
        return;
    end if;

    kind := nullif(current_setting('audit.actor_kind', true), '');
    staff_id := nullif(current_setting('audit.actor_staff_id', true), '')::uuid;
end;
$$;

-- ---------------------------------------------------------------------------
-- The agent access switch.
-- ---------------------------------------------------------------------------

create table public.agent_access_settings (
    id uuid primary key default gen_random_uuid(),
    -- Only ever one row.
    singleton boolean not null default true unique check (singleton),
    enabled boolean not null default false,
    -- Empty while it has never changed since setup.
    changed_at timestamptz,
    changed_by_kind text check (changed_by_kind in ('staff', 'system')),
    changed_by uuid references public.staff_members (id),
    check ((changed_at is null) = (changed_by_kind is null)),
    check ((changed_by_kind = 'staff') = (changed_by is not null))
);

alter table public.agent_access_settings enable row level security;

-- Nobody reads or writes it through the API; the functions below do, as the owner.
revoke all on public.agent_access_settings from anon, authenticated, service_role;

insert into public.audit_scopes (table_name, scope) values ('public.agent_access_settings', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.agent_access_settings
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.agent_access_settings
    for each row
    execute function public.refuse_delete();

do $$
begin
    perform public.set_audit_actor('system');
    insert into public.agent_access_settings (enabled) values (false);
    perform set_config('audit.actor_kind', '', true);
end;
$$;

-- The one reader of the switch. Every agent sign-up, claim, sign-in, invite,
-- reset and portal read checks it.
create function public.agent_access(
    out enabled boolean, out changed_at timestamptz, out changed_by_kind text, out changed_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(s.enabled, false), s.changed_at, s.changed_by_kind, s.changed_by
    from (select 1) one
    left join public.agent_access_settings s on true;
$$;

revoke execute on function public.agent_access() from public, anon, authenticated, service_role;

-- Turns agent access on or off. For the database owner only: run it in the
-- SQL editor or a migration after set_audit_actor('system') or
-- set_audit_actor('staff', <id>), in the same transaction.
create function public.set_agent_access(enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor record;
begin
    if set_agent_access.enabled is null then
        raise exception 'invalid';
    end if;
    select * into actor from public.audit_actor();
    if actor.kind is null or actor.kind not in ('staff', 'system') then
        raise exception 'not_permitted';
    end if;

    update public.agent_access_settings
    set enabled = set_agent_access.enabled,
        changed_at = now(),
        changed_by_kind = actor.kind,
        changed_by = actor.staff_id;
end;
$$;

revoke execute on function public.set_agent_access(boolean) from public, anon, authenticated, service_role;

-- The Agents screen banner: whether agent access is on, and who last changed
-- it and when (nothing since setup). Staff who view leads, as the screen needs.
create function public.agent_access_status()
returns table (enabled boolean, changed_at timestamptz, changed_by_kind text, changed_by_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    return query
        select a.enabled, a.changed_at, a.changed_by_kind, s.full_name
        from public.agent_access() a
        left join public.staff_members s on s.id = a.changed_by;
end;
$$;

revoke execute on function public.agent_access_status() from public, anon;
grant execute on function public.agent_access_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Who may get a login. Replaces refuse_non_staff_signups and
-- link_staff_account (ADR 1, amended).
-- ---------------------------------------------------------------------------

-- Whether a staff record may take a new login for `email`.
create function public.staff_login_open(email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.staff_members s
        where s.email = lower(staff_login_open.email) and s.active and s.user_id is null
    );
$$;

revoke execute on function public.staff_login_open(text) from public, anon, authenticated, service_role;

-- Whether an agent record may take a new login for `email`: Approved,
-- switched on, not retired, no login yet, the email confirmed (an agent's
-- stored email always is) and agent access on.
create function public.agent_login_open(email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select (select a.enabled from public.agent_access() a)
        and exists (
            select 1 from public.marketing_agents m
            where m.email = lower(agent_login_open.email)
              and m.status = 'Approved'
              and m.switched_off_at is null
              and m.retired_at is null
              and m.user_id is null
        );
$$;

revoke execute on function public.agent_login_open(text) from public, anon, authenticated, service_role;

create function public.refuse_unknown_signups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Exactly one kind of person. guard_login keeps an email on one record,
    -- so both matching would be a broken state, refused too.
    if new.email is null
       or public.staff_login_open(new.email) = public.agent_login_open(new.email) then
        raise exception 'This email does not belong to an active staff member or an approved agent.';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_unknown_signups() from public, anon, authenticated, service_role;

-- Runs after the insert so the foreign key to auth.users can be satisfied.
-- The link is recorded under the system actor, then any actor the
-- transaction had is put back. It rechecks here, so a deactivation,
-- switch-off or retire that lands between the two triggers still refuses.
create function public.link_new_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous_kind text := coalesce(current_setting('audit.actor_kind', true), '');
    previous_staff_id text := coalesce(current_setting('audit.actor_staff_id', true), '');
    linked boolean := false;
begin
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);

    if public.staff_login_open(new.email) and not public.agent_login_open(new.email) then
        update public.staff_members
        set user_id = new.id
        where email = lower(new.email) and active and user_id is null;
        linked := found;
    elsif public.agent_login_open(new.email) and not public.staff_login_open(new.email) then
        update public.marketing_agents
        set user_id = new.id
        where email = lower(new.email)
          and status = 'Approved' and switched_off_at is null and retired_at is null and user_id is null;
        linked := found;
    end if;
    -- Neither matched, or the record changed since the first check.
    if not linked then
        raise exception 'This email does not belong to an active staff member or an approved agent.';
    end if;

    perform set_config('audit.actor_kind', previous_kind, true);
    perform set_config('audit.actor_staff_id', previous_staff_id, true);
    return null;
end;
$$;

revoke execute on function public.link_new_login() from public, anon, authenticated, service_role;

drop trigger refuse_non_staff_signups on auth.users;
drop trigger link_staff_account on auth.users;
drop function public.refuse_non_staff_signups();
drop function public.link_staff_account();

create trigger refuse_unknown_signups
    before insert on auth.users
    for each row
    execute function public.refuse_unknown_signups();

create trigger link_new_login
    after insert on auth.users
    for each row
    execute function public.link_new_login();

-- ---------------------------------------------------------------------------
-- A retired agent's login: banned, signed out and its email freed. Auth
-- needs every user to keep an email, so it moves to an address that can't
-- receive mail and no person can hold, in the identity too.
-- ---------------------------------------------------------------------------

create function public.ban_detached_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update auth.users
    set banned_until = 'infinity', email = new.user_id || '@retired.invalid', updated_at = now()
    where id = new.user_id;
    update auth.identities
    set identity_data = identity_data || jsonb_build_object('email', new.user_id || '@retired.invalid'), updated_at = now()
    where user_id = new.user_id and provider = 'email';
    delete from auth.sessions where user_id = new.user_id;
    return null;
end;
$$;

revoke execute on function public.ban_detached_login() from public, anon, authenticated, service_role;

create trigger ban_detached_login
    after insert on public.agent_detached_logins
    for each row
    execute function public.ban_detached_login();
