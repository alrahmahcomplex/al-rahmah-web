-- Streams: the clean-up after the switch (#449, slice 7 of the brief on the
-- ticket). Seats have been counted in streams since 20270113100100; nothing
-- reads the old per class and Day or Boarding count any more.
--
-- 1. Guards, each raising so nothing changes: the seat mode is `named`; and
--    no function outside the set dropped here, and no policy, still names
--    one of them.
-- 2. Dropped: year_seats and seat_check (the old Seats screen and the
--    reopening approval's seat warning), with ranked_seats and
--    seat_holder_entry, which only they used; class_seat_occupancy, once
--    preview_school_fee_payment no longer asks it; and activate_streams(),
--    which ran once.
-- 3. preview_school_fee_payment, as 20261107901200 made it, without the old
--    seats it reported for the "class is full" warning on the review
--    (`seats`, `seats_taken`, `would_overfill`).
-- 4. set_academic_year, as 20270113100050 made it, sets only the
--    Academic-year start: any seats it is sent are refused with
--    `seats_moved`, and it no longer reads or writes class_seats.
--
-- class_seats stays, frozen: the history of what each class had, and
-- what the activation moved. seat_holders stays: the streams use it.
--
-- Refusal codes: cleanup_before_streams, cleanup_still_used.
--
-- Rollback: a new migration recreating the dropped functions as
-- 20261026900600 and 20270113100100 made them, and preview_school_fee_payment
-- and set_academic_year as 20261107901200 and 20270113100050 made them.

do $migration$
declare
    dropped constant text[] := array['year_seats', 'seat_check', 'ranked_seats', 'seat_holder_entry', 'class_seat_occupancy', 'activate_streams'];
    still_used text;
begin
    perform public.set_audit_actor('system');

    if public.seat_mode() <> 'named' then
        raise exception 'cleanup_before_streams';
    end if;

    -- 1. Nothing outside the set may still call them. preview_school_fee_payment
    -- is redefined below without class_seat_occupancy, so it is left out here.
    select string_agg(distinct p.proname || ' uses ' || d.name, ', ')
    into still_used
    from pg_proc p
    join pg_namespace s on s.oid = p.pronamespace
    cross join unnest(dropped) as d (name)
    where s.nspname = 'public'
      and not (p.proname = any (dropped))
      and p.proname <> 'preview_school_fee_payment'
      and p.prosrc ~ ('(^|[^a-z_])' || d.name || '\s*\(');
    if still_used is null then
        select string_agg(distinct pol.schemaname || '.' || pol.tablename || '.' || pol.policyname || ' uses ' || d.name, ', ')
        into still_used
        from pg_policies pol
        cross join unnest(dropped) as d (name)
        where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('(^|[^a-z_])' || d.name || '\s*\(');
    end if;
    if still_used is not null then
        raise exception 'cleanup_still_used' using detail = still_used;
    end if;

    -- 3. preview_school_fee_payment, as 20261107901200 made it, without the
    -- old seat count.
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
    as $fn$
    declare
        now_seat record;
        after_seat record;
        programme record;
        for_programme boolean := preview_school_fee_payment.payment_type = 'pre_form_one_fee';
        programme_paid_after bigint;
    begin
        perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

        select * into now_seat from public.lead_seat_priority(preview_school_fee_payment.lead_id);
        if for_programme then
            after_seat := now_seat;
        else
            select * into after_seat
            from public.lead_seat_priority(preview_school_fee_payment.lead_id, amount::integer, paid_on);
        end if;
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
            'pre_form_one_fee', programme.fee,
            'pre_form_one_paid', programme.paid,
            'pre_form_one_paid_after', programme_paid_after,
            'pre_form_one_balance_after', programme.fee - programme_paid_after
        );
    end;
    $fn$;
    revoke execute on function public.preview_school_fee_payment(uuid, text, numeric, date) from public, anon;
    grant execute on function public.preview_school_fee_payment(uuid, text, numeric, date) to authenticated;

    -- 2. The old seat functions.
    drop function public.year_seats(integer);
    drop function public.seat_check(uuid);
    drop function public.class_seat_occupancy(integer, public.lead_class, public.day_or_boarding, uuid);
    drop function public.seat_holder_entry(uuid, text, text, public.lead_closure, public.seat_priority, date);
    drop function public.ranked_seats(jsonb);
    drop function public.activate_streams();

    -- 4. set_academic_year, as 20270113100050 made it, for the start alone.
    create or replace function public.set_academic_year(schedule_year integer, settings jsonb)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        current_start date;
        seen_start date;
        new_start date;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;

        -- Seats live in streams (#449): a Fee schedule form sending seats
        -- is out of date.
        if jsonb_typeof(settings -> 'seats') = 'array' and jsonb_array_length(settings -> 'seats') > 0 then
            raise exception 'seats_moved';
        end if;

        if settings is null or jsonb_typeof(settings) <> 'object' then
            perform public.fee_input_invalid('settings');
        end if;

        -- Locked, so two people saving the same year at once take turns.
        select s.academic_year_start into current_start
        from public.fee_schedules s
        where s.enrollment_year = schedule_year
        for update;
        if not found then
            raise exception 'no_schedule';
        end if;

        if settings ? 'academic_year_start' then
            if not settings ? 'academic_year_start_was' then
                perform public.fee_input_invalid('academic_year_start');
            end if;
            if jsonb_typeof(settings -> 'academic_year_start') = 'null' then
                if current_start is not null then
                    perform public.fee_input_invalid('academic_year_start');
                end if;
            else
                new_start := public.fee_input_date(settings -> 'academic_year_start', 'academic_year_start');
                if extract(month from new_start) <> 1 or extract(year from new_start) <> schedule_year then
                    perform public.fee_input_invalid('academic_year_start');
                end if;
            end if;
            if jsonb_typeof(settings -> 'academic_year_start_was') <> 'null' then
                seen_start := public.fee_input_date(settings -> 'academic_year_start_was', 'academic_year_start');
            end if;
            if current_start is distinct from seen_start then
                raise exception 'stale' using detail = jsonb_build_object('field', 'academic_year_start')::text;
            end if;
        end if;

        if new_start is not null and new_start is distinct from current_start then
            update public.fee_schedules
            set academic_year_start = new_start
            where enrollment_year = schedule_year;
        end if;

        if new_start is distinct from current_start and new_start <= public.tanzania_today() then
            perform public.enrol_from_academic_year_start(public.tanzania_today());
        end if;
    end;
    $fn$;
    revoke execute on function public.set_academic_year(integer, jsonb) from public, anon;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
