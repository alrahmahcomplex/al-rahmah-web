-- Staff reset their password (#265).
--
-- - request_password_link replaces request_agent_link: one public request
--   decides across staff and agents (an email belongs to at most one of
--   them, ADR 5). It counts every request against the same per-email limit
--   and project-wide hourly budget (agent_link_requests) before it looks the
--   email up, so the limits answer the same for any address. Then:
--   - an active staff member who has joined gets a reset;
--   - an active staff member who hasn't joined gets a fresh invite;
--   - a deactivated staff member gets nothing;
--   - an agent gets what request_agent_link gave, except that while agent
--     access is off the answer is `none`, not `access_off`: staff resets
--     work with agent access off, so a separate answer would tell a stranger
--     that an email is not staff's.
-- - prepare_staff_reset: a Manager's "Send reset link" on Staff and roles.
--   The database refuses it outside the caller's Managed set, for a
--   deactivated staff member and for one still Invited. It counts against
--   the same hourly budget and writes the `password_reset_sent` Action
--   event in the same transaction, so no reset leaves the server without
--   one.

-- ---------------------------------------------------------------------------
-- The Action event
-- ---------------------------------------------------------------------------

-- No permission: like invite_sent, it is open to anyone who manages staff,
-- and prepare_staff_reset checks the Managed set before writing it.
insert into public.audit_action_kinds (kind, permission, scope) values
    ('password_reset_sent', null, 'staff_admin');

-- ---------------------------------------------------------------------------
-- The public request
-- ---------------------------------------------------------------------------

drop function public.request_agent_link(text, integer, integer);

-- Answers one of:
-- - limited: this email has had per_email_limit requests in the last hour.
-- - busy: the project has had hourly_budget requests in the last hour.
-- - none: nothing to send. Counted, unless the same email asked in the last
--   60 seconds, which gets this answer without being counted.
-- - reset or invite: counted; send that email to `send_to`. `principal`
--   says whose login it is, `staff` or `agent`, which picks the link. An
--   agent's send then records the result of `attempt_id` with
--   record_agent_link; a staff member's has no attempt.
create function public.request_password_link(email text, per_email_limit integer, hourly_budget integer)
returns table (outcome text, principal text, send_to text, attempt_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    address text := lower(btrim(request_password_link.email));
    hash text;
    member public.staff_members;
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

    delete from public.agent_link_requests r where r.requested_at < now() - interval '1 hour';

    hash := encode(sha256(convert_to(address, 'UTF8')), 'hex');
    -- Supabase refuses a second email to one address within 60 seconds, so a
    -- repeat inside that gap would send nothing: it gets the neutral reply
    -- and uses no allowance.
    if exists (
        select 1 from public.agent_link_requests r
        where r.email_hash = hash and r.requested_at > now() - interval '60 seconds'
    ) then
        return query select 'none'::text, null::text, null::text, null::uuid;
        return;
    end if;
    if (select count(*) from public.agent_link_requests r where r.email_hash = hash) >= per_email_limit then
        return query select 'limited'::text, null::text, null::text, null::uuid;
        return;
    end if;
    if (select count(*) from public.agent_link_requests) >= hourly_budget then
        return query select 'busy'::text, null::text, null::text, null::uuid;
        return;
    end if;
    insert into public.agent_link_requests (email_hash) values (hash);

    -- Staff first. Staff emails are stored lowercased and match the login's,
    -- since staff never change their own email.
    select s.* into member from public.staff_members s where s.email = address for update;
    if found then
        if not member.active then
            return query select 'none'::text, null::text, null::text, null::uuid;
            return;
        end if;
        -- The Super Admin resets like anyone else (owner decision, #265).
        -- Joined as the Staff and roles screen counts it (staff_member_invited).
        joined := not coalesce(public.staff_member_invited(member.id), true);
        return query select (case when joined then 'reset' else 'invite' end)::text, 'staff'::text, address, null::uuid;
        return;
    end if;

    -- Agents, as request_agent_link decided (#194). With agent access off,
    -- an agent's email gets the same `none` as a stranger's.
    if not (select a.enabled from public.agent_access() a) then
        return query select 'none'::text, null::text, null::text, null::uuid;
        return;
    end if;

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
        return query select 'none'::text, null::text, null::text, null::uuid;
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
        return query select 'reset'::text, 'agent'::text, address, attempt;
        return;
    end if;

    -- Only an agent the school has invited gets a new invite: the Manager
    -- confirmed that email when the first one went out.
    if public.agent_invite_sent_at(agent.id, agent.email) is null then
        return query select 'none'::text, null::text, null::text, null::uuid;
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
    return query select 'invite'::text, 'agent'::text, address, attempt;
end;
$$;

revoke execute on function public.request_password_link(text, integer, integer) from public, anon, authenticated;
grant execute on function public.request_password_link(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The Manager's "Send reset link"
-- ---------------------------------------------------------------------------

-- Checks the caller may send `staff_id` a reset link, counts it against the
-- hourly budget, records the Action event, and returns the person's names
-- and email for the send. Refuses, as resendable_invite does:
-- - not_found: no such staff member, or the Super Admin to anyone else;
-- - forbidden: outside the caller's Managed set;
-- - reset_deactivated, reset_not_joined: deactivated, or still Invited
--   (they keep Resend invite);
-- - reset_too_soon: a Manager sent this person one less than a minute ago
--   (Supabase would refuse the email anyway);
-- - reset_rate_limited: the hourly budget is used up.
-- The email goes out from the server with the secret key after this
-- returns. Calling this alone sends nothing.
--
-- The budget comes from the server's setting, but a caller could pass any
-- number, so it is capped at Supabase's own hourly email limit (50). A
-- Manager's send is counted under a marker for the staff member, not their
-- email's hash, so it uses the hourly budget but never the person's own
-- per-email allowance on the public page.
create function public.prepare_staff_reset(staff_id uuid, hourly_budget integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.staff_members;
    marker text;
begin
    perform public.require_staff_administrator();
    if hourly_budget is null or hourly_budget < 0 then
        raise exception 'invalid';
    end if;

    select * into target from public.staff_members s where s.id = prepare_staff_reset.staff_id for update;
    if not found or public.hidden_staff_member(target.id) then
        raise exception 'not_found';
    end if;
    perform public.require_manages(target.role_id);
    if not target.active then
        raise exception 'reset_deactivated' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;
    if public.staff_member_invited(target.id) then
        raise exception 'reset_not_joined' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;

    delete from public.agent_link_requests r where r.requested_at < now() - interval '1 hour';
    marker := encode(sha256(convert_to('manager-reset:' || target.id::text, 'UTF8')), 'hex');
    if exists (
        select 1 from public.agent_link_requests r
        where r.email_hash = marker and r.requested_at > now() - interval '60 seconds'
    ) then
        raise exception 'reset_too_soon' using detail = jsonb_build_object('name', target.full_name)::text;
    end if;
    if (select count(*) from public.agent_link_requests) >= least(hourly_budget, 50) then
        raise exception 'reset_rate_limited';
    end if;
    insert into public.agent_link_requests (email_hash) values (marker);

    perform public.record_action(
        'password_reset_sent', null,
        jsonb_build_object('staff_member_id', target.id, 'email', target.email)
    );

    return public.staff_member_names(target.id) || jsonb_build_object('id', target.id, 'email', target.email);
end;
$$;

revoke execute on function public.prepare_staff_reset(uuid, integer) from public, anon;
grant execute on function public.prepare_staff_reset(uuid, integer) to authenticated;
