-- Agents reset their own password (slice 12, #194).
--
-- - agent_link_requests: the public reset counter. One row per accepted
--   "Umesahau nenosiri?" or "Tuma kiungo kipya" request: a hash of the email
--   and the time, nothing else. Not audited, deletes allowed, and every write
--   prunes rows older than an hour, so it never holds more than an hour.
-- - request_agent_link: the server's one call per request, with the secret
--   key, after Turnstile and the firewall. It refuses while agent access is
--   off, counts the request against the per-email limit and the project-wide
--   hourly budget, then decides what to send: a reset to an active agent who
--   has joined, a new invite to an active agent who was invited and hasn't
--   joined, and nothing to anyone else. The page shows one neutral reply for
--   all three, so it never tells whether an email has an account.
-- - record_agent_link: the send's result, closing the attempt
--   request_agent_link opened in agent_events. A new invite is an ordinary
--   invite attempt, so the Agents screen and the daily budget count it.
-- - agent_events gains the `reset` kind, with the invite's results.

-- ---------------------------------------------------------------------------
-- agent_link_requests
-- ---------------------------------------------------------------------------

create table public.agent_link_requests (
    -- sha256 of the trimmed, lowercased email, in hex.
    email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
    requested_at timestamptz not null default clock_timestamp()
);

create index agent_link_requests_requested_at_idx on public.agent_link_requests (requested_at);
create index agent_link_requests_email_idx on public.agent_link_requests (email_hash, requested_at);

-- Read and written only through request_agent_link.
alter table public.agent_link_requests enable row level security;

revoke all on public.agent_link_requests from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_events: the reset kind.
-- ---------------------------------------------------------------------------

alter table public.agent_events
    drop constraint agent_events_kind_check,
    drop constraint agent_events_result_check;

alter table public.agent_events
    add constraint agent_events_kind_check check (kind in ('invite', 'claim', 'reset')),
    add constraint agent_events_result_check check (
        (kind in ('invite', 'reset') and result in (
            'started', 'sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error', 'access_off'
        ))
        or (kind = 'claim' and result in ('no_match', 'phone_mismatch'))
    );

-- ---------------------------------------------------------------------------
-- Requesting a link
-- ---------------------------------------------------------------------------

-- Answers one of:
-- - access_off: agent access is off; nothing is counted or sent.
-- - limited: this email has had per_email_limit requests in the last hour.
-- - busy: the project has had hourly_budget requests in the last hour.
-- - none: nothing to send. Counted, unless the same email asked in the last
--   60 seconds, which gets this answer without being counted.
-- - reset or invite: counted; send that email to `send_to`, then record the
--   result of `attempt_id` with record_agent_link.
--
-- Every request that passes the limits is counted, whoever's email it is, so
-- the limits answer the same for any address. Two requests at the same moment
-- may both pass a limit with one place left; Supabase's own per-address gap
-- and hourly email limit still hold.
create function public.request_agent_link(email text, per_email_limit integer, hourly_budget integer)
returns table (outcome text, send_to text, attempt_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    address text := lower(btrim(request_agent_link.email));
    hash text;
    agent public.marketing_agents;
    joined boolean;
    attempt uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if address is null or address = '' or char_length(address) > 254 or position('@' in address) = 0
       or per_email_limit is null or per_email_limit < 0 or hourly_budget is null or hourly_budget < 0 then
        raise exception 'invalid';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    if not (select a.enabled from public.agent_access() a) then
        return query select 'access_off'::text, null::text, null::uuid;
        return;
    end if;

    delete from public.agent_link_requests r where r.requested_at < now() - interval '1 hour';

    hash := encode(sha256(convert_to(address, 'UTF8')), 'hex');
    -- Supabase refuses a second email to one address within 60 seconds, so a
    -- repeat inside that gap would send nothing: it gets the neutral reply
    -- and uses no allowance.
    if exists (
        select 1 from public.agent_link_requests r
        where r.email_hash = hash and r.requested_at > now() - interval '60 seconds'
    ) then
        return query select 'none'::text, null::text, null::uuid;
        return;
    end if;
    if (select count(*) from public.agent_link_requests r where r.email_hash = hash) >= per_email_limit then
        return query select 'limited'::text, null::text, null::uuid;
        return;
    end if;
    if (select count(*) from public.agent_link_requests) >= hourly_budget then
        return query select 'busy'::text, null::text, null::uuid;
        return;
    end if;
    insert into public.agent_link_requests (email_hash) values (hash);

    -- The current, non-retired agent using this email: a joined agent's from
    -- Auth, anyone else's from their record. A joined agent can change their
    -- Auth email to one still stored on an agent who hasn't joined, so both
    -- can match; the joined login owns the address, so it comes first.
    select a.* into agent
    from public.agent_email_holders(address) h
    join public.marketing_agents a on a.id = h.agent_id
    order by (a.user_id is not null and public.agent_joined(a.user_id)) desc
    limit 1
    for update of a;
    if not found or agent.status <> 'Approved' or agent.switched_off_at is not null then
        return query select 'none'::text, null::text, null::uuid;
        return;
    end if;

    -- Locks the login first, as prepare_agent_invite does, so the agent can't
    -- finish joining between this check and the clean-up below.
    if agent.user_id is not null then
        perform 1 from auth.users u where u.id = agent.user_id for update;
    end if;
    joined := agent.user_id is not null and public.agent_joined(agent.user_id);

    if joined then
        insert into public.agent_events (agent_id, kind, result, email)
        values (agent.id, 'reset', 'started', address)
        returning id into attempt;
        return query select 'reset'::text, address, attempt;
        return;
    end if;

    -- Only an agent the school has invited gets a new invite: the Manager
    -- confirmed that email when the first one went out.
    if public.agent_invite_sent_at(agent.id, agent.email) is null then
        return query select 'none'::text, null::text, null::uuid;
        return;
    end if;

    -- As prepare_agent_invite: Auth won't invite an address whose login is
    -- already confirmed, so an unfinished setup is cleared first.
    if agent.user_id is not null
       and exists (select 1 from auth.users u where u.id = agent.user_id and u.email_confirmed_at is not null) then
        update public.marketing_agents a set user_id = null where a.id = agent.id;
        delete from auth.users u where u.id = agent.user_id and coalesce(u.encrypted_password, '') = '';
    end if;

    insert into public.agent_events (agent_id, kind, result, email)
    values (agent.id, 'invite', 'started', address)
    returning id into attempt;
    return query select 'invite'::text, address, attempt;
end;
$$;

revoke execute on function public.request_agent_link(text, integer, integer) from public, anon, authenticated;
grant execute on function public.request_agent_link(text, integer, integer) to service_role;

-- Records how the email of a public attempt went: sent, rate_limited,
-- smtp_error, rejected_address or other_error (with Auth's error code).
create function public.record_agent_link(attempt_id uuid, result text, error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    attempt public.agent_events;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if record_agent_link.result is null
       or record_agent_link.result not in ('sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error') then
        raise exception 'invalid';
    end if;
    perform public.set_audit_actor('public_form', null);

    -- Only an attempt request_agent_link opened: no staff member started it.
    select * into attempt from public.agent_events e
    where e.id = record_agent_link.attempt_id
      and e.kind in ('invite', 'reset')
      and e.result = 'started'
      and e.created_by is null
      and e.batch_id is null;
    if not found then
        raise exception 'not_found';
    end if;

    begin
        insert into public.agent_events (agent_id, kind, result, attempt_id, error_code, email)
        values (
            attempt.agent_id,
            attempt.kind,
            record_agent_link.result,
            attempt.id,
            case when record_agent_link.result = 'other_error'
                then left(coalesce(nullif(btrim(record_agent_link.error_code), ''), 'unknown'), 100)
            end,
            attempt.email
        );
    exception when unique_violation then
        raise exception 'already_recorded';
    end;
end;
$$;

revoke execute on function public.record_agent_link(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_agent_link(uuid, text, text) to service_role;
