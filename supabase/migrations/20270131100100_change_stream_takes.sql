-- Streams: changing who a stream takes (owner request 2026-11-26, approved
-- prototype https://claude.ai/artifact/4eGRBgtNugHexnthncAc76 v4).
--
-- 1. change_stream(stream, label, seats, takes, open_takes, open_label,
--    open_seats, open_request, raise_stream, raise_seats): edit_stream plus
--    who the stream takes, in one save. Children placed in it whom the new
--    answer no longer takes give their seat back (cause `stream_takes`) and
--    take the first seat that takes them, in rank order, after the children
--    already waiting (reconcile_class_seats, unchanged). In the same save the
--    Manager may open one new stream in the class or raise one other
--    stream's seats, so the children moving have somewhere to go. A child
--    left with no seat waits (owner decision 2026-11-26: save anyway). The
--    seats never go below the children who stay; the position never changes.
--    edit_stream stays for an app still running the old screen.
-- 2. year_streams: each stream also counts the boys and girls placed in it.
-- 3. year_stream_children(year): every child placed in a stream of the year,
--    with their rank in the class, for the change sheet's preview. Staff who
--    manage academic years only.
--
-- Refusal codes: not_permitted, seat_mode_legacy, not_found, invalid,
-- label_taken, below_placed.
--
-- Rollback: a new migration dropping change_stream and year_stream_children
-- and putting year_streams back as 20270107100100 made it.

do $migration$
begin
    perform public.set_audit_actor('system');

    comment on table public.streams is
        'Streams of a class and Enrollment year (#449): label, who it takes, seats for new students and order. Written only by open_stream, edit_stream, change_stream and bring_up_streams.';

    -- -----------------------------------------------------------------------
    -- 1. change_stream.
    -- -----------------------------------------------------------------------

    create function public.change_stream(
        stream_id uuid,
        label text,
        seats integer,
        takes public.stream_takes,
        open_takes public.stream_takes default null,
        open_label text default null,
        open_seats integer default null,
        open_request uuid default null,
        raise_stream uuid default null,
        raise_seats integer default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        clean_label text := btrim(change_stream.label);
        clean_open text := btrim(change_stream.open_label);
        wants_open boolean := change_stream.open_takes is not null or change_stream.open_label is not null
                              or change_stream.open_seats is not null or change_stream.open_request is not null;
        current_stream public.streams;
        raised public.streams;
        opened public.streams;
        staff uuid := public.current_staff_id();
        staying integer;
        raised_placed integer;
        leaving uuid[];
        waited uuid[];
        leaver uuid;
        why text;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;
        if stream_id is null then
            raise exception 'not_found';
        end if;
        if clean_label is null or char_length(clean_label) not between 1 and 20 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'label')::text;
        end if;
        if change_stream.seats is null or change_stream.seats < 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'seats')::text;
        end if;
        if change_stream.takes is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'takes')::text;
        end if;
        if wants_open then
            if change_stream.open_takes is null or change_stream.open_request is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'open')::text;
            end if;
            if clean_open is null or char_length(clean_open) not between 1 and 20 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'open_label')::text;
            end if;
            if change_stream.open_seats is null or change_stream.open_seats < 1 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'open_seats')::text;
            end if;
        end if;
        if (change_stream.raise_stream is null) <> (change_stream.raise_seats is null)
           or change_stream.raise_seats < 0
           or (wants_open and change_stream.raise_stream is not null) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'raise_seats')::text;
        end if;

        select * into current_stream from public.streams s where s.id = change_stream.stream_id;
        if not found then
            raise exception 'not_found';
        end if;
        -- Rows a key check touches come before the seat lock, as edit_stream.
        perform 1 from public.fee_schedules f where f.enrollment_year = current_stream.enrollment_year for key share;
        perform 1 from public.staff_members s where s.id = staff for key share;

        perform public.seat_lock();

        -- Read again after the wait.
        select * into current_stream from public.streams s where s.id = change_stream.stream_id;

        -- A retry of a save that opened its stream: everything is done already.
        if wants_open and exists (select 1 from public.streams s where s.request_id = change_stream.open_request) then
            select * into opened from public.streams s where s.request_id = change_stream.open_request;
            return jsonb_build_object(
                'stream', public.stream_json(current_stream),
                'opened', public.stream_json(opened),
                'moved', '[]'::jsonb,
                'seated_from_waiting', 0
            );
        end if;

        if change_stream.raise_stream is not null then
            select * into raised from public.streams s
            where s.id = change_stream.raise_stream
              and s.id <> current_stream.id
              and s.enrollment_year = current_stream.enrollment_year
              and s.class_name = current_stream.class_name;
            if not found then
                raise exception 'not_found';
            end if;
            select count(*) into raised_placed from public.seat_placements p where p.stream_id = raised.id;
            if change_stream.raise_seats < raised_placed then
                raise exception 'below_placed' using detail = jsonb_build_object('placed', raised_placed, 'stream', 'raise')::text;
            end if;
        end if;

        -- The children placed here: who stays and who has to move.
        -- stream_takes_child is null for a child with no Boy or girl answer
        -- outside a Mixed stream: they move.
        select count(*) filter (where coalesce(public.stream_takes_child(change_stream.takes, l.gender), false)),
               coalesce(array_agg(p.lead_id order by p.lead_id)
                        filter (where not coalesce(public.stream_takes_child(change_stream.takes, l.gender), false)), '{}')
        into staying, leaving
        from public.seat_placements p
        join public.leads l on l.id = p.lead_id
        where p.stream_id = current_stream.id;
        if change_stream.seats < staying then
            raise exception 'below_placed' using detail = jsonb_build_object('placed', staying)::text;
        end if;

        if exists (
            select 1 from public.streams s
            where s.enrollment_year = current_stream.enrollment_year and s.class_name = current_stream.class_name
              and s.id <> current_stream.id
              and lower(s.label) = lower(clean_label)
              and public.stream_takes_range(s.takes) && public.stream_takes_range(change_stream.takes)
        ) then
            raise exception 'label_taken';
        end if;

        -- Children waiting for a seat in this class now, to count who takes one.
        select coalesce(array_agg(p.lead_id), '{}') into waited
        from public.seat_placements p
        where p.waiting_year = current_stream.enrollment_year and p.waiting_class = current_stream.class_name;

        why := case
            when change_stream.takes <> current_stream.takes then 'stream_takes'
            when wants_open then 'stream_opened'
            else 'seat_freed'
        end;

        update public.streams s
        set label = clean_label, seats = change_stream.seats, takes = change_stream.takes, updated_at = now()
        where s.id = current_stream.id
        returning * into current_stream;

        if wants_open then
            if exists (
                select 1 from public.streams s
                where s.enrollment_year = current_stream.enrollment_year and s.class_name = current_stream.class_name
                  and lower(s.label) = lower(clean_open)
                  and public.stream_takes_range(s.takes) && public.stream_takes_range(change_stream.open_takes)
            ) then
                raise exception 'label_taken' using detail = jsonb_build_object('field', 'open_label')::text;
            end if;
            insert into public.streams (enrollment_year, class_name, label, takes, seats, position, opened_by, request_id)
            values (
                current_stream.enrollment_year, current_stream.class_name, clean_open, change_stream.open_takes, change_stream.open_seats,
                (select max(s.position) from public.streams s
                 where s.enrollment_year = current_stream.enrollment_year and s.class_name = current_stream.class_name) + 1,
                staff, change_stream.open_request
            )
            returning * into opened;
        end if;

        if raised.id is not null then
            update public.streams s
            set seats = change_stream.raise_seats, updated_at = now()
            where s.id = raised.id;
        end if;

        -- The children the stream no longer takes give their seat back first,
        -- so their history says why. A busy row is left to the sync, which
        -- releases it too and retries.
        foreach leaver in array leaving loop
            if not public.set_seat_placement(leaver, null, null, null, 'stream_takes') then
                perform public.queue_seat_retry(leaver, current_stream.enrollment_year, current_stream.class_name);
            end if;
        end loop;

        perform public.reconcile_class_seats(current_stream.enrollment_year, current_stream.class_name, '{}'::jsonb, why, '{}'::text[]);

        select * into current_stream from public.streams s where s.id = current_stream.id;
        if opened.id is not null then
            select * into opened from public.streams s where s.id = opened.id;
        end if;
        return jsonb_build_object(
            'stream', public.stream_json(current_stream),
            'opened', case when opened.id is null then null else public.stream_json(opened) end,
            'moved', coalesce((
                select jsonb_agg(jsonb_build_object('lead_id', m.lead_id, 'stream_id', p.stream_id) order by m.lead_id)
                from unnest(leaving) as m (lead_id)
                left join public.seat_placements p on p.lead_id = m.lead_id
            ), '[]'::jsonb),
            'seated_from_waiting', (
                select count(*)
                from unnest(waited) as w (lead_id)
                join public.seat_placements p on p.lead_id = w.lead_id
                where p.stream_id is not null
            )
        );
    end;
    $fn$;
    revoke execute on function public.change_stream(
        uuid, text, integer, public.stream_takes, public.stream_takes, text, integer, uuid, uuid, integer
    ) from public, anon, authenticated, service_role;
    grant execute on function public.change_stream(
        uuid, text, integer, public.stream_takes, public.stream_takes, text, integer, uuid, uuid, integer
    ) to authenticated;

    -- -----------------------------------------------------------------------
    -- 2. year_streams, as 20270107100100 made it, with the boys and girls
    --    placed in each stream.
    -- -----------------------------------------------------------------------

    create or replace function public.year_streams(schedule_year integer)
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
                       'placed', (select count(*) from public.seat_placements p where p.stream_id = s.id),
                       'boys', (select count(*) from public.seat_placements p join public.leads l on l.id = p.lead_id
                                where p.stream_id = s.id and l.gender = 'Boy'),
                       'girls', (select count(*) from public.seat_placements p join public.leads l on l.id = p.lead_id
                                 where p.stream_id = s.id and l.gender = 'Girl')
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

    -- -----------------------------------------------------------------------
    -- 3. year_stream_children.
    -- -----------------------------------------------------------------------

    -- Every child placed in a stream of `schedule_year`: their stream, Boy or
    -- girl answer and rank in the class (class_seat_holders' place, the order
    -- the sync serves them in). A child placed but no longer holding a seat
    -- has no rank until the sync releases them.
    create function public.year_stream_children(schedule_year integer)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        out_children jsonb := '[]'::jsonb;
        each_class public.lead_class;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;

        for each_class in
            select distinct s.class_name from public.streams s where s.enrollment_year = schedule_year order by 1
        loop
            out_children := out_children || coalesce((
                select jsonb_agg(jsonb_build_object(
                           'lead_id', l.id, 'student_name', l.student_name, 'gender', l.gender,
                           'class_name', s.class_name, 'stream_id', s.id, 'rank', h.place
                       ) order by h.place nulls last, l.id)
                from public.streams s
                join public.seat_placements p on p.stream_id = s.id
                join public.leads l on l.id = p.lead_id
                left join public.class_seat_holders(schedule_year, each_class) h on h.lead_id = l.id
                where s.enrollment_year = schedule_year and s.class_name = each_class
            ), '[]'::jsonb);
        end loop;
        return out_children;
    end;
    $fn$;
    revoke execute on function public.year_stream_children(integer) from public, anon, authenticated, service_role;
    grant execute on function public.year_stream_children(integer) to authenticated;
end;
$migration$;
