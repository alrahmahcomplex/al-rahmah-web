-- The Manager switches an agent off and on, and retires them (slice 12, #187).
--
-- - change_marketing_agent_status(agent_id, kind, reason) is the Manager's
--   action: `agents.approve`, a reason, and one of switched_off, switched_on
--   or retired. It goes through record_agent_status_change, the one writer of
--   the cached columns and their history (#184).
-- - agent_status_fee_impact(agent_id, kind) lists, as one JSON array, before
--   the Manager confirms, the families whose interview fee the change would move: leads
--   carrying the agent's code whose current interview fee is not yet Paid
--   (or who have no interview yet), when the code's discount would change.
--   Closed leads (Declined, Inactive, Archived) count too: their unpaid fee
--   moves like any other. A Paid fee keeps its locked_amount, so it is never
--   listed.
-- - A recreated row's new record must be Approved and switched on by commit
--   (check_recreated_agent), as Recreate's contract says, so the count it
--   records and the fee-impact list are right.
-- - Every status-change row now records fee_change_count, that number at the
--   moment of the change, counted under the agent's lock.
-- - set_interview_fee_status holds the code's agent record in share mode
--   before it reads the discount, so a payment and a status change wait for
--   each other and the recorded count stays true. After a Recreate it waited
--   for, it holds the replacement too.
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
-- starts Approved and switched on, which check_recreated_agent enforces.
-- Internal: security definer callers check the permission first.
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
-- check_recreated_agent, re-created with its signature and trigger unchanged:
-- the new record must also be Approved and switched on by commit, so the
-- discount never lapses and the recorded fee count holds.
-- ---------------------------------------------------------------------------

create or replace function public.check_recreated_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    replacement record;
begin
    select c.status, c.switched_off_at into replacement
    from public.agent_for_code(new.code) c
    where c.id = new.new_agent_id;
    if not found then
        raise exception 'recreated_code_mismatch' using detail = new.id::text;
    end if;
    if replacement.status <> 'Approved' or replacement.switched_off_at is not null then
        raise exception 'recreated_agent_not_approved' using detail = new.id::text;
    end if;
    return null;
end;
$$;

revoke execute on function public.check_recreated_agent() from public, anon, authenticated;

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
-- set_interview_fee_status, re-created with its signature and grants
-- unchanged: before it reads whether the code gives the discount, it now
-- holds the code's agent record in share mode. A status change holds its
-- agent for update while it counts, so the two wait for each other: a fee
-- marked Paid while a switch-off is under way is locked at the amount the
-- switch-off leaves, and a switch-off that waits for a payment counts that
-- fee as Paid. Either way the recorded count is the fees that moved.
--
-- Lock order, on every path that takes these rows: the lead, then the
-- interview, then the agent record (after a Recreate, the old record and
-- then its replacement). record_agent_status_change takes only
-- the agent and reads the leads and interviews without locking them, so it
-- can't hold one while waiting for the other.
-- ---------------------------------------------------------------------------

create or replace function public.set_interview_fee_status(interview_id uuid, fee_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    lead_code text;
    held uuid;
    holder uuid;
    expected record;
    new_amount integer;
    discounted boolean := false;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interview_payments.record') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = set_interview_fee_status.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead is held before the interview, in the order the other interview
    -- writes take them, so it can't be closed between the check and the
    -- change. Holding it also keeps its code from changing.
    select l.referral_code into lead_code from public.leads l where l.id = target.lead for share;
    perform public.assert_lead_open(target.lead);
    -- Locked, so two clicks at once change the fee once: the second finds the
    -- status already set.
    select * into target from public.interviews i where i.id = target.id for update;

    if set_interview_fee_status.fee_status is null
       or set_interview_fee_status.fee_status not in ('Paid', 'Not Paid') then
        raise exception 'invalid_status';
    end if;
    if target.fee_status::text = set_interview_fee_status.fee_status then
        raise exception 'no_change';
    end if;

    -- The code's current record: a status change refuses a retired one, so
    -- any change in progress, Recreate's included, holds this one. Both
    -- ways: a fee going back to Not Paid starts moving with the code's
    -- discount again, so a count in progress must see it. Read in its own
    -- statement after the wait, the discount is the one that change leaves.
    --
    -- A Recreate this waited for has retired the record it held and put a
    -- new one in its place, which the locking statement couldn't see. So
    -- look the holder up again after each lock, and hold the new one too,
    -- until the record held is the code's current one. Otherwise a switch-off
    -- of the new record wouldn't wait, and would count this fee as unpaid.
    loop
        select c.id into holder from public.agent_for_code(lead_code) c;
        exit when holder is not distinct from held;
        perform 1 from public.marketing_agents a where a.id = holder for share;
        held := holder;
    end loop;

    if set_interview_fee_status.fee_status = 'Paid' then
        select e.amount, e.discount_applied into expected from public.expected_interview_amount(target.lead) e;
        new_amount := expected.amount;
        discounted := expected.discount_applied;
    end if;

    update public.interviews i
    set fee_status = set_interview_fee_status.fee_status::public.interview_fee_status,
        locked_amount = new_amount,
        locked_discount_applied = case when new_amount is null then null else discounted end
    where i.id = target.id;

    return jsonb_build_object(
        'interview_id', target.id,
        'fee_status', set_interview_fee_status.fee_status,
        'locked_amount', new_amount,
        'discount_applied', discounted
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_status_fee_impact: what the Manager reads before confirming. Needs
-- agents.approve, and leads.view since it names families. Recreate (#189)
-- shows it too, so it takes all four kinds. The whole list is one JSON array
-- in one row, read in one snapshot: the API's row cap doesn't cut it short,
-- and no page can skip or repeat a family that changed between pages.
-- ---------------------------------------------------------------------------

create function public.agent_status_fee_impact(agent_id uuid, kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    families jsonb;
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
    select coalesce(jsonb_agg(jsonb_build_object(
            'lead_id', l.id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'class_name', l.class_name::text,
            'contact_name', c.full_name,
            'contact_phone', c.phone,
            'fee_now', public.interview_fee(agent_status_fee_impact.kind not in ('switched_on', 'recreated')),
            'fee_after', public.interview_fee(agent_status_fee_impact.kind in ('switched_on', 'recreated'))
        ) order by l.student_name, l.admission_number, l.id), '[]'::jsonb)
    into families
    from public.agent_fee_change_leads(agent, agent_status_fee_impact.kind) changed (id)
    join public.leads l on l.id = changed.id
    join public.guardian_contacts c on c.id = l.guardian_contact_id;

    return families;
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
