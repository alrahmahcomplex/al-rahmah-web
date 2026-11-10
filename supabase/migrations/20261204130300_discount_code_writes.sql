-- Setting discount amounts and managing Promo codes (owner decisions of
-- 2026-11-09), on the data and the fee rule in
-- 20261204130200_discount_amounts_and_promo_codes.sql.
--
-- Every write needs discount_codes.manage and a signed-in staff session. It
-- locks the row it changes, counts the leads whose interview fee, not yet
-- Paid, the change moves, writes the change and one discount_amount_changes
-- row with those leads, and returns {"fee_change_count": n}. Closed leads
-- count too: their unpaid fee moves like any other. A Paid fee keeps its
-- locked_amount, so it is never counted or moved.
--
--   set_standard_interview_discount(amount, reason)
--   set_agent_interview_discount(agent_id, amount, reason)   null: standard
--   create_promo_code(name, code, amount, ends_on, note)      the new row
--   update_promo_code(id, name, amount, ends_on, note, reason)
--   set_promo_code_state(id, state, reason)
--
-- The fee impact readers list, before the staff member confirms, the
-- families a change would move, in the shape agent_status_fee_impact uses
-- (lead_id, admission_number, student_name, class_name, contact_name,
-- contact_phone, fee_now, fee_after), as one JSON array read in one
-- snapshot:
--
--   standard_discount_fee_impact(amount)
--   agent_discount_fee_impact(agent_id, amount)
--   promo_code_fee_impact(id, amount, state, ends_on, ends_on_given)
--
-- list_promo_codes() is the Promo codes screen's list, for leads.view.
--
-- Refusal codes: `not_permitted`, `invalid` with the field as JSON in the
-- detail, `no_change`, `not_found`, `retired` (an agent's amount on a
-- retired record), `ended` (a Promo code that has ended), and `code_taken`
-- (a code an agent record or another Promo code holds).

-- ---------------------------------------------------------------------------
-- Internal pieces.
-- ---------------------------------------------------------------------------

-- The leads carrying any of the codes whose current interview, the newest
-- registration, is not Paid, or who have no interview yet.
create function public.unpaid_leads_for_codes(codes text[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(l.id order by l.id), '{}')
    from public.leads l
    where l.referral_code = any (unpaid_leads_for_codes.codes)
      and (
          select i.fee_status
          from public.interviews i
          where i.lead = l.id
          order by i.registered_at desc, i.serial_number desc
          limit 1
      ) is distinct from 'Paid';
$$;

revoke execute on function public.unpaid_leads_for_codes(text[]) from public, anon, authenticated, service_role;

-- The fee impact list for leads that all move from one fee to another.
create function public.fee_impact_families(lead_ids uuid[], fee_now integer, fee_after integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
            'lead_id', l.id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'class_name', l.class_name::text,
            'contact_name', c.full_name,
            'contact_phone', c.phone,
            'fee_now', fee_impact_families.fee_now,
            'fee_after', fee_impact_families.fee_after
        ) order by l.student_name, l.admission_number, l.id), '[]'::jsonb)
    from public.leads l
    join public.guardian_contacts c on c.id = l.guardian_contact_id
    where l.id = any (fee_impact_families.lead_ids)
      and fee_impact_families.fee_now is distinct from fee_impact_families.fee_after;
$$;

revoke execute on function public.fee_impact_families(uuid[], integer, integer) from public, anon, authenticated, service_role;

-- The caller may manage discount codes from a staff session, and so names
-- families (discount_codes.manage implies leads.view on every role).
create function public.require_discount_codes_manager()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    staff_id uuid;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('discount_codes.manage')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
    return staff_id;
end;
$$;

revoke execute on function public.require_discount_codes_manager() from public, anon, authenticated, service_role;

-- An amount in whole TZS off the standard interview fee.
create function public.check_discount_amount(amount integer, field text default 'amount')
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if check_discount_amount.amount is null or check_discount_amount.amount not between 0 and 50000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', check_discount_amount.field)::text;
    end if;
end;
$$;

revoke execute on function public.check_discount_amount(integer, text) from public, anon, authenticated, service_role;

-- A reason: required, trimmed, at most 500 characters.
create function public.discount_change_reason(reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
    if btrim(coalesce(discount_change_reason.reason, '')) = '' or char_length(btrim(discount_change_reason.reason)) > 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    return btrim(discount_change_reason.reason);
end;
$$;

revoke execute on function public.discount_change_reason(text) from public, anon, authenticated, service_role;

-- The codes that take the standard amount off now: current agents, Approved
-- and switched on, with no own amount.
create function public.standard_discount_codes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(a.code order by a.code), '{}')
    from public.marketing_agents a
    where a.retired_at is null
      and a.switched_off_at is null
      and a.status = 'Approved'
      and a.interview_discount is null;
$$;

revoke execute on function public.standard_discount_codes() from public, anon, authenticated, service_role;

-- What a Promo code takes off with the given amount, state and last day.
create function public.promo_amount_off(amount integer, state text, ends_on date)
returns integer
language sql
stable
set search_path = ''
as $$
    select case
        when promo_amount_off.state = 'active'
             and (promo_amount_off.ends_on is null or promo_amount_off.ends_on >= public.tanzania_today())
            then promo_amount_off.amount
        else 0
    end;
$$;

revoke execute on function public.promo_amount_off(integer, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The standard amount.
-- ---------------------------------------------------------------------------

create function public.standard_discount_fee_impact(amount integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    current_amount integer := public.standard_interview_discount();
begin
    perform public.require_discount_codes_manager();
    perform public.check_discount_amount(standard_discount_fee_impact.amount);
    if standard_discount_fee_impact.amount = current_amount then
        return '[]'::jsonb;
    end if;
    return public.fee_impact_families(
        public.unpaid_leads_for_codes(public.standard_discount_codes()),
        public.interview_fee(false) - current_amount,
        public.interview_fee(false) - standard_discount_fee_impact.amount
    );
end;
$$;

revoke execute on function public.standard_discount_fee_impact(integer) from public, anon;
grant execute on function public.standard_discount_fee_impact(integer) to authenticated;

create function public.set_standard_interview_discount(amount integer, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    why text;
    setting public.interview_discount_setting;
    moved uuid[];
begin
    perform public.check_discount_amount(set_standard_interview_discount.amount);
    why := public.discount_change_reason(set_standard_interview_discount.reason);

    -- Locked, so a payment waits for this change, and two changes take turns.
    select * into setting from public.interview_discount_setting s where s.singleton for update;
    if setting.amount = set_standard_interview_discount.amount then
        raise exception 'no_change';
    end if;

    moved := public.unpaid_leads_for_codes(public.standard_discount_codes());

    update public.interview_discount_setting s
    set amount = set_standard_interview_discount.amount, updated_at = now(), updated_by = staff_id
    where s.id = setting.id;

    insert into public.discount_amount_changes (kind, old_value, new_value, reason, changed_by, student_count, lead_ids)
    values ('standard', setting.amount::text, set_standard_interview_discount.amount::text, why, staff_id, cardinality(moved), moved);

    return jsonb_build_object('fee_change_count', cardinality(moved));
end;
$$;

revoke execute on function public.set_standard_interview_discount(integer, text) from public, anon;
grant execute on function public.set_standard_interview_discount(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- An agent's own amount. A retired record is refused as `retired`. The fee
-- moves only while the agent gives a discount (Approved and switched on)
-- and only when the amount it takes off changes: an own amount equal to the
-- standard moves nobody.
-- ---------------------------------------------------------------------------

-- The leads whose fee the agent's amount change moves.
create function public.agent_amount_change_leads(agent public.marketing_agents, amount integer)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when agent.retired_at is null
             and agent.switched_off_at is null
             and agent.status = 'Approved'
             and public.agent_discount_amount(agent)
                 is distinct from coalesce(agent_amount_change_leads.amount, public.standard_interview_discount())
            then public.unpaid_leads_for_codes(array[agent.code])
        else '{}'::uuid[]
    end;
$$;

revoke execute on function public.agent_amount_change_leads(public.marketing_agents, integer) from public, anon, authenticated, service_role;

create function public.agent_discount_fee_impact(agent_id uuid, amount integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
begin
    perform public.require_discount_codes_manager();
    if agent_discount_fee_impact.amount is not null then
        perform public.check_discount_amount(agent_discount_fee_impact.amount);
    end if;
    select * into agent from public.marketing_agents a where a.id = agent_discount_fee_impact.agent_id;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    return public.fee_impact_families(
        public.agent_amount_change_leads(agent, agent_discount_fee_impact.amount),
        public.interview_fee(false) - public.agent_discount_amount(agent),
        public.interview_fee(false) - coalesce(agent_discount_fee_impact.amount, public.standard_interview_discount())
    );
end;
$$;

revoke execute on function public.agent_discount_fee_impact(uuid, integer) from public, anon;
grant execute on function public.agent_discount_fee_impact(uuid, integer) to authenticated;

create function public.set_agent_interview_discount(agent_id uuid, amount integer, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    why text;
    agent public.marketing_agents;
    moved uuid[];
begin
    if set_agent_interview_discount.amount is not null then
        perform public.check_discount_amount(set_agent_interview_discount.amount);
    end if;
    why := public.discount_change_reason(set_agent_interview_discount.reason);

    -- The agent, then the standard amount it may fall back to: a payment
    -- takes them in the same order.
    select * into agent from public.marketing_agents a where a.id = set_agent_interview_discount.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform 1 from public.interview_discount_setting s where s.singleton for share;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    if agent.interview_discount is not distinct from set_agent_interview_discount.amount then
        raise exception 'no_change';
    end if;

    moved := public.agent_amount_change_leads(agent, set_agent_interview_discount.amount);

    update public.marketing_agents a
    set interview_discount = set_agent_interview_discount.amount
    where a.id = agent.id;

    insert into public.discount_amount_changes (kind, agent_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
    values (
        'agent', agent.id, agent.interview_discount::text, set_agent_interview_discount.amount::text,
        why, staff_id, cardinality(moved), moved
    );

    return jsonb_build_object('fee_change_count', cardinality(moved));
end;
$$;

revoke execute on function public.set_agent_interview_discount(uuid, integer, text) from public, anon;
grant execute on function public.set_agent_interview_discount(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Promo codes.
-- ---------------------------------------------------------------------------

-- A Promo code's details as typed, cleaned as the table stores them.
create function public.promo_code_name(name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    cleaned text := regexp_replace(btrim(coalesce(promo_code_name.name, '')), '\s+', ' ', 'g');
begin
    if cleaned = '' or char_length(cleaned) > 80 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'name')::text;
    end if;
    return cleaned;
end;
$$;

revoke execute on function public.promo_code_name(text) from public, anon, authenticated, service_role;

create function public.promo_code_note(note text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    cleaned text := nullif(btrim(coalesce(promo_code_note.note, '')), '');
begin
    if char_length(cleaned) > 200 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
    end if;
    return cleaned;
end;
$$;

revoke execute on function public.promo_code_note(text) from public, anon, authenticated, service_role;

create function public.create_promo_code(name text, code text, amount integer, ends_on date, note text)
returns public.promo_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    clean_name text := public.promo_code_name(create_promo_code.name);
    clean_note text := public.promo_code_note(create_promo_code.note);
    clean_code text := upper(regexp_replace(coalesce(create_promo_code.code, ''), '\s', '', 'g'));
    made public.promo_codes;
    moved uuid[];
begin
    if clean_code !~ '^[A-Z0-9]{4,12}$' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;
    perform public.check_discount_amount(create_promo_code.amount);
    if create_promo_code.ends_on is not null and create_promo_code.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;

    -- refuse_promo_code_taken checks agent records under the code's lock;
    -- the unique constraint catches another Promo code.
    begin
        insert into public.promo_codes (code, name, note, amount, ends_on, created_by)
        values (clean_code, clean_name, clean_note, create_promo_code.amount, create_promo_code.ends_on, staff_id)
        returning * into made;
    exception when unique_violation then
        raise exception 'code_taken' using detail = clean_code;
    end;

    -- Leads that already carry the code, typed before it existed, take its
    -- discount on every fee not yet Paid.
    moved := case when public.promo_amount_off(made.amount, made.state, made.ends_on) > 0
        then public.unpaid_leads_for_codes(array[made.code]) else '{}'::uuid[] end;

    insert into public.discount_amount_changes (kind, promo_code_id, new_value, changed_by, student_count, lead_ids)
    values ('promo_created', made.id, made.amount::text, staff_id, cardinality(moved), moved);

    return made;
end;
$$;

revoke execute on function public.create_promo_code(text, text, integer, date, text) from public, anon;
grant execute on function public.create_promo_code(text, text, integer, date, text) to authenticated;

-- What a Promo code change would move: the code with the given amount and
-- state (null keeps each as it is) and, when ends_on_given, the given last
-- day, where null means no last day. A new last day moves fees by itself: an
-- expired code given a later day gives its amount again.
create function public.promo_code_fee_impact(id uuid, amount integer, state text, ends_on date, ends_on_given boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    promo public.promo_codes;
    off_now integer;
    off_after integer;
begin
    perform public.require_discount_codes_manager();
    if promo_code_fee_impact.amount is not null then
        perform public.check_discount_amount(promo_code_fee_impact.amount);
    end if;
    if promo_code_fee_impact.state is not null and promo_code_fee_impact.state not in ('active', 'paused', 'ended') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'state')::text;
    end if;
    select * into promo from public.promo_codes p where p.id = promo_code_fee_impact.id;
    if not found then
        raise exception 'not_found';
    end if;
    -- A new last day already past is refused as update_promo_code refuses
    -- it, so the preview never lists a change the save won't make.
    if promo_code_fee_impact.ends_on_given
       and promo_code_fee_impact.ends_on is distinct from promo.ends_on
       and promo_code_fee_impact.ends_on is not null
       and promo_code_fee_impact.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;

    off_now := public.promo_amount_off(promo.amount, promo.state, promo.ends_on);
    off_after := public.promo_amount_off(
        coalesce(promo_code_fee_impact.amount, promo.amount),
        coalesce(promo_code_fee_impact.state, promo.state),
        case when promo_code_fee_impact.ends_on_given then promo_code_fee_impact.ends_on else promo.ends_on end
    );
    return public.fee_impact_families(
        public.unpaid_leads_for_codes(array[promo.code]),
        public.interview_fee(false) - off_now,
        public.interview_fee(false) - off_after
    );
end;
$$;

revoke execute on function public.promo_code_fee_impact(uuid, integer, text, date, boolean) from public, anon;
grant execute on function public.promo_code_fee_impact(uuid, integer, text, date, boolean) to authenticated;

-- Edits a Promo code's name, amount, last day and note. A reason is needed
-- only when the amount or the last day changes. An Ended code is refused as
-- `ended`. A last day already past may stay; a new one may not be past.
create function public.update_promo_code(id uuid, name text, amount integer, ends_on date, note text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    clean_name text := public.promo_code_name(update_promo_code.name);
    clean_note text := public.promo_code_note(update_promo_code.note);
    why text;
    promo public.promo_codes;
    moved uuid[] := '{}';
    fee_count integer;
begin
    perform public.check_discount_amount(update_promo_code.amount);

    select * into promo from public.promo_codes p where p.id = update_promo_code.id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if promo.state = 'ended' then
        raise exception 'ended';
    end if;
    if update_promo_code.ends_on is distinct from promo.ends_on
       and update_promo_code.ends_on is not null
       and update_promo_code.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;
    if (clean_name, clean_note, update_promo_code.amount, update_promo_code.ends_on)
       is not distinct from (promo.name, promo.note, promo.amount, promo.ends_on) then
        raise exception 'no_change';
    end if;
    if update_promo_code.amount is distinct from promo.amount or update_promo_code.ends_on is distinct from promo.ends_on then
        why := public.discount_change_reason(update_promo_code.reason);
    end if;

    if public.promo_amount_off(promo.amount, promo.state, promo.ends_on)
       is distinct from public.promo_amount_off(update_promo_code.amount, promo.state, update_promo_code.ends_on) then
        moved := public.unpaid_leads_for_codes(array[promo.code]);
    end if;
    fee_count := cardinality(moved);

    update public.promo_codes p
    set name = clean_name, note = clean_note, amount = update_promo_code.amount,
        ends_on = update_promo_code.ends_on, updated_at = now()
    where p.id = promo.id;

    -- One history row per amount change, the fee count on the first.
    if update_promo_code.amount is distinct from promo.amount then
        insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
        values ('promo_amount', promo.id, promo.amount::text, update_promo_code.amount::text, why, staff_id, cardinality(moved), moved);
        moved := '{}';
    end if;
    if update_promo_code.ends_on is distinct from promo.ends_on then
        insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
        values ('promo_ends', promo.id, promo.ends_on::text, update_promo_code.ends_on::text, why, staff_id, cardinality(moved), moved);
    end if;

    return jsonb_build_object('fee_change_count', fee_count);
end;
$$;

revoke execute on function public.update_promo_code(uuid, text, integer, date, text, text) from public, anon;
grant execute on function public.update_promo_code(uuid, text, integer, date, text, text) to authenticated;

-- Pauses, resumes or ends a Promo code. A reason is required; Ended is
-- final and refused as `ended`.
create function public.set_promo_code_state(id uuid, state text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    why text;
    promo public.promo_codes;
    moved uuid[] := '{}';
begin
    if set_promo_code_state.state is null or set_promo_code_state.state not in ('active', 'paused', 'ended') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'state')::text;
    end if;
    why := public.discount_change_reason(set_promo_code_state.reason);

    select * into promo from public.promo_codes p where p.id = set_promo_code_state.id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if promo.state = 'ended' then
        raise exception 'ended';
    end if;
    if promo.state = set_promo_code_state.state then
        raise exception 'no_change';
    end if;

    if public.promo_amount_off(promo.amount, promo.state, promo.ends_on)
       is distinct from public.promo_amount_off(promo.amount, set_promo_code_state.state, promo.ends_on) then
        moved := public.unpaid_leads_for_codes(array[promo.code]);
    end if;

    update public.promo_codes p
    set state = set_promo_code_state.state, updated_at = now()
    where p.id = promo.id;

    insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
    values ('promo_state', promo.id, promo.state, set_promo_code_state.state, why, staff_id, cardinality(moved), moved);

    return jsonb_build_object('fee_change_count', cardinality(moved));
end;
$$;

revoke execute on function public.set_promo_code_state(uuid, text, text) from public, anon;
grant execute on function public.set_promo_code_state(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_promo_codes: every Promo code with its state today and how many
-- leads carry it, and how many of those have an interview fee not yet Paid.
-- Active first (Expired counts as not active), then the newest.
-- ---------------------------------------------------------------------------

create function public.list_promo_codes()
returns table (
    id uuid,
    code text,
    name text,
    note text,
    amount integer,
    ends_on date,
    state text,
    effective_state text,
    student_count integer,
    unpaid_count integer,
    created_at timestamptz,
    updated_at timestamptz
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
    select p.id, p.code, p.name, p.note, p.amount, p.ends_on, p.state, public.effective_state(p),
           (select count(*)::integer from public.leads l where l.referral_code = p.code),
           cardinality(public.unpaid_leads_for_codes(array[p.code])),
           p.created_at, p.updated_at
    from public.promo_codes p
    order by public.effective_state(p) <> 'active', p.created_at desc, p.id;
end;
$$;

revoke execute on function public.list_promo_codes() from public, anon;
grant execute on function public.list_promo_codes() to authenticated;
