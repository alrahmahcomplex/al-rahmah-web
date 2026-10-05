-- Count seats, warn on a full class and rank its leads (slice 9, #111).
--
-- A lead takes a seat in its class, year and Day or boarding when it has a
-- Seat priority and isn't Declined. Inactive and Archived leads keep their
-- seat: only declining frees one. A class whose seats aren't set (no
-- class_seats row) is never full.
--
-- Three reads, none of which writes anything:
--
--   - year_seats(year), for staff with payments.view: every class's seats
--     set, seats taken split by priority, and, for a class over capacity,
--     its leads ranked. getSeats in lib/services/seats.ts wraps it; the Seats
--     screen and slice 10's dashboard read it.
--   - seat_check(lead_id), for signed-in staff with leads.view: whether this
--     lead, holding no seat yet, would take one in a full class, with the
--     ranking. Slice 8's reopening approval (#103) shows it.
--   - preview_school_fee_payment, as #107 made it, now also answering
--     `would_overfill`.
--
-- The ranking: Full, then First instalment, then Deposit; within each, the
-- date the lead reached its priority, oldest first; then Admission Number.
--
-- Refusal codes: `forbidden`, `not_found`.

-- Seat counts read a year's leads by class.
create index leads_year_class_idx on public.leads (enrollment_year, class_name, day_or_boarding);

-- ---------------------------------------------------------------------------
-- seat_holders(year): the leads holding a seat in the year, with their Seat
-- priority and the date they reached it. Only leads with a payment can have
-- a priority, so the payments drive the search. No permission check, so no
-- API role may call it.
-- ---------------------------------------------------------------------------

create function public.seat_holders(schedule_year integer)
returns table (
    lead_id uuid,
    admission_number text,
    student_name text,
    class_name public.lead_class,
    day_or_boarding public.day_or_boarding,
    closure public.lead_closure,
    priority public.seat_priority,
    reached_on date
)
language sql
stable
set search_path = ''
as $$
    select l.id, l.admission_number, l.student_name, l.class_name, l.day_or_boarding, l.closure,
           seat.priority, seat.reached_on
    from public.leads l
    cross join lateral public.lead_seat_priority(l.id) seat
    where l.enrollment_year = seat_holders.schedule_year
      and l.status <> 'Declined'
      and l.id in (select p.lead_id from public.school_fee_payments p)
      and seat.priority is not null;
$$;

revoke execute on function public.seat_holders(integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ranked_seats(holders): the given leads as a ranked JSON list, each with
-- its place from 1. No permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create function public.ranked_seats(holders jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select coalesce(jsonb_agg(h.entry || jsonb_build_object('rank', h.place) order by h.place), '[]'::jsonb)
    from (
        select e.entry,
               row_number() over (
                   order by (e.entry ->> 'priority')::public.seat_priority desc,
                            (e.entry ->> 'reached_on')::date,
                            e.entry ->> 'admission_number'
               ) as place
        from jsonb_array_elements(holders) as e (entry)
    ) h;
$$;

revoke execute on function public.ranked_seats(jsonb) from public, anon, authenticated, service_role;

-- One seat holder as the ranking lists it.
create function public.seat_holder_entry(
    lead_id uuid,
    admission_number text,
    student_name text,
    closure public.lead_closure,
    priority public.seat_priority,
    reached_on date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'lead_id', lead_id,
        'admission_number', admission_number,
        'student_name', student_name,
        'closure', closure,
        'priority', priority,
        'reached_on', reached_on
    );
$$;

revoke execute on function public.seat_holder_entry(uuid, text, text, public.lead_closure, public.seat_priority, date)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- year_seats(year): per class and Day or boarding, in class order with Day
-- first, the seats set (null when not set), the seats taken and how many of
-- them are Full, First instalment and Deposit, and, when the seats taken
-- exceed the seats set, the class's leads ranked. Needs payments.view.
-- ---------------------------------------------------------------------------

create function public.year_seats(schedule_year integer)
returns table (
    class_name public.lead_class,
    day_or_boarding public.day_or_boarding,
    seats integer,
    taken integer,
    full_count integer,
    first_instalment_count integer,
    deposit_count integer,
    ranked jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;

    return query
    with holders as (
        select * from public.seat_holders(year_seats.schedule_year)
    ),
    classes as (
        select c.class_name, d.day_or_boarding
        from unnest(enum_range(null::public.lead_class)) with ordinality as c (class_name, class_order)
        cross join unnest(enum_range(null::public.day_or_boarding)) with ordinality as d (day_or_boarding, choice_order)
        order by c.class_order, d.choice_order
    ),
    counted as (
        select k.class_name,
               k.day_or_boarding,
               s.seats,
               count(h.lead_id)::integer as taken,
               (count(h.lead_id) filter (where h.priority = 'Full'))::integer as full_count,
               (count(h.lead_id) filter (where h.priority = 'First instalment'))::integer as first_instalment_count,
               (count(h.lead_id) filter (where h.priority = 'Deposit'))::integer as deposit_count,
               coalesce(
                   jsonb_agg(public.seat_holder_entry(
                       h.lead_id, h.admission_number, h.student_name, h.closure, h.priority, h.reached_on
                   )) filter (where h.lead_id is not null),
                   '[]'::jsonb
               ) as holders
        from classes k
        left join public.class_seats s
            on s.enrollment_year = year_seats.schedule_year
           and s.class_name = k.class_name
           and s.day_or_boarding = k.day_or_boarding
        left join holders h on h.class_name = k.class_name and h.day_or_boarding = k.day_or_boarding
        group by k.class_name, k.day_or_boarding, s.seats
    )
    select c.class_name, c.day_or_boarding, c.seats, c.taken, c.full_count, c.first_instalment_count, c.deposit_count,
           case when c.seats is not null and c.taken > c.seats then public.ranked_seats(c.holders) end
    from counted c
    order by c.class_name, c.day_or_boarding;
end;
$$;

revoke execute on function public.year_seats(integer) from public, anon;
grant execute on function public.year_seats(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- class_seat_occupancy: a class's seats set (null when not set) and seats
-- taken in a year, leaving one lead out, so a lead's own seat is never
-- counted against it. No permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create function public.class_seat_occupancy(
    schedule_year integer,
    of_class public.lead_class,
    of_choice public.day_or_boarding,
    leaving_out uuid,
    out seats integer,
    out taken integer
)
language sql
stable
set search_path = ''
as $$
    select (
               select s.seats from public.class_seats s
               where s.enrollment_year = schedule_year and s.class_name = of_class and s.day_or_boarding = of_choice
           ),
           (
               select count(*)::integer from public.seat_holders(schedule_year) h
               where h.class_name = of_class and h.day_or_boarding = of_choice and h.lead_id <> leaving_out
           );
$$;

revoke execute on function public.class_seat_occupancy(integer, public.lead_class, public.day_or_boarding, uuid)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- seat_check(lead_id): would this lead, holding no seat yet, take one in a
-- full class? It holds no seat while it is Declined or has no Seat priority,
-- and it would take one with the priority its payments give it. "Full" means
-- the seats taken already reach the seats set; a class with seats not set is
-- never full. When it would overfill, `ranked` lists the class's seat
-- holders with this lead among them, marked `this_lead`; otherwise it is
-- null.
--
-- Read-only and security definer, so it reads payments for staff who may
-- not. Needs a signed-in, active staff member with leads.view.
-- ---------------------------------------------------------------------------

create function public.seat_check(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.leads;
    seat record;
    occupancy record;
    holds_seat boolean;
    would_overfill boolean;
    ranked jsonb;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.is_active_staff()
       or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select * into target from public.leads l where l.id = seat_check.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select * into seat from public.lead_seat_priority(target.id);
    holds_seat := target.status <> 'Declined' and seat.priority is not null;
    select * into occupancy
    from public.class_seat_occupancy(target.enrollment_year, target.class_name, target.day_or_boarding, target.id);

    would_overfill := not holds_seat
        and seat.priority is not null
        and occupancy.seats is not null
        and occupancy.taken >= occupancy.seats;

    if would_overfill then
        select public.ranked_seats(
            coalesce(jsonb_agg(
                public.seat_holder_entry(h.lead_id, h.admission_number, h.student_name, h.closure, h.priority, h.reached_on)
                || jsonb_build_object('this_lead', false)
            ), '[]'::jsonb)
            || jsonb_build_array(
                public.seat_holder_entry(
                    target.id, target.admission_number, target.student_name, target.closure, seat.priority, seat.reached_on
                ) || jsonb_build_object('this_lead', true)
            )
        )
        into ranked
        from public.seat_holders(target.enrollment_year) h
        where h.class_name = target.class_name
          and h.day_or_boarding = target.day_or_boarding
          and h.lead_id <> target.id;
    end if;

    return jsonb_build_object(
        'enrollment_year', target.enrollment_year,
        'class_name', target.class_name,
        'day_or_boarding', target.day_or_boarding,
        'seats', occupancy.seats,
        'seats_taken', occupancy.taken,
        'priority', seat.priority,
        'holds_seat', holds_seat,
        'would_overfill', would_overfill,
        'ranked', ranked
    );
end;
$$;

revoke execute on function public.seat_check(uuid) from public, anon;
grant execute on function public.seat_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- preview_school_fee_payment, as #107 made it, now also answering whether
-- the payment would overfill the lead's class: the lead has no priority now,
-- would have one after the payment, and its class's seats taken already
-- reach its seats set. The Accountant is warned and may still record it.
-- `seats` and `seats_taken` say how full the class is.
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
begin
    perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

    select * into target from public.leads l where l.id = preview_school_fee_payment.lead_id;
    select * into now_seat from public.lead_seat_priority(preview_school_fee_payment.lead_id);
    select * into after_seat
    from public.lead_seat_priority(preview_school_fee_payment.lead_id, amount::integer, paid_on);
    select * into occupancy
    from public.class_seat_occupancy(target.enrollment_year, target.class_name, target.day_or_boarding, target.id);

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
            and occupancy.taken >= occupancy.seats
    );
end;
$$;

revoke execute on function public.preview_school_fee_payment(uuid, text, numeric, date) from public, anon;
grant execute on function public.preview_school_fee_payment(uuid, text, numeric, date) to authenticated;
