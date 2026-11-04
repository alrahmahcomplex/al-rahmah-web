-- One current agent per Discount code (slice 12, #184): groundwork for
-- switching off, retiring and recreating agents. No screen does any of that
-- yet, so nothing behaves differently until a later ticket calls
-- record_agent_status_change.
--
-- - marketing_agents gains cached `retired_at` and `switched_off_at`. Only
--   record_agent_status_change writes them, in the same transaction as the
--   matching agent_status_changes row.
-- - A code, and a phone, is unique only among records that aren't retired. A
--   retired record's code is reused only by Recreate, which retires the old
--   record and creates the new one holding the same code.
-- - agent_for_code(code) is the one rule from a code to an agent: the single
--   non-retired record holding it, or none. Every code lookup reads through
--   it, and agent_code_issued is the only other function that reads the code
--   column, to keep generated codes off retired records.
-- - The discount applies only for an Approved agent who is neither switched
--   off nor retired.
--
-- Refusal codes: `not_found`, `no_change`, `agent_retired`, `invalid` with
-- the offending field as JSON in the detail, `retired_code` (setting a lead's
-- code), and from the guards `agent_status_cached`, `agent_locked`,
-- `update_refused`, `delete_refused` and `recreated_code_mismatch`.

-- ---------------------------------------------------------------------------
-- The cached status columns and partial uniqueness.
-- ---------------------------------------------------------------------------

alter table public.marketing_agents
    add column retired_at timestamptz,
    add column switched_off_at timestamptz;

alter table public.marketing_agents drop constraint marketing_agents_code_key;
drop index public.marketing_agents_phone_key;

-- At most one non-retired record per code and per phone.
create unique index marketing_agents_code_key on public.marketing_agents (code) where retired_at is null;
create unique index marketing_agents_phone_key on public.marketing_agents (phone) where retired_at is null;
-- Every record that ever held a code, retired ones included, for
-- agent_code_issued.
create index marketing_agents_code_idx on public.marketing_agents (code);

-- ---------------------------------------------------------------------------
-- agent_for_code: the one non-retired agent holding a code, matched however
-- it is typed, or no row. Internal: security definer functions call it as
-- their owner, and no API role may.
-- ---------------------------------------------------------------------------

create function public.agent_for_code(code text)
returns setof public.marketing_agents
language sql
stable
security definer
rows 1
set search_path = ''
as $$
    select a.*
    from public.marketing_agents a
    where a.code = public.normalize_referral_code(agent_for_code.code)
      and a.retired_at is null;
$$;

revoke execute on function public.agent_for_code(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_code_issued: whether any agent record, current or retired, has held
-- a code. Code generation skips these, so a retired code comes back only
-- through Recreate; setting a lead's code tells a retired code from an
-- unknown one. Internal, like agent_for_code.
-- ---------------------------------------------------------------------------

create function public.agent_code_issued(code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.marketing_agents a
        where a.code = public.normalize_referral_code(agent_code_issued.code)
    );
$$;

revoke execute on function public.agent_code_issued(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_status_changes: the append-only history behind the cached columns.
-- One row per switch-off, switch-on, retirement or recreation, with who,
-- when and why. A recreated row also records the old and new records, the
-- code, and the leads carrying it at that moment, which follow the code to
-- the new record.
-- ---------------------------------------------------------------------------

create table public.agent_status_changes (
    id uuid primary key default gen_random_uuid(),
    -- Breaks a tie between two changes with the same changed_at.
    sequence bigint generated always as identity,
    agent_id uuid not null references public.marketing_agents (id),
    kind text not null check (kind in ('switched_off', 'switched_on', 'retired', 'recreated')),
    reason text not null check (btrim(reason) <> '' and char_length(reason) <= 500),
    -- When the change took the agent's lock, so a change that waited, or
    -- whose transaction began earlier, still sorts after the one it followed.
    changed_at timestamptz not null default clock_timestamp(),
    -- Null when the system made the change.
    changed_by uuid references public.staff_members (id),
    old_agent_id uuid references public.marketing_agents (id),
    -- Deferred: Recreate inserts the new record after this row.
    new_agent_id uuid references public.marketing_agents (id) deferrable initially deferred,
    code text,
    student_count integer,
    lead_ids uuid[],
    constraint agent_status_changes_recreated_fields check (
        case when kind = 'recreated'
            then old_agent_id is not null and old_agent_id = agent_id
                and new_agent_id is not null and new_agent_id <> agent_id
                and code is not null
                and lead_ids is not null
                and student_count is not null and student_count = cardinality(lead_ids)
            else old_agent_id is null and new_agent_id is null and code is null
                and student_count is null and lead_ids is null
        end
    )
);

create index agent_status_changes_agent_idx on public.agent_status_changes (agent_id, changed_at, sequence);
create index agent_status_changes_new_agent_idx on public.agent_status_changes (new_agent_id) where new_agent_id is not null;
create index agent_status_changes_changed_by_idx on public.agent_status_changes (changed_by) where changed_by is not null;

-- History is never changed after it is written, by anyone.
create function public.refuse_agent_status_change_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'update_refused' using detail = tg_table_name;
end;
$$;

revoke execute on function public.refuse_agent_status_change_update() from public, anon, authenticated;

create trigger refuse_update
    before update on public.agent_status_changes
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.agent_status_changes
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.agent_status_changes
    for each statement
    execute function public.refuse_delete();

-- A recreated row names a new, non-retired record holding the same code by
-- the time the transaction commits. Security definer, as deferred triggers
-- run as whoever commits.
create function public.check_recreated_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (select 1 from public.agent_for_code(new.code) c where c.id = new.new_agent_id) then
        raise exception 'recreated_code_mismatch' using detail = new.id::text;
    end if;
    return null;
end;
$$;

revoke execute on function public.check_recreated_agent() from public, anon, authenticated;

create constraint trigger check_recreated_agent
    after insert on public.agent_status_changes
    deferrable initially deferred
    for each row
    when (new.kind = 'recreated')
    execute function public.check_recreated_agent();

-- Audit (ADR 4): lead scope with no lead id, as for marketing_agents.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.agent_status_changes', 'lead', null);

create trigger audit_row_change
    after insert on public.agent_status_changes
    for each row
    execute function public.audit_row_change();

alter table public.agent_status_changes enable row level security;

create policy "Staff who may view leads read agent status changes"
    on public.agent_status_changes for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.agent_status_changes from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The agent guard, now on insert too. The code, the phone and the
-- registration time never change, and approval is set once. The cached
-- status columns start empty and change only inside
-- record_agent_status_change; retired_at is set once and never cleared, and
-- a retired record never changes again. The writer's mark counts only for a
-- privileged role, as the closed-lead override does: a session running as
-- `authenticated` or `anon` that sets it itself is ignored.
-- ---------------------------------------------------------------------------

create or replace function public.guard_marketing_agent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    writer text := case when current_user not in ('authenticated', 'anon')
        then coalesce(current_setting('app.agent_status_change', true), '') else '' end;
begin
    if tg_op = 'INSERT' then
        if new.retired_at is not null or new.switched_off_at is not null then
            raise exception 'agent_status_cached';
        end if;
        return new;
    end if;

    if (new.retired_at is distinct from old.retired_at or new.switched_off_at is distinct from old.switched_off_at)
       and (writer is distinct from old.id::text or old.retired_at is not null) then
        raise exception 'agent_status_cached';
    end if;
    if old.retired_at is not null then
        raise exception 'agent_locked';
    end if;
    if new.code is distinct from old.code
       or new.phone is distinct from old.phone
       or new.registered_at is distinct from old.registered_at then
        raise exception 'agent_locked';
    end if;
    if old.status = 'Approved'
       and (new.status is distinct from old.status
            or new.approved_at is distinct from old.approved_at
            or new.approved_by is distinct from old.approved_by) then
        raise exception 'agent_locked';
    end if;
    return new;
end;
$$;

drop trigger guard_marketing_agent_change on public.marketing_agents;

create trigger guard_marketing_agent_change
    before insert or update on public.marketing_agents
    for each row
    execute function public.guard_marketing_agent_change();

-- ---------------------------------------------------------------------------
-- record_agent_status_change: the one writer of the cached columns. Locks
-- the agent, writes the cache and the history row together and returns the
-- row's id. `recreated` retires the record and names the new one, which the
-- caller inserts with the same code before committing. The caller names the
-- audit actor; a staff actor is recorded as changed_by. Internal: no API
-- role may call it, so the Manager actions that come later wrap it.
-- ---------------------------------------------------------------------------

create function public.record_agent_status_change(agent_id uuid, kind text, reason text, new_agent_id uuid default null)
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
        old_agent_id, new_agent_id, code, student_count, lead_ids
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
        moved
    )
    returning id into change_id;

    return change_id;
end;
$$;

revoke execute on function public.record_agent_status_change(uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The code lookups, re-created through agent_for_code with their signatures
-- unchanged.
-- ---------------------------------------------------------------------------

-- What the lead's interview costs: the discount for an Approved agent's code
-- whose agent is neither switched off nor retired; the full fee otherwise.
create or replace function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent_status public.marketing_agent_status;
    switched_off timestamptz;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'forbidden';
    end if;

    select a.status, a.switched_off_at into agent_status, switched_off
    from public.leads l
    left join lateral public.agent_for_code(l.referral_code) a on true
    where l.id = expected_interview_amount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    discount_applied := agent_status is not distinct from 'Approved' and switched_off is null;
    amount := public.interview_fee(discount_applied);
end;
$$;

-- Sets a lead's code, or clears it with null. A code only a retired record
-- holds is `retired_code`; one no record holds is `unknown_code`.
create or replace function public.set_lead_referral_code(lead_id uuid, code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_code text;
    new_code text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two corrections made at once never both pass the
    -- no_change check against the same old value.
    select l.referral_code into current_code
    from public.leads l
    where l.id = set_lead_referral_code.lead_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(set_lead_referral_code.lead_id);

    if set_lead_referral_code.code is not null then
        new_code := public.normalize_referral_code(set_lead_referral_code.code);
        if new_code is null then
            raise exception 'unknown_code';
        end if;
        if not exists (select 1 from public.agent_for_code(new_code)) then
            if public.agent_code_issued(new_code) then
                raise exception 'retired_code';
            end if;
            raise exception 'unknown_code';
        end if;
    end if;

    if new_code is not distinct from current_code then
        raise exception 'no_change';
    end if;

    update public.leads l
    set referral_code = new_code
    where l.id = set_lead_referral_code.lead_id;

    return new_code;
end;
$$;

-- The current agent a typed code belongs to, or no row. Now security
-- definer, since agent_for_code is internal; it keeps the old rule that only
-- staff who may view leads find anyone.
create or replace function public.find_marketing_agent(typed_code text)
returns table (code text, full_name text, status public.marketing_agent_status)
language sql
stable
security definer
set search_path = ''
as $$
    select a.code, a.full_name, a.status
    from public.agent_for_code(find_marketing_agent.typed_code) a
    where public.has_permission('leads.view');
$$;

-- How many leads carry an agent's code: none for a retired record, since its
-- leads follow the code to the current one. Now security definer, counting
-- only for staff who may view leads, as the leads' row-level security did.
create or replace function public.lead_count(agent public.marketing_agents)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)
    from public.agent_for_code(agent.code) a
    join public.leads l on l.referral_code = a.code
    where a.id = agent.id
      and public.has_permission('leads.view');
$$;

-- The Admission form's estimate. `switched_off` is new: an agent who is
-- switched off gives no discount, whatever their status.
create or replace function public.discount_code_estimate(code text, out state text, out amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent_status public.marketing_agent_status;
    switched_off timestamptz;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;

    select a.status, a.switched_off_at into agent_status, switched_off
    from public.agent_for_code(discount_code_estimate.code) a;

    state := case
        when agent_status is null then 'unknown'
        when switched_off is not null then 'switched_off'
        when agent_status = 'Approved' then 'approved'
        else 'pending'
    end;
    amount := public.interview_fee(state = 'approved');
end;
$$;

-- Registration: a phone held by a current agent returns that agent's code; a
-- retired record's phone is free and gets a new agent with a new code.
-- Generated codes skip every code an agent record has held, retired ones
-- included.
create or replace function public.register_marketing_agent(full_name text, phone text, whatsapp text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent_name text;
    agent_phone text;
    agent_whatsapp text;
    existing_code text;
    prefix text;
    candidate text;
    attempt integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    agent_name := regexp_replace(btrim(coalesce(register_marketing_agent.full_name, '')), '\s+', ' ', 'g');
    if char_length(agent_name) not between 2 and 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'full_name')::text;
    end if;

    agent_phone := public.normalize_phone(coalesce(register_marketing_agent.phone, ''));
    if agent_phone is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    agent_whatsapp := nullif(btrim(coalesce(register_marketing_agent.whatsapp, '')), '');
    if agent_whatsapp is not null then
        agent_whatsapp := public.normalize_phone(agent_whatsapp);
        if agent_whatsapp is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if agent_whatsapp = agent_phone then
            agent_whatsapp := null;
        end if;
    end if;

    -- Two registrations with the same phone wait for each other here, and the
    -- second finds the first one's agent.
    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || agent_phone, 0));

    select a.code into existing_code
    from public.marketing_agents a
    where a.phone = agent_phone and a.retired_at is null;
    if found then
        return existing_code;
    end if;

    -- Three digits for ten tries, then four. The unique index catches a
    -- collision, including one with a registration running alongside.
    prefix := public.marketing_agent_code_prefix(agent_name);
    for attempt in 1..60 loop
        if attempt <= 10 then
            candidate := prefix || '-' || lpad(floor(random() * 1000)::integer::text, 3, '0');
        else
            candidate := prefix || '-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
        end if;
        -- Skips the subtransaction below for a code already issued.
        continue when public.agent_code_issued(candidate);
        begin
            insert into public.marketing_agents (full_name, phone, whatsapp, code)
            values (agent_name, agent_phone, agent_whatsapp, candidate);
            return candidate;
        exception when unique_violation then
            -- Taken by a registration that committed after the check.
            null;
        end;
    end loop;

    raise exception 'unavailable';
end;
$$;

-- Approval: a retired record is never approved, and is refused as
-- `no_change`, as an Approved one is.
create or replace function public.approve_marketing_agent(agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    approver uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two approvals at once record one approver: the second is
    -- refused as no_change.
    select * into agent from public.marketing_agents a where a.id = approve_marketing_agent.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.status = 'Approved' or agent.retired_at is not null then
        raise exception 'no_change';
    end if;

    select s.id into approver from public.staff_members s where s.user_id = auth.uid();

    update public.marketing_agents a
    set status = 'Approved', approved_at = now(), approved_by = approver
    where a.id = agent.id;
end;
$$;
