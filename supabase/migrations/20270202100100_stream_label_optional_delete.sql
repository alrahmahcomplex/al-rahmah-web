-- Streams: an optional label, and deleting an empty stream (owner request
-- 2026-11-26, approved prototype https://claude.ai/artifact/7p183225JMd529T29EHJBp
-- v1, "yes to all").
--
-- 1. streams.label may be null: the stream is shown as its class alone
--    ("STD 1", "FORM 1 (Girls)"). The label rule is unchanged, with "no
--    label" counted as a label of its own: no two streams of a class and year
--    that overlap in who they take may both go without one (a Boys and a
--    Girls stream may; owner decision 1). So a class's first stream needs no
--    label, and every stream added next to it needs one.
-- 2. A class whose only stream of a year is labelled A (as the activation
--    migration made them) loses the A (owner decision 2).
-- 3. stream_label_taken(), and open_stream, change_stream and
--    bring_up_streams taking an empty label; next_stream_label skips A next
--    to a stream with no label, so the second stream is suggested B.
-- 4. delete_stream(stream): removes a stream nobody is placed in, for good.
--    Streams after it move up one place. A stream request it answered keeps
--    its answer without the stream; a stream brought up from it forgets
--    where it came from. Its last row goes into the audit log (action
--    `delete`), so a child's history can still name it (owner decision 3,
--    deleted_stream_names). If it was the class's last stream, the children
--    waiting there stop waiting (cause `stream_deleted`), as for any class
--    with no streams.
--
-- edit_stream is left as it is: no app calls it since v0.167.0, and it never
-- writes an empty label.
--
-- Refusal codes: not_permitted, seat_mode_legacy, not_found, invalid,
-- label_taken, below_placed, not_empty, busy (delete_stream: try again).
--
-- Rollback: a new migration giving every stream with no label a free letter,
-- putting back the not-null label and the label_clash constraint, the
-- refuse_delete trigger and the functions as 20270104100100 and
-- 20270201100100 made them, and dropping delete_stream,
-- deleted_stream_names, stream_label_taken and refuse_stream_delete.

do $migration$
begin
    perform public.set_audit_actor('system');

    -- -----------------------------------------------------------------------
    -- 1. The label column and the label rule.
    -- -----------------------------------------------------------------------

    alter table public.streams alter column label drop not null;
    alter table public.streams drop constraint streams_label_check;
    alter table public.streams add constraint streams_label_check
        check (label is null or (label = btrim(label) and char_length(label) between 1 and 20));
    alter table public.streams drop constraint streams_label_clash;
    -- A Boys and a Girls stream may share a label, or both have none; no
    -- other two streams of a class and year may (case does not count).
    alter table public.streams add constraint streams_label_clash exclude using gist (
        enrollment_year with =,
        class_name with =,
        (lower(coalesce(label, ''))) with =,
        (public.stream_takes_range(takes)) with &&
    );
    comment on column public.streams.label is
        'The stream''s own part ("A", "B" or a word), shown after its class. Null: shown as the class alone.';
    comment on table public.streams is
        'Streams of a class and Enrollment year (#449): label, who it takes, seats for new students and order. Written only by open_stream, edit_stream, change_stream, bring_up_streams and delete_stream.';

    -- -----------------------------------------------------------------------
    -- 2. A class's only stream labelled A loses the A.
    -- -----------------------------------------------------------------------

    update public.streams s
    set label = null, updated_at = now()
    where s.label = 'A'
      and not exists (
          select 1 from public.streams o
          where o.enrollment_year = s.enrollment_year and o.class_name = s.class_name and o.id <> s.id
      );

    -- -----------------------------------------------------------------------
    -- 3. The label rule's one check, the allocator and the writers.
    -- -----------------------------------------------------------------------

    -- True when a stream of the class and year other than `skip` already has
    -- `label` (null: no label) and overlaps `takes`.
    create function public.stream_label_taken(
        schedule_year integer,
        class public.lead_class,
        label text,
        takes public.stream_takes,
        skip uuid
    )
    returns boolean
    language sql
    stable
    set search_path = ''
    as $fn$
        select exists (
            select 1 from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = class
              and (skip is null or s.id <> skip)
              and lower(coalesce(s.label, '')) = lower(coalesce(stream_label_taken.label, ''))
              and public.stream_takes_range(s.takes) && public.stream_takes_range(stream_label_taken.takes)
        );
    $fn$;
    revoke execute on function public.stream_label_taken(integer, public.lead_class, text, public.stream_takes, uuid)
        from public, anon, authenticated, service_role;

    -- As 20270104100100 made it, skipping A when a stream it overlaps has no
    -- label: that stream reads as the A.
    create or replace function public.next_stream_label(schedule_year integer, class public.lead_class, takes public.stream_takes)
    returns text
    language plpgsql
    stable
    set search_path = ''
    as $fn$
    declare
        n integer := 0;
        candidate text;
        rest integer;
        skip_a boolean := public.stream_label_taken(schedule_year, class, null, next_stream_label.takes, null);
    begin
        loop
            candidate := '';
            rest := n + 1;
            while rest > 0 loop
                candidate := chr(65 + (rest - 1) % 26) || candidate;
                rest := (rest - 1) / 26;
            end loop;
            if not (skip_a and candidate = 'A')
               and not public.stream_label_taken(schedule_year, class, candidate, next_stream_label.takes, null) then
                return candidate;
            end if;
            n := n + 1;
        end loop;
    end;
    $fn$;

    -- open_stream as 20270104100100 made it; an empty label opens a stream
    -- with none.
    create or replace function public.open_stream(
        schedule_year integer,
        class public.lead_class,
        label text,
        takes public.stream_takes,
        seats integer,
        request_id uuid
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        clean_label text := nullif(btrim(open_stream.label), '');
        staff uuid := public.current_staff_id();
        made public.streams;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;
        if class is null or takes is null or request_id is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'stream')::text;
        end if;
        if char_length(clean_label) > 20 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'label')::text;
        end if;
        if seats is null or seats < 1 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'seats')::text;
        end if;

        -- Rows a key check touches come before the seat lock.
        perform 1 from public.fee_schedules f where f.enrollment_year = schedule_year for key share;
        if not found then
            raise exception 'no_schedule';
        end if;
        perform 1 from public.staff_members s where s.id = staff for key share;

        perform public.seat_lock();

        select * into made from public.streams s where s.request_id = open_stream.request_id;
        if found then
            return public.stream_json(made);
        end if;

        if public.stream_label_taken(schedule_year, class, clean_label, open_stream.takes, null) then
            raise exception 'label_taken';
        end if;

        insert into public.streams (enrollment_year, class_name, label, takes, seats, position, opened_by, request_id)
        values (
            schedule_year, class, clean_label, open_stream.takes, open_stream.seats,
            coalesce((select max(s.position) from public.streams s
                      where s.enrollment_year = schedule_year and s.class_name = class), 0) + 1,
            staff, open_stream.request_id
        )
        returning * into made;

        perform public.reconcile_class_seats(schedule_year, class, '{}'::jsonb, 'stream_opened', '{}'::text[]);
        return public.stream_json(made);
    end;
    $fn$;

    -- change_stream as 20270201100100 made it; an empty label, for the stream
    -- or the one it opens, means none.
    create or replace function public.change_stream(
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
        clean_label text := nullif(btrim(change_stream.label), '');
        clean_open text := nullif(btrim(change_stream.open_label), '');
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
        if char_length(clean_label) > 20 then
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
            if char_length(clean_open) > 20 then
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

        -- Read again after the wait; a stream deleted meanwhile is gone.
        select * into current_stream from public.streams s where s.id = change_stream.stream_id;
        if not found then
            raise exception 'not_found';
        end if;

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

        if public.stream_label_taken(current_stream.enrollment_year, current_stream.class_name, clean_label,
                                     change_stream.takes, current_stream.id) then
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
            if public.stream_label_taken(current_stream.enrollment_year, current_stream.class_name, clean_open,
                                         change_stream.open_takes, null) then
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

    -- bring_up_streams as 20270104100100 made it; a stream with no label is
    -- brought up with none, unless the class already has one it overlaps.
    create or replace function public.bring_up_streams(schedule_year integer, sources uuid[])
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        staff uuid := public.current_staff_id();
        source_id uuid;
        source public.streams;
        to_class public.lead_class;
        new_label text;
        made public.streams;
        out_list jsonb := '[]'::jsonb;
        classes public.lead_class[] := array[
            'DAY CARE', 'KG 1', 'KG 2', 'STD 1', 'STD 2', 'STD 3', 'STD 4', 'STD 5', 'STD 6', 'STD 7',
            'FORM 1', 'FORM 2', 'FORM 3', 'FORM 4'
        ]::public.lead_class[];
        touched public.lead_class[] := '{}';
        each_class public.lead_class;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;
        if sources is null or cardinality(sources) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sources')::text;
        end if;

        perform 1 from public.fee_schedules f where f.enrollment_year = schedule_year for key share;
        if not found then
            raise exception 'no_schedule';
        end if;
        perform 1 from public.staff_members s where s.id = staff for key share;

        perform public.seat_lock();

        foreach source_id in array sources loop
            select * into source from public.streams s where s.id = source_id;
            if not found or source.enrollment_year <> schedule_year - 1 or source.class_name = 'FORM 4'
               or exists (select 1 from public.streams b where b.brought_up_from = source.id) then
                continue;
            end if;
            to_class := classes[array_position(classes, source.class_name) + 1];
            new_label := case
                when public.stream_label_taken(schedule_year, to_class, source.label, source.takes, null)
                    then public.next_stream_label(schedule_year, to_class, source.takes)
                else source.label
            end;

            insert into public.streams (enrollment_year, class_name, label, takes, seats, position, opened_by, brought_up_from)
            values (
                schedule_year, to_class, new_label, source.takes, 0,
                coalesce((select max(s.position) from public.streams s
                          where s.enrollment_year = schedule_year and s.class_name = to_class), 0) + 1,
                staff, source.id
            )
            returning * into made;
            out_list := out_list || public.stream_json(made);
            if not (to_class = any (touched)) then
                touched := touched || to_class;
            end if;
        end loop;

        -- A class that had no streams now has some with 0 seats: its
        -- holders wait until the places are typed.
        foreach each_class in array touched loop
            perform public.reconcile_class_seats(schedule_year, each_class, '{}'::jsonb, 'stream_opened', '{}'::text[]);
        end loop;
        return out_list;
    end;
    $fn$;

    -- -----------------------------------------------------------------------
    -- 4. Deleting an empty stream.
    -- -----------------------------------------------------------------------

    -- Streams are still never deleted, except the one delete_stream names
    -- for its own transaction.
    create function public.refuse_stream_delete()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
        if tg_op = 'DELETE' and current_setting('seats.deleting_stream', true) = old.id::text then
            return old;
        end if;
        raise exception 'delete_refused' using detail = tg_table_name;
    end;
    $fn$;
    revoke execute on function public.refuse_stream_delete() from public, anon, authenticated, service_role;

    drop trigger refuse_delete on public.streams;
    create trigger refuse_delete before delete on public.streams
        for each row execute function public.refuse_stream_delete();

    -- delete_stream(stream): removes a stream nobody is placed in, and moves
    -- the streams after it up one place. Returns the stream as it was.
    create function public.delete_stream(stream_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        gone public.streams;
        gone_json jsonb;
        placed integer;
        actor record;
        later record;
        held uuid[];
        child uuid;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;

        select * into gone from public.streams s where s.id = delete_stream.stream_id;
        if not found then
            raise exception 'not_found';
        end if;
        -- Rows a key check touches come before the seat lock, as change_stream.
        -- Letting go of a request audits a row naming its child, so the
        -- children of the requests it answered are held here too: a payment
        -- holds its child and then waits for the seat lock.
        perform 1 from public.fee_schedules f where f.enrollment_year = gone.enrollment_year for key share;
        perform 1 from public.staff_members s where s.id = public.current_staff_id() for key share;
        select coalesce(array_agg(h.id), '{}') into held
        from (
            select l.id from public.leads l
            where l.id in (select r.lead_id from public.stream_requests r where r.resolved_by_stream_id = gone.id)
            order by l.id
            for key share
        ) h;

        perform public.seat_lock();

        -- Read again after the wait.
        select * into gone from public.streams s where s.id = delete_stream.stream_id;
        if not found then
            raise exception 'not_found';
        end if;
        select count(*) into placed from public.seat_placements p where p.stream_id = gone.id;
        if placed > 0 then
            raise exception 'not_empty' using detail = jsonb_build_object('placed', placed)::text;
        end if;

        select * into actor from public.audit_actor();
        if actor.kind is null then
            raise exception 'no_audit_actor' using detail = 'streams';
        end if;

        -- A request it answered while this waited names a child not held
        -- yet. Waiting for that child under the seat lock could deadlock, so
        -- a busy one refuses the delete; trying again holds it first.
        for child in
            select distinct r.lead_id from public.stream_requests r
            where r.resolved_by_stream_id = gone.id and r.lead_id is not null and not (r.lead_id = any (held))
        loop
            perform 1 from public.leads l where l.id = child for key share skip locked;
            if not found then
                raise exception 'busy';
            end if;
        end loop;

        -- What points at it lets go first (each change audited).
        update public.stream_requests r set resolved_by_stream_id = null where r.resolved_by_stream_id = gone.id;
        update public.streams s set brought_up_from = null, updated_at = now() where s.brought_up_from = gone.id;

        gone_json := public.stream_json(gone);
        insert into public.audit_log (table_name, row_id, lead_id, action, old_values, new_values, scope, actor_kind, actor_staff_id)
        values ('streams', gone.id, null, 'delete', to_jsonb(gone), null, 'payment', actor.kind, actor.staff_id);

        perform set_config('seats.deleting_stream', gone.id::text, true);
        delete from public.streams s where s.id = gone.id;
        perform set_config('seats.deleting_stream', '', true);

        -- Later streams move up, lowest first, so no two share a position.
        for later in
            select s.id from public.streams s
            where s.enrollment_year = gone.enrollment_year and s.class_name = gone.class_name and s.position > gone.position
            order by s.position
        loop
            update public.streams s set position = s.position - 1, updated_at = now() where s.id = later.id;
        end loop;

        -- Nobody sat in it, so nobody moves; a class left with no streams
        -- lets its waiting children go.
        perform public.reconcile_class_seats(gone.enrollment_year, gone.class_name, '{}'::jsonb, 'stream_deleted', '{}'::text[]);
        return gone_json;
    end;
    $fn$;
    revoke execute on function public.delete_stream(uuid) from public, anon, authenticated, service_role;
    grant execute on function public.delete_stream(uuid) to authenticated;

    -- The class, label, who it took and when it opened of each deleted
    -- stream among `ids`, from its delete row in the audit log, for a
    -- child's history. Staff who
    -- may read streams.
    create function public.deleted_stream_names(ids uuid[])
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view') then
            raise exception 'not_permitted';
        end if;
        return coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', a.row_id,
                'class_name', a.old_values ->> 'class_name',
                'label', a.old_values ->> 'label',
                'takes', a.old_values ->> 'takes',
                'opened_at', a.old_values ->> 'opened_at'
            ))
            from public.audit_log a
            where a.table_name = 'streams' and a.action = 'delete' and a.row_id = any (ids)
        ), '[]'::jsonb);
    end;
    $fn$;
    revoke execute on function public.deleted_stream_names(uuid[]) from public, anon, authenticated, service_role;
    grant execute on function public.deleted_stream_names(uuid[]) to authenticated;
end;
$migration$;
