-- Streams: the school-fee block, stream requests and the reads, switched
-- off (#449, slice 4b of the brief on the ticket; 4a is 20270104100100).
--
-- While seat_settings.mode is `legacy` nothing here changes what anyone
-- can do: the block, the requests and the refusal below all apply only in
-- `named` mode, which slice 6 turns on.
--
-- 1. stream_fit(year, class, gender, any_child, leaving_out): the one
--    first-fit rule the block, the reads and request resolution share. Free
--    seats are counted after every child already holding a seat priority
--    there and not placed (waiting) takes theirs, in the sync's order.
-- 2. check_school_fee_payment (and so the preview): a school-fee payment by
--    a child with no Seat priority now, in a class and year with streams, is
--    refused with `no_class` while no stream has a free seat that takes
--    them. Any amount. Never a Pre-Form One fee.
-- 3. record_school_fee_payment: for a child who had no Seat priority before
--    the payment, the same test again after its recompute and the seat sync,
--    under the seat lock; `no_class` rolls the whole payment back. A child
--    whose payment gives no priority (below the deposit, Q33 A) is recorded
--    while a seat is free and books nothing.
-- 4. request_stream: a staff member asks the Manager to open a stream, for
--    a child (from their application) or for a class and need. Refused with
--    `not_full` when a stream can take them after all. resolve_stream_requests
--    closes requests once a fitting seat is free, or the child is placed,
--    declined or moved; reconcile_class_seats calls it.
-- 5. Reads: year_streams(year) for Seats and Reports, lead_seat_outlook(lead)
--    for Record payment (with the amount that books the seat: the deposit
--    normally, the first share when a discount brings it lower, nothing when
--    the fee is waived).
-- 6. set_academic_year refuses a seats change with `seats_moved` once the
--    mode is named: class_seats is no longer read then.
--
-- Refusal codes: not_permitted, forbidden, seat_mode_legacy, not_found,
-- invalid, not_full, no_class, seats_moved.
--
-- Rollback: a new migration putting check_school_fee_payment,
-- record_school_fee_payment, set_academic_year and reconcile_class_seats
-- back as 20261204130500, 20261106901100, 20261014900100 and 20270104100100
-- made them, and dropping the functions added here.

do $migration$
begin
    perform public.set_audit_actor('system');

    -- -----------------------------------------------------------------------
    -- 1. The shared first-fit rule.
    -- -----------------------------------------------------------------------

    -- class_seat_holders, as 20270104100100 made it, reading the class's
    -- leads first instead of the whole year's: seat_holders' rule (a Seat
    -- priority, not Declined), ranked the same way. Every seat decision reads
    -- it, under the seat lock.
    create or replace function public.class_seat_holders(schedule_year integer, class public.lead_class)
    returns table (lead_id uuid, gender public.student_gender, place bigint)
    language sql
    stable
    set search_path = ''
    as $fn$
        select l.id, l.gender,
               row_number() over (order by seat.priority desc, seat.reached_on, l.admission_number)
        from public.leads l
        cross join lateral public.lead_seat_priority(l.id) seat
        where l.enrollment_year = class_seat_holders.schedule_year
          and l.class_name = class_seat_holders.class
          and l.status <> 'Declined'
          and l.id in (select p.lead_id from public.school_fee_payments p)
          and seat.priority is not null;
    $fn$;

    -- The stream a child of this gender would take now, or null. With
    -- `any_child`, the first stream with a free seat whoever it takes.
    -- `leaving_out` is the child asking, who must not count against their own
    -- seat. Reads only; meaningful under the seat lock, an early answer
    -- without it.
    create function public.stream_fit(
        schedule_year integer,
        class public.lead_class,
        gender public.student_gender,
        any_child boolean,
        leaving_out uuid
    )
    returns uuid
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        free_seats jsonb;
        holder record;
        target uuid;
    begin
        select jsonb_object_agg(s.id::text, s.seats - (
                   select count(*) from public.seat_placements p where p.stream_id = s.id
               ))
        into free_seats
        from public.streams s
        where s.enrollment_year = schedule_year and s.class_name = class;
        if free_seats is null then
            return null;
        end if;

        -- Children already holding a seat priority here and not placed take
        -- theirs first, in the order the sync serves them.
        for holder in
            select h.lead_id, h.gender
            from public.class_seat_holders(schedule_year, class) h
            left join public.seat_placements p on p.lead_id = h.lead_id
            where p.stream_id is null and h.lead_id is distinct from leaving_out
            order by coalesce(
                exists (
                    select 1 from public.seat_sync_queue q
                    where q.retry and q.lead_id = h.lead_id and q.retry_year = schedule_year and q.retry_class = class
                )
                or (p.waiting_year = schedule_year and p.waiting_class = class),
                false
            ) desc,
            h.place
        loop
            select s.id into target
            from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = class
              and public.stream_takes_child(s.takes, holder.gender)
              and (free_seats ->> s.id::text)::integer > 0
            order by s.position
            limit 1;
            if target is not null then
                free_seats := jsonb_set(free_seats, array[target::text], to_jsonb((free_seats ->> target::text)::integer - 1));
            end if;
        end loop;

        select s.id into target
        from public.streams s
        where s.enrollment_year = schedule_year and s.class_name = class
          and (any_child or public.stream_takes_child(s.takes, gender))
          and (free_seats ->> s.id::text)::integer > 0
        order by s.position
        limit 1;
        return target;
    end;
    $fn$;
    revoke execute on function public.stream_fit(integer, public.lead_class, public.student_gender, boolean, uuid)
        from public, anon, authenticated, service_role;

    -- Whether a school-fee payment by this child is refused now: streams on,
    -- the class and year has streams, the child has no Seat priority and no
    -- seat, and no stream can take them.
    create function public.payment_needs_stream(lead_id uuid)
    returns boolean
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        target public.leads;
    begin
        if public.seat_mode() <> 'named' then
            return false;
        end if;
        select * into target from public.leads l where l.id = payment_needs_stream.lead_id;
        if not found or not exists (
            select 1 from public.streams s
            where s.enrollment_year = target.enrollment_year and s.class_name = target.class_name
        ) then
            return false;
        end if;
        if (select seat.priority from public.lead_seat_priority(target.id) seat) is not null
           or exists (select 1 from public.seat_placements p where p.lead_id = target.id and p.stream_id is not null) then
            return false;
        end if;
        return public.stream_fit(target.enrollment_year, target.class_name, target.gender, false, target.id) is null;
    end;
    $fn$;
    revoke execute on function public.payment_needs_stream(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- 2 and 3. The block.
    -- -----------------------------------------------------------------------

    -- check_school_fee_payment, as 20261204130500 made it, refusing
    -- `no_class` at the end.
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
    as $fn$
    declare
        current_result public.interview_result;
        current_from_import boolean;
        lead_year integer;
        from_workbook boolean;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
            raise exception 'not_permitted';
        end if;

        select l.enrollment_year, l.imported_as_enrolled into lead_year, from_workbook
        from public.leads l where l.id = check_school_fee_payment.lead_id;
        if not found then
            raise exception 'not_found';
        end if;
        perform public.assert_lead_open(check_school_fee_payment.lead_id);

        select i.result, i.import_batch_id is not null into current_result, current_from_import
        from public.interviews i
        where i.lead = check_school_fee_payment.lead_id
        order by i.registered_at desc, i.serial_number desc
        limit 1;
        -- The workbook pass holds only while the current interview is still the
        -- one the import registered, with no result. A retake after a reopening,
        -- or a result recorded on the imported interview, puts the lead back
        -- under the usual rule.
        if current_result is distinct from 'Passed'
           and not public.reopened_to_enrol(check_school_fee_payment.lead_id)
           and not (from_workbook and coalesce(current_from_import, false) and current_result is null) then
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

        -- Streams (#449): a school-fee payment by a child with no Seat priority
        -- and no seat, in a class and year with streams, waits for a stream that
        -- can take them. Any amount; never the Pre-Form One fee.
        if payment_type <> 'pre_form_one_fee' and public.payment_needs_stream(check_school_fee_payment.lead_id) then
            raise exception 'no_class';
        end if;
    end;
    $fn$;

    revoke execute on function public.check_school_fee_payment(uuid, text, numeric, date) from public, anon, authenticated, service_role;

    -- record_school_fee_payment, as 20261106901100 made it, re-checking a
    -- first booking under the seat lock after the sync.
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
    as $fn$
    declare
        staff_id uuid;
        new_id uuid;
        seat record;
        earlier public.school_fee_payments;
        had_priority boolean;
        child public.leads;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
            raise exception 'not_permitted';
        end if;
        if record_school_fee_payment.request_id is null then
            raise exception 'request_missing';
        end if;
        perform public.lock_lead_family(record_school_fee_payment.lead_id);
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
        had_priority := (select s.priority from public.lead_seat_priority(record_school_fee_payment.lead_id) s) is not null;

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

        -- Streams (#449): a child who had no Seat priority is checked again after
        -- the sync, under the seat lock, so two families never both pay for the
        -- last seat. Not placed and no stream can take them: the whole payment
        -- rolls back. A payment that gives no priority is kept while a seat is
        -- free and books nothing (Q33 A).
        if not had_priority and record_school_fee_payment.payment_type <> 'pre_form_one_fee'
           and public.seat_mode() = 'named' then
            perform public.flush_seat_queue();
            perform 1 from public.staff_members s where s.id = staff_id for key share;
            perform public.seat_lock();
            select * into child from public.leads l where l.id = record_school_fee_payment.lead_id;
            if exists (
                   select 1 from public.streams s
                   where s.enrollment_year = child.enrollment_year and s.class_name = child.class_name
               )
               and not exists (select 1 from public.seat_placements p where p.lead_id = child.id and p.stream_id is not null)
               and public.stream_fit(child.enrollment_year, child.class_name, child.gender, false, child.id) is null then
                raise exception 'no_class';
            end if;
        end if;

        select * into seat from public.lead_seat_priority(record_school_fee_payment.lead_id);

        return jsonb_build_object(
            'payment_id', new_id,
            'total_paid', seat.total_paid,
            'priority', seat.priority
        );
    end;
    $fn$;

    revoke execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) from public, anon;
    grant execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) to authenticated;

    -- -----------------------------------------------------------------------
    -- 4. Stream requests.
    -- -----------------------------------------------------------------------

    -- Closes the open requests of one class and year that a fitting seat now
    -- answers, or whose child is placed, declined or no longer here. Under
    -- the seat lock. A request naming a child is written only once the
    -- child's row is held without waiting (the audit row's key check);
    -- otherwise the child is queued as a retry for this class, and the next
    -- sync or the daily job closes it.
    create function public.resolve_stream_requests(schedule_year integer, class public.lead_class)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        request record;
        child public.leads;
        target uuid;
        answered boolean;
    begin
        for request in
            select r.* from public.stream_requests r
            where r.enrollment_year = schedule_year and r.class_name = class and r.resolved_at is null
            order by r.requested_at, r.id
        loop
            target := null;
            if request.lead_id is not null then
                select * into child from public.leads l where l.id = request.lead_id;
                if child.status = 'Declined' or child.enrollment_year <> schedule_year or child.class_name <> class then
                    answered := true;
                else
                    select p.stream_id into target from public.seat_placements p
                    where p.lead_id = child.id and p.stream_id is not null;
                    if target is null then
                        target := public.stream_fit(schedule_year, class, child.gender, false, child.id);
                    end if;
                    answered := target is not null;
                end if;
                if answered then
                    perform 1 from public.leads l where l.id = request.lead_id for key share skip locked;
                    if not found then
                        -- Busy: the next sync or the daily job closes it.
                        perform public.queue_seat_retry(request.lead_id, schedule_year, class);
                        continue;
                    end if;
                end if;
            else
                target := public.stream_fit(
                    schedule_year, class,
                    case request.need when 'Boys' then 'Boy'::public.student_gender
                                      when 'Girls' then 'Girl'::public.student_gender end,
                    request.need is null, null
                );
                answered := target is not null;
            end if;

            if answered then
                update public.stream_requests r
                set resolved_at = now(), resolved_by_stream_id = target
                where r.id = request.id;
            end if;
        end loop;
    end;
    $fn$;
    revoke execute on function public.resolve_stream_requests(integer, public.lead_class)
        from public, anon, authenticated, service_role;

    -- seat_classes_of, as 20270104100100 made it, also naming the class and
    -- year of each open request about these leads, so a request is looked at
    -- again when its child's class or year is corrected before any payment.
    create or replace function public.seat_classes_of(leads uuid[])
    returns table (enrollment_year integer, class_name public.lead_class)
    language sql
    stable
    set search_path = ''
    as $fn$
        select distinct x.enrollment_year, x.class_name
        from (
            select l.enrollment_year, l.class_name from public.leads l where l.id = any (leads)
            union
            select s.enrollment_year, s.class_name
            from public.seat_placements p join public.streams s on s.id = p.stream_id
            where p.lead_id = any (leads)
            union
            select p.waiting_year, p.waiting_class
            from public.seat_placements p
            where p.lead_id = any (leads) and p.waiting_class is not null
            union
            select r.enrollment_year, r.class_name
            from public.stream_requests r
            where r.lead_id = any (leads) and r.resolved_at is null
        ) x
        order by 1, 2;
    $fn$;

    -- reconcile_class_seats, as 20270104100100 made it, closing the requests
    -- its seats now answer.
    create or replace function public.reconcile_class_seats(
        schedule_year integer,
        class public.lead_class,
        causes jsonb,
        default_cause text,
        retried text[]
    )
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        free_seats jsonb := '{}'::jsonb;
        holder record;
        placed record;
        stale record;
        target uuid;
        settled uuid[] := '{}';
        why text;
        this_xact xid8 := pg_current_xact_id();
        holders jsonb;
    begin
        if not exists (
            select 1 from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = class
        ) then
            -- No streams here: no seats to give, and nobody waits here.
            for stale in
                select p.lead_id from public.seat_placements p
                where p.waiting_year = schedule_year and p.waiting_class = class
            loop
                if not public.set_seat_placement(stale.lead_id, null, null, null,
                        coalesce(causes ->> stale.lead_id::text, default_cause)) then
                    perform public.queue_seat_retry(stale.lead_id, schedule_year, class);
                end if;
            end loop;
            perform public.resolve_stream_requests(schedule_year, class);
            return;
        end if;

        select coalesce(jsonb_agg(jsonb_build_object('lead_id', h.lead_id, 'gender', h.gender, 'place', h.place)), '[]'::jsonb)
        into holders
        from public.class_seat_holders(schedule_year, class) h;

        -- 1. Seats no longer held, or in a stream that no longer takes the child.
        for placed in
            select p.lead_id, s.takes, h.lead_id is not null as holds, h.gender
            from public.seat_placements p
            join public.streams s on s.id = p.stream_id
            left join jsonb_to_recordset(holders) as h (lead_id uuid, gender public.student_gender, place bigint) on h.lead_id = p.lead_id
            where s.enrollment_year = schedule_year and s.class_name = class
            order by p.lead_id
        loop
            if placed.holds and public.stream_takes_child(placed.takes, placed.gender) then
                settled := settled || placed.lead_id;
            elsif not public.set_seat_placement(placed.lead_id, null, null, null,
                    case when placed.holds then 'gender'
                         else coalesce(causes ->> placed.lead_id::text, default_cause) end) then
                -- Busy: the seat stays counted until the retry clears it.
                settled := settled || placed.lead_id;
                perform public.queue_seat_retry(placed.lead_id, schedule_year, class);
            end if;
        end loop;

        -- 2. Waiting here, but no longer holding a seat here.
        for stale in
            select p.lead_id from public.seat_placements p
            where p.waiting_year = schedule_year and p.waiting_class = class
              and not exists (
                  select 1 from jsonb_to_recordset(holders) as h (lead_id uuid, gender public.student_gender, place bigint)
                  where h.lead_id = p.lead_id
              )
        loop
            if not public.set_seat_placement(stale.lead_id, null, null, null,
                    coalesce(causes ->> stale.lead_id::text, default_cause)) then
                perform public.queue_seat_retry(stale.lead_id, schedule_year, class);
            end if;
        end loop;

        select coalesce(jsonb_object_agg(s.id::text, s.seats - (
                   select count(*) from public.seat_placements p where p.stream_id = s.id
               )), '{}'::jsonb)
        into free_seats
        from public.streams s
        where s.enrollment_year = schedule_year and s.class_name = class;

        -- 3. Children already waiting here first, then the rest; each group
        -- in rank order.
        for holder in
            select h.lead_id, h.gender
            from jsonb_to_recordset(holders) as h (lead_id uuid, gender public.student_gender, place bigint)
            left join public.seat_placements p on p.lead_id = h.lead_id
            where not (h.lead_id = any (settled))
            -- coalesce: a child with no row has no waiting, and a null
            -- would sort first under desc.
            order by coalesce(
                (h.lead_id::text || '|' || schedule_year || '|' || class) = any (coalesce(retried, '{}'))
                or exists (
                    select 1 from public.seat_sync_queue q
                    where q.retry and q.lead_id = h.lead_id and q.retry_year = schedule_year and q.retry_class = class
                )
                or (p.waiting_year = schedule_year and p.waiting_class = class and p.waiting_xid <> this_xact),
                false
            ) desc,
            h.place
        loop
            why := coalesce(causes ->> holder.lead_id::text, default_cause);
            select s.id into target
            from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = class
              and public.stream_takes_child(s.takes, holder.gender)
              and (free_seats ->> s.id::text)::integer > 0
            order by s.position
            limit 1;

            if target is not null then
                -- The seat is counted as taken whether or not the row was
                -- free, so a busy child is never passed.
                free_seats := jsonb_set(free_seats, array[target::text], to_jsonb((free_seats ->> target::text)::integer - 1));
            end if;
            if not public.set_seat_placement(
                holder.lead_id, target,
                case when target is null then schedule_year end,
                case when target is null then class end,
                why
            ) then
                perform public.queue_seat_retry(holder.lead_id, schedule_year, class);
            end if;
        end loop;

        -- Requests its seats now answer (slice 4b).
        perform public.resolve_stream_requests(schedule_year, class);
    end;
    $fn$;

    -- request_stream(lead, year, class, need): asks for a new stream. For a
    -- child (lead given), the year, class and need come from their record,
    -- never from the caller; that needs leads.view too. Refused with
    -- `not_full` when a stream can take them (or the class has no streams:
    -- no limit). One open request per class, need and child: asking again
    -- hands back the open one.
    create function public.request_stream(
        lead_id uuid,
        schedule_year integer,
        class public.lead_class,
        need public.stream_takes
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        staff uuid := public.current_staff_id();
        child public.leads;
        want_year integer := request_stream.schedule_year;
        want_class public.lead_class := request_stream.class;
        want_need public.stream_takes := request_stream.need;
        made public.stream_requests;
        has_streams boolean;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view')
           or (request_stream.lead_id is not null and not public.has_permission('leads.view')) then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;

        -- Rows a key check touches come before the seat lock: the child's,
        -- the year's, the staff member's.
        if request_stream.lead_id is not null then
            select * into child from public.leads l where l.id = request_stream.lead_id for key share;
            if not found then
                raise exception 'not_found';
            end if;
            want_year := child.enrollment_year;
            want_class := child.class_name;
            want_need := case child.gender when 'Boy' then 'Boys'::public.stream_takes
                                           when 'Girl' then 'Girls'::public.stream_takes end;
        elsif want_year is null or want_class is null or want_need is not distinct from 'Mixed' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'request')::text;
        end if;
        perform 1 from public.fee_schedules f where f.enrollment_year = want_year for key share;
        if not found then
            raise exception 'no_schedule';
        end if;
        perform 1 from public.staff_members s where s.id = staff for key share;

        perform public.seat_lock();

        select exists (
            select 1 from public.streams s where s.enrollment_year = want_year and s.class_name = want_class
        ) into has_streams;
        if not has_streams
           or (child.id is not null and (
               child.status = 'Declined'
               or exists (select 1 from public.seat_placements p where p.lead_id = child.id and p.stream_id is not null)
               or public.stream_fit(want_year, want_class, child.gender, false, child.id) is not null
           ))
           or (child.id is null and public.stream_fit(
               want_year, want_class,
               case want_need when 'Boys' then 'Boy'::public.student_gender when 'Girls' then 'Girl'::public.student_gender end,
               want_need is null, null
           ) is not null) then
            raise exception 'not_full';
        end if;

        select * into made from public.stream_requests r
        where r.enrollment_year = want_year and r.class_name = want_class
          and r.need is not distinct from want_need and r.lead_id is not distinct from child.id
          and r.resolved_at is null;
        if not found then
            insert into public.stream_requests (enrollment_year, class_name, need, lead_id, requested_by)
            values (want_year, want_class, want_need, child.id, staff)
            returning * into made;
        end if;

        return jsonb_build_object(
            'id', made.id, 'enrollment_year', made.enrollment_year, 'class_name', made.class_name,
            'need', made.need, 'lead_id', made.lead_id, 'requested_at', made.requested_at
        );
    end;
    $fn$;
    revoke execute on function public.request_stream(uuid, integer, public.lead_class, public.stream_takes)
        from public, anon, authenticated, service_role;
    grant execute on function public.request_stream(uuid, integer, public.lead_class, public.stream_takes) to authenticated;

    -- -----------------------------------------------------------------------
    -- 5. Reads.
    -- -----------------------------------------------------------------------

    -- year_streams(year): for staff with payments.view. Every class of the
    -- year with streams: its streams in order with seats, placed and free
    -- (after waiting children), whether a boy, a girl and any child could
    -- take a seat now, and its waiting children ranked; then the year's
    -- requests, open first, with who asked.
    create function public.year_streams(schedule_year integer)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        out_classes jsonb := '[]'::jsonb;
        each_class public.lead_class;
        stream_list jsonb;
        waiting jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view') then
            raise exception 'not_permitted';
        end if;

        for each_class in
            select distinct s.class_name from public.streams s where s.enrollment_year = schedule_year order by 1
        loop
            select coalesce(jsonb_agg(jsonb_build_object(
                       'id', s.id, 'label', s.label, 'takes', s.takes, 'seats', s.seats, 'position', s.position,
                       'brought_up_from', s.brought_up_from,
                       'placed', (select count(*) from public.seat_placements p where p.stream_id = s.id)
                   ) order by s.position), '[]'::jsonb)
            into stream_list
            from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = each_class;

            select coalesce(jsonb_agg(jsonb_build_object(
                       'lead_id', l.id, 'admission_number', l.admission_number, 'student_name', l.student_name,
                       'gender', l.gender, 'priority', sh.priority, 'reached_on', sh.reached_on, 'rank', h.place
                   ) order by h.place), '[]'::jsonb)
            into waiting
            from public.class_seat_holders(schedule_year, each_class) h
            join public.leads l on l.id = h.lead_id
            join public.seat_holders(schedule_year) sh on sh.lead_id = h.lead_id
            left join public.seat_placements p on p.lead_id = h.lead_id
            where p.stream_id is null;

            out_classes := out_classes || jsonb_build_object(
                'class_name', each_class,
                'streams', stream_list,
                'free_for_boy', public.stream_fit(schedule_year, each_class, 'Boy', false, null) is not null,
                'free_for_girl', public.stream_fit(schedule_year, each_class, 'Girl', false, null) is not null,
                'free_for_any', public.stream_fit(schedule_year, each_class, null, true, null) is not null,
                'waiting', waiting
            );
        end loop;

        return jsonb_build_object(
            'mode', public.seat_mode(),
            'enrollment_year', schedule_year,
            'classes', out_classes,
            'requests', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'class_name', r.class_name, 'need', r.need,
                    'lead_id', r.lead_id, 'student_name', l.student_name,
                    'requested_by_name', s.full_name, 'requested_by_role', ro.name,
                    'requested_at', r.requested_at, 'resolved_at', r.resolved_at,
                    'resolved_by_stream_id', r.resolved_by_stream_id
                ) order by r.resolved_at nulls first, r.requested_at)
                from public.stream_requests r
                join public.staff_members s on s.id = r.requested_by
                left join public.roles ro on ro.id = s.role_id
                left join public.leads l on l.id = r.lead_id
                where r.enrollment_year = schedule_year
            ), '[]'::jsonb)
        );
    end;
    $fn$;
    revoke execute on function public.year_streams(integer) from public, anon, authenticated, service_role;
    grant execute on function public.year_streams(integer) to authenticated;

    -- lead_seat_outlook(lead): for staff with leads.view and payments.view,
    -- what Record payment shows about the child's seat: whether streams are
    -- on and the class has any, where the child sits or that they wait, the
    -- stream a payment would place them in, whether a payment is refused,
    -- the amount that books the seat (Q33 A: what gives a Seat priority —
    -- the minimum deposit normally, the first share when a discount brings
    -- it lower, nothing when the fee is waived), and the child's open or
    -- last request.
    create function public.lead_seat_outlook(lead_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        child public.leads;
        fee record;
        seat record;
        schedule public.fee_schedules;
        placed public.streams;
        fit public.streams;
        first_amount bigint;
        books bigint;
        books_kind text;
        has_streams boolean;
        request jsonb;
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('leads.view')
           or not public.has_permission('payments.view') then
            raise exception 'forbidden';
        end if;
        select * into child from public.leads l where l.id = lead_seat_outlook.lead_id;
        if not found then
            raise exception 'not_found';
        end if;

        select * into fee from public.lead_fee_amounts(child.id);
        select * into seat from public.lead_seat_priority(child.id);
        select * into schedule from public.fee_schedules s where s.enrollment_year = child.enrollment_year;
        if fee.has_schedule then
            first_amount := ceil(fee.school_fee::numeric * schedule.first_share / 100);
            books := least(schedule.minimum_deposit::bigint, first_amount, fee.school_fee::bigint);
            books_kind := case
                when fee.school_fee = 0 then 'waived'
                when books = schedule.minimum_deposit then 'deposit'
                when books = fee.school_fee then 'full'
                else 'first_share'
            end;
        end if;

        select exists (
            select 1 from public.streams s where s.enrollment_year = child.enrollment_year and s.class_name = child.class_name
        ) into has_streams;
        select s.* into placed from public.seat_placements p join public.streams s on s.id = p.stream_id
        where p.lead_id = child.id;
        if has_streams and placed.id is null then
            select s.* into fit from public.streams s
            where s.id = public.stream_fit(child.enrollment_year, child.class_name, child.gender, false, child.id);
        end if;

        select jsonb_build_object(
                   'id', r.id, 'need', r.need, 'requested_by_name', s.full_name, 'requested_at', r.requested_at,
                   'resolved_at', r.resolved_at
               )
        into request
        from public.stream_requests r
        join public.staff_members s on s.id = r.requested_by
        where r.lead_id = child.id
        order by r.resolved_at nulls first, r.requested_at desc
        limit 1;

        return jsonb_build_object(
            'mode', public.seat_mode(),
            'has_streams', has_streams,
            'gender', child.gender,
            'priority', seat.priority,
            'total_paid', seat.total_paid,
            'placed', case when placed.id is null then null else jsonb_build_object(
                'id', placed.id, 'class_name', placed.class_name, 'label', placed.label, 'takes', placed.takes
            ) end,
            'waiting', has_streams and placed.id is null and seat.priority is not null and child.status <> 'Declined',
            'would_take', case when fit.id is null then null else jsonb_build_object(
                'id', fit.id, 'class_name', fit.class_name, 'label', fit.label, 'takes', fit.takes
            ) end,
            'blocked', public.payment_needs_stream(child.id),
            'books_at', books,
            'books_kind', books_kind,
            'request', request
        );
    end;
    $fn$;
    revoke execute on function public.lead_seat_outlook(uuid) from public, anon, authenticated, service_role;
    grant execute on function public.lead_seat_outlook(uuid) to authenticated;

    -- -----------------------------------------------------------------------
    -- 6. Fee schedule seats, once streams are on.
    -- -----------------------------------------------------------------------

    -- set_academic_year, as 20261014900100 made it, refusing a seats change
    -- with `seats_moved` once the mode is named.
    create or replace function public.set_academic_year(schedule_year integer, settings jsonb)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        most constant numeric := 2147483647;
        current_start date;
        seen_start date;
        new_start date;
        current_count integer;
        seen_count integer;
        entry jsonb;
        entry_class public.lead_class;
        entry_choice public.day_or_boarding;
        entry_field text;
        seen text[] := '{}';
        classes public.lead_class[] := '{}';
        choices public.day_or_boarding[] := '{}';
        counts integer[] := '{}';
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;

        -- Streams (#449): once the mode is named, seats live in streams and
        -- class_seats is not read; a Fee schedule tab left open must not save
        -- seats nothing uses.
        if public.seat_mode() = 'named' and jsonb_typeof(settings -> 'seats') = 'array'
           and jsonb_array_length(settings -> 'seats') > 0 then
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

        if settings -> 'seats' is not null and jsonb_typeof(settings -> 'seats') <> 'null' then
            if jsonb_typeof(settings -> 'seats') <> 'array' then
                perform public.fee_input_invalid('seats');
            end if;

            for entry in select value from jsonb_array_elements(settings -> 'seats') loop
                if jsonb_typeof(entry) <> 'object'
                    or not entry ? 'was'
                    or jsonb_typeof(entry -> 'class_name') is distinct from 'string'
                    or jsonb_typeof(entry -> 'day_or_boarding') is distinct from 'string'
                    or not (entry ->> 'class_name') = any (enum_range(null::public.lead_class)::text[])
                    or not (entry ->> 'day_or_boarding') = any (enum_range(null::public.day_or_boarding)::text[])
                then
                    perform public.fee_input_invalid('seats');
                end if;
                entry_class := (entry ->> 'class_name')::public.lead_class;
                entry_choice := (entry ->> 'day_or_boarding')::public.day_or_boarding;
                entry_field := format('seats.%s.%s', entry_class, entry_choice);

                -- The same class twice would leave the saved count to chance.
                if entry_field = any (seen) then
                    perform public.fee_input_invalid('seats');
                end if;
                seen := seen || entry_field;

                current_count := (
                    select c.seats from public.class_seats c
                    where c.enrollment_year = schedule_year and c.class_name = entry_class and c.day_or_boarding = entry_choice
                );
                seen_count := null;
                if jsonb_typeof(entry -> 'was') <> 'null' then
                    seen_count := public.fee_input_whole(entry -> 'was', entry_field, 0, most);
                end if;

                if entry -> 'seats' is null or jsonb_typeof(entry -> 'seats') = 'null' then
                    if current_count is not null then
                        perform public.fee_input_invalid(entry_field);
                    end if;
                else
                    classes := classes || entry_class;
                    choices := choices || entry_choice;
                    counts := counts || public.fee_input_whole(entry -> 'seats', entry_field, 0, most);
                end if;

                if current_count is distinct from seen_count then
                    raise exception 'stale' using detail = jsonb_build_object('field', entry_field)::text;
                end if;
            end loop;
        end if;

        if new_start is not null and new_start is distinct from current_start then
            update public.fee_schedules
            set academic_year_start = new_start
            where enrollment_year = schedule_year;
        end if;

        -- An unchanged count writes nothing, so the history holds only changes.
        insert into public.class_seats as c (enrollment_year, class_name, day_or_boarding, seats)
        select schedule_year, n.class_name, n.day_or_boarding, n.seats
        from unnest(classes, choices, counts) as n (class_name, day_or_boarding, seats)
        on conflict (enrollment_year, class_name, day_or_boarding) do update
        set seats = excluded.seats
        where c.seats is distinct from excluded.seats;

        if new_start is distinct from current_start and new_start <= public.tanzania_today() then
            perform public.enrol_from_academic_year_start(public.tanzania_today());
        end if;
    end;
    $fn$;

    revoke execute on function public.set_academic_year(integer, jsonb) from public, anon;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
