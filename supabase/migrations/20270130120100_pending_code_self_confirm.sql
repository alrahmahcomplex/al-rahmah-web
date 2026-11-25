-- A code the office hasn't approved yet goes on to the choice of how to sign
-- in, as a new agent's does (owner, 24 Nov 2026, agent sign-up fixes item 6).
--
-- Until now start_agent_self_confirm answered "pending" for a Pending code, and
-- the page sent it down today's claim path, which needs an email: the form
-- asked for one before the person had chosen the email path. Now a Pending
-- code with matching names opens an attempt that behaves like the one a new
-- agent opens (20270128110100_new_agent_self_confirm.sql):
--   - by mobile, the number goes to the mobile on the record, and a right
--     number lets them set a password: a phone login linked to the Pending
--     record, which stays Pending; every agent read answers "not_approved"
--     until the office approves it;
--   - by email, the email goes on the Pending record (set_new_agent_email);
--     today's set-password email follows the office's approval.
--
-- Invariants:
--   - An Approved code works exactly as before.
--   - A Pending code proves the person the way an Approved one does: the
--     code, the names (strong names only, the same misses lock and the same
--     attempt limits), then the mobile ON THE RECORD. A typed mobile is never
--     used for a Pending record, so knowing a code and names can't put a
--     stranger's mobile on it.
--   - The attempt is marked new_agent, the flag agent_attempt_open,
--     link_new_login and set_new_agent_email already read as "this attempt may
--     go on with a Pending record". Nothing else reads it.
--   - The page never learns the record's email: email_on_record is false for
--     a Pending code, so the email path asks for it, and set_new_agent_email
--     refuses one that differs from an email already on the record.
--   - After Remove this sign-in with its tick (email closed), the email path
--     stays shut for a Pending record too: set_new_agent_email now checks
--     agent_email_self_confirm_closed itself, as prepare_self_confirm_invite
--     does, so hiding the choice on the page isn't the only guard (Greptile,
--     #544).

create or replace function public.start_agent_self_confirm(code text, typed_names text, typed_phone text, browser text, ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent record;
    phone text := nullif(public.normalize_phone(start_agent_self_confirm.typed_phone), '');
    attempt_id uuid;
    closed boolean;
    pending boolean;
    texts_to text;
begin
    if not public.agent_self_confirm_on() then
        return jsonb_build_object('outcome', case when (select a.enabled from public.agent_access() a) then 'off' else 'access_off' end);
    end if;

    select m.* into agent from public.agent_for_code(start_agent_self_confirm.code) m
    where m.switched_off_at is null;
    if agent.id is null then return jsonb_build_object('outcome', 'no_match'); end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then return jsonb_build_object('outcome', 'joined'); end if;
    pending := agent.status = 'Pending';
    -- A record with weak names never self-confirms, so neither its names nor
    -- self-confirm's locks and limits apply: today's claim path takes it.
    if not public.agent_names_strong(agent.full_name) then return jsonb_build_object('outcome', 'weak_names'); end if;

    perform 1 from public.marketing_agents m where m.id = agent.id for update;

    -- Locked for 30 minutes from the fifth wrong names within 30 minutes.
    if exists (
        select 1 from public.agent_confirm_misses x
        where x.agent_id = agent.id and x.kind = 'names' and x.at > clock_timestamp() - interval '30 minutes'
          and (select count(*) from public.agent_confirm_misses y
               where y.agent_id = agent.id and y.kind = 'names' and y.at <= x.at and y.at > x.at - interval '30 minutes') >= 5
    ) then
        return jsonb_build_object('outcome', 'locked');
    end if;
    if (select count(*) from public.agent_confirm_attempts a where a.browser_digest = start_agent_self_confirm.browser and a.created_at > clock_timestamp() - interval '1 day') >= 3
       or (start_agent_self_confirm.ip is not null
           and (select count(*) from public.agent_confirm_attempts a where a.ip_digest = start_agent_self_confirm.ip and a.created_at > clock_timestamp() - interval '1 day') >= 20) then
        return jsonb_build_object('outcome', 'setups_limited');
    end if;

    if not public.agent_names_match(agent.full_name, start_agent_self_confirm.typed_names) then
        insert into public.agent_confirm_misses (agent_id, kind) values (agent.id, 'names');
        return jsonb_build_object('outcome', 'name_mismatch');
    end if;

    -- After Remove this sign-in with its tick, only the mobile on record
    -- proves the person until the real agent joins: no email, and no typed
    -- mobile (the person removed may have joined with one). With no mobile on
    -- record, today's claim path takes it, where the Manager decides.
    closed := public.agent_email_self_confirm_closed(agent.id);
    if closed and not coalesce(agent.phone ~ '^\+255[67][0-9]{8}$', false) then
        return jsonb_build_object('outcome', 'email_closed');
    end if;

    -- Where a number may go: the mobile on record, or for an Approved record
    -- with none (and email not closed), the one typed. Never a typed one for
    -- a Pending record.
    texts_to := case when closed or pending then agent.phone else coalesce(agent.phone, phone) end;

    -- A new attempt voids the agent's open ones.
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');

    insert into public.agent_confirm_attempts (agent_id, browser_digest, ip_digest, typed_phone, shown_mobile, new_agent)
    values (agent.id, start_agent_self_confirm.browser, start_agent_self_confirm.ip,
            case when agent.phone is null and not closed and not pending then phone end, phone, pending)
    returning id into attempt_id;

    return jsonb_build_object(
        'outcome', 'ready',
        'attempt', attempt_id,
        'mobile_on_record', agent.phone is not null,
        -- Only when the typed mobile is the one on file may the page show it.
        'typed_matches', agent.phone is not null and phone is not distinct from agent.phone,
        'can_text', coalesce(texts_to ~ '^\+255[67][0-9]{8}$', false),
        -- A Pending record's email stays unknown to the page: its email path asks.
        'email_on_record', agent.email is not null and not pending,
        'email_open', not closed,
        'pending', pending,
        'code', agent.code
    );
end;
$$;

revoke execute on function public.start_agent_self_confirm(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.start_agent_self_confirm(text, text, text, text, text) to service_role;

-- The email path of a new agent's or a Pending code's attempt, as in
-- 20270128110100_new_agent_self_confirm.sql, now also shut while email
-- self-confirm is closed on the code ("off", which the page already handles).
create or replace function public.set_new_agent_email(attempt uuid, browser text, typed_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    a public.agent_confirm_attempts;
    agent public.marketing_agents;
    address text := nullif(lower(btrim(coalesce(set_new_agent_email.typed_email, ''))), '');
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    a := public.agent_confirm_attempt(set_new_agent_email.attempt, set_new_agent_email.browser);
    if a.id is null or not a.new_agent then return jsonb_build_object('outcome', 'expired'); end if;
    if not public.agent_attempt_open(a) then return jsonb_build_object('outcome', 'off'); end if;
    select m.* into agent from public.marketing_agents m where m.id = a.agent_id for update;
    if agent.status <> 'Pending' then return jsonb_build_object('outcome', 'off'); end if;
    if public.agent_email_self_confirm_closed(agent.id) then return jsonb_build_object('outcome', 'off'); end if;
    perform public.set_audit_actor('public_form', null);

    if address is null or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(address) > 254 then
        return jsonb_build_object('outcome', 'no_email');
    end if;
    -- An email already on the record (the office may have added one while
    -- the attempt was open) is never replaced from the public page (Sol, #538).
    if agent.email is not null and agent.email <> address then
        return jsonb_build_object('outcome', 'email_unusable');
    end if;
    if agent.email is null then
        perform public.lock_login_email(address);
        if public.agent_email_taken(address) or exists (select 1 from auth.users u where lower(u.email) = address) then
            return jsonb_build_object('outcome', 'email_unusable');
        end if;
        update public.marketing_agents m set email = address where m.id = agent.id;
    end if;

    -- The attempt is done: no number goes out now.
    update public.agent_confirm_numbers n set voided_at = clock_timestamp() where n.attempt_id = a.id and n.used_at is null and n.voided_at is null;
    update public.agent_confirm_attempts o set channel = 'email', destination = address, state = 'void' where o.id = a.id;

    return jsonb_build_object('outcome', 'registered', 'code', agent.code, 'email', address);
end;
$$;

revoke execute on function public.set_new_agent_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_new_agent_email(uuid, text, text) to service_role;
