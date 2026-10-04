-- School-fee payments and Seat priority (slice 9, #107).
--
-- The Accountant records a payment against a lead whose current interview is
-- Passed. A payment is locked once recorded: nothing updates or deletes it,
-- not even the database owner. Corrections arrive with payment adjustments
-- (#108), which replace effective_school_fee_payments with `create or
-- replace` so every reader below follows them.
--
-- From the effective payments the database derives the lead's Seat priority
-- (Full, First instalment, Deposit, or none) and the date it was reached,
-- each time it is read. Enrolled is a later ticket: recording a payment
-- changes no lead.
--
-- Refusal codes: `not_permitted`, `forbidden` (reads), `not_found`,
-- `lead_closed` (from assert_lead_open), `not_passed`, `no_schedule`,
-- `invalid_type`, `amount_not_positive`, `amount_not_whole`,
-- `amount_too_large`, `date_missing`, `date_in_future`, and
-- `payment_locked` for any change to a recorded payment.

-- ---------------------------------------------------------------------------
-- The fixed lists. The payment types hold all seven #29 names; this ticket
-- records only the five school-fee types. Seat priorities sort lowest first,
-- so `max` and comparisons read naturally.
-- ---------------------------------------------------------------------------

create type public.school_fee_payment_type as enum (
    'full_payment',
    'initial_deposit',
    'first_instalment',
    'second_instalment',
    'third_instalment',
    'fee_waived',
    'pre_form_one_fee'
);

create type public.seat_priority as enum ('Deposit', 'First instalment', 'Full');

-- ---------------------------------------------------------------------------
-- School-fee payments. Never updated, never deleted.
-- ---------------------------------------------------------------------------

create table public.school_fee_payments (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    payment_type public.school_fee_payment_type not null,
    -- Whole TZS above zero; empty exactly for Fee waived.
    amount integer check (amount > 0),
    -- Not after today in Tanzania: guard_school_fee_payment checks it on
    -- insert, since a check constraint can't read the clock.
    paid_on date not null,
    recorded_by uuid not null references public.staff_members (id),
    recorded_at timestamptz not null default now(),
    -- The form's own id for one confirmed payment. A Confirm retried after a
    -- lost response sends the same id and gets the payment already recorded,
    -- so a retry never records it twice.
    request_id uuid unique,
    check ((payment_type = 'fee_waived') = (amount is null))
);

create index school_fee_payments_lead_idx on public.school_fee_payments (lead_id, paid_on);
create index school_fee_payments_recorded_by_idx on public.school_fee_payments (recorded_by);

-- The rules no caller may skip: a payment date is never later than today in
-- Tanzania, and a recorded payment never changes.
create function public.guard_school_fee_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' then
        raise exception 'payment_locked';
    end if;
    if new.paid_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
    return new;
end;
$$;

revoke execute on function public.guard_school_fee_payment() from public, anon, authenticated;

create trigger guard_school_fee_payment
    before insert or update on public.school_fee_payments
    for each row
    execute function public.guard_school_fee_payment();

-- Audit (ADR 4): the payment scope, on the lead's history.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.school_fee_payments', 'payment', 'lead_id');

create trigger audit_row_change
    after insert or update on public.school_fee_payments
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.school_fee_payments
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.school_fee_payments
    for each statement
    execute function public.refuse_delete();

alter table public.school_fee_payments enable row level security;

create policy "Staff who may view payments read school-fee payments"
    on public.school_fee_payments for select
    to authenticated
    using ((select public.has_permission('payments.view')));

revoke insert, update, delete, truncate on public.school_fee_payments from anon, authenticated, service_role;

-- The lead fee profile's Enrolled trigger names a payment (#106 left the
-- foreign key for this table).
alter table public.lead_fee_profiles
    add constraint lead_fee_profiles_enrolled_trigger_payment_id_fkey
    foreign key (enrolled_trigger_payment_id) references public.school_fee_payments (id);

create index lead_fee_profiles_enrolled_trigger_payment_idx
    on public.lead_fee_profiles (enrolled_trigger_payment_id)
    where enrolled_trigger_payment_id is not null;

-- ---------------------------------------------------------------------------
-- effective_school_fee_payments: a lead's payments as they count now, with
-- every type. Until adjustments exist (#108) a payment counts as recorded;
-- #108 replaces this with `create or replace`, keeping the columns, to apply
-- the latest adjustment and drop voided payments. No permission check, so no
-- API role may call it.
-- ---------------------------------------------------------------------------

create function public.effective_school_fee_payments(lead_id uuid)
returns table (
    payment_id uuid,
    payment_type public.school_fee_payment_type,
    amount integer,
    paid_on date,
    recorded_at timestamptz
)
language sql
stable
set search_path = ''
as $$
    select p.id, p.payment_type, p.amount, p.paid_on, p.recorded_at
    from public.school_fee_payments p
    where p.lead_id = effective_school_fee_payments.lead_id;
$$;

revoke execute on function public.effective_school_fee_payments(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_seat_priority: Total paid, the Seat priority and the date it was
-- reached, from the effective payments and the School fee. The seat-priority
-- reader for slice 9's own functions (Enrolled, seats, the dashboard); no
-- permission check, so no API role may call it.
--
-- `with_amount` and `with_paid_on` add one more school-fee payment that isn't
-- recorded, for the preview before recording.
--
--   Full:             at least one effective school-fee payment and Total
--                     paid at least the School fee.
--   First instalment: Total paid × 100 ≥ School fee × the first share.
--   Deposit:          Total paid at least the minimum Initial deposit.
--
-- The date a priority was reached is the payment date at which the running
-- total, in effective payment-date order, first crosses its line. Pre-Form
-- One payments never count. A lead whose year has no schedule has Total paid
-- but no priority.
-- ---------------------------------------------------------------------------

create function public.lead_seat_priority(
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
    fee record;
    schedule public.fee_schedules;
    payments integer;
    full_on date;
    first_on date;
    deposit_on date;
begin
    select * into fee from public.lead_fee_amounts(lead_seat_priority.lead_id);
    school_fee := fee.school_fee;

    select * into schedule from public.fee_schedules s where s.enrollment_year = fee.enrollment_year;

    with counted as (
        select e.amount::bigint as amount, e.paid_on, e.recorded_at, e.payment_id::text as tiebreak
        from public.effective_school_fee_payments(lead_seat_priority.lead_id) e
        where e.payment_type <> 'pre_form_one_fee'
        union all
        select with_amount, with_paid_on, now(), 'unrecorded'
        where with_amount is not null
    ),
    running as (
        select c.paid_on,
               sum(coalesce(c.amount, 0)) over (order by c.paid_on, c.recorded_at, c.tiebreak rows unbounded preceding) as total
        from counted c
    )
    select count(*)::integer,
           coalesce(max(r.total), 0),
           min(r.paid_on) filter (where r.total >= school_fee),
           min(r.paid_on) filter (where r.total * 100 >= school_fee::bigint * schedule.first_share),
           min(r.paid_on) filter (where r.total >= schedule.minimum_deposit)
    into payments, total_paid, full_on, first_on, deposit_on
    from running r;

    if not fee.has_schedule or payments = 0 then
        return;
    end if;

    if full_on is not null then
        priority := 'Full';
        reached_on := full_on;
    elsif first_on is not null then
        priority := 'First instalment';
        reached_on := first_on;
    elsif deposit_on is not null then
        priority := 'Deposit';
        reached_on := deposit_on;
    end if;
end;
$$;

revoke execute on function public.lead_seat_priority(uuid, integer, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_school_fee, as #106 made it, now with Total paid from the payments and
-- the Seat priority with the date it was reached. Its result changes, so it
-- is dropped and made again with the same grants.
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
    out priority_reached_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    fee record;
    seat record;
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
end;
$$;

revoke execute on function public.lead_school_fee(uuid) from public, anon;
grant execute on function public.lead_school_fee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- check_school_fee_payment: every rule a new payment must pass, in the order
-- the Accountant would fix them. Shared by the preview and the recording, so
-- the preview never promises what recording would refuse. No API role may
-- call it.
--
-- The lead's current interview is its newest registration (slice 5). A
-- reopened lead approved to enrol without a retaken interview arrives with
-- slice 8's approval, which extends this check.
-- ---------------------------------------------------------------------------

create function public.check_school_fee_payment(
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
    if current_result is distinct from 'Passed' then
        raise exception 'not_passed';
    end if;

    if not exists (select 1 from public.fee_schedules s where s.enrollment_year = lead_year) then
        raise exception 'no_schedule';
    end if;

    -- Fee waived and the Pre-Form One fee come with their own tickets.
    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment'
    ) then
        raise exception 'invalid_type';
    end if;

    if amount is null or amount <= 0 then
        raise exception 'amount_not_positive';
    end if;
    if amount <> trunc(amount) then
        raise exception 'amount_not_whole';
    end if;
    if amount > 2147483647 then
        raise exception 'amount_too_large';
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
-- preview_school_fee_payment: what recording this payment would do, without
-- recording it. Needs payments.record and refuses exactly what recording
-- refuses.
-- ---------------------------------------------------------------------------

create function public.preview_school_fee_payment(
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
    now_seat record;
    after_seat record;
begin
    perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

    select * into now_seat from public.lead_seat_priority(preview_school_fee_payment.lead_id);
    select * into after_seat
    from public.lead_seat_priority(preview_school_fee_payment.lead_id, amount::integer, paid_on);

    return jsonb_build_object(
        'school_fee', after_seat.school_fee,
        'total_paid', now_seat.total_paid,
        'total_paid_after', after_seat.total_paid,
        'balance_after', after_seat.school_fee - after_seat.total_paid,
        'priority', now_seat.priority,
        'priority_after', after_seat.priority,
        'priority_reached_on_after', after_seat.reached_on
    );
end;
$$;

revoke execute on function public.preview_school_fee_payment(uuid, text, numeric, date) from public, anon;
grant execute on function public.preview_school_fee_payment(uuid, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- record_school_fee_payment: records the payment under the signed-in
-- Accountant. Needs payments.record. The lead row is locked first, so two
-- payments on one lead are checked and counted one after the other. It adds
-- a payment and changes no lead.
-- ---------------------------------------------------------------------------

create function public.record_school_fee_payment(
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
-- lead_school_fee_payments: a lead's payments, newest payment date first,
-- each with who recorded it and when. Staff with payments.view may not read
-- other staff members' records, so the name is looked up here. Needs
-- leads.view and payments.view.
-- ---------------------------------------------------------------------------

create function public.lead_school_fee_payments(lead_id uuid)
returns table (
    id uuid,
    payment_type public.school_fee_payment_type,
    amount integer,
    paid_on date,
    recorded_at timestamptz,
    recorded_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;
    if not exists (select 1 from public.leads l where l.id = lead_school_fee_payments.lead_id) then
        raise exception 'not_found';
    end if;

    return query
    select p.id, p.payment_type, p.amount, p.paid_on, p.recorded_at, s.full_name
    from public.school_fee_payments p
    left join public.staff_members s on s.id = p.recorded_by
    where p.lead_id = lead_school_fee_payments.lead_id
    order by p.paid_on desc, p.recorded_at desc, p.id desc;
end;
$$;

revoke execute on function public.lead_school_fee_payments(uuid) from public, anon;
grant execute on function public.lead_school_fee_payments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_seat_priorities: the Seat priority of each given lead, for the lead
-- list's badges. Leads with none, or with no such lead, are left out. Needs
-- leads.view and payments.view; at most 200 leads at once.
-- ---------------------------------------------------------------------------

create function public.lead_seat_priorities(lead_ids uuid[])
returns table (lead_id uuid, priority public.seat_priority, reached_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;
    if cardinality(lead_ids) > 200 then
        raise exception 'too_many';
    end if;

    return query
    select l.id, seat.priority, seat.reached_on
    from public.leads l
    cross join lateral public.lead_seat_priority(l.id) seat
    where l.id = any (lead_seat_priorities.lead_ids)
      and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id)
      and seat.priority is not null;
end;
$$;

revoke execute on function public.lead_seat_priorities(uuid[]) from public, anon;
grant execute on function public.lead_seat_priorities(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_history, as slice 2 made it, now with the lead's payment rows for
-- staff who may view payments (ADR 4's `payment` scope). Everyone else still
-- reads only `lead` rows.
-- ---------------------------------------------------------------------------

create or replace function public.lead_history(lead_id uuid)
returns table (
    id bigint,
    created_at timestamptz,
    table_name text,
    row_id uuid,
    action text,
    old_values jsonb,
    new_values jsonb,
    actor_kind text,
    actor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    sees_payments boolean := public.has_permission('payments.view');
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    if not exists (select 1 from public.leads l where l.id = lead_history.lead_id) then
        raise exception 'not_found';
    end if;

    return query
    with own as (
        select a.*
        from public.audit_log a
        where a.lead_id = lead_history.lead_id
          and (a.scope = 'lead' or (a.scope = 'payment' and sees_payments))
    ),
    contacts as (
        select (o.new_values ->> 'guardian_contact_id')::uuid as contact_id
        from own o
        where o.table_name = 'leads' and o.new_values ? 'guardian_contact_id'
        union
        select (o.old_values ->> 'guardian_contact_id')::uuid
        from own o
        where o.table_name = 'leads' and o.old_values ? 'guardian_contact_id'
    ),
    entries as (
        select * from own
        union all
        select a.*
        from public.audit_log a
        where a.table_name = 'guardian_contacts'
          and a.scope = 'lead'
          and a.row_id in (select c.contact_id from contacts c where c.contact_id is not null)
    )
    select e.id, e.created_at, e.table_name, e.row_id, e.action, e.old_values, e.new_values,
           e.actor_kind, s.full_name
    from entries e
    left join public.staff_members s on s.id = e.actor_staff_id
    order by e.created_at desc, e.id desc;
end;
$$;
