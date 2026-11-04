-- The Manager switches an agent off and on, and retires them (slice 12, #187).
--
-- - change_marketing_agent_status(agent_id, kind, reason) is the Manager's
--   action: `agents.approve`, a reason, and one of switched_off, switched_on
--   or retired. It goes through record_agent_status_change, the one writer of
--   the cached columns and their history (#184).
-- - agent_status_fee_impact(agent_id, kind) lists, before the Manager
--   confirms, the families whose interview fee the change would move: leads
--   carrying the agent's code, open, whose current interview fee is not yet
--   Paid (or who have no interview yet), when the code's discount would
--   change. A Paid fee keeps its locked_amount, so it is never listed.
-- - Every status-change row now records fee_change_count, that number at the
--   moment of the change, counted under the agent's lock.
-- - find_marketing_agent also returns switched_off_at, so staff screens can
--   say a code is switched off and since when.
-- - marketing_agent_status_notes(agent_ids) gives the Agents screen the
--   latest change per agent with the staff member's name, and the record
--   that replaced a recreated one.
--
-- Refusal codes: `not_permitted`, `not_found`, `no_change`, `agent_retired`,
-- and `invalid` with the field as JSON in the detail.

-- ---------------------------------------------------------------------------
-- fee_change_count on the history. Rows written before this migration were
-- written by tests only (the system is not in use yet) and read as 0.
-- ---------------------------------------------------------------------------

alter table public.agent_status_changes
    add column fee_change_count integer not null default 0 check (fee_change_count >= 0);
alter table public.agent_status_changes alter column fee_change_count drop default;

-- ---------------------------------------------------------------------------
-- agent_fee_change_leads: the leads whose interview fee a status change would
-- move, for the agent as they stand now. The discount applies while the
-- agent is Approved, switched on and not retired (expected_interview_amount);
-- a change moves a fee only when it changes that. Recreate's new record
-- starts Approved and switched on. Internal: security definer callers check
-- the permission first.
-- ---------------------------------------------------------------------------

create function public.agent_fee_change_leads(agent public.marketing_agents, kind text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select l.id
    from public.agent_for_code(agent.code) a
    join public.leads l on l.referral_code = a.code
    where a.id = agent.id
      and (a.status = 'Approved' and a.switched_off_at is null)
          is distinct from case agent_fee_change_leads.kind
              when 'switched_on' then a.status = 'Approved'
              when 'recreated' then true
              else false
          end
      and l.status <> 'Declined'
      and l.closure is null
      -- The current interview, the newest registration, is not Paid; or the
      -- lead has none yet.
      and (
          select i.fee_status
          from public.interviews i
          where i.lead = l.id
          order by i.registered_at desc, i.serial_number desc
          limit 1
      ) is distinct from 'Paid'
    order by l.id;
$$;

revoke execute on function public.agent_fee_change_leads(public.marketing_agents, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_agent_status_change, re-created with its signature unchanged: it now
-- counts the leads whose fee the change moves, after taking the agent's lock
-- and before writing, and records the count on the history row.
-- ---------------------------------------------------------------------------

create or replace function public.record_agent_status_change(agent_id uuid, kind text, reason text, new_agent_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    actor record;
    changed timestamptz;
    moved uuid[];
    affected integer;
    change_id uuid;
begin
    if record_agent_status_change.kind is null
       or record_agent_status_change.kind not in ('switched_off', 'switched_on', 'retired', 'recreated') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;
    if btrim(coalesce(record_agent_status_change.reason, '')) = ''
       or char_length(btrim(record_agent_status_change.reason)) > 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    if (record_agent_status_change.kind = 'recreated') <> (record_agent_status_change.new_agent_id is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'new_agent_id')::text;
    end if;

    select * into agent
    from public.marketing_agents a
    where a.id = record_agent_status_change.agent_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- Read after the lock, not now(): the transaction's start can come before
    -- a change that committed while this one waited or ran, and the history
    -- would then replay the two out of order.
    changed := clock_timestamp();
    if agent.retired_at is not null then
        raise exception 'agent_retired';
    end if;
    if (record_agent_status_change.kind = 'switched_off' and agent.switched_off_at is not null)
       or (record_agent_status_change.kind = 'switched_on' and agent.switched_off_at is null) then
        raise exception 'no_change';
    end if;

    -- Counted before the cache changes, as the agent stands under the lock.
    select count(*) into affected
    from public.agent_fee_change_leads(agent, record_agent_status_change.kind);

    if record_agent_status_change.kind = 'recreated' then
        select coalesce(array_agg(l.id order by l.id), '{}') into moved
        from public.leads l
        where l.referral_code = agent.code;
    end if;

    perform set_config('app.agent_status_change', agent.id::text, true);
    update public.marketing_agents a
    set switched_off_at = case record_agent_status_change.kind
            when 'switched_off' then changed
            when 'switched_on' then null
            else a.switched_off_at
        end,
        retired_at = case when record_agent_status_change.kind in ('retired', 'recreated') then changed end
    where a.id = agent.id;
    perform set_config('app.agent_status_change', '', true);

    select * into actor from public.audit_actor();

    insert into public.agent_status_changes (
        agent_id, kind, reason, changed_at, changed_by,
        old_agent_id, new_agent_id, code, student_count, lead_ids, fee_change_count
    ) values (
        agent.id,
        record_agent_status_change.kind,
        btrim(record_agent_status_change.reason),
        changed,
        actor.staff_id,
        case when moved is not null then agent.id end,
        record_agent_status_change.new_agent_id,
        case when moved is not null then agent.code end,
        cardinality(moved),
        moved,
        affected
    )
    returning id into change_id;

    return change_id;
end;
$$;

revoke execute on function public.record_agent_status_change(uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_status_fee_impact: what the Manager reads before confirming. Needs
-- agents.approve, and leads.view since it names families. Recreate (#189)
-- shows it too, so it takes all four kinds.
-- ---------------------------------------------------------------------------

create function public.agent_status_fee_impact(agent_id uuid, kind text)
returns table (
    lead_id uuid,
    admission_number text,
    student_name text,
    class_name text,
    contact_name text,
    contact_phone text,
    fee_now integer,
    fee_after integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('agents.approve')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if agent_status_fee_impact.kind is null
       or agent_status_fee_impact.kind not in ('switched_off', 'switched_on', 'retired', 'recreated') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;

    select * into agent from public.marketing_agents a where a.id = agent_status_fee_impact.agent_id;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'agent_retired';
    end if;

    -- Every listed fee moves between the two amounts: the discount goes on
    -- for switching on and recreating, and comes off otherwise.
    return query
    select l.id, l.admission_number, l.student_name, l.class_name::text, c.full_name, c.phone,
        public.interview_fee(agent_status_fee_impact.kind not in ('switched_on', 'recreated')),
        public.interview_fee(agent_status_fee_impact.kind in ('switched_on', 'recreated'))
    from public.agent_fee_change_leads(agent, agent_status_fee_impact.kind) changed (id)
    join public.leads l on l.id = changed.id
    join public.guardian_contacts c on c.id = l.guardian_contact_id
    order by l.student_name, l.admission_number;
end;
$$;

revoke execute on function public.agent_status_fee_impact(uuid, text) from public, anon;
grant execute on function public.agent_status_fee_impact(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- change_marketing_agent_status: the Manager's Switch off, Switch on and
-- Retire. Needs agents.approve only, as approval does. Returns how many
-- families' fees the change moved, as recorded on the history row. The
-- session's staff member is the audit actor and changed_by.
-- ---------------------------------------------------------------------------

create function public.change_marketing_agent_status(agent_id uuid, kind text, reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    change_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if change_marketing_agent_status.kind is null
       or change_marketing_agent_status.kind not in ('switched_off', 'switched_on', 'retired') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;

    change_id := public.record_agent_status_change(
        change_marketing_agent_status.agent_id,
        change_marketing_agent_status.kind,
        change_marketing_agent_status.reason
    );

    return (select c.fee_change_count from public.agent_status_changes c where c.id = change_id);
end;
$$;

revoke execute on function public.change_marketing_agent_status(uuid, text, text) from public, anon;
grant execute on function public.change_marketing_agent_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- marketing_agent_status_notes: each given agent's latest status change, with
-- the staff member's name (staff with leads.view can't read other staff
-- records) and, for a recreated record, the record that replaced it. Agents
-- with no change are left out.
-- ---------------------------------------------------------------------------

create function public.marketing_agent_status_notes(agent_ids uuid[])
returns table (
    agent_id uuid,
    kind text,
    changed_at timestamptz,
    changed_by_name text,
    replaced_by_name text,
    replaced_by_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return query
    select distinct on (c.agent_id)
        c.agent_id, c.kind, c.changed_at, s.full_name, n.full_name, n.code
    from public.agent_status_changes c
    left join public.staff_members s on s.id = c.changed_by
    left join public.marketing_agents n on n.id = c.new_agent_id
    where c.agent_id = any (marketing_agent_status_notes.agent_ids)
    order by c.agent_id, c.changed_at desc, c.sequence desc;
end;
$$;

revoke execute on function public.marketing_agent_status_notes(uuid[]) from public, anon;
grant execute on function public.marketing_agent_status_notes(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- find_marketing_agent, now with switched_off_at. Its return type changes, so
-- it is dropped and created again, with the same rule and grants.
-- ---------------------------------------------------------------------------

drop function public.find_marketing_agent(text);

create function public.find_marketing_agent(typed_code text)
returns table (code text, full_name text, status public.marketing_agent_status, switched_off_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select a.code, a.full_name, a.status, a.switched_off_at
    from public.agent_for_code(find_marketing_agent.typed_code) a
    where public.has_permission('leads.view');
$$;

revoke execute on function public.find_marketing_agent(text) from public, anon;
grant execute on function public.find_marketing_agent(text) to authenticated;
