-- Discount amounts and Promo codes: the data and the one fee rule (owner
-- decisions of 2026-11-09). The writers come in
-- 20261203130300_discount_code_writes.sql.
--
-- - The standard interview discount is a setting, TZS 10,000 to start, in
--   whole TZS off the standard interview fee of TZS 50,000.
-- - An agent may have an own amount (marketing_agents.interview_discount);
--   null means the standard. agent_discount_amount(agent) reads the two.
-- - A Promo code is a school code with a name and an amount, Active, Paused
--   or Ended, with an optional last day. It never carries commission and has
--   no agent (owner decision 1).
-- - Agent codes and Promo codes share one namespace: a code is one or the
--   other, never both, enforced by a trigger on each table under one
--   advisory lock per code.
-- - code_discount(code) is the one rule from a code to what it takes off
--   right now. lead_interview_discount(lead_id), expected_interview_amount,
--   discount_code_estimate, find_discount_code and every fee impact read
--   through it, or through agent_discount_amount for an agent's own row.
--   The contract named the lead reader lead_discount, but that name is the
--   School fee discount's (20261103900900_discount_requests.sql), so it is
--   lead_interview_discount here.
-- - A Paid interview fee keeps its locked_amount: nothing here touches
--   interviews. set_interview_fee_status now also holds the lead's Promo
--   code row and the setting in share mode before it reads the amount, so a
--   payment and an amount change wait for each other and the recorded fee
--   counts stay true.
-- - interview_fee(discounted) and interview_discount() stay for their old
--   callers and now follow the standard amount.
--
-- The setting has a uuid id and a singleton flag, as agent_access_settings
-- does, since audit_row_change records rows by a uuid id.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- Promo codes. No API role writes the table; the functions in the next
-- migration do, as its owner.
-- ---------------------------------------------------------------------------

create table public.promo_codes (
    id uuid primary key default gen_random_uuid(),
    -- Letters and digits only, so it never looks like an agent code with a
    -- dash, and is already as normalize_referral_code stores codes.
    code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
    name text not null check (btrim(name) <> '' and char_length(name) <= 80),
    note text check (note is null or (btrim(note) <> '' and char_length(note) <= 200)),
    -- Whole TZS off the standard interview fee.
    amount integer not null check (amount between 0 and 50000),
    -- The last day the code gives its discount. Null: no end.
    ends_on date,
    state text not null default 'active' check (state in ('active', 'paused', 'ended')),
    created_at timestamptz not null default now(),
    created_by uuid references public.staff_members (id),
    updated_at timestamptz not null default now()
);

create index promo_codes_created_by_idx on public.promo_codes (created_by) where created_by is not null;

-- The code and who made it never change, and Ended is final.
create function public.guard_promo_code_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.code is distinct from old.code
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
        raise exception 'promo_code_locked';
    end if;
    if old.state = 'ended' and new.state is distinct from 'ended' then
        raise exception 'promo_code_ended';
    end if;
    return new;
end;
$$;

revoke execute on function public.guard_promo_code_change() from public, anon, authenticated;

create trigger guard_promo_code_change
    before update on public.promo_codes
    for each row
    execute function public.guard_promo_code_change();

insert into public.audit_scopes (table_name, scope) values ('public.promo_codes', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.promo_codes
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.promo_codes
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.promo_codes
    for each statement
    execute function public.refuse_delete();

alter table public.promo_codes enable row level security;

create policy "Staff who may view leads read Promo codes"
    on public.promo_codes for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.promo_codes from anon, authenticated, service_role;

-- What a Promo code's state means today: Active past its last day reads as
-- Expired. Internal: list_promo_codes and code_discount read it as owner.
create function public.effective_state(promo public.promo_codes)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when promo.state = 'active' and promo.ends_on is not null and promo.ends_on < public.tanzania_today() then 'expired'
        else promo.state
    end;
$$;

revoke execute on function public.effective_state(public.promo_codes) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One code namespace. Both triggers take the same advisory lock on the code
-- before they look, so a Promo code and an agent created with one code at
-- the same moment can't both pass: the second waits and then sees the
-- first. Security definer, since they read the other table as its owner.
-- ---------------------------------------------------------------------------

create function public.lock_discount_code(code text)
returns void
language sql
set search_path = ''
as $$
    select pg_advisory_xact_lock(hashtextextended('discount-code:' || lock_discount_code.code, 0));
$$;

revoke execute on function public.lock_discount_code(text) from public, anon, authenticated, service_role;

create function public.refuse_promo_code_taken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_discount_code(new.code);
    -- Any agent record that ever held it, retired ones included: a retired
    -- code comes back only through Recreate, for the same person.
    if public.agent_code_issued(new.code) then
        raise exception 'code_taken' using detail = new.code;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_promo_code_taken() from public, anon, authenticated;

create trigger refuse_promo_code_taken
    before insert on public.promo_codes
    for each row
    execute function public.refuse_promo_code_taken();

create function public.refuse_agent_code_taken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_discount_code(new.code);
    if exists (select 1 from public.promo_codes p where p.code = public.normalize_referral_code(new.code)) then
        raise exception 'code_taken' using detail = new.code;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_agent_code_taken() from public, anon, authenticated;

-- Sign-up, create, import and Recreate all insert through here.
create trigger refuse_agent_code_taken
    before insert or update of code on public.marketing_agents
    for each row
    execute function public.refuse_agent_code_taken();

-- ---------------------------------------------------------------------------
-- The standard interview discount.
-- ---------------------------------------------------------------------------

create table public.interview_discount_setting (
    id uuid primary key default gen_random_uuid(),
    -- Only ever one row.
    singleton boolean not null default true unique check (singleton),
    -- Whole TZS off the standard interview fee of TZS 50,000.
    amount integer not null check (amount between 0 and 50000),
    updated_at timestamptz not null default now(),
    -- Null when the system set it.
    updated_by uuid references public.staff_members (id)
);

alter table public.interview_discount_setting enable row level security;

-- Nobody reads or writes it through the API; standard_interview_discount()
-- reads it and set_standard_interview_discount() writes it, as the owner.
revoke all on public.interview_discount_setting from anon, authenticated, service_role;

insert into public.audit_scopes (table_name, scope) values ('public.interview_discount_setting', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.interview_discount_setting
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.interview_discount_setting
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.interview_discount_setting
    for each statement
    execute function public.refuse_delete();

insert into public.interview_discount_setting (amount) values (10000);

-- The standard amount, for every screen and piece of copy that states it.
-- Signed-in staff and the secret key; anonymous visitors read it on the
-- server with the secret key, as for interview_discount().
create function public.standard_interview_discount()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select s.amount from public.interview_discount_setting s where s.singleton;
$$;

revoke execute on function public.standard_interview_discount() from public, anon;
grant execute on function public.standard_interview_discount() to authenticated, service_role;

-- Kept for its callers: the standard amount.
create or replace function public.interview_discount()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select public.standard_interview_discount();
$$;

revoke execute on function public.interview_discount() from public, anon;
grant execute on function public.interview_discount() to authenticated, service_role;

-- Kept for its old callers and tests: the full fee, or the full fee less the
-- standard amount. Nothing new calls it with true; the fee a lead pays comes
-- from code_discount. Same signature and grants: internal only.
create or replace function public.interview_fee(discounted boolean)
returns integer
language sql
stable
strict
set search_path = ''
as $$
    select case when interview_fee.discounted then 50000 - public.standard_interview_discount() else 50000 end;
$$;

revoke execute on function public.interview_fee(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An agent's own amount.
-- ---------------------------------------------------------------------------

alter table public.marketing_agents
    add column interview_discount integer check (interview_discount between 0 and 50000);

comment on column public.marketing_agents.interview_discount is
    'Whole TZS this agent''s code takes off the interview fee while the agent is Approved and switched on. Null: the standard interview discount.';

-- What the agent's code takes off while it gives a discount. A computed
-- column, so the Agents screen selects it.
create function public.agent_discount_amount(agent public.marketing_agents)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(agent.interview_discount, public.standard_interview_discount());
$$;

revoke execute on function public.agent_discount_amount(public.marketing_agents) from public, anon;
grant execute on function public.agent_discount_amount(public.marketing_agents) to authenticated, service_role;

-- Recreate keeps the amount: the new record, inserted after the history row
-- that names it, takes the own amount of the record it replaces.
create function public.carry_recreated_interview_discount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.interview_discount is null then
        select o.interview_discount into new.interview_discount
        from public.agent_status_changes c
        join public.marketing_agents o on o.id = c.old_agent_id
        where c.new_agent_id = new.id and c.kind = 'recreated';
    end if;
    return new;
end;
$$;

revoke execute on function public.carry_recreated_interview_discount() from public, anon, authenticated;

create trigger carry_recreated_interview_discount
    before insert on public.marketing_agents
    for each row
    execute function public.carry_recreated_interview_discount();

-- ---------------------------------------------------------------------------
-- discount_amount_changes: the append-only history of every amount and
-- Promo code change, with who, when, why and the leads whose unpaid fee it
-- moved. Name and note edits are in the audit history only.
--
--   standard       old and new standard amount
--   agent          old and new own amount; null is the standard
--   promo_created  new_value is the amount
--   promo_amount   old and new amount
--   promo_state    old and new state
--   promo_ends     old and new last day; null is no end
-- ---------------------------------------------------------------------------

create table public.discount_amount_changes (
    id uuid primary key default gen_random_uuid(),
    -- Breaks a tie between two changes with the same changed_at.
    sequence bigint generated always as identity,
    kind text not null check (kind in ('standard', 'agent', 'promo_amount', 'promo_state', 'promo_created', 'promo_ends')),
    agent_id uuid references public.marketing_agents (id),
    promo_code_id uuid references public.promo_codes (id),
    old_value text,
    new_value text,
    reason text check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 500)),
    changed_at timestamptz not null default clock_timestamp(),
    -- Null when the system made the change.
    changed_by uuid references public.staff_members (id),
    -- The leads whose interview fee, not yet Paid, the change moved.
    student_count integer not null check (student_count >= 0),
    lead_ids uuid[] not null,
    check (student_count = cardinality(lead_ids)),
    check (case kind
        when 'standard' then agent_id is null and promo_code_id is null
        when 'agent' then agent_id is not null and promo_code_id is null
        else agent_id is null and promo_code_id is not null
    end)
);

create index discount_amount_changes_agent_idx on public.discount_amount_changes (agent_id, changed_at, sequence) where agent_id is not null;
create index discount_amount_changes_promo_idx on public.discount_amount_changes (promo_code_id, changed_at, sequence) where promo_code_id is not null;
create index discount_amount_changes_changed_by_idx on public.discount_amount_changes (changed_by) where changed_by is not null;

create trigger refuse_update
    before update on public.discount_amount_changes
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.discount_amount_changes
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.discount_amount_changes
    for each statement
    execute function public.refuse_delete();

insert into public.audit_scopes (table_name, scope) values ('public.discount_amount_changes', 'staff_admin');

create trigger audit_row_change
    after insert on public.discount_amount_changes
    for each row
    execute function public.audit_row_change();

alter table public.discount_amount_changes enable row level security;

create policy "Staff who may view leads read discount amount changes"
    on public.discount_amount_changes for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.discount_amount_changes from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- code_discount: the one rule from a typed code to its holder and what it
-- takes off the interview fee right now. One row, or none for a code nobody
-- ever held and for something that isn't a code.
--
--   promo  active (amount off), paused, ended or expired (nothing off)
--   agent  approved (own amount or the standard off), pending, switched_off,
--          or retired: a code only retired records held (nothing off)
--
-- Internal: security definer callers check the permission first.
-- ---------------------------------------------------------------------------

create function public.code_discount(typed_code text)
returns table (
    kind text,
    code text,
    agent_id uuid,
    promo_code_id uuid,
    holder_name text,
    state text,
    amount_off integer
)
language sql
stable
security definer
set search_path = ''
as $$
    with typed as (
        select public.normalize_referral_code(code_discount.typed_code) as code
    ),
    promo as (
        select p.id, p.code, p.name, p.amount, public.effective_state(p) as effective
        from typed t
        join public.promo_codes p on p.code = t.code
    ),
    current_agent as (
        select a.id, a.code, a.full_name, a.status, a.switched_off_at, public.agent_discount_amount(a) as amount
        from typed t
        cross join lateral public.agent_for_code(t.code) a
    ),
    retired_agent as (
        select r.id, r.code, r.full_name
        from typed t
        cross join lateral public.retired_agent_for_code(t.code) r
        where not exists (select 1 from current_agent)
    )
    select 'promo', p.code, null::uuid, p.id, p.name, p.effective,
           case when p.effective = 'active' then p.amount else 0 end
    from promo p
    union all
    select 'agent', a.code, a.id, null::uuid, a.full_name,
           case when a.switched_off_at is not null then 'switched_off' when a.status = 'Approved' then 'approved' else 'pending' end,
           case when a.switched_off_at is null and a.status = 'Approved' then a.amount else 0 end
    from current_agent a
    union all
    select 'agent', r.code, r.id, null::uuid, r.full_name, 'retired', 0
    from retired_agent r;
$$;

revoke execute on function public.code_discount(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_interview_discount(lead_id): the lead's code, its holder, its state
-- and what it takes off now. Always one row: kind `none` with no state for a
-- lead with no code, and `none` with `unrecognised` for a code nobody holds.
-- Staff who may view leads, and the secret key.
-- ---------------------------------------------------------------------------

create function public.lead_interview_discount(lead_id uuid)
returns table (
    kind text,
    code text,
    agent_id uuid,
    promo_code_id uuid,
    holder_name text,
    state text,
    amount_off integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_code text;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;

    select l.referral_code into lead_code from public.leads l where l.id = lead_interview_discount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    return query
    select coalesce(d.kind, 'none'),
           lead_code,
           d.agent_id,
           d.promo_code_id,
           d.holder_name,
           case when lead_code is null then null else coalesce(d.state, 'unrecognised') end,
           coalesce(d.amount_off, 0)
    from (select 1) one
    left join lateral public.code_discount(lead_code) d on true;
end;
$$;

revoke execute on function public.lead_interview_discount(uuid) from public, anon;
grant execute on function public.lead_interview_discount(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- expected_interview_amount, re-created with its signature and grants
-- unchanged: the full fee less what the lead's code takes off now.
-- ---------------------------------------------------------------------------

create or replace function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_code text;
    off integer;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'forbidden';
    end if;

    select l.referral_code into lead_code from public.leads l where l.id = expected_interview_amount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select coalesce(max(d.amount_off), 0) into off from public.code_discount(lead_code) d;
    discount_applied := off > 0;
    amount := public.interview_fee(false) - off;
end;
$$;

-- ---------------------------------------------------------------------------
-- discount_code_estimate, re-created with its signature and grants
-- unchanged. A Promo code giving its discount reads `approved`, so the form
-- shows the same discount line; paused, ended or expired reads
-- `switched_off`. `amount` is the fee per child after the code's own amount.
-- A code only retired records held reads `unknown`, as before.
-- ---------------------------------------------------------------------------

create or replace function public.discount_code_estimate(code text, out state text, out amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    found_code record;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;

    select d.kind, d.state, d.amount_off into found_code
    from public.code_discount(discount_code_estimate.code) d;

    state := case
        when found_code.kind is null or found_code.state = 'retired' then 'unknown'
        when found_code.kind = 'promo' then case when found_code.state = 'active' then 'approved' else 'switched_off' end
        else found_code.state
    end;
    amount := public.interview_fee(false) - coalesce(found_code.amount_off, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_lead_referral_code, as 20261116400200_referral_notice_version.sql left
-- it, except that a Promo code in any state is accepted: the amount follows
-- the state. A code nothing holds is still refused.
-- ---------------------------------------------------------------------------

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
        if not exists (select 1 from public.agent_for_code(new_code))
           and not exists (select 1 from public.promo_codes p where p.code = new_code) then
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
    set referral_code = new_code,
        referral_notice_version = case when new_code is null then null else 'staff_reminder' end
    where l.id = set_lead_referral_code.lead_id;

    return new_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- find_discount_code: the agent or Promo code a typed code belongs to, for
-- the referral panel, its editor and the check-in form. No row for a code
-- nobody ever held. Staff who may view leads, and the secret key.
-- ---------------------------------------------------------------------------

create function public.find_discount_code(typed_code text)
returns table (
    kind text,
    code text,
    holder_name text,
    state text,
    amount_off integer,
    agent_id uuid,
    promo_code_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select d.kind, d.code, d.holder_name, d.state, d.amount_off, d.agent_id, d.promo_code_id
    from public.code_discount(find_discount_code.typed_code) d
    where public.has_permission('leads.view') or auth.role() is not distinct from 'service_role';
$$;

revoke execute on function public.find_discount_code(text) from public, anon;
grant execute on function public.find_discount_code(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_fee_change_leads, as 20261120120100_agent_create_recreate.sql made
-- it, except that an agent whose amount is TZS 0 moves no fee.
-- ---------------------------------------------------------------------------

create or replace function public.agent_fee_change_leads(agent public.marketing_agents, kind text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select l.id
    from public.leads l
    where l.referral_code = agent.code
      and public.agent_discount_amount(agent) > 0
      and case
          when agent.retired_at is null then exists (
              select 1
              from public.agent_for_code(agent.code) holder
              where holder.id = agent.id
                and (holder.status = 'Approved' and holder.switched_off_at is null)
                    is distinct from case agent_fee_change_leads.kind
                        when 'switched_on' then holder.status = 'Approved'
                        when 'recreated' then true
                        else false
                    end
          )
          else agent_fee_change_leads.kind = 'recreated'
              and not exists (select 1 from public.agent_for_code(agent.code))
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
-- agent_status_fee_impact, as 20261120120100_agent_create_recreate.sql made
-- it, with the agent's own amount: the fee moves between TZS 50,000 and
-- TZS 50,000 less agent_discount_amount. Recreate's new record keeps the
-- amount (carry_recreated_interview_discount).
-- ---------------------------------------------------------------------------

create or replace function public.agent_status_fee_impact(agent_id uuid, kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    full_fee integer := public.interview_fee(false);
    discounted integer;
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
    if agent.retired_at is not null
       and (agent_status_fee_impact.kind <> 'recreated' or not public.agent_recreatable(agent)) then
        raise exception 'agent_retired';
    end if;

    discounted := full_fee - public.agent_discount_amount(agent);
    -- Every listed fee moves between the two amounts: the discount goes on
    -- for switching on and recreating, and comes off otherwise.
    select coalesce(jsonb_agg(jsonb_build_object(
            'lead_id', l.id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'class_name', l.class_name::text,
            'contact_name', c.full_name,
            'contact_phone', c.phone,
            'fee_now', case when agent_status_fee_impact.kind in ('switched_on', 'recreated') then full_fee else discounted end,
            'fee_after', case when agent_status_fee_impact.kind in ('switched_on', 'recreated') then discounted else full_fee end
        ) order by l.student_name, l.admission_number, l.id), '[]'::jsonb)
    into families
    from public.agent_fee_change_leads(agent, agent_status_fee_impact.kind) changed (id)
    join public.leads l on l.id = changed.id
    join public.guardian_contacts c on c.id = l.guardian_contact_id;

    return families;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_interview_fee_status, as 20261120120100_agent_create_recreate.sql made
-- it, now also holding, after the agent records, the lead's Promo code row
-- and then the setting, in share mode. Each amount writer holds the row it
-- changes for update while it counts, so a payment waits for a change in
-- progress and locks the amount that change leaves, or the change waits for
-- the payment and counts that fee as Paid. Lock order: the lead, the
-- interview, the agent records, the Promo code, the setting.
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

    -- The code's current record, or while there is none the retired record
    -- Recreate would start from, as before.
    loop
        select c.id into holder from public.agent_for_code(lead_code) c;
        if holder is null then
            select r.id into holder from public.retired_agent_for_code(lead_code) r;
        end if;
        exit when holder is not distinct from held;
        perform 1 from public.marketing_agents a where a.id = holder for share;
        held := holder;
    end loop;
    -- A Promo code's row, then the standard amount: their writers hold them
    -- for update while they count.
    perform 1 from public.promo_codes p where p.code = lead_code for share;
    perform 1 from public.interview_discount_setting s where s.singleton for share;

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
-- agent_code_conflict, as 20261120120100_agent_create_recreate.sql made it,
-- except that a code a Promo code holds is refused outright as
-- `code_taken`, with the code in the detail: it has no agent to name, and
-- the Manager's screens word it as a code in use.
-- ---------------------------------------------------------------------------

create or replace function public.agent_code_conflict(code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    holder public.marketing_agents;
    students integer;
begin
    if exists (select 1 from public.promo_codes p where p.code = public.normalize_referral_code(agent_code_conflict.code)) then
        raise exception 'code_taken' using detail = public.normalize_referral_code(agent_code_conflict.code);
    end if;
    select * into holder from public.agent_for_code(agent_code_conflict.code);
    if found then
        return jsonb_build_object('outcome', 'code_taken', 'agent', public.agent_ref(holder));
    end if;
    select * into holder from public.retired_agent_for_code(agent_code_conflict.code);
    if found then
        select count(*) into students from public.leads l where l.referral_code = holder.code;
        return jsonb_build_object(
            'outcome', 'retired_code',
            'agent', jsonb_build_object('id', holder.id, 'full_name', holder.full_name, 'code', holder.code),
            'student_count', students
        );
    end if;
    return null;
end;
$$;

revoke execute on function public.agent_code_conflict(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_import_verdicts, as 20261121120100_agent_import.sql made it, with
-- one more verdict before the rest: `promo_code`, a code a Promo code holds.
-- ---------------------------------------------------------------------------

create or replace function public.agent_import_verdicts(rows jsonb)
returns table (sheet_row integer, verdict jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select r.sheet_row,
        case
            when exists (select 1 from public.promo_codes p where p.code = r.code)
                then jsonb_build_object('verdict', 'promo_code')
            when holder.id is not null then
                case
                    when lower(regexp_replace(btrim(holder.full_name), '\s+', ' ', 'g')) <> lower(r.full_name)
                        then jsonb_build_object('verdict', 'code_exists', 'agent', public.agent_import_ref(holder))
                    when holder.phone <> r.phone
                        then jsonb_build_object('verdict', 'mobile_differs', 'agent', public.agent_import_ref(holder))
                    when r.email is null or r.email = holder.email
                        then jsonb_build_object('verdict', 'present', 'agent', public.agent_import_ref(holder))
                    when holder.email is not null
                        then jsonb_build_object('verdict', 'email_differs', 'agent', public.agent_import_ref(holder))
                    when public.agent_email_taken(r.email)
                        then jsonb_build_object('verdict', 'email_taken')
                    else jsonb_build_object('verdict', 'email_to_add', 'agent', public.agent_import_ref(holder))
                end
            when public.agent_code_issued(r.code) then jsonb_build_object('verdict', 'retired_code')
            when phone_holder.id is not null
                then jsonb_build_object('verdict', 'mobile_taken', 'agent', public.agent_import_ref(phone_holder))
            when public.agent_email_taken(r.email) then jsonb_build_object('verdict', 'email_taken')
            else jsonb_build_object('verdict', 'create')
        end
    from public.agent_import_rows(agent_import_verdicts.rows) r
    left join lateral (select h.* from public.agent_for_code(r.code) h) holder on true
    left join lateral (
        select a.* from public.marketing_agents a where a.phone = r.phone and a.retired_at is null
    ) phone_holder on true
    order by r.sheet_row;
$$;

revoke execute on function public.agent_import_verdicts(jsonb) from public, anon, authenticated, service_role;

select set_config('audit.actor_kind', '', true);
