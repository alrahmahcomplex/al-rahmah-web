-- The approval SMS (owner request 2026-11-28, prototype 5RcTximr3tbuDVYmXhncEi):
-- a brand-new agent who signed up with their mobile already has a phone
-- login while Pending. When the Manager approves them, one SMS goes to that
-- mobile saying they can now sign in. An agent who signed up by email gets
-- today's invite email instead, so nothing here changes for them.
--
-- The SMS is a new kind in the SMS log. Like the courtesy SMS it is sent by
-- the school, once per agent, so it is left out of the per-mobile limits
-- (those stop strangers pumping a mobile); it still takes a place in the
-- day's budget.
--
-- Rollback: drop claim_approval_sms, put reserve_sms back as in
-- 20270125120100 and the kind check back without 'approved' (after deleting
-- any 'approved' rows).

alter table public.sms_sends drop constraint sms_sends_kind_check;
alter table public.sms_sends add constraint sms_sends_kind_check check (kind in ('self_confirm', 'reset', 'courtesy', 'approved'));

-- reserve_sms, re-created: accepts 'approved', which, like 'courtesy', skips
-- the per-mobile limits and isn't counted in them. Otherwise as in
-- 20270125120100.
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
    if reserve_sms.kind is null or reserve_sms.kind not in ('self_confirm', 'reset', 'courtesy', 'approved')
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

    if reserve_sms.kind not in ('courtesy', 'approved') and (
        (select count(*) from public.sms_sends s
         where s.to_phone = mobile and s.kind not in ('courtesy', 'approved') and s.result in ('reserved', 'sent', 'provider_error')
           and s.created_at > at_time - interval '1 hour') >= settings.per_mobile_hour
        or (select count(*) from public.sms_sends s
            where s.to_phone = mobile and s.kind not in ('courtesy', 'approved') and s.result in ('reserved', 'sent', 'provider_error')
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

-- For an agent the Manager has just approved: the mobile their login signs
-- in with, when the approval SMS should go to it. Outcomes:
--   send        phone (+255…) and agent: text it
--   access_off  a mobile login, but agent access is off, so they can't sign in
--   none        anything else: not Approved, switched off or retired, no
--               login, an email login (the invite covers it), no password
--               yet, or an approval SMS already reserved or sent
-- Secret key only.
create function public.claim_approval_sms(agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    login_phone text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Only the Manager's approval asks, and an agent is approved once
    -- (approve_marketing_agent refuses a second as no_change), so two claims
    -- for one agent don't meet; the check for an earlier SMS below stops any
    -- later one.
    select m.* into agent from public.marketing_agents m where m.id = claim_approval_sms.agent_id;
    if not found or agent.status <> 'Approved' or agent.retired_at is not null or agent.switched_off_at is not null
       or agent.user_id is null or not public.agent_joined(agent.user_id) then
        return jsonb_build_object('outcome', 'none');
    end if;
    -- A phone login only: an email login was invited by email.
    select public.normalize_phone(u.phone) into login_phone
    from auth.users u
    where u.id = agent.user_id
      and u.phone_confirmed_at is not null
      and coalesce(u.phone, '') <> ''
      and coalesce(u.email, '') = '';
    if login_phone is null or login_phone !~ '^\+255[67][0-9]{8}$' then
        return jsonb_build_object('outcome', 'none');
    end if;
    if exists (
        select 1 from public.sms_sends s
        where s.agent_id = agent.id and s.kind = 'approved' and s.result in ('reserved', 'sent', 'provider_error')
    ) then
        return jsonb_build_object('outcome', 'none');
    end if;
    if not coalesce((select s.enabled from public.agent_access_settings s where s.singleton), false) then
        return jsonb_build_object('outcome', 'access_off');
    end if;
    return jsonb_build_object('outcome', 'send', 'phone', login_phone, 'agent', agent.id);
end;
$$;

revoke execute on function public.claim_approval_sms(uuid) from public, anon, authenticated;
grant execute on function public.claim_approval_sms(uuid) to service_role;
