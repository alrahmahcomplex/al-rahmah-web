-- Agent invites, account states and email edits (slice 12, #191).
--
-- - agent_events: append-only, one row per agent event. This ticket writes
--   invite attempts and joined agents' email changes; the claim, reset and
--   batch tickets add their kinds. A raw email is stored only on an event
--   linked to an agent.
-- - prepare_agent_invite and record_agent_invite: the Manager's two calls
--   around the invite email, which the server sends with the secret key in
--   between. Preparing refuses an agent who isn't Approved, is switched off or
--   retired, has no email or has joined, records an attempt refused because
--   agent access is off, and otherwise starts the attempt. Recording appends
--   the attempt's result whatever happened to the agent since.
-- - account_state(marketing_agents): each agent's account state, in one
--   place, readable as a column of the agent list. agent_account_counts and
--   agent_invites feed the Agents screen's counts and badges.
-- - set_marketing_agent_email: adds or corrects an agent's email. An invited
--   agent who hasn't joined loses the unused login, so the next invite goes
--   to the new address. For a joined agent it only starts the change: the
--   server changes the Auth email with the admin API, then
--   finish_agent_email_change stores the email once Auth holds it.
-- - reconcile_agent_emails: for a joined agent the Auth email is the source
--   of truth, so the stored email follows it. Only the secret key calls it,
--   at both ends of every email save and when the Agents screen loads, for
--   at most max_agents agents a load. An agent may change their own sign-in
--   email in Supabase Auth (owner decision, 2026-11-06): their record follows
--   it here and the move is recorded with changed_by `agent`. Their Discount
--   code, name and the rest of their record never change this way.
-- - current_agent_account(): the signed-in agent's own name, code and state,
--   for the agent sign-in and pages.

-- ---------------------------------------------------------------------------
-- agent_events
-- ---------------------------------------------------------------------------

create table public.agent_events (
    id uuid primary key default gen_random_uuid(),
    -- Empty for an event that matched no agent, such as a refused claim.
    agent_id uuid references public.marketing_agents (id),
    -- invite: an invite email. email_change: a Manager changing a joined
    -- agent's email, which changes their sign-in email first, or
    -- (`reconciled`) the stored email following a sign-in email that no
    -- open change asked for, usually the agent's own change in Auth.
    kind text not null check (kind in ('invite', 'email_change')),
    -- `started` opens an attempt; one later row of the same kind closes it
    -- with its result. access_off is an invite refused before it started.
    result text not null,
    -- The `started` row this row closes.
    attempt_id uuid references public.agent_events (id),
    -- The error code Auth gave, for other_error, so it can be read out.
    error_code text check (char_length(error_code) <= 100),
    -- The address the event was about, only when it is linked to an agent.
    email text check (email = lower(btrim(email)) and char_length(email) <= 254),
    -- The stored email it replaced, on a row that moved it (`changed`,
    -- `reconciled`).
    previous_email text check (previous_email = lower(btrim(previous_email)) and char_length(previous_email) <= 254),
    -- Who changed the sign-in email, on a row that moved the stored email:
    -- `staff` for a Manager's change, `agent` for the agent's own change in
    -- Supabase Auth.
    changed_by text check (changed_by in ('staff', 'agent')),
    created_at timestamptz not null default clock_timestamp(),
    -- The staff member who caused it; empty when no one did.
    created_by uuid references public.staff_members (id),
    check (email is null or agent_id is not null),
    check ((changed_by is not null) = (result in ('changed', 'reconciled'))),
    check (previous_email is null or result in ('changed', 'reconciled')),
    check ((result = 'other_error') = (error_code is not null)),
    check (
        (kind = 'invite' and result in (
            'started', 'sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error', 'access_off'
        ))
        or (kind = 'email_change' and result in ('started', 'changed', 'cancelled', 'reconciled'))
    ),
    check ((attempt_id is null) = (result in ('started', 'access_off', 'reconciled')))
);

-- One result per attempt.
create unique index agent_events_attempt_idx on public.agent_events (attempt_id) where attempt_id is not null;
create index agent_events_kind_created_at_idx on public.agent_events (kind, created_at);
create index agent_events_agent_kind_created_at_idx on public.agent_events (agent_id, kind, created_at) where agent_id is not null;
create index agent_events_created_by_idx on public.agent_events (created_by) where created_by is not null;

create trigger refuse_update
    before update on public.agent_events
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.agent_events
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.agent_events
    for each statement
    execute function public.refuse_delete();

-- Audit (ADR 4): lead scope with no lead id, as for the other agent tables.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.agent_events', 'lead', null);

create trigger audit_row_change
    after insert on public.agent_events
    for each row
    execute function public.audit_row_change();

-- Read and written only through the functions below.
alter table public.agent_events enable row level security;

revoke all on public.agent_events from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Account state
-- ---------------------------------------------------------------------------

-- How long an invite link works: otp_expiry in supabase/config.toml and the
-- hosted Email OTP expiration (docs/agents/hosted-services.md).
create function public.invite_link_lifetime()
returns interval
language sql
immutable
set search_path = ''
as $$
    select interval '24 hours';
$$;

revoke execute on function public.invite_link_lifetime() from public, anon, authenticated, service_role;

-- When the latest invite to the agent's current email was sent, or null.
create function public.agent_invite_sent_at(agent_id uuid, email text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
    select max(e.created_at)
    from public.agent_events e
    where e.agent_id = agent_invite_sent_at.agent_id
      and e.kind = 'invite'
      and e.result = 'sent'
      and e.email = agent_invite_sent_at.email;
$$;

revoke execute on function public.agent_invite_sent_at(uuid, text) from public, anon, authenticated, service_role;

-- Whether the agent finished joining: used the invite link and saved a
-- password. Using the link confirms the email before the password is saved,
-- so a confirmed login with no password is an unfinished setup, which a new
-- invite replaces (prepare_agent_invite).
create function public.agent_joined(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from auth.users u
        where u.id = agent_joined.user_id
          and u.email_confirmed_at is not null
          and coalesce(u.encrypted_password, '') <> ''
    );
$$;

revoke execute on function public.agent_joined(uuid) from public, anon, authenticated, service_role;

-- The agent's account state, in this order (CONTEXT.md, Account state):
-- retired, switched_off, awaiting_confirmation, no_email, invite_not_sent,
-- invite_expired, invited, joined. A Pending agent has none yet: approval
-- comes first. awaiting_confirmation needs the email claims #193 adds, which
-- replaces this function to return it.
--
-- A computed column, so the Agents screen can filter on it. Staff without
-- leads.view, and agents, get null for every row.
create function public.account_state(agent public.marketing_agents)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    sent_at timestamptz;
begin
    if not public.has_permission('leads.view') then
        return null;
    end if;
    if agent.retired_at is not null then
        return 'retired';
    end if;
    if agent.switched_off_at is not null then
        return 'switched_off';
    end if;
    if agent.status <> 'Approved' then
        return null;
    end if;
    if agent.email is null then
        return 'no_email';
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        return 'joined';
    end if;
    sent_at := public.agent_invite_sent_at(agent.id, agent.email);
    if sent_at is null then
        return 'invite_not_sent';
    end if;
    if sent_at <= now() - public.invite_link_lifetime() then
        return 'invite_expired';
    end if;
    return 'invited';
end;
$$;

revoke execute on function public.account_state(public.marketing_agents) from public, anon;
grant execute on function public.account_state(public.marketing_agents) to authenticated;

-- How many agents are in each account state, for the Agents screen's filters
-- and its "needs attention" count. Staff who view leads.
create function public.agent_account_counts()
returns table (state text, agents bigint)
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
        select s.state, count(*)
        from public.marketing_agents a
        cross join lateral (select public.account_state(a) as state) s
        where s.state is not null
        group by s.state;
end;
$$;

revoke execute on function public.agent_account_counts() from public, anon;
grant execute on function public.agent_account_counts() to authenticated;

-- Each agent's email and state with its latest invite to that email and its
-- latest invite attempt of any result, for the badges. Staff who view leads.
create function public.agent_invites(agent_ids uuid[])
returns table (
    agent_id uuid,
    email text,
    state text,
    sent_at timestamptz,
    last_result text,
    last_error_code text,
    last_attempt_at timestamptz
)
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
        select
            a.id,
            a.email,
            public.account_state(a),
            public.agent_invite_sent_at(a.id, a.email),
            last.result,
            last.error_code,
            last.created_at
        from public.marketing_agents a
        left join lateral (
            select e.result, e.error_code, e.created_at
            from public.agent_events e
            where e.agent_id = a.id and e.kind = 'invite' and e.result <> 'started'
            order by e.created_at desc
            limit 1
        ) last on true
        where a.id = any (agent_invites.agent_ids);
end;
$$;

revoke execute on function public.agent_invites(uuid[]) from public, anon;
grant execute on function public.agent_invites(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Invites. The server calls prepare_agent_invite on the Manager's session,
-- which checks the agent and starts the attempt, sends the email with the
-- secret key, then records the attempt's result with record_agent_invite.
-- The email goes only to the address the Manager sees.
-- ---------------------------------------------------------------------------

-- Refuses (`not_permitted`, `not_found`, `retired`, `switched_off`,
-- `not_approved`, `no_email`, `already_joined`, and `email_changed` when
-- expected_email is given and is no longer the agent's) or answers `ready`
-- with the address, whether an invite to the agent went out before, and the
-- attempt it started. While agent access is off it answers `access_off` and
-- records that attempt. A login whose setup never finished (link used, no
-- password saved) is removed, so the new invite creates a fresh one.
create function public.prepare_agent_invite(agent_id uuid, expected_email text default null)
returns table (outcome text, email text, resend boolean, attempt_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    attempt uuid;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    select * into agent from public.marketing_agents a where a.id = prepare_agent_invite.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    if agent.switched_off_at is not null then
        raise exception 'switched_off';
    end if;
    if agent.status <> 'Approved' then
        raise exception 'not_approved';
    end if;
    if agent.email is null then
        raise exception 'no_email';
    end if;
    if expected_email is not null and lower(btrim(expected_email)) is distinct from agent.email then
        raise exception 'email_changed';
    end if;
    -- Locks the login first, so the agent can't finish setting a password
    -- between the joined check and the delete below.
    if agent.user_id is not null then
        perform 1 from auth.users u where u.id = agent.user_id for update;
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        raise exception 'already_joined';
    end if;

    if not (select a.enabled from public.agent_access() a) then
        insert into public.agent_events (agent_id, kind, result, email, created_by)
        values (agent.id, 'invite', 'access_off', agent.email, public.current_staff_id());
        return query select 'access_off'::text, agent.email, false, null::uuid;
        return;
    end if;

    -- Auth won't invite an address whose login is already confirmed.
    if agent.user_id is not null
       and exists (select 1 from auth.users u where u.id = agent.user_id and u.email_confirmed_at is not null) then
        update public.marketing_agents a set user_id = null where a.id = agent.id;
        delete from auth.users u where u.id = agent.user_id and coalesce(u.encrypted_password, '') = '';
    end if;

    insert into public.agent_events (agent_id, kind, result, email, created_by)
    values (agent.id, 'invite', 'started', agent.email, public.current_staff_id())
    returning id into attempt;

    return query select
        'ready'::text,
        agent.email,
        exists (
            select 1 from public.agent_events e
            where e.agent_id = agent.id and e.kind = 'invite' and e.result = 'sent'
        ),
        attempt;
end;
$$;

revoke execute on function public.prepare_agent_invite(uuid, text) from public, anon;
grant execute on function public.prepare_agent_invite(uuid, text) to authenticated;

-- Records how an invite email went, for an attempt the same staff member
-- started, to the address it started with. The checks were made when the
-- attempt started; the email has gone (or not) by now, so the result is
-- recorded even if the agent was switched off, retired or changed since.
-- Refuses `not_permitted`, `invalid`, `not_found` and `already_recorded`.
create function public.record_agent_invite(attempt_id uuid, result text, error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    attempt public.agent_events;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if record_agent_invite.result is null
       or record_agent_invite.result not in ('sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error') then
        raise exception 'invalid';
    end if;

    select * into attempt from public.agent_events e
    where e.id = record_agent_invite.attempt_id
      and e.kind = 'invite'
      and e.result = 'started'
      and e.created_by is not distinct from public.current_staff_id();
    if not found then
        raise exception 'not_found';
    end if;

    begin
        insert into public.agent_events (agent_id, kind, result, attempt_id, error_code, email, created_by)
        values (
            attempt.agent_id,
            'invite',
            record_agent_invite.result,
            attempt.id,
            case when record_agent_invite.result = 'other_error'
                then left(coalesce(nullif(btrim(record_agent_invite.error_code), ''), 'unknown'), 100)
            end,
            attempt.email,
            public.current_staff_id()
        );
    exception when unique_violation then
        raise exception 'already_recorded';
    end;
end;
$$;

revoke execute on function public.record_agent_invite(uuid, text, text) from public, anon;
grant execute on function public.record_agent_invite(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding or correcting an agent's email.
--
-- A joined agent's change runs in three steps, one at a time per agent:
-- set_marketing_agent_email starts it, the server changes the Auth email with
-- the admin API, then finish_agent_email_change stores the email, but only
-- while Auth holds that address and the change is still the agent's latest.
-- If the Auth change fails, cancel_agent_email_change closes it. A change
-- left open longer than email_change_lease() (a server that stopped
-- mid-change) no longer blocks the next one.
--
-- Auth writes can't be fenced: one sent before a takeover can land after
-- it. So the Auth email is the source of truth for a joined agent, and
-- reconcile_agent_emails moves the stored email to it, run by the server
-- before and after every save and when the Agents screen loads. A late Auth
-- write is then put right by the next reconcile, not left split.
-- ---------------------------------------------------------------------------

create function public.email_change_lease()
returns interval
language sql
immutable
set search_path = ''
as $$
    select interval '5 minutes';
$$;

revoke execute on function public.email_change_lease() from public, anon, authenticated, service_role;

-- The agent's latest started email change, if no row closes it.
create function public.open_email_change(agent_id uuid)
returns public.agent_events
language sql
stable
security definer
set search_path = ''
as $$
    select e.*
    from public.agent_events e
    where e.agent_id = open_email_change.agent_id and e.kind = 'email_change' and e.result = 'started'
      and not exists (select 1 from public.agent_events c where c.attempt_id = e.id)
      and e.created_at = (
          select max(l.created_at) from public.agent_events l
          where l.agent_id = open_email_change.agent_id and l.kind = 'email_change' and l.result = 'started'
      )
    limit 1;
$$;

revoke execute on function public.open_email_change(uuid) from public, anon, authenticated, service_role;

-- Needs agents.approve. Refuses `not_permitted`, `not_found`, `retired`,
-- `email_invalid`, `no_change`, `busy` while another change to the agent is
-- under way, and `email_taken` with who holds the address as JSON in the
-- detail. An invited agent who hasn't joined loses the unused login, so a
-- link to the old address no longer works and the next invite creates a
-- login for the new one, and change_id is null. For a joined agent the
-- stored email stays as it is: the answer is the change it started and the
-- login whose Auth email the server changes next.
create function public.set_marketing_agent_email(agent_id uuid, email text)
returns table (previous_email text, change_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    address text := lower(btrim(coalesce(set_marketing_agent_email.email, '')));
    holder record;
    unused_login uuid;
    change uuid;
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
    if exists (
        select 1 from public.open_email_change(agent.id) o
        where o.id is not null and o.created_at > clock_timestamp() - public.email_change_lease()
    ) then
        raise exception 'busy';
    end if;
    if agent.email is not distinct from address then
        raise exception 'no_change';
    end if;

    perform public.lock_login_email(address);
    select 'staff' as kind, s.full_name as name, null::text as code into holder
    from public.staff_members s where s.email = address;
    if not found then
        select 'agent' as kind, a.full_name as name, a.code into holder
        from public.marketing_agents a where a.email = address and a.retired_at is null;
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

    -- Locks the login first, so the agent can't finish joining between the
    -- joined check and the delete below and be left with an orphaned login.
    if agent.user_id is not null then
        perform 1 from auth.users u where u.id = agent.user_id for update;
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        insert into public.agent_events (agent_id, kind, result, email, created_by)
        values (agent.id, 'email_change', 'started', address, public.current_staff_id())
        returning id into change;
        return query select agent.email, change, agent.user_id;
        return;
    end if;

    unused_login := agent.user_id;
    update public.marketing_agents a set email = address, user_id = null where a.id = agent.id;
    if unused_login is not null then
        delete from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '';
    end if;
    return query select agent.email, null::uuid, null::uuid;
end;
$$;

revoke execute on function public.set_marketing_agent_email(uuid, text) from public, anon;
grant execute on function public.set_marketing_agent_email(uuid, text) to authenticated;

-- Stores the email of a change the same staff member started, once the
-- agent's Auth email is that address. Answers again, without changing
-- anything, for a change already finished. Refuses `not_permitted`,
-- `not_found`, `superseded` when it is no longer the agent's latest open
-- change, `retired`, `login_mismatch` when Auth doesn't hold the address,
-- and `email_taken` as set_marketing_agent_email does.
create function public.finish_agent_email_change(change_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    change public.agent_events;
    agent public.marketing_agents;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    select * into change from public.agent_events e
    where e.id = finish_agent_email_change.change_id
      and e.kind = 'email_change'
      and e.result = 'started'
      and e.created_by is not distinct from public.current_staff_id();
    if not found then
        raise exception 'not_found';
    end if;

    select * into agent from public.marketing_agents a where a.id = change.agent_id for update;
    if exists (select 1 from public.agent_events c where c.attempt_id = change.id and c.result = 'changed') then
        return;
    end if;
    if (select o.id from public.open_email_change(agent.id) o) is distinct from change.id then
        raise exception 'superseded';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    if agent.user_id is null or not exists (
        select 1 from auth.users u where u.id = agent.user_id and lower(u.email) = change.email
    ) then
        raise exception 'login_mismatch';
    end if;

    perform public.lock_login_email(change.email);
    if exists (select 1 from public.staff_members s where s.email = change.email)
       or exists (select 1 from public.marketing_agents a where a.email = change.email and a.id <> agent.id and a.retired_at is null) then
        raise exception 'email_taken';
    end if;

    update public.marketing_agents a set email = change.email where a.id = agent.id;
    insert into public.agent_events (agent_id, kind, result, attempt_id, email, previous_email, changed_by, created_by)
    values (agent.id, 'email_change', 'changed', change.id, change.email, agent.email, 'staff', public.current_staff_id());
end;
$$;

revoke execute on function public.finish_agent_email_change(uuid) from public, anon;
grant execute on function public.finish_agent_email_change(uuid) to authenticated;

-- Closes a change the same staff member started whose Auth change failed.
-- The stored email never moved, so nothing else changes. Does nothing for a
-- change already closed. Refuses `not_permitted` and `not_found`.
create function public.cancel_agent_email_change(change_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    change public.agent_events;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    select * into change from public.agent_events e
    where e.id = cancel_agent_email_change.change_id
      and e.kind = 'email_change'
      and e.result = 'started'
      and e.created_by is not distinct from public.current_staff_id();
    if not found then
        raise exception 'not_found';
    end if;

    insert into public.agent_events (agent_id, kind, result, attempt_id, email, created_by)
    values (change.agent_id, 'email_change', 'cancelled', change.id, change.email, public.current_staff_id())
    on conflict (attempt_id) where attempt_id is not null do nothing;
end;
$$;

revoke execute on function public.cancel_agent_email_change(uuid) from public, anon;
grant execute on function public.cancel_agent_email_change(uuid) to authenticated;

-- For each joined agent (all of them whose stored and Auth emails differ or
-- who have an open change, or just for_agent), with the agent row and the
-- login locked:
-- - Auth holds the stored email: `in_line`. An open change past its lease is
--   closed; one within it is left to finish.
-- - Auth holds another address that no staff member or other current agent
--   holds: the stored email becomes it, `aligned`. An open change to that
--   address is closed as changed; any other is cancelled and the move is
--   recorded as `reconciled`, with changed_by `staff` when it is a Manager's
--   change that never finished landing late, and `agent` otherwise: the
--   agent changed their own sign-in email.
-- - Auth holds someone else's address: `taken`, with the stored email, which
--   the server puts back into Auth before reconciling again.
-- Only the email moves: the code, name and every other field stay. Without
-- for_agent it takes at most max_agents agents (1 to 200), so one page load
-- stays bounded and the rest wait for the next. Running it again changes
-- nothing. Only the secret key may call it, so staff sessions, visitors and
-- agents can't.
create function public.reconcile_agent_emails(for_agent uuid default null, max_agents integer default 25)
returns table (agent_id uuid, outcome text, user_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    candidate uuid;
    agent public.marketing_agents;
    login_email text;
    pending public.agent_events;
    settled text;
    settled_email text;
    late_by uuid;
    late boolean;
begin
    perform public.set_audit_actor('system');

    for candidate in
        select a.id
        from public.marketing_agents a
        join auth.users u on u.id = a.user_id
        where a.retired_at is null
          and public.agent_joined(a.user_id)
          and (
              a.id = reconcile_agent_emails.for_agent
              or (
                  reconcile_agent_emails.for_agent is null
                  and (
                      lower(u.email) is distinct from a.email
                      or (select o.id from public.open_email_change(a.id) o) is not null
                  )
              )
          )
        order by a.id
        limit case
            when reconcile_agent_emails.for_agent is null
                then least(greatest(coalesce(reconcile_agent_emails.max_agents, 25), 1), 200)
            else 1
        end
    loop
        select * into agent from public.marketing_agents a where a.id = candidate for update;
        if agent.user_id is null or agent.retired_at is not null then
            continue;
        end if;
        select lower(u.email) into login_email from auth.users u where u.id = agent.user_id for update;
        pending := public.open_email_change(agent.id);

        if login_email is null or login_email = agent.email then
            if pending.id is not null and pending.created_at <= clock_timestamp() - public.email_change_lease() then
                insert into public.agent_events (agent_id, kind, result, attempt_id, email)
                values (agent.id, 'email_change', 'cancelled', pending.id, pending.email)
                on conflict (attempt_id) where attempt_id is not null do nothing;
            end if;
            return query select agent.id, 'in_line'::text, agent.user_id, agent.email;
            continue;
        end if;

        perform public.lock_login_email(login_email);
        settled := 'taken';
        settled_email := agent.email;
        if not exists (select 1 from public.staff_members s where s.email = login_email)
           and not exists (
               select 1 from public.marketing_agents a
               where a.email = login_email and a.id <> agent.id and a.retired_at is null
           ) then
            begin
                update public.marketing_agents a set email = login_email where a.id = agent.id;
                if pending.id is not null and pending.email = login_email then
                    insert into public.agent_events (agent_id, kind, result, attempt_id, email, previous_email, changed_by, created_by)
                    values (agent.id, 'email_change', 'changed', pending.id, login_email, agent.email, 'staff', pending.created_by);
                else
                    if pending.id is not null then
                        insert into public.agent_events (agent_id, kind, result, attempt_id, email)
                        values (agent.id, 'email_change', 'cancelled', pending.id, pending.email);
                    end if;
                    -- A Manager's change to this address that never finished
                    -- is a late Auth write; any other move is the agent's own.
                    late_by := null;
                    select s.created_by into late_by
                    from public.agent_events s
                    where s.agent_id = agent.id and s.kind = 'email_change' and s.result = 'started'
                      and s.email = login_email
                      and not exists (
                          select 1 from public.agent_events c where c.attempt_id = s.id and c.result = 'changed'
                      )
                    order by s.created_at desc
                    limit 1;
                    late := found;
                    insert into public.agent_events (agent_id, kind, result, email, previous_email, changed_by, created_by)
                    values (
                        agent.id, 'email_change', 'reconciled', login_email, agent.email,
                        case when late then 'staff' else 'agent' end, late_by
                    );
                end if;
                settled := 'aligned';
                settled_email := login_email;
            exception when check_violation or unique_violation then
                -- An address the stored email can't take: it goes back in Auth.
                settled := 'taken';
                settled_email := agent.email;
            end;
        end if;
        return query select agent.id, settled, agent.user_id, settled_email;
    end loop;
end;
$$;

revoke execute on function public.reconcile_agent_emails(uuid, integer) from public, anon, authenticated;
grant execute on function public.reconcile_agent_emails(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The signed-in agent.
-- ---------------------------------------------------------------------------

-- One row for an agent session: `access_off`, `retired`, `switched_off`,
-- `not_approved` or `active`, with the name and code only while active.
-- No row for staff, a visitor or a login that belongs to no one.
create function public.current_agent_account()
returns table (state text, full_name text, code text)
language sql
stable
security definer
set search_path = ''
as $$
    with me as (
        select
            a.full_name,
            a.code,
            case
                when not acc.enabled then 'access_off'
                when a.retired_at is not null then 'retired'
                when a.switched_off_at is not null then 'switched_off'
                when a.status <> 'Approved' then 'not_approved'
                else 'active'
            end as state
        from public.current_principal() p
        join public.marketing_agents a on a.id = p.agent_id
        cross join public.agent_access() acc
        where p.kind = 'agent'
    )
    select
        me.state,
        case when me.state = 'active' then me.full_name end,
        case when me.state = 'active' then me.code end
    from me;
$$;

revoke execute on function public.current_agent_account() from public, anon;
grant execute on function public.current_agent_account() to authenticated;
