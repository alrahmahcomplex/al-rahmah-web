-- A code whose record has short names goes on to the choice of how to sign
-- in, as a code the office hasn't approved yet does (owner, 26 Nov 2026,
-- prototype v6 item 3).
--
-- Until now start_agent_self_confirm answered "weak_names" for any record
-- whose names are too short to prove anyone (fewer than three, or a
-- one-letter name: agent_names_strong), and the page sent it down today's
-- claim path, which asks for an email before anything else. Now such a
-- record, when its names match and it has a mobile that can take an SMS,
-- opens an attempt that proves the person by that mobile alone:
--   - by mobile, the number goes ONLY to the mobile on the record, never to a
--     typed one (typed_phone stays empty, as for a Pending or closed record);
--   - by email, the page sends today's claim (the Marketing Office decides):
--     the attempt's own email paths refuse it ("email_closed"), so neither a
--     typed email nor the record's email is ever reached from this attempt.
--
-- Invariants:
--   - A record with strong names works exactly as before.
--   - Short names prove nothing, so nothing here rests on them: the SMS to the
--     mobile on record is the proof. The names still have to match, so a
--     stranger with only the code can't make the agent's phone ring; a
--     mismatch is not counted as a miss and answers "weak_names" (today's
--     claim path), so a record like "J Ali Omari" never locks out the real
--     agent who types "Juma".
--   - With no mobile on record that can take an SMS, "weak_names" as before:
--     the page offers the email path only, which is today's claim.
--   - The page never learns the record's email for such a record
--     (email_on_record false), and email_open is false, so the page offers
--     the claim (email_claim) instead of the self-confirm email.
--   - Such an attempt is marked record_only. prepare_self_confirm_invite and
--     set_new_agent_email refuse a record_only attempt themselves, so hiding
--     the email choice on the page isn't the only guard: a direct call with
--     the attempt can't put a typed email on the record or send the record's
--     email an invite.
--   - Only start_agent_self_confirm (a code typed on the form) marks it. A
--     brand-new applicant whose name has an initial ("Rehema A Juma") opens
--     their attempt with start_new_agent_self_confirm, unmarked, and keeps
--     their email path as before (Sol, #546).
--   - Every other rule of start_agent_self_confirm stays as in
--     20270130120100_pending_code_self_confirm.sql.

-- An attempt opened on a code whose record has short names: proved by the
-- mobile on record alone, never by email.
alter table public.agent_confirm_attempts add column record_only boolean not null default false;

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
    weak boolean;
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
    -- Short names on the record prove nobody: only the mobile on record can.
    -- With no mobile that takes an SMS, or names that don't match (not a
    -- miss: short names never lock), today's claim path takes it.
    weak := not public.agent_names_strong(agent.full_name);
    if weak and (not coalesce(agent.phone ~ '^\+255[67][0-9]{8}$', false)
                 or not public.agent_names_match(agent.full_name, start_agent_self_confirm.typed_names)) then
        return jsonb_build_object('outcome', 'weak_names');
    end if;

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

    if not weak and not public.agent_names_match(agent.full_name, start_agent_self_confirm.typed_names) then
        insert into public.agent_confirm_misses (agent_id, kind) values (agent.id, 'names');
        return jsonb_build_object('outcome', 'name_mismatch');
    end if;

    -- After Remove this sign-in with its tick, only the mobile on record
    -- proves the person until the real agent joins: no email, and no typed
    -- mobile (the person removed may have joined with one). With no mobile on
    -- record, today's claim path takes it, where the Manager decides.
    closed := public.agent_email_self_confirm_closed(agent.id);
    -- A Pending record with an email claim still waiting for the Manager
    -- (sent by today's claim path before this) stays the Manager's to decide:
    -- its email path is shut too, so a second address can't take the record
    -- out of the queue (Astra, #544).
    closed := closed or (pending and exists (select 1 from public.agent_open_claims(agent.id)));
    if closed and not coalesce(agent.phone ~ '^\+255[67][0-9]{8}$', false) then
        return jsonb_build_object('outcome', 'email_closed');
    end if;

    -- Where a number may go: the mobile on record, or for an Approved record
    -- with strong names and none on record (and email not closed), the one
    -- typed. Never a typed one for a Pending record or short names.
    texts_to := case when closed or pending or weak then agent.phone else coalesce(agent.phone, phone) end;

    -- A new attempt voids the agent's open ones.
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');

    insert into public.agent_confirm_attempts (agent_id, browser_digest, ip_digest, typed_phone, shown_mobile, new_agent, record_only)
    values (agent.id, start_agent_self_confirm.browser, start_agent_self_confirm.ip,
            case when agent.phone is null and not closed and not pending and not weak then phone end, phone, pending, weak)
    returning id into attempt_id;

    return jsonb_build_object(
        'outcome', 'ready',
        'attempt', attempt_id,
        'mobile_on_record', agent.phone is not null,
        -- Only when the typed mobile is the one on file may the page show it.
        'typed_matches', agent.phone is not null and phone is not distinct from agent.phone,
        'can_text', coalesce(texts_to ~ '^\+255[67][0-9]{8}$', false),
        -- A Pending record's or short names' email stays unknown to the page.
        'email_on_record', agent.email is not null and not pending and not weak,
        'email_open', not closed and not weak,
        -- Short names: the email path is today's claim, which the Manager decides.
        'email_claim', weak,
        'pending', pending,
        'code', agent.code
    );
end;
$$;

revoke execute on function public.start_agent_self_confirm(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.start_agent_self_confirm(text, text, text, text, text) to service_role;

-- The self-confirm email of 20270126120100_agent_remove_sign_in.sql, now shut
-- ("email_closed") for an attempt on a code with short names (record_only):
-- its email path is today's claim, so a direct call can neither put a typed
-- email on the record nor invite the record's email.
create or replace function public.prepare_self_confirm_invite(attempt uuid, browser text, typed_email text, hourly_budget integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    a public.agent_confirm_attempts;
    agent public.marketing_agents;
    address text := nullif(lower(btrim(coalesce(prepare_self_confirm_invite.typed_email, ''))), '');
    event_id uuid;
    unused_login uuid;
    put_on_record boolean := false;
begin
    a := public.agent_confirm_attempt(prepare_self_confirm_invite.attempt, prepare_self_confirm_invite.browser);
    if a.id is null then return jsonb_build_object('outcome', 'expired'); end if;
    if not public.agent_can_self_confirm(a.agent_id) then return jsonb_build_object('outcome', 'off'); end if;
    select m.* into agent from public.marketing_agents m where m.id = a.agent_id for update;
    if public.agent_email_self_confirm_closed(agent.id) or a.record_only then
        return jsonb_build_object('outcome', 'email_closed');
    end if;
    -- No staff member is behind a self-confirm write.
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);

    -- 5 numbers and links per code a day, together.
    if public.self_confirm_sends_today(agent.id) >= 5 then
        return jsonb_build_object('outcome', 'code_limited');
    end if;
    -- The public hourly email budget, shared with "Tuma kiungo kipya", so
    -- staff invites and resets keep their share of Auth's hourly emails.
    delete from public.agent_link_requests r where r.requested_at < now() - interval '1 hour';
    if prepare_self_confirm_invite.hourly_budget is null
       or (select count(*) from public.agent_link_requests) >= prepare_self_confirm_invite.hourly_budget then
        return jsonb_build_object('outcome', 'busy');
    end if;

    -- The record's email may be set here when it has none, or corrected
    -- when an earlier self-confirm attempt put it there and it is still
    -- unconfirmed (the agent isn't joined: agent_can_self_confirm). An
    -- email staff entered is never changed here.
    if agent.email is null
       or (address is not null and address is distinct from agent.email
           and (select o.email_put_on_record from public.agent_confirm_attempts o
                where o.agent_id = agent.id and o.email_put_on_record is not null
                order by o.created_at desc limit 1) = agent.email) then
        if address is null or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(address) > 254 then
            return jsonb_build_object('outcome', 'no_email');
        end if;
        perform public.lock_login_email(address);
        if public.agent_email_taken(address) or exists (select 1 from auth.users u where lower(u.email) = address) then
            return jsonb_build_object('outcome', 'email_unusable');
        end if;
        unused_login := agent.user_id;
        update public.marketing_agents m set email = address, user_id = null where m.id = agent.id;
        -- The earlier address's unused invite login (no password) goes with it.
        if unused_login is not null then
            delete from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '';
        end if;
        agent.email := address;
        agent.user_id := null;
        put_on_record := true;
    end if;

    -- Auth won't invite an address whose login is already confirmed; an
    -- unused invite's login gives way, as in prepare_agent_invite.
    if agent.user_id is not null and not public.agent_joined(agent.user_id)
       and exists (select 1 from auth.users u where u.id = agent.user_id and u.email_confirmed_at is not null) then
        perform set_config('audit.actor_kind', 'system', true);
        perform set_config('audit.actor_staff_id', '', true);
        update public.marketing_agents m set user_id = null where m.id = agent.id;
        delete from auth.users u where u.id = agent.user_id and coalesce(u.encrypted_password, '') = '';
    end if;

    insert into public.agent_link_requests (email_hash) values (encode(sha256(convert_to(agent.email, 'UTF8')), 'hex'));
    insert into public.agent_events (agent_id, kind, result, email, created_by)
    values (agent.id, 'invite', 'started', agent.email, null)
    returning id into event_id;
    update public.agent_confirm_numbers n set voided_at = clock_timestamp() where n.attempt_id = a.id and n.used_at is null and n.voided_at is null;
    update public.agent_confirm_attempts o
    set channel = 'email', destination = agent.email, state = 'sent', invite_event = event_id,
        email_put_on_record = case when put_on_record then agent.email else o.email_put_on_record end
    where o.id = a.id;

    -- `stored`: the email was already on record (the typed one was ignored).
    return jsonb_build_object('outcome', 'ready', 'email', agent.email, 'event', event_id, 'stored', address is distinct from agent.email);
end;
$$;

revoke execute on function public.prepare_self_confirm_invite(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.prepare_self_confirm_invite(uuid, text, text, integer) to service_role;

-- The email path of a new agent's or a Pending code's attempt, as in
-- 20270130120100_pending_code_self_confirm.sql, now also shut
-- ("email_closed") for an attempt on a Pending code with short names
-- (record_only): its email path is today's claim too. A brand-new applicant's
-- own attempt is never record_only, whatever their names.
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
    if public.agent_email_self_confirm_closed(agent.id) or exists (select 1 from public.agent_open_claims(agent.id))
       or a.record_only then
        return jsonb_build_object('outcome', 'email_closed');
    end if;
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
