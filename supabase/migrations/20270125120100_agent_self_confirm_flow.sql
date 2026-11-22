-- Agent self-confirm, the flow (#503 slice 3), still switched off: every
-- step below answers "off" until set_agent_self_confirm(true) (slice 4).
--
-- An agent already on record (Approved code, not joined) types their code
-- and names; when they match, they choose how they will sign in. By mobile,
-- the app texts a 6-digit confirmation number (its HMAC digest is stored
-- here, never the number) to the mobile on record, or to the typed mobile
-- when none is on file; a right number proves the attempt, and the app
-- creates the phone login with the secret key, which the Auth triggers below
-- accept only for a proven attempt. By email, today's agent invite goes out.
--
-- Tables have RLS and no client policies; every function is for the secret
-- key only, and each one checks again that self-confirm is on and the agent
-- can still use it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.agent_confirm_attempts (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references public.marketing_agents (id),
    -- sha256 hex of the browser's httpOnly cookie token, and of the IP.
    browser_digest text not null check (browser_digest ~ '^[0-9a-f]{64}$'),
    ip_digest text check (ip_digest ~ '^[0-9a-f]{64}$'),
    channel text check (channel in ('mobile', 'email')),
    -- The mobile texted (+255…) or the email invited.
    destination text check (char_length(destination) <= 254),
    -- The mobile typed, as normalize_phone stores it, when it matched none on file.
    typed_phone text check (typed_phone = public.normalize_phone(typed_phone)),
    state text not null default 'matched' check (state in ('matched', 'sent', 'proven', 'finished', 'void')),
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null default clock_timestamp() + interval '60 minutes',
    proven_at timestamptz,
    finished_at timestamptz,
    -- The email this attempt put on a record that had none (E3), so a later
    -- attempt may correct it while it is still unconfirmed. Kept when the
    -- attempt goes on by mobile instead.
    email_put_on_record text,
    -- The invite this attempt sent, so switching off can tell a self-confirm
    -- invite from a Manager's or a public resend (both also have no or
    -- another sender).
    invite_event uuid references public.agent_events (id),
    -- The mobile the page may show (O-N9): the one typed, when it is the one
    -- texted. A number sent anywhere else is never shown, even masked.
    shown_mobile text,
    -- A void attempt keeps whatever it reached: any state can be voided.
    check (state = 'void' or (state in ('proven', 'finished')) = (proven_at is not null)),
    check ((state = 'finished') = (finished_at is not null)),
    check (state in ('matched', 'void') or channel is not null)
);

create index agent_confirm_attempts_agent_idx on public.agent_confirm_attempts (agent_id, created_at);
create index agent_confirm_attempts_browser_idx on public.agent_confirm_attempts (browser_digest, created_at);
create index agent_confirm_attempts_ip_idx on public.agent_confirm_attempts (ip_digest, created_at);

create table public.agent_confirm_numbers (
    id uuid primary key default gen_random_uuid(),
    attempt_id uuid not null references public.agent_confirm_attempts (id),
    -- HMAC-SHA256 hex (OTP_HMAC_SECRET) of "<attempt id>|<six digits>".
    digest text not null check (digest ~ '^[0-9a-f]{64}$'),
    tries integer not null default 0 check (tries between 0 and 5),
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null default clock_timestamp() + interval '10 minutes',
    used_at timestamptz,
    voided_at timestamptz
);

create index agent_confirm_numbers_attempt_idx on public.agent_confirm_numbers (attempt_id, created_at);

-- Wrong names (5 in 30 minutes lock the code, O-N28) and wrong numbers
-- (10 per agent a day).
create table public.agent_confirm_misses (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references public.marketing_agents (id),
    kind text not null check (kind in ('names', 'number')),
    at timestamptz not null default clock_timestamp()
);

create index agent_confirm_misses_agent_idx on public.agent_confirm_misses (agent_id, kind, at);

alter table public.agent_confirm_attempts enable row level security;
alter table public.agent_confirm_numbers enable row level security;
alter table public.agent_confirm_misses enable row level security;
revoke all on public.agent_confirm_attempts from anon, authenticated, service_role;
revoke all on public.agent_confirm_numbers from anon, authenticated, service_role;
revoke all on public.agent_confirm_misses from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Weak record names (lead, 21 Nov): a one-letter name, or fewer than three
-- names, can't self-confirm; such a record goes through today's claim path.
create function public.agent_names_strong(full_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select cardinality(names) >= 3 and not exists (select 1 from unnest(names) n where char_length(n) < 2)
    from (select regexp_split_to_array(public.normalize_father_name(agent_names_strong.full_name), ' ') as names) s
$$;

-- An agent who may self-confirm right now.
create function public.agent_can_self_confirm(agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.agent_self_confirm_on()
        and exists (
            select 1 from public.marketing_agents m
            where m.id = agent_can_self_confirm.agent_id
              and m.status = 'Approved' and m.switched_off_at is null and m.retired_at is null
              -- Not joined: no login, or only an unused invite's.
              and (m.user_id is null or not public.agent_joined(m.user_id))
        )
$$;

revoke execute on function public.agent_names_strong(text) from public, anon, authenticated;
revoke execute on function public.agent_can_self_confirm(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Start: code and names
-- ---------------------------------------------------------------------------

create function public.start_agent_self_confirm(code text, typed_names text, typed_phone text, browser text, ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent record;
    phone text := nullif(public.normalize_phone(start_agent_self_confirm.typed_phone), '');
    attempt_id uuid;
begin
    if not public.agent_self_confirm_on() then
        return jsonb_build_object('outcome', case when (select a.enabled from public.agent_access() a) then 'off' else 'access_off' end);
    end if;

    select m.* into agent from public.agent_for_code(start_agent_self_confirm.code) m
    where m.switched_off_at is null;
    if agent.id is null then return jsonb_build_object('outcome', 'no_match'); end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then return jsonb_build_object('outcome', 'joined'); end if;
    if agent.status <> 'Approved' then return jsonb_build_object('outcome', 'pending'); end if;
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

    -- A new attempt voids the agent's open ones.
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');

    insert into public.agent_confirm_attempts (agent_id, browser_digest, ip_digest, typed_phone, shown_mobile)
    values (agent.id, start_agent_self_confirm.browser, start_agent_self_confirm.ip,
            case when agent.phone is null then phone end, phone)
    returning id into attempt_id;

    return jsonb_build_object(
        'outcome', 'ready',
        'attempt', attempt_id,
        'mobile_on_record', agent.phone is not null,
        -- Only when the typed mobile is the one on file may the page show it.
        'typed_matches', agent.phone is not null and phone is not distinct from agent.phone,
        'can_text', coalesce(agent.phone, phone) ~ '^\+255[67][0-9]{8}$',
        'email_on_record', agent.email is not null
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A confirmation number for the mobile
-- ---------------------------------------------------------------------------

-- Numbers and links sent for an agent's self-confirm in the last day,
-- together: 5 a day per code (O-N26).
create function public.self_confirm_sends_today(agent_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select (select count(*) from public.agent_confirm_numbers n join public.agent_confirm_attempts o on o.id = n.attempt_id
            where o.agent_id = self_confirm_sends_today.agent_id and n.created_at > clock_timestamp() - interval '1 day')
         + (select count(*) from public.agent_events e
            where e.agent_id = self_confirm_sends_today.agent_id and e.kind = 'invite' and e.result = 'started' and e.created_by is null
              and e.created_at > clock_timestamp() - interval '1 day')
$$;

revoke execute on function public.self_confirm_sends_today(uuid) from public, anon, authenticated, service_role;

-- The open attempt of this browser, locked, or null.
create function public.agent_confirm_attempt(attempt uuid, browser text)
returns public.agent_confirm_attempts
language sql
security definer
set search_path = ''
as $$
    select a.* from public.agent_confirm_attempts a
    where a.id = agent_confirm_attempt.attempt and a.browser_digest = agent_confirm_attempt.browser
      and a.state in ('matched', 'sent', 'proven') and a.expires_at > clock_timestamp()
    for update
$$;

revoke execute on function public.agent_confirm_attempt(uuid, text) from public, anon, authenticated, service_role;

create function public.issue_agent_confirm_number(attempt uuid, browser text, digest text)
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
    if not public.agent_can_self_confirm(a.agent_id) then return jsonb_build_object('outcome', 'off'); end if;
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

-- The SMS didn't go (budget, the mobile's limits, the provider): the number
-- is removed, so it counts against no limit, and the page can offer email.
create function public.void_agent_confirm_number(attempt uuid, browser text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    a public.agent_confirm_attempts;
begin
    a := public.agent_confirm_attempt(void_agent_confirm_number.attempt, void_agent_confirm_number.browser);
    if a.id is null then return; end if;
    delete from public.agent_confirm_numbers n where n.attempt_id = a.id and n.used_at is null and n.voided_at is null and n.tries = 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Checking the number
-- ---------------------------------------------------------------------------

create function public.check_agent_confirm_number(attempt uuid, browser text, digest text)
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
    if not public.agent_can_self_confirm(a.agent_id) then return jsonb_build_object('outcome', 'off'); end if;
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

revoke execute on function public.start_agent_self_confirm(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.issue_agent_confirm_number(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.void_agent_confirm_number(uuid, text) from public, anon, authenticated;
revoke execute on function public.check_agent_confirm_number(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_agent_self_confirm(text, text, text, text, text) to service_role;
grant execute on function public.issue_agent_confirm_number(uuid, text, text) to service_role;
grant execute on function public.void_agent_confirm_number(uuid, text) to service_role;
grant execute on function public.check_agent_confirm_number(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3b. Email instead: today's agent invite
-- ---------------------------------------------------------------------------

-- Readies today's invite for the attempt's agent: the stored email is kept;
-- with none on record, the typed email, if no one else uses it, is stored
-- (system actor). Opens an invite event like prepare_agent_invite, with no
-- staff member behind it. The app then sends the invite and records it.
create function public.prepare_self_confirm_invite(attempt uuid, browser text, typed_email text, hourly_budget integer)
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

-- How the self-confirm invite went, closing its event like record_agent_invite.
create function public.record_self_confirm_invite(event uuid, result text, error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    started public.agent_events;
begin
    if record_self_confirm_invite.result is null
       or record_self_confirm_invite.result not in ('sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error') then
        raise exception 'invalid';
    end if;
    select e.* into started from public.agent_events e
    where e.id = record_self_confirm_invite.event and e.kind = 'invite' and e.result = 'started' and e.created_by is null;
    if not found then raise exception 'not_found'; end if;
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);
    insert into public.agent_events (agent_id, kind, result, attempt_id, error_code, email, created_by)
    values (started.agent_id, 'invite', record_self_confirm_invite.result, started.id,
            case when record_self_confirm_invite.result = 'other_error' then coalesce(record_self_confirm_invite.error_code, 'unknown') end,
            started.email, null);
end;
$$;

revoke execute on function public.prepare_self_confirm_invite(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.record_self_confirm_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_self_confirm_invite(uuid, text, text, integer) to service_role;
grant execute on function public.record_self_confirm_invite(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The phone login: Auth accepts it only for a proven attempt
-- ---------------------------------------------------------------------------

-- The proven, open attempt a new phone-only login names in its
-- user_metadata, for that same mobile, whose agent can still self-confirm.
-- Null otherwise. Auth writes app_metadata only after the insert, so the
-- marker rides in user_metadata, which Auth inserts with the row; at insert
-- it can only come from the secret key, since sign-ups are off.
-- INSERT ONLY: a signed-in person can rewrite their own user_metadata
-- (updateUser), so nothing may read this marker except the two INSERT
-- triggers below, and the app clears it once the login is made.
create function public.self_confirm_attempt_for(new_user auth.users)
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
      and public.agent_can_self_confirm(a.agent_id)
$$;

revoke execute on function public.self_confirm_attempt_for(auth.users) from public, anon, authenticated, service_role;

create or replace function public.refuse_unknown_signups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- A phone login from a proven self-confirm attempt (#503). Insert only:
    -- the marker it reads is user_metadata, which a login can rewrite later.
    if new.email is null and public.self_confirm_attempt_for(new) is not null then
        return new;
    end if;
    -- Exactly one kind of person. guard_login keeps an email on one record,
    -- so both matching would be a broken state, refused too.
    if new.email is null
       or public.staff_login_open(new.email) = public.agent_login_open(new.email) then
        raise exception 'This email does not belong to an active staff member or an approved agent.';
    end if;
    return new;
end;
$$;

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
    unused_login uuid;
begin
    perform set_config('audit.actor_kind', 'system', true);
    perform set_config('audit.actor_staff_id', '', true);

    if new.email is null then
        -- A self-confirm phone login (#503): linked by its attempt's agent,
        -- under the agent row's lock, so a second finish can't link twice.
        attempt_id := public.self_confirm_attempt_for(new);
        if attempt_id is not null then
            select a.agent_id into attempt_agent from public.agent_confirm_attempts a where a.id = attempt_id;
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
            update public.marketing_agents m
            set user_id = new.id
            where m.id = attempt_agent
              and m.status = 'Approved' and m.switched_off_at is null and m.retired_at is null and m.user_id is null;
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

revoke execute on function public.refuse_unknown_signups() from public, anon, authenticated, service_role;
revoke execute on function public.link_new_login() from public, anon, authenticated, service_role;

-- Joined: a login with a password and a confirmed email, or since #503 a
-- confirmed mobile (a self-confirm phone login has no email).
create or replace function public.agent_joined(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from auth.users u
        where u.id = agent_joined.user_id
          and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
          and coalesce(u.encrypted_password, '') <> ''
    );
$$;

revoke execute on function public.agent_joined(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reserve_sms, re-created (from #522's review): a missing sms_settings row
-- refuses the send instead of reading an empty budget.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_sms(kind text, to_phone text, agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    settings public.sms_settings;
    -- Read after the lock below, so the clock and the day are those of the
    -- moment this reservation holds it.
    at_time timestamptz;
    day date;
    mobile text := public.normalize_phone(reserve_sms.to_phone);
    spent integer;
    made uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if reserve_sms.kind is null or reserve_sms.kind not in ('self_confirm', 'reset', 'courtesy')
       or mobile is null or mobile !~ '^\+255[67][0-9]{8}$' then
        raise exception 'invalid';
    end if;

    -- One reservation at a time, whatever the day: two at once can't both
    -- take the budget's last place or a mobile's last one, even either side
    -- of midnight, where the hour's window spans two days.
    perform pg_advisory_xact_lock(hashtextextended('sms-reservations', 0));
    at_time := clock_timestamp();
    day := (at_time at time zone 'Africa/Dar_es_Salaam')::date;
    select * into settings from public.sms_settings;
    -- With no settings row, no budget can be read: nothing is sent.
    if settings.daily_budget is null then
        raise exception 'unavailable';
    end if;

    select count(*) into spent
    from public.sms_sends s
    where s.tz_day = day and s.result in ('reserved', 'sent', 'provider_error');
    if spent >= settings.daily_budget then
        insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result, created_at)
        values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'budget_reached', at_time);
        return jsonb_build_object('outcome', 'budget_reached');
    end if;

    if reserve_sms.kind <> 'courtesy' and (
        (select count(*) from public.sms_sends s
         where s.to_phone = mobile and s.kind <> 'courtesy' and s.result in ('reserved', 'sent', 'provider_error')
           and s.created_at > at_time - interval '1 hour') >= settings.per_mobile_hour
        or (select count(*) from public.sms_sends s
            where s.to_phone = mobile and s.kind <> 'courtesy' and s.result in ('reserved', 'sent', 'provider_error')
              and s.tz_day = day) >= settings.per_mobile_day
    ) then
        insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result, created_at)
        values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'mobile_limited', at_time);
        return jsonb_build_object('outcome', 'mobile_limited');
    end if;

    insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result, created_at)
    values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'reserved', at_time)
    returning id into made;
    return jsonb_build_object('outcome', 'reserved', 'send_id', made);
end;
$$;

revoke execute on function public.reserve_sms(text, text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_sms(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Which invite self-confirm sent. Switching self-confirm off stops new
-- starts, numbers and emails at once; a link already sent keeps working
-- until it expires, like any invite (lead decision, #530: off stops new
-- joins, it doesn't recall them; Remove this sign-in, slice 4, undoes one).
-- ---------------------------------------------------------------------------

-- An agent whose latest invite is the one a self-confirm attempt sent.
create function public.agent_invited_by_self_confirm(agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.agent_confirm_attempts a
        where a.agent_id = agent_invited_by_self_confirm.agent_id
          and a.invite_event = (
              select e.id from public.agent_events e
              where e.agent_id = agent_invited_by_self_confirm.agent_id and e.kind = 'invite' and e.result = 'started'
              order by e.created_at desc, e.id desc limit 1
          )
    )
$$;

revoke execute on function public.agent_invited_by_self_confirm(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. The welcome after an email self-confirm says the account is ready
-- ---------------------------------------------------------------------------

-- For the signed-in agent: whether their invite was a self-confirm one.
create function public.my_agent_self_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select public.agent_invited_by_self_confirm(m.id) from public.marketing_agents m where m.user_id = auth.uid()), false)
$$;

revoke execute on function public.my_agent_self_confirmed() from public, anon;
grant execute on function public.my_agent_self_confirmed() to authenticated;

-- ---------------------------------------------------------------------------
-- account_state, as 20261127120700_agent_email_claims.sql made it, with
-- joined read before the email checks: a self-confirm phone login has no
-- email, and the Agents screen shows it joined, not waiting for one.
-- ---------------------------------------------------------------------------

create or replace function public.account_state(agent public.marketing_agents)
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
    if agent.status = 'Approved' and agent.user_id is not null and public.agent_joined(agent.user_id) then
        return 'joined';
    end if;
    if agent.email is null and exists (select 1 from public.agent_open_claims(agent.id)) then
        return 'awaiting_confirmation';
    end if;
    if agent.status <> 'Approved' then
        return null;
    end if;
    if agent.email is null then
        return 'no_email';
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
