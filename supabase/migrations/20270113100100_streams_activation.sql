-- Streams, switched on (#449, slice 6 of the brief on the ticket, section 8).
--
-- Today's seats (class_seats: one count per class and Day or Boarding) move
-- into streams, today's seat holders are placed in them, and the seat mode
-- becomes `named`. This migration does nothing else. The engine and the
-- screens are already live and switched off (20270104100100,
-- 20270107100100, 20270110100100, 20270111100100).
--
-- activate_streams() does the move; the `do` block below creates it and calls
-- it once. It is a function so that the dry run in
-- tests/integration/serial/streams-activation.test.ts runs the same body. No
-- API role may execute it. The clean-up slice drops it with that test.
--
-- 1. Guard: raises `streams_already_active` when the mode is not `legacy`,
--    `streams_exist` when any stream or seat placement exists, and
--    `seat_queue_not_empty` when the seat sync queue holds a row (a retry
--    left there would fail the first check every time).
-- 2. The rule, for each Enrollment year and class with seats set in
--    class_seats. It is written once, in the query that fills
--    streams_activation_classes; everything after reads that table.
--      Day and Boarding both set   one Mixed stream labelled A, position 1,
--                                  its seats Day plus Boarding. 0 on both
--                                  sides stays 0, a full class; 0 on one
--                                  side takes the other side's number (Q17).
--      one side set, above 0       the stream takes that side's number (Q8).
--      one side at 0, the other    no stream: the class keeps no limit, as
--      not set                     the side not set has today (the lead's
--                                  decision of 2026-11-19, from Q17). The
--                                  audit row names these classes, so the
--                                  Manager can open streams for them.
--      seats not set               no stream; the class keeps no limit.
-- 3. Each migrated class is reconciled by the engine's own
--    reconcile_class_seats, cause `migration`: its seat holders (a Seat
--    priority, not Declined; Inactive and Archived keep theirs) are placed
--    in today's ranking order, up to the seats, and the rest wait. Every
--    stream is Mixed, so a child with no Boy or girl answer is placed like
--    any other (Q7). A child with no Seat priority, an Enrolled imported
--    student with no payment among them, holds no seat before or after
--    (Q18). Day or boarding no longer splits the count: in a class where
--    only one side was set, above 0, the children of the other side now
--    count against that side's number. A class left with no stream is not
--    reconciled: its seat holders are neither placed nor waiting.
-- 4. Checks, each raising:
--      activation_child_busy      a child's row was held by another
--                                 transaction, so the engine skipped them;
--      activation_placed_count    a class's placed children are not the
--                                 smaller of its seats and its seat holders;
--      activation_waiting_order   a child is placed or waiting against
--                                 today's ranking: the waiting children
--                                 must be exactly the lowest ranked;
--      activation_stray_placement a placement for a child who holds no seat
--                                 in a migrated class;
--      activation_declined_placed a Declined child is placed;
--      fee_snapshot_changed       a fee, status, Seat priority or seat
--                                 count differs from fee_snapshot() taken
--                                 before the move.
-- 5. One audit row, action `streams_activated`, payment scope, as `system`:
--    streams created, children placed and waiting, and how many streams
--    came from a class with only one of Day and Boarding set, with 0 on
--    both sides, and with 0 on one side and a number on the other; each
--    stream's class with its own numbers; and the classes left with no
--    stream because one side was 0 and the other not set, counted and
--    named. The Super Admin reads it on the Audit screen.
-- 6. seat_settings.mode becomes `named`.
--
-- Locks, in the order the Fee schedule's own writers take them: fee
-- schedules, class seats and leads, all in exclusive mode, then the seat
-- lock. Exclusive mode also keeps out row locks, so once it is held no
-- other transaction holds a child's row and the engine skips nobody; and
-- every writer of a fee, a payment or a status locks its lead's row first,
-- so nothing the checks compare moves meanwhile. A transaction that began
-- under `legacy` and waits for these locks goes on under `named` once this
-- commits. Plain reads are not blocked.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. A failed check raises, and the whole block rolls
-- back with it: no stream, no placement, no audit row, no function, and
-- the mode still `legacy`. The migration can then run again as it is.
--
-- Rollback: forward only. Once this has applied, the data has moved and
-- payments are checked against streams; fix with a new migration. Until it
-- applies, reverting the app is enough.

do $migration$
begin
    perform public.set_audit_actor('system');

    lock table public.fee_schedules, public.class_seats, public.leads in exclusive mode;

    create function public.activate_streams()
    returns jsonb
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        target record;
        problem jsonb;
        report jsonb;
    begin
        perform public.set_audit_actor('system');
        perform public.seat_lock();

        -- 1. Only from legacy, and only onto empty tables.
        if (select s.mode from public.seat_settings s) is distinct from 'legacy' then
            raise exception 'streams_already_active';
        end if;
        if exists (select 1 from public.streams) or exists (select 1 from public.seat_placements) then
            raise exception 'streams_exist';
        end if;
        -- Nothing is queued while the mode is legacy. A row left here would
        -- be read below as a child the engine skipped.
        if exists (select 1 from public.seat_sync_queue) then
            raise exception 'seat_queue_not_empty';
        end if;

        drop table if exists pg_temp.streams_activation_snapshot_before;
        create temp table streams_activation_snapshot_before as select * from public.fee_snapshot();

        -- 2. THE RULE: what each class's seats become. This query is the one
        -- place that decides it; `stream_seats` is the seats of the class's
        -- stream, or null when the class gets no stream. To change the rule,
        -- change this `case` and nothing else.
        drop table if exists pg_temp.streams_activation_classes;
        create temp table streams_activation_classes as
        select c.enrollment_year, c.class_name, c.day_seats, c.boarding_seats,
               case
                   -- Day and Boarding both set: the two added together. 0 on
                   -- both sides stays 0, a full class; 0 on one side takes
                   -- the other side's number (Q17).
                   when c.day_seats is not null and c.boarding_seats is not null
                       then least(c.day_seats::bigint + c.boarding_seats, 2147483647)::integer
                   -- One side at 0 and the other not set: no stream, so the
                   -- class keeps no limit, as the side not set has today.
                   when coalesce(c.day_seats, c.boarding_seats) = 0 then null
                   -- One side set: that side (Q8).
                   else coalesce(c.day_seats, c.boarding_seats)
               end as stream_seats
        from (
            select s.enrollment_year, s.class_name,
                   max(s.seats) filter (where s.day_or_boarding = 'Day') as day_seats,
                   max(s.seats) filter (where s.day_or_boarding = 'Boarding') as boarding_seats
            from public.class_seats s
            group by s.enrollment_year, s.class_name
        ) c;

        -- 3. One Mixed stream A per class the rule gives seats, then the
        -- engine places its seat holders.
        for target in
            select c.enrollment_year, c.class_name, c.stream_seats
            from pg_temp.streams_activation_classes c
            where c.stream_seats is not null
            order by c.enrollment_year, c.class_name
        loop
            insert into public.streams (enrollment_year, class_name, label, takes, seats, position)
            values (target.enrollment_year, target.class_name, 'A', 'Mixed', target.stream_seats, 1);
            perform public.reconcile_class_seats(target.enrollment_year, target.class_name, '{}'::jsonb, 'migration', '{}'::text[]);
        end loop;

        -- 4. The checks. A skipped child first: it explains the others.
        select jsonb_agg(jsonb_build_object('lead_id', q.lead_id, 'year', q.retry_year, 'class', q.retry_class))
        into problem
        from public.seat_sync_queue q
        where q.retry;
        if problem is not null then
            raise exception 'activation_child_busy' using detail = problem::text;
        end if;

        -- Today's seat holders of each migrated class, in today's ranking order
        -- (ranked_seats: Full, First instalment, Deposit; the date reached;
        -- Admission Number), Day and Boarding together.
        drop table if exists pg_temp.streams_activation_holders;
        create temp table streams_activation_holders as
        select s.id as stream_id, s.enrollment_year, s.class_name, s.seats, h.lead_id,
               row_number() over (
                   partition by s.id order by h.priority desc, h.reached_on, h.admission_number
               ) as place
        from (select distinct m.enrollment_year from public.streams m) y
        cross join lateral public.seat_holders(y.enrollment_year) h
        join public.streams s on s.enrollment_year = y.enrollment_year and s.class_name = h.class_name;

        select jsonb_agg(to_jsonb(c))
        into problem
        from (
            select s.enrollment_year as year, s.class_name as class, s.seats,
                   (select count(*) from pg_temp.streams_activation_holders h where h.stream_id = s.id) as holders,
                   (select count(*) from public.seat_placements p where p.stream_id = s.id) as placed
            from public.streams s
        ) c
        where c.placed <> least(c.seats, c.holders);
        if problem is not null then
            raise exception 'activation_placed_count' using detail = problem::text;
        end if;

        select jsonb_agg(to_jsonb(c))
        into problem
        from (
            select h.enrollment_year as year, h.class_name as class, h.lead_id, h.place, h.seats
            from pg_temp.streams_activation_holders h
            left join public.seat_placements p on p.lead_id = h.lead_id
            where case
                when h.place <= h.seats then p.stream_id is distinct from h.stream_id
                else p.id is null or p.stream_id is not null
                     or p.waiting_year is distinct from h.enrollment_year
                     or p.waiting_class is distinct from h.class_name
            end
            order by h.enrollment_year, h.class_name, h.place
            limit 20
        ) c;
        if problem is not null then
            raise exception 'activation_waiting_order' using detail = problem::text;
        end if;

        select jsonb_agg(p.lead_id)
        into problem
        from public.seat_placements p
        where not exists (select 1 from pg_temp.streams_activation_holders h where h.lead_id = p.lead_id);
        if problem is not null then
            raise exception 'activation_stray_placement' using detail = problem::text;
        end if;

        select jsonb_agg(p.lead_id)
        into problem
        from public.seat_placements p
        join public.leads l on l.id = p.lead_id
        where p.stream_id is not null and l.status = 'Declined';
        if problem is not null then
            raise exception 'activation_declined_placed' using detail = problem::text;
        end if;

        perform public.assert_fee_snapshot_unchanged('pg_temp.streams_activation_snapshot_before');

        -- 5. The record of what it did.
        -- The first three class counts are of the streams created; a class
        -- left with no stream is in none of them, and has its own count and
        -- its name in the list after it.
        with classes as (
            select s.enrollment_year, s.class_name, s.seats, c.day_seats, c.boarding_seats,
                   (select count(*) from pg_temp.streams_activation_holders h where h.stream_id = s.id) as holders,
                   (select count(*) from public.seat_placements p where p.stream_id = s.id) as placed
            from public.streams s
            join pg_temp.streams_activation_classes c
                on c.enrollment_year = s.enrollment_year and c.class_name = s.class_name
        ),
        no_stream as (
            select c.enrollment_year, c.class_name, c.day_seats, c.boarding_seats,
                   (select count(*) from public.seat_holders(c.enrollment_year) h where h.class_name = c.class_name) as holders
            from pg_temp.streams_activation_classes c
            where c.stream_seats is null
        )
        select jsonb_build_object(
            'ticket', '#449',
            'streams_created', count(*),
            'children_placed', coalesce(sum(c.placed), 0),
            'children_waiting', coalesce(sum(c.holders - c.placed), 0),
            'classes_with_one_of_day_and_boarding_set', count(*) filter (where c.day_seats is null or c.boarding_seats is null),
            'classes_at_0_on_both_sides', count(*) filter (where c.day_seats = 0 and c.boarding_seats = 0),
            'classes_at_0_on_one_side_only', count(*) filter (where (c.day_seats = 0) <> (c.boarding_seats = 0)),
            'classes_at_0_with_other_side_not_set', (select count(*) from no_stream),
            'classes_left_with_no_stream', (
                select coalesce(jsonb_agg(jsonb_build_object(
                    'year', n.enrollment_year, 'class', n.class_name,
                    'day_seats', n.day_seats, 'boarding_seats', n.boarding_seats, 'seat_holders', n.holders
                ) order by n.enrollment_year, n.class_name), '[]'::jsonb)
                from no_stream n
            ),
            'classes', coalesce(jsonb_agg(jsonb_build_object(
                'year', c.enrollment_year, 'class', c.class_name,
                'day_seats', c.day_seats, 'boarding_seats', c.boarding_seats, 'seats', c.seats,
                'seat_holders', c.holders, 'placed', c.placed, 'waiting', c.holders - c.placed
            ) order by c.enrollment_year, c.class_name), '[]'::jsonb)
        )
        into report
        from classes c;

        insert into public.audit_log (action, new_values, scope, actor_kind)
        values ('streams_activated', report, 'payment', 'system');

        drop table pg_temp.streams_activation_holders;
        drop table pg_temp.streams_activation_classes;
        drop table pg_temp.streams_activation_snapshot_before;

        -- 6. The switch, last: everything above was checked first.
        update public.seat_settings set mode = 'named', updated_at = now();

        return report;
    end;
    $fn$;

    revoke execute on function public.activate_streams() from public, anon, authenticated, service_role;

    perform public.activate_streams();

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
