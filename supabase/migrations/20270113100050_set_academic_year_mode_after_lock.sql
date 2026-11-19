-- A seats save that crosses the streams activation is refused (#449, slice
-- 6; found in review of #488).
--
-- set_academic_year, as 20270107100100 made it, read the seat mode for its
-- `seats_moved` refusal before it waited for the year's fee_schedules row.
-- The activation migration (20270113100100) holds fee_schedules while it
-- moves the seats into streams. A Fee schedule save sent in that moment
-- passed the check while the mode was still legacy, waited, and then wrote
-- class_seats after the mode was named: seats nothing reads, reported as
-- saved.
--
-- It now checks the mode a second time once the row is held, and refuses
-- `seats_moved` there too. The first check stays, so a save sent after the
-- activation is refused without waiting. Nothing else in the function
-- changes; same signature and grants. This migration is stamped before the
-- activation so that the check is in place when the activation runs.
--
-- Rollback: a new migration putting set_academic_year back as
-- 20270107100100 made it.

do $migration$
begin
    perform public.set_audit_actor('system');

    -- set_academic_year, as 20270107100100 made it, checking the seat mode
    -- again after the schedule row lock.
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

        -- The mode again, now that the schedule row is held. The activation
        -- (20270113100100) holds fee_schedules while it moves the seats, so a
        -- save that passed the check above while the mode was legacy waits
        -- here and goes on once the mode is named. This statement reads the
        -- mode as it is after the wait.
        if public.seat_mode() = 'named' and jsonb_typeof(settings -> 'seats') = 'array'
           and jsonb_array_length(settings -> 'seats') > 0 then
            raise exception 'seats_moved';
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
