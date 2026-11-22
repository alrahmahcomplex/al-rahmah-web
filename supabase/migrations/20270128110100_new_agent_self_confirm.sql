-- New agents choose how to sign in too (#503 slice 4d-b, prototype v63;
-- replaces decision 75). Like everything self-confirm, it answers "off"
-- until set_agent_self_confirm(true) (#535).
--
-- A brand-new agent sends the Discount code form without a code. While
-- self-confirm is on, that send registers today's Pending record (no email
-- yet) and opens a self-confirm attempt for it, bound to this browser:
--   - by mobile, the confirmation number goes to the mobile they typed, and a
--     right number lets them set a password: a phone login linked to the
--     Pending record. Until the office approves the code, every agent read
--     answers "not_approved" (agent_students, current_agent_account), so the
--     login sees no students and no discount. Approving only flips the status.
--   - by email, the email goes on the Pending record, and today's set-password
--     email follows the office's approval, as now.
--
-- Invariants:
--   - A new-agent attempt can only ever prove a login for a Pending record
--     that it opened, from the browser that opened it, for the mobile typed
--     there (agent_attempt_open, self_confirm_attempt_for, link_new_login).
--   - A code holder's attempt still needs an Approved record, exactly as
--     before: agent_attempt_open is agent_can_self_confirm for those.
--   - The same SMS guards as a code holder's: Turnstile before the send, +255
--     mobiles only, the daily SMS budget and each mobile's limits
--     (reserve_sms), 5 numbers a day per code, and the per-browser (3 a day)
--     and per-IP (20 a day) limits on attempts.
--   - The email path sends nothing now; the record's email is set only when
--     it has none and nobody else uses the address.

-- ---------------------------------------------------------------------------
-- The attempt knows whether it opened a new record
-- ---------------------------------------------------------------------------

alter table public.agent_confirm_attempts add column new_agent boolean not null default false;

-- Whether this attempt's record may still go on: self-confirm on, the record
-- neither switched off nor retired, not joined, and Approved; or, for an
-- attempt that opened a new record, still Pending.
create function public.agent_attempt_open(attempt public.agent_confirm_attempts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.agent_self_confirm_on()
        and exists (
            select 1 from public.marketing_agents m
            where m.id = ($1).agent_id
              and m.switched_off_at is null and m.retired_at is null
              and (m.user_id is null or not public.agent_joined(m.user_id))
              and (m.status = 'Approved' or (($1).new_agent and m.status = 'Pending'))
        )
$$;

revoke execute on function public.agent_attempt_open(public.agent_confirm_attempts) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The start, for a new agent
-- ---------------------------------------------------------------------------

create function public.start_new_agent_self_confirm(full_name text, phone text, whatsapp text, browser text, ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    draft record;
    by_phone public.marketing_agents;
    agent public.marketing_agents;
    made record;
    attempt_id uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if not (select a.enabled from public.agent_access() a) then
        return jsonb_build_object('outcome', 'access_off');
    end if;
    if not public.agent_self_confirm_on() then
        return jsonb_build_object('outcome', 'off');
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    select * into draft
    from public.agent_draft(start_new_agent_self_confirm.full_name, start_new_agent_self_confirm.phone, start_new_agent_self_confirm.whatsapp, null, null);

    -- The lock sign_up_marketing_agent and create_agent_record take, so two
    -- sends with one phone wait for each other.
    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || draft.agent_phone, 0));
    select * into by_phone from public.marketing_agents a where a.phone = draft.agent_phone and a.retired_at is null;

    if by_phone.id is not null then
        -- The same person sending again before they finished: their Pending
        -- record goes on. Anyone else's mobile has a code already.
        if by_phone.status = 'Pending' and by_phone.switched_off_at is null and by_phone.full_name = draft.agent_name
           and by_phone.email is null and (by_phone.user_id is null or not public.agent_joined(by_phone.user_id)) then
            agent := by_phone;
        elsif by_phone.user_id is not null and public.agent_joined(by_phone.user_id) then
            return jsonb_build_object('outcome', 'joined');
        else
            return jsonb_build_object('outcome', 'code_needed');
        end if;
    end if;

    -- The attempt limits, as start_agent_self_confirm's: 3 a day per browser,
    -- 20 a day per IP, before anything is written.
    if (select count(*) from public.agent_confirm_attempts a where a.browser_digest = start_new_agent_self_confirm.browser and a.created_at > clock_timestamp() - interval '1 day') >= 3
       or (start_new_agent_self_confirm.ip is not null
           and (select count(*) from public.agent_confirm_attempts a where a.ip_digest = start_new_agent_self_confirm.ip and a.created_at > clock_timestamp() - interval '1 day') >= 20) then
        return jsonb_build_object('outcome', 'setups_limited');
    end if;

    if agent.id is null then
        select * into made
        from public.create_agent_record(draft.agent_name, draft.agent_phone, draft.agent_whatsapp, null, null, 'Pending', null);
        select * into agent from public.marketing_agents a where a.id = made.agent_id;
    end if;

    perform 1 from public.marketing_agents m where m.id = agent.id for update;
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');
    insert into public.agent_confirm_attempts (agent_id, browser_digest, ip_digest, shown_mobile, new_agent)
    values (agent.id, start_new_agent_self_confirm.browser, start_new_agent_self_confirm.ip, agent.phone, true)
    returning id into attempt_id;

    return jsonb_build_object(
        'outcome', 'ready',
        'attempt', attempt_id,
        'code', agent.code,
        'mobile_on_record', true,
        'typed_matches', true,
        'can_text', coalesce(agent.phone, '') ~ '^\+255[67][0-9]{8}$',
        'email_on_record', false
    );
end;
$$;

revoke execute on function public.start_new_agent_self_confirm(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.start_new_agent_self_confirm(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The number, re-created with agent_attempt_open (was agent_can_self_confirm)
-- ---------------------------------------------------------------------------

create or replace function public.issue_agent_confirm_number(attempt uuid, browser text, digest text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    a public.agent_confirm_attempts;
    agent record;
    last_sent timestamptz;
    target text;
begin
    a := public.agent_confirm_attempt(issue_agent_confirm_number.attempt, issue_agent_confirm_number.browser);
    if a.id is null then return jsonb_build_object('outcome', 'expired'); end if;
    if not public.agent_attempt_open(a) then return jsonb_build_object('outcome', 'off'); end if;
    select m.phone into agent from public.marketing_agents m where m.id = a.agent_id;
    target := coalesce(agent.phone, a.typed_phone);
    -- A landline or a foreign number on file can't take an SMS: email instead.
    if target is null or target !~ '^\+255[67][0-9]{8}$' then return jsonb_build_object('outcome', 'no_mobile'); end if;

    if (select count(*) from public.agent_confirm_misses x where x.agent_id = a.agent_id and x.kind = 'number' and x.at > clock_timestamp() - interval '1 day') >= 10
       or exists (
           select 1 from public.agent_confirm_numbers n join public.agent_confirm_attempts o on o.id = n.attempt_id
           where o.agent_id = a.agent_id and n.tries >= 5 and n.created_at > clock_timestamp() - interval '30 minutes'
       ) then
        return jsonb_build_object('outcome', 'locked');
    end if;
    select max(n.created_at) into last_sent from public.agent_confirm_numbers n
    join public.agent_confirm_attempts o on o.id = n.attempt_id where o.agent_id = a.agent_id;
    if last_sent > clock_timestamp() - interval '60 seconds' then return jsonb_build_object('outcome', 'too_soon'); end if;
    if public.self_confirm_sends_today(a.agent_id) >= 5 then
        return jsonb_build_object('outcome', 'code_limited');
    end if;

    update public.agent_confirm_numbers n set voided_at = clock_timestamp() where n.attempt_id = a.id and n.used_at is null and n.voided_at is null;
    insert into public.agent_confirm_numbers (attempt_id, digest) values (a.id, issue_agent_confirm_number.digest);
    update public.agent_confirm_attempts o set channel = 'mobile', destination = target, state = 'sent' where o.id = a.id;

    return jsonb_build_object('outcome', 'issued', 'phone', target, 'agent', a.agent_id, 'on_record', agent.phone is not null, 'show', target = a.shown_mobile);
end;
$$;

create or replace function public.check_agent_confirm_number(attempt uuid, browser text, digest text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    a public.agent_confirm_attempts;
    n public.agent_confirm_numbers;
begin
    a := public.agent_confirm_attempt(check_agent_confirm_number.attempt, check_agent_confirm_number.browser);
    if a.id is null then return jsonb_build_object('outcome', 'expired'); end if;
    if not public.agent_attempt_open(a) then return jsonb_build_object('outcome', 'off'); end if;
    -- The mobile on file changed since the number went out (a Manager's
    -- edit): the proof was for another mobile.
    if a.channel = 'mobile' and exists (select 1 from public.marketing_agents m where m.id = a.agent_id and m.phone is not null and m.phone <> a.destination) then
        return jsonb_build_object('outcome', 'expired');
    end if;
    if a.state = 'proven' then return jsonb_build_object('outcome', 'right', 'phone', a.destination); end if;
    -- Email was chosen since: the number went with it.
    if a.channel is distinct from 'mobile' then return jsonb_build_object('outcome', 'expired_number'); end if;
    if (select count(*) from public.agent_confirm_misses x where x.agent_id = a.agent_id and x.kind = 'number' and x.at > clock_timestamp() - interval '1 day') >= 10 then
        return jsonb_build_object('outcome', 'locked');
    end if;

    select x.* into n from public.agent_confirm_numbers x
    where x.attempt_id = a.id and x.used_at is null and x.voided_at is null
    order by x.created_at desc limit 1 for update;
    if n.id is null or n.tries >= 5 then return jsonb_build_object('outcome', 'locked'); end if;
    if n.expires_at <= clock_timestamp() then return jsonb_build_object('outcome', 'expired_number'); end if;

    if n.digest <> check_agent_confirm_number.digest then
        update public.agent_confirm_numbers x set tries = x.tries + 1 where x.id = n.id;
        insert into public.agent_confirm_misses (agent_id, kind) values (a.agent_id, 'number');
        if n.tries + 1 >= 5
           or (select count(*) from public.agent_confirm_misses x where x.agent_id = a.agent_id and x.kind = 'number' and x.at > clock_timestamp() - interval '1 day') >= 10 then
            return jsonb_build_object('outcome', 'locked');
        end if;
        return jsonb_build_object('outcome', 'wrong', 'tries_left', 5 - (n.tries + 1));
    end if;

    update public.agent_confirm_numbers x set used_at = clock_timestamp() where x.id = n.id;
    -- One mobile, one login (E8): checked only now, after the proof.
    if exists (select 1 from auth.users u where u.phone = ltrim(a.destination, '+')) then
        return jsonb_build_object('outcome', 'mobile_in_use');
    end if;
    update public.agent_confirm_attempts o set state = 'proven', proven_at = clock_timestamp() where o.id = a.id;
    return jsonb_build_object('outcome', 'right', 'phone', a.destination);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The phone login: Auth accepts and links it for a proven attempt whose
--    record is still open, Pending ones included for a new-agent attempt
-- ---------------------------------------------------------------------------

create or replace function public.self_confirm_attempt_for(new_user auth.users)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select a.id from public.agent_confirm_attempts a
    where a.id = case
            when (new_user.raw_user_meta_data ->> 'self_confirm_attempt') ~ '^[0-9a-f-]{36}$'
            then (new_user.raw_user_meta_data ->> 'self_confirm_attempt')::uuid
          end
      and a.state = 'proven' and a.channel = 'mobile' and a.expires_at > clock_timestamp()
      -- The browser that proved it: its token's digest rides in the marker.
      and a.browser_digest = (new_user.raw_user_meta_data ->> 'self_confirm_browser')
      and new_user.email is null
      and nullif(new_user.phone, '') is not null and a.destination = '+' || new_user.phone
      and exists (select 1 from public.marketing_agents m where m.id = a.agent_id and (m.phone is null or m.phone = a.destination))
      and public.agent_attempt_open(a)
$$;

revoke execute on function public.self_confirm_attempt_for(auth.users) from public, anon, authenticated, service_role;

create or replace function public.link_new_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    previous_kind text := coalesce(current_setting('audit.actor_kind', true), '');
    previous_staff_id text := coalesce(current_setting('audit.actor_staff_id', true), '');
    linked boolean := false;
    attempt_id uuid;
    attempt_agent uuid;
    attempt_new boolean;
    unused_login uuid;
begin
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);

    if new.email is null then
        -- A self-confirm phone login (#503): linked by its attempt's agent,
        -- under the agent row's lock, so a second finish can't link twice.
        attempt_id := public.self_confirm_attempt_for(new);
        if attempt_id is not null then
            select a.agent_id, a.new_agent into attempt_agent, attempt_new from public.agent_confirm_attempts a where a.id = attempt_id;
            select m.user_id into unused_login from public.marketing_agents m where m.id = attempt_agent for update;
            if unused_login is not null then
                perform 1 from auth.users u where u.id = unused_login for update;
            end if;
            -- An unused invite's login (no password yet) gives way, as a new
            -- invite clears it in prepare_agent_invite.
            if unused_login is not null and not public.agent_joined(unused_login)
               and exists (select 1 from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '') then
                update public.marketing_agents m set user_id = null where m.id = attempt_agent;
                delete from auth.users u where u.id = unused_login;
            end if;
            -- An Approved record, or the Pending one a new agent's attempt
            -- opened (#503 slice 4d-b): it stays Pending, and every agent read
            -- answers "not_approved" until the office approves it.
            update public.marketing_agents m
            set user_id = new.id
            where m.id = attempt_agent
              and (m.status = 'Approved' or (attempt_new and m.status = 'Pending'))
              and m.switched_off_at is null and m.retired_at is null and m.user_id is null;
            linked := found;
            if linked then
                update public.agent_confirm_attempts a set state = 'finished', finished_at = clock_timestamp() where a.id = attempt_id;
                update public.agent_confirm_attempts a set state = 'void'
                where a.agent_id = attempt_agent and a.id <> attempt_id and a.state in ('matched', 'sent', 'proven');
            end if;
        end if;
    elsif public.staff_login_open(new.email) and not public.agent_login_open(new.email) then
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

-- ---------------------------------------------------------------------------
-- 4. By email: the email goes on the new Pending record; today's
--    set-password email follows the office's approval
-- ---------------------------------------------------------------------------

create function public.set_new_agent_email(attempt uuid, browser text, typed_email text)
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
    perform public.set_audit_actor('public_form', null);

    if address is null or address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(address) > 254 then
        return jsonb_build_object('outcome', 'no_email');
    end if;
    if agent.email is distinct from address then
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

-- ---------------------------------------------------------------------------
-- 5. What the page reads
-- ---------------------------------------------------------------------------

-- Whether the Discount code form asks in self-confirm's order: no email
-- question before the send. Off, it keeps today's order.
create function public.self_confirm_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.agent_self_confirm_on()
$$;

revoke execute on function public.self_confirm_open() from public, anon, authenticated;
grant execute on function public.self_confirm_open() to service_role;

-- The signed-in agent's own code while their record waits for the office
-- (Pending, neither switched off nor retired, agent access on): the page
-- shows it with the share link. Nothing else about the record, and nothing
-- for anyone else.
create function public.my_pending_agent()
returns table (code text)
language sql
stable
security definer
set search_path = ''
as $$
    select a.code
    from public.current_principal() p
    join public.marketing_agents a on a.id = p.agent_id
    where p.kind = 'agent'
      and a.status = 'Pending' and a.switched_off_at is null and a.retired_at is null
      and (select acc.enabled from public.agent_access() acc)
$$;

revoke execute on function public.my_pending_agent() from public, anon;
grant execute on function public.my_pending_agent() to authenticated;
