-- Agent invites in batches (slice 12, #192).
--
-- - agent_invite_batches: one row per batch the Manager sends from "Approved,
--   no account yet", with the budget it started with and why it stopped.
--   Each invite attempt it makes is an agent_events row carrying its id.
-- - start_agent_invite_batch: checks the Manager and agent access, counts
--   today's agent invite emails from agent_events, and answers the agents to
--   send to, oldest approval first, skipping anyone invited in the last 24
--   hours. The server sends one at a time and stops at the batch's count,
--   time or budget limit or at the first rate limit, then calls
--   finish_agent_invite_batch with the reason.
-- - prepare_agent_invite gains batch_id, which ties the attempt to its batch
--   and skips an agent invited since the batch started.
-- - agent_invite_batch_report and agent_invite_batch_agents: the batch's
--   report and the agents behind each of its counts, read from the database
--   each time, so a batch cut off before it finished still reports correctly.
--
-- The daily cap and the staff reserve are configuration the server passes in
-- (EMAIL_DAILY_CAP and STAFF_INVITE_RESERVE); the database records the values
-- each batch used.

-- ---------------------------------------------------------------------------
-- agent_invite_batches
-- ---------------------------------------------------------------------------

create table public.agent_invite_batches (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null default clock_timestamp(),
    started_by uuid not null references public.staff_members (id),
    -- The import the batch was limited to; empty for every agent.
    import_batch_id uuid references public.import_batches (id),
    -- The SMTP provider's daily cap and the reserve kept for staff invites,
    -- as configured when the batch started.
    daily_cap integer not null check (daily_cap >= 0),
    staff_reserve integer not null check (staff_reserve >= 0),
    -- The most invites the batch may send.
    batch_limit integer not null check (batch_limit > 0),
    -- Agent invite emails already counted today (UTC, the provider's day)
    -- when the batch started.
    used_today integer not null check (used_today >= 0),
    -- Agents waiting for an invite when it started, and agents skipped as
    -- invited in the last 24 hours.
    waiting integer not null check (waiting >= 0),
    skipped_recent integer not null check (skipped_recent >= 0),
    finished_at timestamptz,
    -- done: everyone waiting was tried. batch_limit, daily_budget,
    -- hourly_limit (the first 429), time_limit, access_off: stopped early.
    stop_reason text check (
        stop_reason in ('done', 'batch_limit', 'daily_budget', 'hourly_limit', 'time_limit', 'access_off')
    ),
    check ((finished_at is null) = (stop_reason is null))
);

create index agent_invite_batches_started_at_idx on public.agent_invite_batches (started_at);
create index agent_invite_batches_started_by_idx on public.agent_invite_batches (started_by);
create index agent_invite_batches_import_batch_idx on public.agent_invite_batches (import_batch_id)
    where import_batch_id is not null;

create trigger refuse_delete
    before delete on public.agent_invite_batches
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.agent_invite_batches
    for each statement
    execute function public.refuse_delete();

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.agent_invite_batches', 'lead', null);

create trigger audit_row_change
    after insert or update on public.agent_invite_batches
    for each row
    execute function public.audit_row_change();

-- Read and written only through the functions below.
alter table public.agent_invite_batches enable row level security;

revoke all on public.agent_invite_batches from anon, authenticated, service_role;

-- The batch an invite attempt belongs to, on its `started` row.
alter table public.agent_events
    add column batch_id uuid references public.agent_invite_batches (id),
    add check (batch_id is null or (kind = 'invite' and result = 'started'));

create index agent_events_batch_idx on public.agent_events (batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------------
-- The daily budget
-- ---------------------------------------------------------------------------

-- Agent invite emails counted today, from agent_events. The provider's day
-- is the UTC calendar day (docs/agents/hosted-services.md). An attempt counts
-- unless it ended in a failure, so one cut off mid-send counts as sent.
create function public.agent_invite_emails_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)::integer
    from public.agent_events s
    where s.kind = 'invite'
      and s.result = 'started'
      and s.created_at >= date_trunc('day', now(), 'UTC')
      and not exists (
          select 1 from public.agent_events r
          where r.attempt_id = s.id
            and r.result in ('rate_limited', 'smtp_error', 'rejected_address', 'other_error')
      );
$$;

revoke execute on function public.agent_invite_emails_today() from public, anon, authenticated, service_role;

-- The same count, for the Manager's Send invites dialog. agents.approve.
create function public.agent_invite_budget_used()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    return public.agent_invite_emails_today();
end;
$$;

revoke execute on function public.agent_invite_budget_used() from public, anon;
grant execute on function public.agent_invite_budget_used() to authenticated;

-- ---------------------------------------------------------------------------
-- Starting and finishing a batch
-- ---------------------------------------------------------------------------

-- Needs agents.approve and leads.view, which account_state reads with.
-- Refuses `not_permitted`, `invalid` and `access_off`.
-- Starts a batch over the Approved agents with no account yet, within one
-- import when import_batch_id is given, and answers it with the agents to
-- send to (at most batch_limit, oldest approval first) and their emails.
-- Agents invited in the last 24 hours and agents with no email are skipped.
create function public.start_agent_invite_batch(
    import_batch_id uuid,
    daily_cap integer,
    staff_reserve integer,
    batch_limit integer
)
returns table (batch_id uuid, used_today integer, budget_left integer, waiting integer, agents jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
    batch uuid;
    used integer;
    waiting_count integer;
    skipped integer;
    chosen jsonb;
begin
    if not public.has_permission('agents.approve') or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if daily_cap is null or daily_cap < 0
       or staff_reserve is null or staff_reserve < 0
       or batch_limit is null or batch_limit < 1 or batch_limit > 1000 then
        raise exception 'invalid';
    end if;
    if not (select a.enabled from public.agent_access() a) then
        raise exception 'access_off';
    end if;

    used := public.agent_invite_emails_today();

    with candidates as (
        select a.id, a.email, a.approved_at, public.account_state(a) as state
        from public.marketing_agents a
        where a.retired_at is null
          and a.switched_off_at is null
          and a.status = 'Approved'
          and (start_agent_invite_batch.import_batch_id is null
               or a.import_batch_id = start_agent_invite_batch.import_batch_id)
    )
    select
        count(*) filter (where c.state in ('invite_not_sent', 'invite_expired')),
        count(*) filter (where c.state = 'invited'),
        coalesce(
            (
                select jsonb_agg(jsonb_build_object('agent_id', w.id, 'email', w.email) order by w.approved_at, w.id)
                from (
                    select c2.id, c2.email, c2.approved_at
                    from candidates c2
                    where c2.state in ('invite_not_sent', 'invite_expired')
                    order by c2.approved_at nulls last, c2.id
                    limit start_agent_invite_batch.batch_limit
                ) w
            ),
            '[]'::jsonb
        )
    into waiting_count, skipped, chosen
    from candidates c;

    insert into public.agent_invite_batches (
        started_by, import_batch_id, daily_cap, staff_reserve, batch_limit, used_today, waiting, skipped_recent
    ) values (
        public.current_staff_id(),
        start_agent_invite_batch.import_batch_id,
        start_agent_invite_batch.daily_cap,
        start_agent_invite_batch.staff_reserve,
        start_agent_invite_batch.batch_limit,
        used,
        waiting_count,
        skipped
    )
    returning id into batch;

    return query select
        batch,
        used,
        greatest(start_agent_invite_batch.daily_cap - start_agent_invite_batch.staff_reserve - used, 0),
        waiting_count,
        chosen;
end;
$$;

revoke execute on function public.start_agent_invite_batch(uuid, integer, integer, integer) from public, anon;
grant execute on function public.start_agent_invite_batch(uuid, integer, integer, integer) to authenticated;

-- Records why the batch stopped, once, by the staff member who started it.
-- Refuses `not_permitted`, `invalid` and `not_found`.
create function public.finish_agent_invite_batch(batch_id uuid, stop_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if finish_agent_invite_batch.stop_reason is null or finish_agent_invite_batch.stop_reason not in (
        'done', 'batch_limit', 'daily_budget', 'hourly_limit', 'time_limit', 'access_off'
    ) then
        raise exception 'invalid';
    end if;
    update public.agent_invite_batches b
    set finished_at = clock_timestamp(), stop_reason = finish_agent_invite_batch.stop_reason
    where b.id = finish_agent_invite_batch.batch_id
      and b.started_by is not distinct from public.current_staff_id()
      and b.finished_at is null;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

revoke execute on function public.finish_agent_invite_batch(uuid, text) from public, anon;
grant execute on function public.finish_agent_invite_batch(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- prepare_agent_invite, now with the batch an attempt belongs to. As in
-- 20261124120600_agent_invites.sql, plus: with batch_id, refuses
-- `batch_closed` for a batch that isn't the caller's open one, and
-- `recently_invited` for an agent sent an invite to this email in the last
-- 24 hours (since the batch chose them, say by a single Send invite).
-- ---------------------------------------------------------------------------

drop function public.prepare_agent_invite(uuid, text);

create function public.prepare_agent_invite(agent_id uuid, expected_email text default null, batch_id uuid default null)
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

    if prepare_agent_invite.batch_id is not null and not exists (
        select 1 from public.agent_invite_batches b
        where b.id = prepare_agent_invite.batch_id
          and b.started_by is not distinct from public.current_staff_id()
          and b.finished_at is null
    ) then
        raise exception 'batch_closed';
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
    if prepare_agent_invite.batch_id is not null
       and public.agent_invite_sent_at(agent.id, agent.email) > now() - public.invite_link_lifetime() then
        raise exception 'recently_invited';
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

    insert into public.agent_events (agent_id, kind, result, email, created_by, batch_id)
    values (agent.id, 'invite', 'started', agent.email, public.current_staff_id(), prepare_agent_invite.batch_id)
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

revoke execute on function public.prepare_agent_invite(uuid, text, uuid) from public, anon;
grant execute on function public.prepare_agent_invite(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------

-- Where each agent stands for a batch, one row per agent in at most one of:
-- sent (an invite went out in the batch), failed (the batch's attempt failed
-- and none went out), and, for the batch's other agents with no account yet
-- as they are now, waiting (still to be invited, including those the batch
-- didn't reach or that hit the rate limit) and no_email. Read fresh each
-- time, so a batch cut off before it finished still adds up.
create function public.agent_invite_batch_outcomes(batch_id uuid)
returns table (agent_id uuid, outcome text)
language sql
stable
security definer
set search_path = ''
as $$
    with batch as (
        select b.import_batch_id from public.agent_invite_batches b where b.id = agent_invite_batch_outcomes.batch_id
    ),
    attempts as (
        select
            s.agent_id,
            bool_or(r.result = 'sent') as sent,
            bool_or(r.result in ('smtp_error', 'rejected_address', 'other_error')) as failed
        from public.agent_events s
        left join public.agent_events r on r.attempt_id = s.id
        where s.batch_id = agent_invite_batch_outcomes.batch_id
        group by s.agent_id
    ),
    scope as (
        select a.id, public.account_state(a) as state
        from public.marketing_agents a, batch
        where a.retired_at is null
          and a.switched_off_at is null
          and a.status = 'Approved'
          and (batch.import_batch_id is null or a.import_batch_id = batch.import_batch_id)
    )
    select t.agent_id, 'sent' from attempts t where t.sent
    union all
    select t.agent_id, 'failed' from attempts t where t.failed and not t.sent
    union all
    select s.id, case when s.state = 'no_email' then 'no_email' else 'waiting' end
    from scope s
    where s.state in ('no_email', 'invite_not_sent', 'invite_expired')
      and not exists (select 1 from attempts t where t.agent_id = s.id and (t.sent or t.failed));
$$;

revoke execute on function public.agent_invite_batch_outcomes(uuid) from public, anon, authenticated, service_role;

-- A batch's report: the batch given, or with batch_id null the latest one
-- within the same import (or over every agent). No row when there is none.
-- Staff who view leads; `not_permitted` otherwise.
create function public.agent_invite_batch_report(batch_id uuid, import_batch_id uuid)
returns table (
    id uuid,
    started_at timestamptz,
    started_by_name text,
    finished_at timestamptz,
    stop_reason text,
    daily_cap integer,
    staff_reserve integer,
    batch_limit integer,
    used_today integer,
    waiting_at_start integer,
    skipped_recent integer,
    sent integer,
    waiting integer,
    no_email integer,
    failed integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    batch public.agent_invite_batches;
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if agent_invite_batch_report.batch_id is not null then
        select * into batch from public.agent_invite_batches b where b.id = agent_invite_batch_report.batch_id;
    else
        select * into batch from public.agent_invite_batches b
        where b.import_batch_id is not distinct from agent_invite_batch_report.import_batch_id
        order by b.started_at desc
        limit 1;
    end if;
    if not found then
        return;
    end if;

    return query
        select
            batch.id,
            batch.started_at,
            s.full_name,
            batch.finished_at,
            batch.stop_reason,
            batch.daily_cap,
            batch.staff_reserve,
            batch.batch_limit,
            batch.used_today,
            batch.waiting,
            batch.skipped_recent,
            count(*) filter (where o.outcome = 'sent')::integer,
            count(*) filter (where o.outcome = 'waiting')::integer,
            count(*) filter (where o.outcome = 'no_email')::integer,
            count(*) filter (where o.outcome = 'failed')::integer
        from public.staff_members s
        left join public.agent_invite_batch_outcomes(batch.id) o on true
        where s.id = batch.started_by
        group by s.full_name;
end;
$$;

revoke execute on function public.agent_invite_batch_report(uuid, uuid) from public, anon;
grant execute on function public.agent_invite_batch_report(uuid, uuid) to authenticated;

-- The agents behind one of a batch's counts (`sent`, `waiting`, `no_email`
-- or `failed`), as rows of the agent list, so the Agents screen can page and
-- search them. Staff who view leads; `not_permitted` or `invalid` otherwise.
create function public.agent_invite_batch_agents(batch_id uuid, outcome text)
returns setof public.marketing_agents
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if agent_invite_batch_agents.outcome is null
       or agent_invite_batch_agents.outcome not in ('sent', 'waiting', 'no_email', 'failed') then
        raise exception 'invalid';
    end if;
    return query
        select a.*
        from public.marketing_agents a
        join public.agent_invite_batch_outcomes(agent_invite_batch_agents.batch_id) o on o.agent_id = a.id
        where o.outcome = agent_invite_batch_agents.outcome;
end;
$$;

revoke execute on function public.agent_invite_batch_agents(uuid, text) from public, anon;
grant execute on function public.agent_invite_batch_agents(uuid, text) to authenticated;
