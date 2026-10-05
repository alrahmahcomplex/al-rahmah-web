-- Enrol a lead from its payments (slice 9, #108).
--
-- A lead becomes Enrolled from its payments, and nobody sets Enrolled by
-- hand. recompute_lead_fee(lead_id, cause) is the one function that moves a
-- lead into and out of Enrolled. It derives the Seat priority from the
-- effective payments and the School fee, and from it Enrolled:
--
--   - at once when the priority is Full;
--   - from the Academic-year start when it is First instalment (#109 adds
--     the daily job that reaches leads nobody recomputes on that day);
--   - never on Deposit, and never with no payment.
--
-- It runs in the same transaction as each change that can move the line:
-- recording a payment (one lead), saving a Fee schedule's amounts (every
-- lead in that year with a payment), a change to the year's Academic-year
-- start (a trigger on fee_schedules), and a correction to the lead's class,
-- enrollment year or Day or boarding (a trigger on leads). Later slice 9
-- tickets call it for adjustments, discounts, the Family and reopenings.
--
-- A Declined lead is never changed: it keeps its payments and its status. A
-- closure mark is never touched; an Inactive or Archived lead's status moves
-- through slice 8's `payment_recompute` lifecycle override.
--
-- Refusal codes: `invalid` (an unknown cause), `not_found`, and
-- `enrolled_from_payments` when anything else tries to set Enrolled.

-- ---------------------------------------------------------------------------
-- The cause of the latest recompute that changed the lead's Enrolled state,
-- written with it, so the lead history can say why a lead became Enrolled or
-- stopped being Enrolled. The list covers every cause #29 names, so later
-- tickets call recompute_lead_fee without changing this table.
-- ---------------------------------------------------------------------------

alter table public.lead_fee_profiles
    add column recompute_cause text check (recompute_cause in (
        'payment',
        'payment_adjustment',
        'discount',
        'fee_schedule',
        'lead_details',
        'family',
        'academic_year_start',
        'reopening'
    ));

-- ---------------------------------------------------------------------------
-- lead_fee_crossings: where a lead's payments cross each Seat priority line,
-- from the effective payments and the School fee. The one place the running
-- total is taken, so the Seat priority, its date and the payment that
-- enrolled a lead always agree. No permission check, so no API role may call
-- it.
--
-- `with_amount` and `with_paid_on` add one more school-fee payment that isn't
-- recorded, for the preview before recording; it has no payment id.
--
-- Payments are taken in effective payment-date order, then by when they were
-- recorded. A line is crossed by the first payment whose running total
-- reaches it:
--
--   Full:             the School fee.
--   First instalment: total × 100 ≥ School fee × the first share.
--   Deposit:          the minimum Initial deposit.
--
-- Pre-Form One payments never count. A lead whose year has no schedule
-- crosses no line.
-- ---------------------------------------------------------------------------

create function public.lead_fee_crossings(
    lead_id uuid,
    with_amount integer default null,
    with_paid_on date default null,
    out has_schedule boolean,
    out school_fee integer,
    out total_paid bigint,
    out payments integer,
    out full_on date,
    out full_payment_id uuid,
    out first_on date,
    out first_payment_id uuid,
    out deposit_on date
)
language plpgsql
stable
set search_path = ''
as $$
declare
    fee record;
    schedule public.fee_schedules;
begin
    select * into fee from public.lead_fee_amounts(lead_fee_crossings.lead_id);
    has_schedule := fee.has_schedule;
    school_fee := fee.school_fee;

    select * into schedule from public.fee_schedules s where s.enrollment_year = fee.enrollment_year;

    with counted as (
        select e.payment_id, e.amount::bigint as amount, e.paid_on, e.recorded_at, e.payment_id::text as tiebreak
        from public.effective_school_fee_payments(lead_fee_crossings.lead_id) e
        where e.payment_type <> 'pre_form_one_fee'
        union all
        select null::uuid, with_amount, with_paid_on, now(), 'unrecorded'
        where with_amount is not null
    ),
    running as (
        select c.payment_id, c.paid_on, c.recorded_at, c.tiebreak,
               sum(coalesce(c.amount, 0)) over (order by c.paid_on, c.recorded_at, c.tiebreak rows unbounded preceding) as total
        from counted c
    ),
    crossings as (
        select r.*,
               r.total >= school_fee as full_line,
               r.total * 100 >= school_fee::bigint * schedule.first_share as first_line,
               r.total >= schedule.minimum_deposit as deposit_line
        from running r
    )
    select count(*)::integer,
           coalesce(max(x.total), 0),
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.full_line))[1],
           (array_agg(x.payment_id order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.full_line))[1],
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.first_line))[1],
           (array_agg(x.payment_id order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.first_line))[1],
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.deposit_line))[1]
    into payments, total_paid, full_on, full_payment_id, first_on, first_payment_id, deposit_on
    from crossings x;

    if not has_schedule then
        full_on := null;
        full_payment_id := null;
        first_on := null;
        first_payment_id := null;
        deposit_on := null;
    end if;
end;
$$;

revoke execute on function public.lead_fee_crossings(uuid, integer, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_seat_priority, as #107 made it, now reading its lines from
-- lead_fee_crossings. Same signature and answers.
-- ---------------------------------------------------------------------------

create or replace function public.lead_seat_priority(
    lead_id uuid,
    with_amount integer default null,
    with_paid_on date default null,
    out school_fee integer,
    out total_paid bigint,
    out priority public.seat_priority,
    out reached_on date
)
language plpgsql
stable
set search_path = ''
as $$
declare
    lines record;
begin
    select * into lines from public.lead_fee_crossings(lead_seat_priority.lead_id, with_amount, with_paid_on);
    school_fee := lines.school_fee;
    total_paid := lines.total_paid;

    if not lines.has_schedule or lines.payments = 0 then
        return;
    end if;

    if lines.full_on is not null then
        priority := 'Full';
        reached_on := lines.full_on;
    elsif lines.first_on is not null then
        priority := 'First instalment';
        reached_on := lines.first_on;
    elsif lines.deposit_on is not null then
        priority := 'Deposit';
        reached_on := lines.deposit_on;
    end if;
end;
$$;

revoke execute on function public.lead_seat_priority(uuid, integer, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- recompute_lead_fee(lead_id, cause, as_of): moves the lead into or out of
-- Enrolled to match its payments as of `as_of`, today in Tanzania unless a
-- caller gives a date (#109's Academic-year start job does).
--
-- Enrolled holds when the lead has an effective payment and either its
-- priority is Full, or it reached First instalment and the Academic-year
-- start is on or before `as_of`. The Enrolled date is a calendar date: the
-- earlier of the date Full was reached, and the later of the date First
-- instalment was reached and the start. The trigger is the payment whose
-- running total crossed that line, or `academic_year_start` when the start
-- is the later date.
--
-- When a lead newly qualifies, its status is kept in status_before_enrolled
-- and it becomes Enrolled; when an Enrolled lead stops qualifying, that
-- status comes back. While it stays Enrolled the trigger and date are
-- re-derived, so a correction moves them. The profile is written only when
-- something in it changes, together with the cause, so the history shows
-- each change beside why it happened.
--
-- A lead set to Enrolled outside this function (only the database owner can)
-- has no trigger, so it is left as it is until it qualifies.
--
-- Runs as its owner, so slice 8's lifecycle override counts; granted to no
-- API role.
-- ---------------------------------------------------------------------------

create function public.recompute_lead_fee(lead_id uuid, cause text, as_of date default null)
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

    if (profile.id is null and (before_enrolled is not null or trigger_kind is not null))
       or (profile.id is not null and (
           profile.status_before_enrolled,
           profile.enrolled_trigger,
           profile.enrolled_trigger_payment_id,
           profile.enrolled_on
       ) is distinct from (before_enrolled, trigger_kind, trigger_payment, trigger_on)) then
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
-- Nothing but recompute_lead_fee sets Enrolled. A write made for a signed-in
-- session or an API key (every slice 2 function) that would move a lead into
-- Enrolled is refused, unless recompute_lead_fee set the override. The
-- database owner's own SQL (migrations, the seeds, the SQL editor) carries no
-- API role and is let through, like every other owner write.
-- ---------------------------------------------------------------------------

create function public.refuse_enrolled_by_hand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.status = 'Enrolled'
       and (tg_op = 'INSERT' or old.status is distinct from 'Enrolled')
       and auth.role() is not null
       and not (
           current_user not in ('authenticated', 'anon')
           and coalesce(current_setting('app.lead_lifecycle_override', true), '') = 'payment_recompute'
       ) then
        raise exception 'enrolled_from_payments';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_enrolled_by_hand() from public, anon, authenticated;

create trigger refuse_enrolled_by_hand
    before insert or update of status on public.leads
    for each row
    execute function public.refuse_enrolled_by_hand();

-- ---------------------------------------------------------------------------
-- A correction to the lead's class, enrollment year or Day or boarding
-- changes its School fee, so it recomputes the lead.
-- ---------------------------------------------------------------------------

create function public.recompute_lead_fee_on_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.recompute_lead_fee(new.id, 'lead_details');
    return null;
end;
$$;

revoke execute on function public.recompute_lead_fee_on_lead_change() from public, anon, authenticated, service_role;

create trigger recompute_lead_fee_on_lead_change
    after update of class_name, enrollment_year, day_or_boarding on public.leads
    for each row
    when (
        old.class_name is distinct from new.class_name
        or old.enrollment_year is distinct from new.enrollment_year
        or old.day_or_boarding is distinct from new.day_or_boarding
    )
    execute function public.recompute_lead_fee_on_lead_change();

-- ---------------------------------------------------------------------------
-- recompute_year_fees(year, cause): recomputes every lead in the year that
-- has a payment. A lead with no payment can't be Enrolled, so the others are
-- left alone; Declined leads return at once. Leads are taken in id order, so
-- two runs lock them in the same order. For slice 9's own functions only.
-- ---------------------------------------------------------------------------

create function public.recompute_year_fees(schedule_year integer, cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
begin
    for each_lead in
        select l.id
        from public.leads l
        where l.enrollment_year = schedule_year
          and l.status <> 'Declined'
          and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id)
        order by l.id
    loop
        perform public.recompute_lead_fee(each_lead, recompute_year_fees.cause);
    end loop;
end;
$$;

revoke execute on function public.recompute_year_fees(integer, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A change to a year's Academic-year start moves the line for its First
-- instalment leads, either way: a start brought forward to today or earlier
-- enrols them, and a start moved later takes back those it enrolled. The
-- daily job that reaches leads on the start day itself is #109's.
-- ---------------------------------------------------------------------------

create function public.recompute_on_academic_year_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.recompute_year_fees(new.enrollment_year, 'academic_year_start');
    return null;
end;
$$;

revoke execute on function public.recompute_on_academic_year_start() from public, anon, authenticated, service_role;

create trigger recompute_on_academic_year_start
    after update of academic_year_start on public.fee_schedules
    for each row
    when (old.academic_year_start is distinct from new.academic_year_start)
    execute function public.recompute_on_academic_year_start();

-- ---------------------------------------------------------------------------
-- record_school_fee_payment, as #107 made it, now recomputing the lead in
-- the same transaction, so a payment that reaches Full enrols it.
-- ---------------------------------------------------------------------------

create or replace function public.record_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date,
    request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid;
    new_id uuid;
    seat record;
    earlier public.school_fee_payments;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;
    if record_school_fee_payment.request_id is null then
        raise exception 'request_missing';
    end if;
    perform 1 from public.leads l where l.id = record_school_fee_payment.lead_id for update;

    -- A retry of a payment already recorded: hand back that payment instead
    -- of recording it again. The lead's row lock above makes two retries
    -- take turns, so the second sees the first. The same id with a different
    -- payment is a caller's mistake, refused rather than guessed at.
    select * into earlier from public.school_fee_payments p
    where p.request_id = record_school_fee_payment.request_id;
    if found then
        if earlier.lead_id <> record_school_fee_payment.lead_id
            or earlier.payment_type::text <> record_school_fee_payment.payment_type
            or earlier.amount is distinct from record_school_fee_payment.amount
            or earlier.paid_on <> record_school_fee_payment.paid_on
        then
            raise exception 'request_reused';
        end if;
        select * into seat from public.lead_seat_priority(record_school_fee_payment.lead_id);
        return jsonb_build_object(
            'payment_id', earlier.id,
            'total_paid', seat.total_paid,
            'priority', seat.priority
        );
    end if;

    perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by, request_id)
    values (
        record_school_fee_payment.lead_id,
        record_school_fee_payment.payment_type::public.school_fee_payment_type,
        record_school_fee_payment.amount::integer,
        record_school_fee_payment.paid_on,
        staff_id,
        record_school_fee_payment.request_id
    )
    returning id into new_id;

    perform public.recompute_lead_fee(record_school_fee_payment.lead_id, 'payment');

    select * into seat from public.lead_seat_priority(record_school_fee_payment.lead_id);

    return jsonb_build_object(
        'payment_id', new_id,
        'total_paid', seat.total_paid,
        'priority', seat.priority
    );
end;
$$;

revoke execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) from public, anon;
grant execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- save_fee_schedule, as #104 made it, now recomputing every lead in the year
-- that has a payment, in the same transaction.
-- ---------------------------------------------------------------------------

create or replace function public.save_fee_schedule(schedule_year integer, amounts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- Above this, an amount no longer fits the columns.
    most constant numeric := 2147483647;
    shares integer[];
    dues date[];
    deposit integer;
    pre_form_one_day integer;
    pre_form_one_boarding integer;
    each_band public.fee_band;
    band_input jsonb;
    day_fees integer[] := '{}';
    boarding_fees integer[] := '{}';
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    if schedule_year is null or schedule_year not between 2000 and 2999 then
        perform public.fee_input_invalid('enrollment_year');
    end if;
    if amounts is null or jsonb_typeof(amounts) <> 'object' then
        perform public.fee_input_invalid('amounts');
    end if;

    -- Checked in the order the screen shows them, so the first refusal named
    -- is the first one the Accountant reaches.
    foreach each_band in array enum_range(null::public.fee_band) loop
        band_input := amounts -> 'bands' -> each_band::text;
        day_fees := day_fees || public.fee_input_whole(band_input -> 'day_fee', each_band || '.day_fee', 1, most);
        boarding_fees := boarding_fees
            || public.fee_input_whole(band_input -> 'boarding_fee', each_band || '.boarding_fee', 1, most);
    end loop;

    shares := array[
        public.fee_input_whole(amounts -> 'first_share', 'first_share', 1, 98),
        public.fee_input_whole(amounts -> 'second_share', 'second_share', 1, 98),
        public.fee_input_whole(amounts -> 'third_share', 'third_share', 1, 98)
    ];
    if shares[1] + shares[2] + shares[3] <> 100 then
        perform public.fee_input_invalid('split');
    end if;

    dues := array[
        public.fee_input_date(amounts -> 'first_due', 'first_due'),
        public.fee_input_date(amounts -> 'second_due', 'second_due'),
        public.fee_input_date(amounts -> 'third_due', 'third_due')
    ];
    if dues[2] < dues[1] then
        perform public.fee_input_invalid('second_due');
    end if;
    if dues[3] < dues[2] then
        perform public.fee_input_invalid('third_due');
    end if;

    deposit := public.fee_input_whole(amounts -> 'minimum_deposit', 'minimum_deposit', 1, most);
    pre_form_one_day := public.fee_input_whole(amounts -> 'pre_form_one_day_fee', 'pre_form_one_day_fee', 1, most);
    pre_form_one_boarding :=
        public.fee_input_whole(amounts -> 'pre_form_one_boarding_fee', 'pre_form_one_boarding_fee', 1, most);

    insert into public.fee_schedules as s (
        enrollment_year, first_share, second_share, third_share, first_due, second_due, third_due,
        minimum_deposit, pre_form_one_day_fee, pre_form_one_boarding_fee
    ) values (
        schedule_year, shares[1], shares[2], shares[3], dues[1], dues[2], dues[3],
        deposit, pre_form_one_day, pre_form_one_boarding
    )
    on conflict (enrollment_year) do update
    set first_share = excluded.first_share,
        second_share = excluded.second_share,
        third_share = excluded.third_share,
        first_due = excluded.first_due,
        second_due = excluded.second_due,
        third_due = excluded.third_due,
        minimum_deposit = excluded.minimum_deposit,
        pre_form_one_day_fee = excluded.pre_form_one_day_fee,
        pre_form_one_boarding_fee = excluded.pre_form_one_boarding_fee;

    insert into public.fee_band_amounts as a (enrollment_year, band, day_fee, boarding_fee)
    select schedule_year, b.band, b.day_fee, b.boarding_fee
    from unnest(enum_range(null::public.fee_band), day_fees, boarding_fees) as b (band, day_fee, boarding_fee)
    on conflict (enrollment_year, band) do update
    set day_fee = excluded.day_fee,
        boarding_fee = excluded.boarding_fee;

    perform public.recompute_year_fees(schedule_year, 'fee_schedule');
end;
$$;

revoke execute on function public.save_fee_schedule(integer, jsonb) from public, anon;
grant execute on function public.save_fee_schedule(integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_school_fee, as #107 made it, now also saying what enrolled the lead
-- and when: the payment, with its type and amount, or the Academic-year
-- start. Its result changes, so it is dropped and made again with the same
-- grants.
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
    out enrolled_payment_amount integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    fee record;
    seat record;
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
    if not has_schedule then
        return;
    end if;

    select * into seat from public.lead_seat_priority(lead_school_fee.lead_id);

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

-- ---------------------------------------------------------------------------
-- Leads already paid in Full before this migration become Enrolled now, as
-- the system. One block, so the audit actor holds for every write.
-- ---------------------------------------------------------------------------

do $$
declare
    each_lead uuid;
begin
    perform public.set_audit_actor('system');
    for each_lead in
        select l.id
        from public.leads l
        where l.status <> 'Declined'
          and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id)
        order by l.id
    loop
        perform public.recompute_lead_fee(each_lead, 'payment');
    end loop;
end;
$$;
