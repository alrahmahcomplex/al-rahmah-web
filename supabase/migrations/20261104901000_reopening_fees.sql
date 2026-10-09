-- Where slice 9 meets slice 8's reopening (#115).
--
--   - A lead reopened with Enrol without a retaken interview takes school-fee
--     payments without a Passed interview: the payment precondition also
--     passes when the lead's latest approved Reopening request has
--     `enrol_without_retake` true.
--   - When an approval restores a lead that was Declined, its status leaves
--     Declined, and the after-update trigger on leads recomputes it with the
--     cause `reopening`. A lead declined while Enrolled comes back as
--     Interviewed, so this works Enrolled out again from its payments, and
--     the lead fee profile records the reopening as the cause. Approval
--     itself calls nothing in slice 9.
--
-- The Seats screen's Decline: No seat available link is app code only;
-- decline_lead already limits that reason to academic_years.manage.

-- ---------------------------------------------------------------------------
-- reopened_to_enrol(lead_id): whether the lead's latest approved Reopening
-- request chose Enrol without a retaken interview. A later approval that
-- chose a retake, or one for a lead that was never declined (no choice),
-- replaces an earlier Enrol without a retaken interview.
-- ---------------------------------------------------------------------------

create function public.reopened_to_enrol(lead_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce((
        select r.enrol_without_retake
        from public.reopening_requests r
        where r.lead_id = reopened_to_enrol.lead_id and r.state = 'approved'
        order by r.decided_at desc, r.id desc
        limit 1
    ), false);
$$;

revoke execute on function public.reopened_to_enrol(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_school_fee_payment, as 20261103900900_discount_requests.sql made it,
-- now passing a lead whose current interview isn't Passed when its latest
-- approved Reopening request has `enrol_without_retake` true. Every other
-- rule is unchanged, and the preview and the recording both still call it.
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

    -- The Pre-Form One fee comes with its own ticket (#114).
    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment', 'fee_waived'
    ) then
        raise exception 'invalid_type';
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
-- recompute_lead_fee, as 20261025900500_enrol_from_payments.sql made it, now
-- also writing the lead fee profile when only its cause would change, if the
-- status is about to move. Everything else is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_lead_fee(lead_id uuid, cause text, as_of date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    profile public.lead_fee_profiles;
    lines record;
    start_on date;
    on_date date := coalesce(as_of, public.tanzania_today());
    from_start date;
    qualifies boolean := false;
    trigger_kind text;
    trigger_payment uuid;
    trigger_on date;
    before_enrolled public.lead_status;
    next_status public.lead_status;
    earlier_override text;
begin
    if cause is null or cause not in (
        'payment', 'payment_adjustment', 'discount', 'fee_schedule',
        'lead_details', 'family', 'academic_year_start', 'reopening'
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'cause')::text;
    end if;

    -- Locked, so two recomputes of one lead take turns and the second sees
    -- what the first wrote.
    select * into target from public.leads l where l.id = recompute_lead_fee.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- A Declined lead keeps its payments and its status.
    if target.status = 'Declined' then
        return;
    end if;

    select * into profile from public.lead_fee_profiles p where p.lead_id = target.id;
    select * into lines from public.lead_fee_crossings(target.id);

    if lines.has_schedule and lines.payments > 0 then
        select s.academic_year_start into start_on
        from public.fee_schedules s
        where s.enrollment_year = target.enrollment_year;

        if lines.first_on is not null and start_on is not null and greatest(lines.first_on, start_on) <= on_date then
            from_start := greatest(lines.first_on, start_on);
        end if;

        if lines.full_on is not null and (from_start is null or lines.full_on <= from_start) then
            qualifies := true;
            trigger_kind := 'payment';
            trigger_payment := lines.full_payment_id;
            trigger_on := lines.full_on;
        elsif from_start is not null then
            qualifies := true;
            if start_on > lines.first_on then
                trigger_kind := 'academic_year_start';
                trigger_on := start_on;
            else
                trigger_kind := 'payment';
                trigger_payment := lines.first_payment_id;
                trigger_on := lines.first_on;
            end if;
        end if;
    end if;

    if qualifies then
        next_status := 'Enrolled';
        before_enrolled := case when target.status = 'Enrolled' then profile.status_before_enrolled else target.status end;
    elsif target.status = 'Enrolled' and profile.enrolled_trigger is not null then
        -- Interviewed when the earlier status was never kept: the status a
        -- lead holds once it may pay.
        next_status := coalesce(profile.status_before_enrolled, 'Interviewed');
    else
        next_status := target.status;
    end if;

    -- Also written, for its cause alone, when the status is about to move
    -- and the profile's cause is another one: a lead declined while Enrolled
    -- keeps its profile, and when a reopening enrols it again the history
    -- must say the reopening did it, not the payment that first did.
    if (profile.id is null and (before_enrolled is not null or trigger_kind is not null))
       or (profile.id is not null and (
           profile.status_before_enrolled,
           profile.enrolled_trigger,
           profile.enrolled_trigger_payment_id,
           profile.enrolled_on
       ) is distinct from (before_enrolled, trigger_kind, trigger_payment, trigger_on))
       or (profile.id is not null
           and next_status <> target.status
           and profile.recompute_cause is distinct from recompute_lead_fee.cause) then
        insert into public.lead_fee_profiles as p (
            lead_id, status_before_enrolled, enrolled_trigger, enrolled_trigger_payment_id, enrolled_on, recompute_cause
        ) values (
            target.id, before_enrolled, trigger_kind, trigger_payment, trigger_on, recompute_lead_fee.cause
        )
        on conflict on constraint lead_fee_profiles_lead_id_key do update
        set status_before_enrolled = excluded.status_before_enrolled,
            enrolled_trigger = excluded.enrolled_trigger,
            enrolled_trigger_payment_id = excluded.enrolled_trigger_payment_id,
            enrolled_on = excluded.enrolled_on,
            recompute_cause = excluded.recompute_cause;
    end if;

    if next_status <> target.status then
        -- Slice 8's override lets this one update through on an Inactive or
        -- Archived lead; the caller's own override comes back after it.
        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('payment_recompute');
        update public.leads l set status = next_status where l.id = target.id;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end if;
end;
$$;

revoke execute on function public.recompute_lead_fee(uuid, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The after-update trigger on leads, as 20261025900500_enrol_from_payments.sql
-- made it, now also firing when the status leaves Declined. That happens only
-- when slice 8's approval restores a reopened lead, so the recompute names the
-- cause `reopening`; a correction to the class, year or Day or boarding stays
-- `lead_details`. One trigger, so a lead is recomputed once per update.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_lead_fee_on_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.recompute_lead_fee(
        new.id,
        case when old.status = 'Declined' and new.status <> 'Declined' then 'reopening' else 'lead_details' end
    );
    return null;
end;
$$;

revoke execute on function public.recompute_lead_fee_on_lead_change() from public, anon, authenticated, service_role;

drop trigger recompute_lead_fee_on_lead_change on public.leads;

create trigger recompute_lead_fee_on_lead_change
    after update of class_name, enrollment_year, day_or_boarding, status on public.leads
    for each row
    when (
        old.class_name is distinct from new.class_name
        or old.enrollment_year is distinct from new.enrollment_year
        or old.day_or_boarding is distinct from new.day_or_boarding
        or (old.status = 'Declined' and new.status <> 'Declined')
    )
    execute function public.recompute_lead_fee_on_lead_change();
