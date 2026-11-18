-- Streams: what correcting a placed child's Boy or girl answer would do to
-- their seat, for the warning before saving (#449, slice 5b of the brief on
-- the ticket; prototype v42, "Correcting Boy or girl on a placed child").
--
-- lead_gender_outlook(lead_id, gender), for staff with leads.view and
-- leads.edit: the stream the child is placed in, whether the other answer
-- takes them out of it (a Boys or Girls stream that doesn't take the new
-- answer; a Mixed stream takes every child), and the stream they would move
-- to. Null when none has a free seat, so they would wait. Read-only;
-- reconcile_class_seats moves the seat when the correction is saved, and
-- this follows its order: the child's old seat is freed first, the children
-- already waiting there take theirs, then the rest in rank order, the child
-- among them with the new answer (stream_fit can't say it, since it counts
-- the old seat as taken).
--
-- While seat_settings.mode is `legacy` it reads no seat: `placed` is null.
--
-- Refusal codes: forbidden, not_found.
--
-- Rollback: drop function public.lead_gender_outlook(uuid, public.student_gender).

do $migration$
begin
    perform public.set_audit_actor('system');

    create function public.lead_gender_outlook(lead_id uuid, gender public.student_gender)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        child public.leads;
        placed public.streams;
        fit public.streams;
        moves boolean := false;
        free_seats jsonb;
        holder record;
        target uuid;
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('leads.view')
           or not public.has_permission('leads.edit') then
            raise exception 'forbidden';
        end if;
        select * into child from public.leads l where l.id = lead_gender_outlook.lead_id;
        if not found then
            raise exception 'not_found';
        end if;

        if public.seat_mode() = 'named' then
            select s.* into placed from public.seat_placements p join public.streams s on s.id = p.stream_id
            where p.lead_id = child.id;
        end if;
        if placed.id is not null and not public.stream_takes_child(placed.takes, lead_gender_outlook.gender) then
            moves := true;
            -- Free seats with the child's own seat given back.
            select jsonb_object_agg(s.id::text, s.seats - (
                       select count(*) from public.seat_placements p where p.stream_id = s.id
                   ) + case when s.id = placed.id then 1 else 0 end)
            into free_seats
            from public.streams s
            where s.enrollment_year = child.enrollment_year and s.class_name = child.class_name;

            -- reconcile_class_seats' step 3: children already waiting here
            -- first, then the rest, each in rank order; the child, unplaced by
            -- the correction, is one of the rest.
            for holder in
                select h.lead_id,
                       case when h.lead_id = child.id then lead_gender_outlook.gender else h.gender end as gender
                from public.class_seat_holders(child.enrollment_year, child.class_name) h
                left join public.seat_placements p on p.lead_id = h.lead_id
                where p.stream_id is null or h.lead_id = child.id
                order by coalesce(
                    h.lead_id <> child.id and (
                        exists (
                            select 1 from public.seat_sync_queue q
                            where q.retry and not q.for_request
                              and q.lead_id = h.lead_id and q.retry_year = child.enrollment_year and q.retry_class = child.class_name
                        )
                        or (p.waiting_year = child.enrollment_year and p.waiting_class = child.class_name)
                    ),
                    false
                ) desc,
                h.place
            loop
                select s.id into target
                from public.streams s
                where s.enrollment_year = child.enrollment_year and s.class_name = child.class_name
                  and public.stream_takes_child(s.takes, holder.gender)
                  and (free_seats ->> s.id::text)::integer > 0
                order by s.position
                limit 1;
                if holder.lead_id = child.id then
                    select s.* into fit from public.streams s where s.id = target;
                    exit;
                end if;
                if target is not null then
                    free_seats := jsonb_set(free_seats, array[target::text], to_jsonb((free_seats ->> target::text)::integer - 1));
                end if;
            end loop;
        end if;

        return jsonb_build_object(
            'placed', case when placed.id is null then null else jsonb_build_object(
                'id', placed.id, 'class_name', placed.class_name, 'label', placed.label, 'takes', placed.takes
            ) end,
            'moves', moves,
            'would_take', case when fit.id is null then null else jsonb_build_object(
                'id', fit.id, 'class_name', fit.class_name, 'label', fit.label, 'takes', fit.takes
            ) end
        );
    end;
    $fn$;
    revoke execute on function public.lead_gender_outlook(uuid, public.student_gender) from public, anon, authenticated, service_role;
    grant execute on function public.lead_gender_outlook(uuid, public.student_gender) to authenticated;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
