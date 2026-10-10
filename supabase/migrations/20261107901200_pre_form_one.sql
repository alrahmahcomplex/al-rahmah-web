-- The Pre-Form One programme and its fee (slice 9, #114).
--
-- Staff tick the programme on a FORM 1 lead when the family takes it up
-- (`leads.edit`). The tick lives on the lead fee profile, which #106 created
-- with it. If a correction later moves the lead off FORM 1, the tick stays
-- recorded but no longer applies, and new Pre-Form One fee payments are
-- refused until the class is FORM 1 again. Slice 9 never rewrites slice 2's
-- class change.
--
-- The programme's fee is the Fee schedule's Pre-Form One fee for the lead's
-- Day or boarding. No discount applies to it. It is paid with
-- `pre_form_one_fee` payments, which count toward neither Total paid, Seat
-- priority nor Enrolled: lead_fee_crossings already leaves them out, and
-- #110's function and trigger already refuse an adjustment that moves a
-- payment between a school-fee type and `pre_form_one_fee`.
--
--   - lead_pre_form_one(lead_id): the tick, whether it applies, the fee, and
--     what has been paid toward it.
--   - set_pre_form_one(lead_id, ticked).
--   - check_school_fee_payment now takes `pre_form_one_fee` while the tick
--     applies.
--   - preview_school_fee_payment previews a Pre-Form One fee payment against
--     the programme fee, leaving Total paid and the Seat priority as they are.
--   - lead_school_fee also returns the Pre-Form One fee, paid and balance.
--
-- Refusal codes for set_pre_form_one: `not_permitted`, `not_found`,
-- `lead_closed` (from assert_lead_open), `invalid` (no choice given) and
-- `not_form_one`. Recording adds `not_pre_form_one`.

-- ---------------------------------------------------------------------------
-- lead_pre_form_one(lead_id): the Pre-Form One tick, whether the lead's class
-- is FORM 1 (`offered`), whether the tick applies (ticked on a FORM 1 lead),
-- the programme fee for its Day or boarding (null while its year has no Fee
-- schedule), and the sum of its effective Pre-Form One fee payments. No
-- permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create function public.lead_pre_form_one(
    lead_id uuid,
    out ticked boolean,
    out offered boolean,
    out applies boolean,
    out fee integer,
    out paid bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
    lead public.leads;
begin
    select * into lead from public.leads l where l.id = lead_pre_form_one.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    ticked := coalesce((
        select p.pre_form_one from public.lead_fee_profiles p where p.lead_id = lead.id
    ), false);
    offered := lead.class_name = 'FORM 1';
    applies := ticked and offered;

    select case lead.day_or_boarding when 'Day' then s.pre_form_one_day_fee else s.pre_form_one_boarding_fee end
    into fee
    from public.fee_schedules s
    where s.enrollment_year = lead.enrollment_year;

    select coalesce(sum(e.amount), 0) into paid
    from public.effective_school_fee_payments(lead.id) e
    where e.payment_type = 'pre_form_one_fee';
end;
$$;

revoke execute on function public.lead_pre_form_one(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_pre_form_one(lead_id, ticked): ticks or clears the Pre-Form One
-- programme on an open lead. Needs leads.edit. Ticking needs a FORM 1 lead;
-- clearing is allowed on any class, so a tick that no longer applies can be
-- taken off. The same choice again changes nothing. The programme fee never
-- touches the School fee, so nothing is recomputed.
-- ---------------------------------------------------------------------------

create function public.set_pre_form_one(lead_id uuid, ticked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead_class public.lead_class;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;
    if set_pre_form_one.ticked is null then
        raise exception 'invalid';
    end if;

    -- Locked, so a class correction or a Pre-Form One payment on the same
    -- lead takes its turn.
    select l.class_name into lead_class from public.leads l where l.id = set_pre_form_one.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(set_pre_form_one.lead_id);

    if set_pre_form_one.ticked and lead_class <> 'FORM 1' then
        raise exception 'not_form_one';
    end if;

    if coalesce((
        select p.pre_form_one from public.lead_fee_profiles p where p.lead_id = set_pre_form_one.lead_id
    ), false) = set_pre_form_one.ticked then
        return;
    end if;

    insert into public.lead_fee_profiles as p (lead_id, pre_form_one)
    values (set_pre_form_one.lead_id, set_pre_form_one.ticked)
    on conflict on constraint lead_fee_profiles_lead_id_key do update
    set pre_form_one = excluded.pre_form_one;
end;
$$;

revoke execute on function public.set_pre_form_one(uuid, boolean) from public, anon;
grant execute on function public.set_pre_form_one(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- check_school_fee_payment, as 20261104901000_reopening_fees.sql made it, now
-- taking `pre_form_one_fee` while the lead's Pre-Form One tick applies. Every
-- other rule is unchanged, and the preview and the recording both still call
-- it.
-- ---------------------------------------------------------------------------

create or replace function public.check_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
    current_result public.interview_result;
    lead_year integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    select l.enrollment_year into lead_year from public.leads l where l.id = check_school_fee_payment.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(check_school_fee_payment.lead_id);

    select i.result into current_result
    from public.interviews i
    where i.lead = check_school_fee_payment.lead_id
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    if current_result is distinct from 'Passed'
       and not public.reopened_to_enrol(check_school_fee_payment.lead_id) then
        raise exception 'not_passed';
    end if;

    if not exists (select 1 from public.fee_schedules s where s.enrollment_year = lead_year) then
        raise exception 'no_schedule';
    end if;

    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment', 'fee_waived',
        'pre_form_one_fee'
    ) then
        raise exception 'invalid_type';
    end if;

    if payment_type = 'pre_form_one_fee'
       and not (select p.applies from public.lead_pre_form_one(check_school_fee_payment.lead_id) p) then
        raise exception 'not_pre_form_one';
    end if;

    if payment_type = 'fee_waived' then
        if not exists (
            select 1 from public.discount_requests r
            where r.lead_id = check_school_fee_payment.lead_id and r.kind = 'qualified_orphan' and r.state = 'granted'
        ) then
            raise exception 'not_waivable';
        end if;
        if amount is not null then
            raise exception 'amount_not_allowed';
        end if;
        if exists (
            select 1 from public.effective_school_fee_payments(check_school_fee_payment.lead_id) e
            where e.payment_type = 'fee_waived'
        ) then
            raise exception 'already_waived';
        end if;
    else
        if amount is null or amount <= 0 then
            raise exception 'amount_not_positive';
        end if;
        if amount <> trunc(amount) then
            raise exception 'amount_not_whole';
        end if;
        if amount > 2147483647 then
            raise exception 'amount_too_large';
        end if;
    end if;

    if paid_on is null then
        raise exception 'date_missing';
    end if;
    if paid_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
end;
$$;

revoke execute on function public.check_school_fee_payment(uuid, text, numeric, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- preview_school_fee_payment, as 20261026900600_seats.sql made it. A
-- Pre-Form One fee payment now leaves Total paid, the balance and the Seat
-- priority as they are and never overfills a class. Every preview also
-- answers the Pre-Form One fee, what is paid toward it now and after, and
-- the balance after.
-- ---------------------------------------------------------------------------

create or replace function public.preview_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.leads;
    now_seat record;
    after_seat record;
    occupancy record;
    programme record;
    for_programme boolean := preview_school_fee_payment.payment_type = 'pre_form_one_fee';
    programme_paid_after bigint;
begin
    perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

    select * into target from public.leads l where l.id = preview_school_fee_payment.lead_id;
    select * into now_seat from public.lead_seat_priority(preview_school_fee_payment.lead_id);
    if for_programme then
        after_seat := now_seat;
    else
        select * into after_seat
        from public.lead_seat_priority(preview_school_fee_payment.lead_id, amount::integer, paid_on);
    end if;
    select * into occupancy
    from public.class_seat_occupancy(target.enrollment_year, target.class_name, target.day_or_boarding, target.id);
    select * into programme from public.lead_pre_form_one(preview_school_fee_payment.lead_id);
    programme_paid_after := programme.paid + case when for_programme then amount::bigint else 0 end;

    return jsonb_build_object(
        'school_fee', after_seat.school_fee,
        'total_paid', now_seat.total_paid,
        'total_paid_after', after_seat.total_paid,
        'balance_after', after_seat.school_fee - after_seat.total_paid,
        'priority', now_seat.priority,
        'priority_after', after_seat.priority,
        'priority_reached_on_after', after_seat.reached_on,
        'seats', occupancy.seats,
        'seats_taken', occupancy.taken,
        'would_overfill', now_seat.priority is null
            and after_seat.priority is not null
            and occupancy.seats is not null
            and occupancy.taken >= occupancy.seats,
        'pre_form_one_fee', programme.fee,
        'pre_form_one_paid', programme.paid,
        'pre_form_one_paid_after', programme_paid_after,
        'pre_form_one_balance_after', programme.fee - programme_paid_after
    );
end;
$$;

revoke execute on function public.preview_school_fee_payment(uuid, text, numeric, date) from public, anon;
grant execute on function public.preview_school_fee_payment(uuid, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_school_fee, as 20261103900900_discount_requests.sql made it, now also
-- returning the Pre-Form One programme: the tick, whether the class is FORM
-- 1, whether the tick applies, the fee (no discount), what has been paid
-- toward it and the balance. The tick and the payments show even while the
-- year has no Fee schedule. Its result changes, so it is dropped and made
-- again with the same grants.
-- ---------------------------------------------------------------------------

drop function public.lead_school_fee(uuid);

create function public.lead_school_fee(
    lead_id uuid,
    out enrollment_year integer,
    out band public.fee_band,
    out day_or_boarding public.day_or_boarding,
    out has_schedule boolean,
    out school_fee integer,
    out total_paid bigint,
    out balance bigint,
    out first_amount integer,
    out first_due date,
    out second_amount integer,
    out second_due date,
    out third_amount integer,
    out third_due date,
    out priority public.seat_priority,
    out priority_reached_on date,
    out enrolled_trigger text,
    out enrolled_on date,
    out enrolled_payment_type public.school_fee_payment_type,
    out enrolled_payment_amount integer,
    out band_fee integer,
    out discount text,
    out discount_percent integer,
    out pre_form_one boolean,
    out pre_form_one_offered boolean,
    out pre_form_one_applies boolean,
    out pre_form_one_fee integer,
    out pre_form_one_paid bigint,
    out pre_form_one_balance bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    fee record;
    seat record;
    programme record;
    profile public.lead_fee_profiles;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;

    select * into fee from public.lead_fee_amounts(lead_school_fee.lead_id);

    enrollment_year := fee.enrollment_year;
    band := fee.band;
    day_or_boarding := fee.day_or_boarding;
    has_schedule := fee.has_schedule;
    discount := fee.discount;
    discount_percent := fee.discount_percent;

    select * into programme from public.lead_pre_form_one(lead_school_fee.lead_id);
    pre_form_one := programme.ticked;
    pre_form_one_offered := programme.offered;
    pre_form_one_applies := programme.applies;
    pre_form_one_fee := programme.fee;
    pre_form_one_paid := programme.paid;
    pre_form_one_balance := programme.fee - programme.paid;

    if not has_schedule then
        return;
    end if;

    select * into seat from public.lead_seat_priority(lead_school_fee.lead_id);

    band_fee := fee.band_fee;
    school_fee := fee.school_fee;
    total_paid := seat.total_paid;
    balance := school_fee - total_paid;
    first_amount := fee.first_amount;
    first_due := fee.first_due;
    second_amount := fee.second_amount;
    second_due := fee.second_due;
    third_amount := fee.third_amount;
    third_due := fee.third_due;
    priority := seat.priority;
    priority_reached_on := seat.reached_on;

    -- The trigger is set while recompute_lead_fee has the lead Enrolled. A
    -- lead declined while Enrolled keeps its profile, since nothing changes a
    -- Declined lead, but it is no longer Enrolled, so it says nothing.
    if not exists (
        select 1 from public.leads l where l.id = lead_school_fee.lead_id and l.status = 'Enrolled'
    ) then
        return;
    end if;
    select * into profile from public.lead_fee_profiles p where p.lead_id = lead_school_fee.lead_id;
    enrolled_trigger := profile.enrolled_trigger;
    enrolled_on := profile.enrolled_on;
    if profile.enrolled_trigger_payment_id is not null then
        select e.payment_type, e.amount into enrolled_payment_type, enrolled_payment_amount
        from public.effective_school_fee_payments(lead_school_fee.lead_id) e
        where e.payment_id = profile.enrolled_trigger_payment_id;
    end if;
end;
$$;

revoke execute on function public.lead_school_fee(uuid) from public, anon;
grant execute on function public.lead_school_fee(uuid) to authenticated;
