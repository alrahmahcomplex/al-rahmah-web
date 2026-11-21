-- Agent self-confirm, slice 1 of 4: the foundation (#503, owner approved
-- prototype v58 on 2026-11-21). Nothing calls these yet; slice 3 builds the
-- flow on them and slice 4 turns it on.
--
-- - agent_access_settings.self_confirm_enabled: the self-confirm switch, off.
--   agent_self_confirm_on() is its one reader; it is on only while agent
--   access is on too. set_agent_self_confirm changes it, for the database
--   owner only, like set_agent_access.
-- - agent_names_match(on_record, typed): the owner's name rule (21 Nov). Every
--   name on the record pairs with a different typed name, in any order, within
--   a typo limit set by the length of the name on record: 3 letters or fewer
--   exact, 4-5 one typo, 6-10 two, 11 or more three. A typo is a letter wrong,
--   missing or extra, or two neighbours swapped (word_edit_distance). Initials
--   fail; a typed name beyond the record's is ignored.
-- - sms_settings and sms_sends: every SMS the app sends (Beem), its day's
--   budget and each mobile's limits. reserve_sms takes a place in the budget
--   before a send; record_sms says how it went. Secret key only.

-- ---------------------------------------------------------------------------
-- The self-confirm switch.
-- ---------------------------------------------------------------------------

alter table public.agent_access_settings add column self_confirm_enabled boolean not null default false;

-- On only while agent access is on too: switching agent access off stops
-- self-confirm with everything else.
create function public.agent_self_confirm_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select a.enabled from public.agent_access() a), false)
        and coalesce((select s.self_confirm_enabled from public.agent_access_settings s), false);
$$;

revoke execute on function public.agent_self_confirm_on() from public, anon, authenticated, service_role;

-- Turns self-confirm on or off. For the database owner only: run it in the
-- SQL editor or a migration after set_audit_actor('system') or
-- set_audit_actor('staff', <id>), in the same transaction. The row's audit
-- trigger records the change.
create function public.set_agent_self_confirm(enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor record;
begin
    if set_agent_self_confirm.enabled is null then
        raise exception 'invalid';
    end if;
    select * into actor from public.audit_actor();
    if actor.kind is null or actor.kind not in ('staff', 'system') then
        raise exception 'not_permitted';
    end if;

    update public.agent_access_settings
    set self_confirm_enabled = set_agent_self_confirm.enabled;
end;
$$;

revoke execute on function public.set_agent_self_confirm(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The owner's name rule.
-- ---------------------------------------------------------------------------

-- How many typos a name on record allows, by its length in letters.
create function public.agent_name_typo_limit(letters integer)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
    select case
        when agent_name_typo_limit.letters <= 3 then 0
        when agent_name_typo_limit.letters <= 5 then 1
        when agent_name_typo_limit.letters <= 10 then 2
        else 3
    end;
$$;

revoke execute on function public.agent_name_typo_limit(integer) from public, anon, authenticated, service_role;

-- Whether the record's names from the i-th on can each pair with a typed name
-- not yet used (bit j - 1 of `used` set) within its limit. Tries every
-- pairing, so order never matters; at most 6 by 8 names.
create function public.agent_names_pair(on_record text[], typed text[], i integer, used integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    j integer;
begin
    if i > cardinality(on_record) then
        return true;
    end if;
    for j in 1 .. cardinality(typed) loop
        if used & (1 << (j - 1)) = 0
           and public.word_edit_distance(on_record[i], typed[j])
               <= public.agent_name_typo_limit(char_length(on_record[i]))
           and public.agent_names_pair(on_record, typed, i + 1, used | (1 << (j - 1))) then
            return true;
        end if;
    end loop;
    return false;
end;
$$;

revoke execute on function public.agent_names_pair(text[], text[], integer, integer) from public, anon, authenticated, service_role;

-- Whether a typed full name matches the full name on record. Both are
-- normalised as the father's name is (lowercase, no dots, commas, apostrophes
-- or hyphens, single spaces). A record has at most 6 names, a typed name at
-- most 8, and no name is longer than 40 letters.
create function public.agent_names_match(on_record text, typed text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    record_names text[] := regexp_split_to_array(public.normalize_father_name(agent_names_match.on_record), ' ');
    typed_names text[] := regexp_split_to_array(public.normalize_father_name(agent_names_match.typed), ' ');
begin
    if record_names is null or typed_names is null
       or cardinality(record_names) > 6 or cardinality(typed_names) > 8
       or cardinality(typed_names) < cardinality(record_names)
       or exists (select 1 from unnest(record_names || typed_names) w where char_length(w) > 40) then
        return false;
    end if;
    return public.agent_names_pair(record_names, typed_names, 1, 0);
end;
$$;

revoke execute on function public.agent_names_match(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SMS: the budget, each mobile's limits and the log.
-- ---------------------------------------------------------------------------

create table public.sms_settings (
    id uuid primary key default gen_random_uuid(),
    -- Only ever one row.
    singleton boolean not null default true unique check (singleton),
    -- SMS a day, all kinds together, counted by the day in Tanzania.
    daily_budget integer not null default 500 check (daily_budget > 0),
    -- Confirmation numbers to one mobile: self-confirm and resets together.
    per_mobile_hour integer not null default 3 check (per_mobile_hour > 0),
    per_mobile_day integer not null default 5 check (per_mobile_day >= per_mobile_hour)
);

alter table public.sms_settings enable row level security;
-- Nobody reads or writes it through the API; reserve_sms reads it as the owner.
revoke all on public.sms_settings from anon, authenticated, service_role;

insert into public.audit_scopes (table_name, scope) values ('public.sms_settings', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.sms_settings
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.sms_settings
    for each row
    execute function public.refuse_delete();

do $$
begin
    perform public.set_audit_actor('system');
    insert into public.sms_settings default values;
    perform set_config('audit.actor_kind', '', true);
end;
$$;

-- One row per SMS the app tried to send, kept as the record of what went out.
-- `reserved` holds a place in the day's budget until record_sms says how the
-- send went; a send refused before it reached Beem says why instead.
create table public.sms_sends (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('self_confirm', 'reset', 'courtesy')),
    -- A Tanzanian mobile, stored as normalize_phone stores it.
    to_phone text not null check (to_phone ~ '^\+255[67][0-9]{8}$'),
    agent_id uuid references public.marketing_agents (id) on delete set null,
    -- The day in Tanzania it counts against.
    tz_day date not null,
    result text not null check (result in ('reserved', 'sent', 'provider_error', 'budget_reached', 'mobile_limited')),
    provider_request_id text check (char_length(provider_request_id) <= 100),
    error_code text check (char_length(error_code) <= 100),
    created_at timestamptz not null default now(),
    finished_at timestamptz,
    check ((result in ('sent', 'provider_error')) = (finished_at is not null)),
    check (provider_request_id is null or result = 'sent'),
    check (error_code is null or result = 'provider_error')
);

create index sms_sends_day_idx on public.sms_sends (tz_day, result);
create index sms_sends_mobile_idx on public.sms_sends (to_phone, created_at);
create index sms_sends_agent_idx on public.sms_sends (agent_id) where agent_id is not null;

alter table public.sms_sends enable row level security;
-- No policies: only reserve_sms and record_sms write it, as the owner.
revoke all on public.sms_sends from anon, authenticated, service_role;

-- Takes a place in today's budget for one SMS, or says why not. The caller
-- sends only on `reserved`, then calls record_sms with the send's id.
-- Confirmation numbers (self_confirm, reset) to one mobile are limited per
-- hour and per day; a courtesy SMS counts against the budget only, so a
-- stranger's tries never keep it from the real agent. Sends that reached
-- Beem or are on their way count; refused ones don't.
create function public.reserve_sms(kind text, to_phone text, agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    settings public.sms_settings;
    day date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
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

    -- One reservation at a time for the day, so two at once can't both take
    -- the last place.
    perform pg_advisory_xact_lock(hashtextextended('sms-day:' || day::text, 0));
    select * into settings from public.sms_settings;

    select count(*) into spent
    from public.sms_sends s
    where s.tz_day = day and s.result in ('reserved', 'sent', 'provider_error');
    if spent >= settings.daily_budget then
        insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result)
        values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'budget_reached');
        return jsonb_build_object('outcome', 'budget_reached');
    end if;

    if reserve_sms.kind <> 'courtesy' and (
        (select count(*) from public.sms_sends s
         where s.to_phone = mobile and s.kind <> 'courtesy' and s.result in ('reserved', 'sent', 'provider_error')
           and s.created_at > now() - interval '1 hour') >= settings.per_mobile_hour
        or (select count(*) from public.sms_sends s
            where s.to_phone = mobile and s.kind <> 'courtesy' and s.result in ('reserved', 'sent', 'provider_error')
              and s.tz_day = day) >= settings.per_mobile_day
    ) then
        insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result)
        values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'mobile_limited');
        return jsonb_build_object('outcome', 'mobile_limited');
    end if;

    insert into public.sms_sends (kind, to_phone, agent_id, tz_day, result)
    values (reserve_sms.kind, mobile, reserve_sms.agent_id, day, 'reserved')
    returning id into made;
    return jsonb_build_object('outcome', 'reserved', 'send_id', made);
end;
$$;

revoke execute on function public.reserve_sms(text, text, uuid) from public, anon, authenticated;
grant execute on function public.reserve_sms(text, text, uuid) to service_role;

-- How a reserved send went: `sent` with Beem's request id, or
-- `provider_error` with a short error code. Once only.
create function public.record_sms(send_id uuid, result text, provider_request_id text default null, error_code text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if record_sms.result is null or record_sms.result not in ('sent', 'provider_error') then
        raise exception 'invalid';
    end if;

    update public.sms_sends s
    set result = record_sms.result,
        provider_request_id = case when record_sms.result = 'sent' then left(record_sms.provider_request_id, 100) end,
        error_code = case when record_sms.result = 'provider_error' then left(coalesce(record_sms.error_code, 'unknown'), 100) end,
        finished_at = now()
    where s.id = record_sms.send_id and s.result = 'reserved';
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

revoke execute on function public.record_sms(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_sms(uuid, text, text, text) to service_role;
