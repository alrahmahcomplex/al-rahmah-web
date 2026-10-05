-- The Referral code on a lead (slice 4, #80): the column, the one place the
-- two interview amounts live, the real expected_interview_amount, and the
-- staff write that sets or clears a lead's code.
--
-- A lead holds its code as normalized and nothing else: no foreign key and no
-- copied agent name. The agent and their status come from a join on
-- marketing_agents.code whenever the code is read; a code no agent holds is
-- Unrecognised. Agents' codes never change and agents are never deleted, so
-- the join stays stable. Slice 2's audit trigger on leads records every
-- change, and the closed-lead trigger refuses one on a closed lead.
--
-- Refusal codes: `not_permitted`, `forbidden`, `not_found`, `lead_closed`
-- (from assert_lead_open), `unknown_code` and `no_change`.

alter table public.leads
    add column referral_code text
        constraint leads_referral_code_normalized check (referral_code = public.normalize_referral_code(referral_code));

-- The agent join and each code's lead count on the Marketing Agents screen.
create index leads_referral_code_idx on public.leads (referral_code) where referral_code is not null;

-- ---------------------------------------------------------------------------
-- interview_fee: the two interview amounts, in whole TZS, and the only place
-- they are written down. Every amount reader takes them from here, so the
-- staff screens, the Paid lock and the Admission form's estimate agree.
-- Internal: security definer functions call it as their owner.
-- ---------------------------------------------------------------------------

create function public.interview_fee(discounted boolean)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select case when interview_fee.discounted then 30000 else 50000 end;
$$;

revoke execute on function public.interview_fee(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- expected_interview_amount: what the lead's interview costs, and whether an
-- Approved Marketing Agent's discount brought it down. TZS 30,000 for an
-- Approved agent's code; TZS 50,000 for no code, an Unrecognised code or a
-- Pending agent's. Read live, so approving an agent lowers the amount on
-- every lead carrying the code at once. Slice 5 locks it at Paid. Replaces
-- Wave 0's stand-in, with the same signature. Needs leads.view.
-- ---------------------------------------------------------------------------

create or replace function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent_status public.marketing_agent_status;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'forbidden';
    end if;

    select a.status into agent_status
    from public.leads l
    left join public.marketing_agents a on a.code = l.referral_code
    where l.id = expected_interview_amount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    discount_applied := agent_status is not distinct from 'Approved';
    amount := public.interview_fee(discount_applied);
end;
$$;

revoke execute on function public.expected_interview_amount(uuid) from public, anon;
grant execute on function public.expected_interview_amount(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_lead_referral_code: sets a lead's code, or clears it with null. Staff
-- only enter a registered agent's code, Pending or Approved; anything else is
-- `unknown_code`. The code is matched however it is typed. Setting the code
-- the lead already holds is `no_change`. Needs leads.edit. Returns the code as
-- stored, or null once cleared.
-- ---------------------------------------------------------------------------

create function public.set_lead_referral_code(lead_id uuid, code text)
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
        if new_code is null or not exists (select 1 from public.marketing_agents a where a.code = new_code) then
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

revoke execute on function public.set_lead_referral_code(uuid, text) from public, anon;
grant execute on function public.set_lead_referral_code(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- find_marketing_agent: the agent a typed code belongs to, matched however it
-- is typed, or no row. For the Referral code input, which names the agent as
-- staff type. Security invoker: it reads through the agent list's row-level
-- security, so only staff who may view leads find anyone.
-- ---------------------------------------------------------------------------

create function public.find_marketing_agent(typed_code text)
returns table (code text, full_name text, status public.marketing_agent_status)
language sql
stable
security invoker
set search_path = ''
as $$
    select a.code, a.full_name, a.status
    from public.marketing_agents a
    where a.code = public.normalize_referral_code(find_marketing_agent.typed_code);
$$;

revoke execute on function public.find_marketing_agent(text) from public, anon;
grant execute on function public.find_marketing_agent(text) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_count: how many leads carry an agent's code. A computed column, so the
-- Marketing Agents list selects it in the same query. Security invoker: it
-- counts through the leads' row-level security.
-- ---------------------------------------------------------------------------

create function public.lead_count(agent public.marketing_agents)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
    select count(*) from public.leads l where l.referral_code = agent.code;
$$;

revoke execute on function public.lead_count(public.marketing_agents) from public, anon;
grant execute on function public.lead_count(public.marketing_agents) to authenticated;
