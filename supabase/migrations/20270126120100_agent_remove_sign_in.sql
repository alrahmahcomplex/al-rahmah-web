-- Remove this sign-in (#503 slice 4a, prototype v58 R1 to R3).
--
-- The office's way to put out someone who joined on an agent's code: staff
-- with agents.approve remove a joined agent's sign-in. In one step, on the
-- agent's row lock: the Auth user is deleted (its sessions and refresh tokens
-- go with it), the agent is no longer linked or joined, open self-confirm
-- attempts are void, and one history row is written, which the Audit page
-- shows. The code, names and students stay.
--
-- An access token issued before the removal stays valid until it expires,
-- but every agent page and agent read finds the agent through
-- current_principal(), on marketing_agents.user_id = auth.uid(), which no
-- longer matches: such a token reads nothing at once.
--
-- The sheet's tick (on by default) closes email self-confirm on the code
-- until the real agent joins: the person removed still knows the code and the
-- names. Mobile self-confirm to the number on record stays open (the SMS
-- proves the person), and the Manager's invite still works.
--
-- Rollback: drop the table and functions below, then re-run the two
-- self-confirm functions from 20270125120100_agent_self_confirm_flow.sql.

-- ---------------------------------------------------------------------------
-- Removals: append-only, one row per removed sign-in
-- ---------------------------------------------------------------------------

create table public.agent_sign_in_removals (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references public.marketing_agents (id),
    -- What the removed login signed in with, as Auth held it: the email, or
    -- the mobile as +255…
    signed_in_with text not null check (char_length(signed_in_with) between 1 and 254),
    joined_at timestamptz,
    -- The sheet's tick: email self-confirm closed until the agent joins.
    close_email boolean not null,
    removed_by uuid not null references public.staff_members (id),
    removed_at timestamptz not null default clock_timestamp()
);

create index agent_sign_in_removals_agent_idx on public.agent_sign_in_removals (agent_id, removed_at);
create index agent_sign_in_removals_removed_by_idx on public.agent_sign_in_removals (removed_by);

create trigger refuse_update
    before update on public.agent_sign_in_removals
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.agent_sign_in_removals
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.agent_sign_in_removals
    for each statement
    execute function public.refuse_delete();

-- Audit (ADR 4): lead scope with no lead id, as for the other agent tables.
-- The insert is the removal's Audit line.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.agent_sign_in_removals', 'lead', null);

create trigger audit_row_change
    after insert on public.agent_sign_in_removals
    for each row
    execute function public.audit_row_change();

alter table public.agent_sign_in_removals enable row level security;
revoke all on public.agent_sign_in_removals from anon, authenticated, service_role;

-- Whether email self-confirm is closed on the agent's code: the latest
-- removal had the tick, and the agent hasn't joined since.
create function public.agent_email_self_confirm_closed(agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((
        select r.close_email from public.agent_sign_in_removals r
        where r.agent_id = agent_email_self_confirm_closed.agent_id
        order by r.removed_at desc, r.id desc limit 1
    ), false)
    and not exists (
        select 1 from public.marketing_agents m
        where m.id = agent_email_self_confirm_closed.agent_id and m.user_id is not null and public.agent_joined(m.user_id)
    )
$$;

revoke execute on function public.agent_email_self_confirm_closed(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the sheet shows: the joined agent's sign-in and when they joined
-- ---------------------------------------------------------------------------

create function public.agent_sign_in(agent_id uuid)
returns table (login uuid, signed_in_with text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    return query
    select u.id, coalesce(nullif(u.email, ''), '+' || u.phone)::text,
           coalesce(u.phone_confirmed_at, u.email_confirmed_at, u.created_at)
    from public.marketing_agents m
    join auth.users u on u.id = m.user_id
    where m.id = agent_sign_in.agent_id and m.retired_at is null and public.agent_joined(m.user_id);
end;
$$;

revoke execute on function public.agent_sign_in(uuid) from public, anon;
grant execute on function public.agent_sign_in(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The removal
-- ---------------------------------------------------------------------------

-- Refuses not_permitted, invalid, not_found, retired, not_joined (no joined
-- sign-in to remove: already removed, or never joined) and changed: the
-- agent's login is no longer `login`, the one the sheet showed (someone
-- removed it and the real agent joined since). Returns what the removed
-- login signed in with.
create function public.remove_agent_sign_in(agent_id uuid, close_email boolean, login uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    removed auth.users;
    actor record;
    shown text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if remove_agent_sign_in.close_email is null or remove_agent_sign_in.login is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', case when remove_agent_sign_in.close_email is null then 'close_email' else 'login' end)::text;
    end if;
    select * into actor from public.audit_actor();
    if actor.staff_id is null then
        raise exception 'not_permitted';
    end if;

    -- The agent's row first, as every finish locks it, then the login.
    select * into agent from public.marketing_agents m where m.id = remove_agent_sign_in.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    if agent.user_id is null then
        raise exception 'not_joined';
    end if;
    if agent.user_id <> remove_agent_sign_in.login then
        raise exception 'changed';
    end if;
    select * into removed from auth.users u where u.id = agent.user_id for update;
    if not found or not public.agent_joined(agent.user_id) then
        raise exception 'not_joined';
    end if;
    shown := coalesce(nullif(removed.email, ''), '+' || removed.phone);

    insert into public.agent_sign_in_removals (agent_id, signed_in_with, joined_at, close_email, removed_by)
    values (agent.id, shown, coalesce(removed.phone_confirmed_at, removed.email_confirmed_at, removed.created_at),
            remove_agent_sign_in.close_email, actor.staff_id);
    -- The record forgets an email the removed login signed in with, so the
    -- public "Tuma kiungo kipya" can't invite that address back; the row
    -- reads "No email", and the Manager enters the real agent's email.
    update public.marketing_agents m
    set user_id = null,
        email = case when removed.email is not null and m.email = lower(removed.email) then null else m.email end
    where m.id = agent.id;
    -- Its sessions and refresh tokens go with it.
    delete from auth.users u where u.id = removed.id;
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');

    return jsonb_build_object('signed_in_with', shown);
end;
$$;

revoke execute on function public.remove_agent_sign_in(uuid, boolean, uuid) from public, anon;
grant execute on function public.remove_agent_sign_in(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The Agents screen's line under a removed agent (R3)
-- ---------------------------------------------------------------------------

-- For each listed agent who isn't joined now: the latest removal, and who
-- made it. Staff who may view leads, as the Agents screen itself.
create function public.agent_sign_in_removals(agent_ids uuid[])
returns table (agent_id uuid, removed_at timestamptz, removed_by text, close_email boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    return query
    select distinct on (r.agent_id) r.agent_id, r.removed_at, s.full_name::text, r.close_email
    from public.agent_sign_in_removals r
    join public.marketing_agents m on m.id = r.agent_id
    left join public.staff_members s on s.id = r.removed_by
    where r.agent_id = any(agent_sign_in_removals.agent_ids)
      and (m.user_id is null or not public.agent_joined(m.user_id))
    order by r.agent_id, r.removed_at desc, r.id desc;
end;
$$;

revoke execute on function public.agent_sign_in_removals(uuid[]) from public, anon;
grant execute on function public.agent_sign_in_removals(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-confirm, as 20270125120100_agent_self_confirm_flow.sql made it, with
-- email closed after a removal with the tick
-- ---------------------------------------------------------------------------

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

    -- After Remove this sign-in with its tick, only the mobile on record
    -- proves the person until the real agent joins: no email, and no typed
    -- mobile (the person removed may have joined with one). With no mobile on
    -- record, today's claim path takes it, where the Manager decides.
    closed := public.agent_email_self_confirm_closed(agent.id);
    if closed and not coalesce(agent.phone ~ '^\+255[67][0-9]{8}$', false) then
        return jsonb_build_object('outcome', 'email_closed');
    end if;

    -- A new attempt voids the agent's open ones.
    update public.agent_confirm_attempts a set state = 'void'
    where a.agent_id = agent.id and a.state in ('matched', 'sent', 'proven');

    insert into public.agent_confirm_attempts (agent_id, browser_digest, ip_digest, typed_phone, shown_mobile)
    values (agent.id, start_agent_self_confirm.browser, start_agent_self_confirm.ip,
            case when agent.phone is null and not closed then phone end, phone)
    returning id into attempt_id;

    return jsonb_build_object(
        'outcome', 'ready',
        'attempt', attempt_id,
        'mobile_on_record', agent.phone is not null,
        -- Only when the typed mobile is the one on file may the page show it.
        'typed_matches', agent.phone is not null and phone is not distinct from agent.phone,
        'can_text', case when closed then agent.phone else coalesce(agent.phone, phone) end ~ '^\+255[67][0-9]{8}$',
        'email_on_record', agent.email is not null,
        'email_open', not closed
    );
end;
$$;

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
    if public.agent_email_self_confirm_closed(agent.id) then return jsonb_build_object('outcome', 'email_closed'); end if;
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
