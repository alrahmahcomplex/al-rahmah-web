-- A joined agent's email, for every check of who holds an email (slice 12,
-- #219). A joined agent's email lives in Supabase Auth and only they change
-- it (owner decision 41), so marketing_agents.email keeps the address they
-- were invited with. The checks now read a joined agent's address from
-- auth.users at the moment of the check, and an agent who hasn't joined by
-- the stored email. Nothing is copied between the two stores.
--
-- - agent_email_holders(email): the current agents holding an email, by
--   that rule. agent_email_taken, invite_staff_member's `agent_email`,
--   guard_login and set_marketing_agent_email's `email_taken` read through
--   it, so the address a joined agent moved away from is free again and the
--   one they moved to is theirs.
-- - marketing_agents_email_key goes: a joined agent's stale stored email
--   would otherwise still block a new agent given that address. guard_login
--   now refuses an email another current agent holds (`email_taken`), under
--   lock_login_email as before, so two current agents still can't share
--   one. create_agent_record's handler for that index can no longer fire;
--   its earlier email_taken check gives the same answer.

-- ---------------------------------------------------------------------------
-- Who holds an email.
-- ---------------------------------------------------------------------------

-- The non-retired agents holding `email`: a joined agent by their Auth email,
-- any other by the stored one. At most one, while guard_login holds.
create function public.agent_email_holders(email text)
returns table (agent_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
    select a.id
    from public.marketing_agents a
    where a.email = lower(btrim(agent_email_holders.email))
      and a.retired_at is null
      and not (a.user_id is not null and public.agent_joined(a.user_id))
    union
    select a.id
    from auth.users u
    join public.marketing_agents a on a.user_id = u.id
    where lower(u.email) = lower(btrim(agent_email_holders.email))
      and a.retired_at is null
      and public.agent_joined(u.id);
$$;

revoke execute on function public.agent_email_holders(text) from public, anon, authenticated, service_role;

drop index public.marketing_agents_email_key;
create index marketing_agents_email_idx on public.marketing_agents (email) where retired_at is null;

-- Whether a current agent or a staff member already uses an email.
create or replace function public.agent_email_taken(email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select agent_email_taken.email is not null and (
        exists (select 1 from public.agent_email_holders(agent_email_taken.email))
        or exists (select 1 from public.staff_members s where s.email = agent_email_taken.email)
    );
$$;

-- ---------------------------------------------------------------------------
-- guard_login, re-created. A current agent's email is read through
-- agent_email_holders, and an agent record is refused an email another
-- current agent holds, now the unique index is gone.
-- ---------------------------------------------------------------------------

create or replace function public.guard_login()
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

    -- Two staff records are left to staff_members' unique index, so
    -- invite_staff_member keeps its answer to a duplicate; this checks the
    -- agents, the staff for an agent, and Auth.
    if new.email is not null and email_changed then
        perform public.lock_login_email(new.email);
        if (not is_staff and exists (
            select 1 from public.staff_members s where s.email = lower(new.email)
        )) or exists (
            select 1 from public.agent_email_holders(new.email) h where h.agent_id is distinct from new.id or is_staff
        ) or exists (
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

-- ---------------------------------------------------------------------------
-- invite_staff_member, re-created with its signature and grants unchanged.
-- Its `agent_email` check reads through agent_email_holders.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- set_marketing_agent_email, re-created with its signature and grants
-- unchanged. The agent holding the address is found through
-- agent_email_holders.
-- ---------------------------------------------------------------------------

create or replace function public.set_marketing_agent_email(agent_id uuid, email text)
returns table (previous_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    address text := lower(btrim(coalesce(set_marketing_agent_email.email, '')));
    holder record;
    unused_login uuid;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if address = '' or char_length(address) > 254 or address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'email_invalid';
    end if;

    select * into agent from public.marketing_agents a where a.id = set_marketing_agent_email.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    -- Locks the login first, so the agent can't finish joining between the
    -- joined check and the delete below and be left with an orphaned login.
    if agent.user_id is not null then
        perform 1 from auth.users u where u.id = agent.user_id for update;
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        raise exception 'already_joined';
    end if;
    if agent.email is not distinct from address then
        raise exception 'no_change';
    end if;

    perform public.lock_login_email(address);
    select 'staff' as kind, s.full_name as name, null::text as code into holder
    from public.staff_members s where s.email = address;
    if not found then
        select 'agent' as kind, a.full_name as name, a.code into holder
        from public.agent_email_holders(address) h
        join public.marketing_agents a on a.id = h.agent_id
        where a.id <> agent.id;
    end if;
    if not found then
        select 'login' as kind, null::text as name, null::text as code into holder
        from auth.users u where lower(u.email) = address and u.id is distinct from agent.user_id;
    end if;
    if found then
        raise exception 'email_taken' using detail = jsonb_build_object(
            'email', address, 'holder', holder.kind, 'name', holder.name, 'code', holder.code
        )::text;
    end if;

    unused_login := agent.user_id;
    update public.marketing_agents a set email = address, user_id = null where a.id = agent.id;
    if unused_login is not null then
        delete from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '';
    end if;
    return query select agent.email;
end;
$$;
