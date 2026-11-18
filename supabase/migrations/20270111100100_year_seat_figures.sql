-- Streams: Reports' Seats by class once streams are on (#449, slice 5c of
-- the brief on the ticket; prototype v42, the owner's Q10 and the lead's
-- answer of 2026-11-19 on classes without streams).
--
-- year_seat_figures(year), for staff with payments.view. Counts only, never
-- the children. One entry per class that has a stream or a seat holder in
-- the year, in class order:
--   - its streams in their order, each with its seats, the children placed
--     in it by Seat priority (Full, First instalment, Deposit) and its free
--     seats (seats less placed, never below zero);
--   - the class's seat holders by Seat priority, placed or not, which is
--     what a class with no streams shows;
--   - how many of them wait for a stream (holding a seat priority, placed
--     nowhere, in a class that has streams).
-- It reads the same tables before streams are on, so the Reports screen
-- decides which view to show from seat_mode().
--
-- Refusal codes: not_permitted.
--
-- Rollback: drop function public.year_seat_figures(integer).

do $migration$
begin
    perform public.set_audit_actor('system');

    create function public.year_seat_figures(schedule_year integer)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        out_classes jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view') then
            raise exception 'not_permitted';
        end if;

        with holders as (
            select h.lead_id, h.class_name, h.priority, p.stream_id
            from public.seat_holders(schedule_year) h
            left join public.seat_placements p on p.lead_id = h.lead_id
        ),
        stream_rows as (
            select s.class_name,
                   jsonb_agg(jsonb_build_object(
                       'id', s.id, 'label', s.label, 'takes', s.takes, 'seats', s.seats, 'position', s.position,
                       'full', (select count(*) from holders x where x.stream_id = s.id and x.priority = 'Full'),
                       'first_instalment', (select count(*) from holders x where x.stream_id = s.id and x.priority = 'First instalment'),
                       'deposit', (select count(*) from holders x where x.stream_id = s.id and x.priority = 'Deposit'),
                       'free', greatest(s.seats - (select count(*) from public.seat_placements p where p.stream_id = s.id), 0)
                   ) order by s.position) as streams
            from public.streams s
            where s.enrollment_year = schedule_year
            group by s.class_name
        ),
        classes as (
            select class_name from stream_rows
            union
            select class_name from holders
        )
        select coalesce(jsonb_agg(jsonb_build_object(
                   'class_name', c.class_name,
                   'streams', coalesce(r.streams, '[]'::jsonb),
                   'full', (select count(*) from holders x where x.class_name = c.class_name and x.priority = 'Full'),
                   'first_instalment', (select count(*) from holders x where x.class_name = c.class_name and x.priority = 'First instalment'),
                   'deposit', (select count(*) from holders x where x.class_name = c.class_name and x.priority = 'Deposit'),
                   'waiting', case when r.streams is null then 0
                                   else (select count(*) from holders x where x.class_name = c.class_name and x.stream_id is null) end
               ) order by c.class_name), '[]'::jsonb)
        into out_classes
        from classes c
        left join stream_rows r on r.class_name = c.class_name;

        return jsonb_build_object('enrollment_year', schedule_year, 'classes', out_classes);
    end;
    $fn$;
    revoke execute on function public.year_seat_figures(integer) from public, anon, authenticated, service_role;
    grant execute on function public.year_seat_figures(integer) to authenticated;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
