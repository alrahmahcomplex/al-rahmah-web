-- Streams, switched off (#449, slice 4a of the brief on the ticket).
--
-- Seats move from one count per class and Day or Boarding (class_seats) to
-- streams: groups inside a class and Enrollment year, such as FORM 1 A
-- (Boys), each with its own seats for new students. A child holding a Seat
-- priority is placed automatically in the first stream of their class, in
-- order, that takes them and has a free seat.
--
-- Everything here is switched off: seat_settings.mode starts at `legacy`,
-- open_stream, edit_stream and bring_up_streams refuse with
-- `seat_mode_legacy`, and nothing is ever queued for placement while the
-- mode is legacy. Today's seat counts, warning and seat editing are not
-- touched. Slice 6 moves today's seats into streams and switches the mode.
--
-- 1. btree_gist, for the label rule.
-- 2. seat_settings: the one mode row. Internal; seat_mode() reads it.
-- 3. streams, seat_placements, stream_requests, with RLS (read by staff who
--    may view payments), the audit trigger and refuse_delete.
-- 4. seat_sync_queue: internal. recompute_lead_fee queues the lead (only
--    when the mode is `named`); a deferred constraint trigger flushes the
--    queue at commit, under one school-wide seat lock taken after every
--    Family lock and lead row lock the transaction needs. After the seat
--    lock nothing waits for a lead row: a child is placed only after
--    `for no key update skip locked` on their leads row, and a child skipped
--    stays queued as a retry (run by the next flush or the daily job).
-- 5. A separate trigger queues a sync when a lead's gender changes or it
--    enters Declined. The fee trigger is not changed, so no fee, status or
--    Seat priority moves (brief, invariant 4).
-- 6. open_stream, edit_stream, bring_up_streams and next_stream_label.
--
-- Refusal codes: not_permitted, seat_mode_legacy, not_found, invalid,
-- label_taken, below_placed, no_schedule.
--
-- Rollback: a new migration dropping the triggers, functions and tables
-- here and putting back recompute_lead_fee from 20261211100100.

do $migration$
begin
    perform public.set_audit_actor('system');

    create extension if not exists btree_gist with schema extensions;

    -- -----------------------------------------------------------------------
    -- 2. The seat mode.
    -- -----------------------------------------------------------------------

    create table public.seat_settings (
        id uuid primary key default gen_random_uuid(),
        mode text not null default 'legacy' check (mode in ('legacy', 'named')),
        updated_at timestamptz not null default now()
    );
    comment on table public.seat_settings is
        'One row: how seats are counted. legacy = class_seats (per class and Day or Boarding); named = streams (#449). Only migrations change it.';
    create unique index seat_settings_one_row on public.seat_settings ((true));
    alter table public.seat_settings enable row level security;
    revoke all on public.seat_settings from anon, authenticated, service_role;
    insert into public.seat_settings (mode) values ('legacy');

    create function public.seat_mode()
    returns text
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
        select s.mode from public.seat_settings s;
    $fn$;
    revoke execute on function public.seat_mode() from public, anon, authenticated, service_role;
    grant execute on function public.seat_mode() to authenticated;

    -- -----------------------------------------------------------------------
    -- 3. Streams, placements and requests.
    -- -----------------------------------------------------------------------

    create type public.stream_takes as enum ('Boys', 'Girls', 'Mixed');

    -- Who a stream takes, as a range: a Boys and a Girls stream don't
    -- overlap, a Mixed one overlaps both. The label rule compares these.
    create function public.stream_takes_range(takes public.stream_takes)
    returns int4range
    language sql
    immutable
    set search_path = ''
    as $fn$
        select case takes
            when 'Boys' then int4range(1, 2)
            when 'Girls' then int4range(2, 3)
            else int4range(1, 3)
        end;
    $fn$;
    revoke execute on function public.stream_takes_range(public.stream_takes) from public, anon, authenticated, service_role;

    create table public.streams (
        id uuid primary key default gen_random_uuid(),
        enrollment_year integer not null references public.fee_schedules (enrollment_year),
        class_name public.lead_class not null,
        -- The stream's own part ("A", "B" or a word), shown after its class.
        label text not null check (label = btrim(label) and char_length(label) between 1 and 20),
        takes public.stream_takes not null,
        -- Places for new students that year, not the stream's size.
        seats integer not null check (seats >= 0),
        -- The order children fill the class's streams in, from 1.
        position integer not null check (position >= 1),
        opened_by uuid references public.staff_members (id),
        opened_at timestamptz not null default now(),
        -- A retry of open_stream with the same request hands back this stream.
        request_id uuid unique,
        -- The stream of the year before it was brought up from; each once.
        brought_up_from uuid unique references public.streams (id),
        updated_at timestamptz not null default now(),
        unique (enrollment_year, class_name, position),
        -- A Boys and a Girls stream may share a label; no other two streams
        -- of a class and year may (case does not count).
        constraint streams_label_clash exclude using gist (
            enrollment_year with =,
            class_name with =,
            (lower(label)) with =,
            (public.stream_takes_range(takes)) with &&
        )
    );
    comment on table public.streams is
        'Streams of a class and Enrollment year (#449): label, who it takes, seats for new students and order. Written only by open_stream, edit_stream and bring_up_streams.';
    create index streams_opened_by_idx on public.streams (opened_by);

    create table public.seat_placements (
        id uuid primary key default gen_random_uuid(),
        lead_id uuid not null unique references public.leads (id),
        -- Null: the child holds no seat now (it was given back, or none
        -- was free).
        stream_id uuid references public.streams (id),
        -- Set while the child holds a Seat priority and waits for a stream
        -- in that class and year: since when, and the transaction that
        -- recorded it. A child waiting from an earlier transaction is served
        -- before any newcomer (brief, invariant 5); a child moved to another
        -- class or year starts waiting afresh there.
        waiting_since timestamptz,
        waiting_xid xid8,
        waiting_year integer,
        waiting_class public.lead_class,
        check (stream_id is null or waiting_since is null),
        check ((waiting_since is null) = (waiting_xid is null)
               and (waiting_since is null) = (waiting_year is null)
               and (waiting_since is null) = (waiting_class is null)),
        cause text not null,
        changed_at timestamptz not null default now()
    );
    comment on table public.seat_placements is
        'Where each child who has held a seat in a class with streams sits (#449). Null stream: not placed now. Written only by the seat sync.';
    create index seat_placements_stream_id_idx on public.seat_placements (stream_id);

    create table public.stream_requests (
        id uuid primary key default gen_random_uuid(),
        enrollment_year integer not null references public.fee_schedules (enrollment_year),
        class_name public.lead_class not null,
        -- Boys or Girls; null for any child.
        need public.stream_takes check (need is distinct from 'Mixed'),
        lead_id uuid references public.leads (id),
        requested_by uuid not null references public.staff_members (id),
        requested_at timestamptz not null default now(),
        resolved_at timestamptz,
        resolved_by_stream_id uuid references public.streams (id)
    );
    comment on table public.stream_requests is
        'A staff member''s request that a new stream be opened (#449). request_stream (slice 4b) writes it.';
    create unique index stream_requests_one_open on public.stream_requests (enrollment_year, class_name, need, lead_id)
        nulls not distinct where resolved_at is null;
    create index stream_requests_lead_id_idx on public.stream_requests (lead_id);
    create index stream_requests_requested_by_idx on public.stream_requests (requested_by);
    create index stream_requests_resolved_by_stream_id_idx on public.stream_requests (resolved_by_stream_id);

    alter table public.streams enable row level security;
    alter table public.seat_placements enable row level security;
    alter table public.stream_requests enable row level security;

    create policy "Staff who may view payments read streams"
        on public.streams for select to authenticated
        using ((select public.has_permission('payments.view')));
    create policy "Staff who may view payments read seat placements"
        on public.seat_placements for select to authenticated
        using ((select public.has_permission('payments.view')));
    create policy "Staff who may view payments read stream requests"
        on public.stream_requests for select to authenticated
        using ((select public.has_permission('payments.view')));

    revoke insert, update, delete, truncate on public.streams from anon, authenticated, service_role;
    revoke insert, update, delete, truncate on public.seat_placements from anon, authenticated, service_role;
    revoke insert, update, delete, truncate on public.stream_requests from anon, authenticated, service_role;

    insert into public.audit_scopes (table_name, scope, lead_id_column) values
        ('public.streams', 'payment', null),
        ('public.seat_placements', 'payment', 'lead_id'),
        ('public.stream_requests', 'payment', 'lead_id'),
        ('public.seat_settings', 'payment', null);

    create trigger audit_row_change after insert or update on public.streams
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.streams
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.streams
        for each statement execute function public.refuse_delete();

    create trigger audit_row_change after insert or update on public.seat_placements
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.seat_placements
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.seat_placements
        for each statement execute function public.refuse_delete();

    create trigger audit_row_change after insert or update on public.stream_requests
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.stream_requests
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.stream_requests
        for each statement execute function public.refuse_delete();

    create trigger audit_row_change after insert or update on public.seat_settings
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.seat_settings
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.seat_settings
        for each statement execute function public.refuse_delete();

    -- -----------------------------------------------------------------------
    -- 4. The seat lock, the shared rules, the queue and the sync.
    -- -----------------------------------------------------------------------

    -- One school-wide lock for every seat decision. Volatile and its own
    -- statement, so what a caller reads after it is read after the wait.
    create function public.seat_lock()
    returns void
    language plpgsql
    volatile
    set search_path = ''
    as $fn$
    begin
        perform pg_advisory_xact_lock(hashtext('al-rahmah:seats'));
    end;
    $fn$;
    revoke execute on function public.seat_lock() from public, anon, authenticated, service_role;

    -- Whether a stream takes a child: a Mixed one takes every child; a Boys
    -- or Girls one takes only a child with that answer.
    create function public.stream_takes_child(takes public.stream_takes, gender public.student_gender)
    returns boolean
    language sql
    immutable
    set search_path = ''
    as $fn$
        select takes = 'Mixed'
            or (takes = 'Boys' and gender = 'Boy')
            or (takes = 'Girls' and gender = 'Girl');
    $fn$;
    revoke execute on function public.stream_takes_child(public.stream_takes, public.student_gender)
        from public, anon, authenticated, service_role;

    -- The children holding a seat (a Seat priority, not Declined) in one
    -- class and year, ranked: Full, First instalment, Deposit; then the date
    -- reached; then Admission Number. seat_holders' rule, for one class.
    create function public.class_seat_holders(schedule_year integer, class public.lead_class)
    returns table (lead_id uuid, gender public.student_gender, place bigint)
    language sql
    stable
    set search_path = ''
    as $fn$
        select h.lead_id, l.gender,
               row_number() over (order by h.priority desc, h.reached_on, h.admission_number)
        from public.seat_holders(schedule_year) h
        join public.leads l on l.id = h.lead_id
        where h.class_name = class_seat_holders.class;
    $fn$;
    revoke execute on function public.class_seat_holders(integer, public.lead_class) from public, anon, authenticated, service_role;

    create table public.seat_sync_queue (
        id bigint generated always as identity primary key,
        -- No foreign key: its check would wait on a lead row another
        -- transaction holds, which the seat lock's rule forbids. Leads are
        -- never deleted (refuse_delete).
        lead_id uuid not null,
        cause text not null,
        -- A child skipped because another transaction held their row: kept
        -- past the commit, run by the next flush or the daily job.
        retry boolean not null default false,
        actor_kind text,
        actor_staff_id uuid,
        queued_at timestamptz not null default now()
    );
    comment on table public.seat_sync_queue is
        'Internal (#449): leads whose seat is checked at the end of the transaction, and children skipped while their row was busy.';
    create unique index seat_sync_queue_once on public.seat_sync_queue (lead_id) where not retry;
    create unique index seat_sync_queue_retry_once on public.seat_sync_queue (lead_id) where retry;
    alter table public.seat_sync_queue enable row level security;
    revoke all on public.seat_sync_queue from anon, authenticated, service_role;

    -- Queues a lead's seat for the end of the transaction. Nothing while
    -- the mode is legacy. The actor is kept, since some blocks clear theirs
    -- before the commit.
    create function public.queue_seat_sync(lead_id uuid, cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    #variable_conflict use_column
    declare
        actor record;
    begin
        if public.seat_mode() <> 'named' then
            return;
        end if;
        select * into actor from public.audit_actor();
        insert into public.seat_sync_queue (lead_id, cause, actor_kind, actor_staff_id)
        values (queue_seat_sync.lead_id, queue_seat_sync.cause, actor.kind, actor.staff_id)
        on conflict (lead_id) where not retry do nothing;
    end;
    $fn$;
    revoke execute on function public.queue_seat_sync(uuid, text) from public, anon, authenticated, service_role;

    -- set_seat_placement(lead, stream, waiting_in_year, waiting_in_class,
    -- cause): the one writer of seat_placements. With a stream, the child is
    -- placed there. With no stream and a class, the child waits in that class
    -- and year; a child already waiting there keeps when they started and
    -- the transaction that recorded it. With neither, the child holds no seat
    -- and does not wait. Nothing is written until the child's row is held
    -- (`for no key update skip locked`), because the audit row and the key
    -- check would otherwise wait on it; false means the row was busy and the
    -- caller queues a retry.
    create function public.set_seat_placement(
        lead_id uuid,
        stream_id uuid,
        waiting_in_year integer,
        waiting_in_class public.lead_class,
        cause text
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    #variable_conflict use_column
    declare
        current_row public.seat_placements;
        waits boolean := set_seat_placement.stream_id is null and set_seat_placement.waiting_in_class is not null;
        same_wait boolean;
    begin
        perform 1 from public.leads l where l.id = set_seat_placement.lead_id for no key update skip locked;
        if not found then
            return false;
        end if;

        select * into current_row from public.seat_placements p where p.lead_id = set_seat_placement.lead_id;
        same_wait := waits and current_row.waiting_class is not distinct from set_seat_placement.waiting_in_class
                     and current_row.waiting_year is not distinct from set_seat_placement.waiting_in_year
                     and current_row.waiting_since is not null;

        if current_row.id is null then
            if set_seat_placement.stream_id is null and not waits then
                return true;
            end if;
            insert into public.seat_placements (lead_id, stream_id, waiting_since, waiting_xid, waiting_year, waiting_class, cause)
            values (
                set_seat_placement.lead_id, set_seat_placement.stream_id,
                case when waits then now() end,
                case when waits then pg_current_xact_id() end,
                case when waits then set_seat_placement.waiting_in_year end,
                case when waits then set_seat_placement.waiting_in_class end,
                set_seat_placement.cause
            );
            return true;
        end if;

        if current_row.stream_id is not distinct from set_seat_placement.stream_id
           and ((waits and same_wait) or (not waits and current_row.waiting_since is null)) then
            return true;
        end if;

        update public.seat_placements p
        set stream_id = set_seat_placement.stream_id,
            waiting_since = case when same_wait then current_row.waiting_since when waits then now() end,
            waiting_xid = case when same_wait then current_row.waiting_xid when waits then pg_current_xact_id() end,
            waiting_year = case when waits then set_seat_placement.waiting_in_year end,
            waiting_class = case when waits then set_seat_placement.waiting_in_class end,
            cause = set_seat_placement.cause,
            changed_at = now()
        where p.lead_id = set_seat_placement.lead_id;
        return true;
    end;
    $fn$;
    revoke execute on function public.set_seat_placement(uuid, uuid, integer, public.lead_class, text)
        from public, anon, authenticated, service_role;

    -- A child whose row was busy: run again by the next flush or the daily
    -- job. The queue has no foreign key, so this never waits.
    create function public.queue_seat_retry(lead_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    #variable_conflict use_column
    begin
        insert into public.seat_sync_queue (lead_id, cause, retry)
        values (queue_seat_retry.lead_id, 'retry', true)
        on conflict (lead_id) where retry do nothing;
    end;
    $fn$;
    revoke execute on function public.queue_seat_retry(uuid) from public, anon, authenticated, service_role;

    -- reconcile_class_seats(year, class, causes, default_cause, retried):
    -- the one place seats are given and taken back, for one class and year,
    -- under the seat lock.
    --   1. Children placed in a stream of this class that still holds them
    --      and still takes them stay (nobody is moved to tidy up). Others are
    --      cleared.
    --   2. Children recorded as waiting here who no longer hold a seat here
    --      stop waiting.
    --   3. The free seats go, in ranking order, first to children already
    --      waiting here (recorded by an earlier transaction, or retried
    --      because their row was busy), then to everyone else, each to the
    --      first stream in order that takes them and has a seat. A child with
    --      no seat is recorded as waiting here.
    -- Every write goes through set_seat_placement; a busy row is skipped and
    -- retried, and a seat it holds keeps counting, so nobody is over the
    -- seats and nobody passes a waiting child. `causes` gives each queued
    -- child's own cause; the others take `default_cause`.
    create function public.reconcile_class_seats(
        schedule_year integer,
        class public.lead_class,
        causes jsonb,
        default_cause text,
        retried uuid[]
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
                    perform public.queue_seat_retry(stale.lead_id);
                end if;
            end loop;
            return;
        end if;

        -- 1. Seats no longer held, or in a stream that no longer takes the child.
        for placed in
            select p.lead_id, s.takes, h.lead_id is not null as holds, h.gender
            from public.seat_placements p
            join public.streams s on s.id = p.stream_id
            left join public.class_seat_holders(schedule_year, class) h on h.lead_id = p.lead_id
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
                perform public.queue_seat_retry(placed.lead_id);
            end if;
        end loop;

        -- 2. Waiting here, but no longer holding a seat here.
        for stale in
            select p.lead_id from public.seat_placements p
            where p.waiting_year = schedule_year and p.waiting_class = class
              and not exists (select 1 from public.class_seat_holders(schedule_year, class) h where h.lead_id = p.lead_id)
        loop
            if not public.set_seat_placement(stale.lead_id, null, null, null,
                    coalesce(causes ->> stale.lead_id::text, default_cause)) then
                perform public.queue_seat_retry(stale.lead_id);
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
            from public.class_seat_holders(schedule_year, class) h
            left join public.seat_placements p on p.lead_id = h.lead_id
            where not (h.lead_id = any (settled))
            -- coalesce: a child with no row has no waiting, and a null
            -- would sort first under desc.
            order by coalesce(
                h.lead_id = any (coalesce(retried, '{}'))
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
                perform public.queue_seat_retry(holder.lead_id);
            end if;
        end loop;
    end;
    $fn$;
    revoke execute on function public.reconcile_class_seats(integer, public.lead_class, jsonb, text, uuid[])
        from public, anon, authenticated, service_role;

    create function public.seat_classes_of(leads uuid[])
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
        ) x
        order by 1, 2;
    $fn$;
    revoke execute on function public.seat_classes_of(uuid[]) from public, anon, authenticated, service_role;

    -- flush_seat_queue(): runs this transaction's queued leads, and every
    -- retry left by earlier ones, under the seat lock. Each class and year
    -- they touch is reconciled once: the one they are in now and the one
    -- their seat was in. Returns how many leads it ran.
    create function public.flush_seat_queue()
    returns integer
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        queued record;
        own uuid[] := '{}';
        causes jsonb := '{}'::jsonb;
        actor_kind text;
        actor_staff uuid;
        retries uuid[];
        pair record;
        touched integer;
    begin
        if not exists (select 1 from public.seat_sync_queue q where not q.retry) then
            return 0;
        end if;

        perform public.seat_lock();

        for queued in
            delete from public.seat_sync_queue q where not q.retry
            returning q.lead_id, q.cause, q.actor_kind, q.actor_staff_id, q.id
        loop
            own := own || queued.lead_id;
            causes := causes || jsonb_build_object(queued.lead_id::text, queued.cause);
            actor_kind := coalesce(actor_kind, queued.actor_kind);
            actor_staff := coalesce(actor_staff, queued.actor_staff_id);
        end loop;
        if cardinality(own) = 0 then
            return 0;
        end if;

        with gone as (delete from public.seat_sync_queue q where q.retry returning q.lead_id)
        select coalesce(array_agg(g.lead_id), '{}') into retries from gone g;

        -- Some blocks clear their actor before the commit: the queue kept it.
        if (select a.kind from public.audit_actor() a) is null and actor_kind is not null then
            perform set_config('audit.actor_kind', actor_kind, true);
            perform set_config('audit.actor_staff_id', coalesce(actor_staff::text, ''), true);
        end if;

        touched := 0;
        for pair in select * from public.seat_classes_of(own || retries)
        loop
            perform public.reconcile_class_seats(pair.enrollment_year, pair.class_name, causes, 'seat_freed', retries);
            touched := touched + 1;
        end loop;

        return cardinality(own);
    end;
    $fn$;
    revoke execute on function public.flush_seat_queue() from public, anon, authenticated, service_role;

    -- At the commit of every transaction that queued a lead.
    create function public.flush_seat_queue_at_commit()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        perform public.flush_seat_queue();
        return null;
    end;
    $fn$;
    revoke execute on function public.flush_seat_queue_at_commit() from public, anon, authenticated, service_role;

    create constraint trigger flush_seat_queue_at_commit
        after insert on public.seat_sync_queue
        deferrable initially deferred
        for each row
        when (not new.retry)
        execute function public.flush_seat_queue_at_commit();

    -- The daily job's call: children skipped because their row was busy get
    -- their seat within a day, even if nobody touches anything.
    create function public.run_seat_retries()
    returns integer
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        retries uuid[];
        pair record;
    begin
        if not exists (select 1 from public.seat_sync_queue q where q.retry) then
            return 0;
        end if;
        perform public.set_audit_actor('system');
        perform public.seat_lock();
        with gone as (delete from public.seat_sync_queue q where q.retry returning q.lead_id)
        select coalesce(array_agg(g.lead_id), '{}') into retries from gone g;
        for pair in select * from public.seat_classes_of(retries)
        loop
            perform public.reconcile_class_seats(pair.enrollment_year, pair.class_name, '{}'::jsonb, 'seat_freed', retries);
        end loop;
        return cardinality(retries);
    end;
    $fn$;
    revoke execute on function public.run_seat_retries() from public, anon, authenticated, service_role;

    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'seat-retries';
    perform cron.schedule('seat-retries', '10 21 * * *', 'select public.run_seat_retries()');

    -- 5. A gender change or entering Declined queues the seat; the fee
    -- trigger stays as it is.
    create function public.queue_seat_sync_on_lead_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        perform public.queue_seat_sync(
            new.id,
            case when new.status = 'Declined' and old.status <> 'Declined' then 'declined' else 'gender' end
        );
        return null;
    end;
    $fn$;
    revoke execute on function public.queue_seat_sync_on_lead_change() from public, anon, authenticated, service_role;

    create trigger queue_seat_sync_on_lead_change
        after update of gender, status on public.leads
        for each row
        when (
            old.gender is distinct from new.gender
            or (new.status = 'Declined' and old.status <> 'Declined')
        )
        execute function public.queue_seat_sync_on_lead_change();

    -- recompute_lead_fee, as 20261211100100 made it, queueing the lead's
    -- seat after its row lock and before the early return for Declined.
    create or replace function public.recompute_lead_fee(lead_id uuid, cause text, as_of date default null)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        target public.leads;
        profile public.lead_fee_profiles;
        lines record;
        start_on date;
        -- The Academic-year sweep sets its date for the transaction, so a sibling
        -- its cascade recomputes is judged on the same day.
        on_date date := coalesce(as_of, nullif(current_setting('app.recompute_as_of', true), '')::date, public.tanzania_today());
        from_start date;
        qualifies boolean := false;
        trigger_kind text;
        trigger_payment uuid;
        trigger_on date;
        before_enrolled public.lead_status;
        next_status public.lead_status;
        earlier_override text;
        locked_contact uuid;
        keeps_sibling boolean := false;
        clears_import boolean := false;
    begin
        if cause is null or cause not in (
            'payment', 'payment_adjustment', 'discount', 'fee_schedule',
            'lead_details', 'family', 'academic_year_start', 'reopening',
            'sibling', 'prior_sibling'
        ) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'cause')::text;
        end if;

        -- The Family lock first, then the row: two recomputes in one Family take
        -- turns, and the second sees what the first enrolled.
        locked_contact := public.lock_lead_family(recompute_lead_fee.lead_id);

        -- Locked, so two recomputes of one lead take turns and the second sees
        -- what the first wrote.
        select * into target from public.leads l where l.id = recompute_lead_fee.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        -- Moved to another contact before the row lock was taken.
        if target.guardian_contact_id is distinct from locked_contact then
            perform public.lock_families(array[target.guardian_contact_id]);
        end if;

        -- Streams (#449): the lead's seat is checked at the end of the
        -- transaction, a Declined one too. Nothing while the mode is legacy.
        perform public.queue_seat_sync(target.id, recompute_lead_fee.cause);

        -- The stored Sibling result first: the fee below reads it. A Declined
        -- lead's fee reads it too.
        perform public.refresh_sibling_result(target.id, recompute_lead_fee.cause);

        -- A Declined lead keeps its payments and its status.
        if target.status = 'Declined' then
            return;
        end if;

        select * into profile from public.lead_fee_profiles p where p.lead_id = target.id;
        select * into lines from public.lead_fee_crossings(target.id);

        if lines.has_schedule and lines.payments > 0 then
            select s.academic_year_start into start_on
            from public.fee_schedules s
            where s.enrollment_year = target.enrollment_year;

            if lines.first_on is not null and start_on is not null and greatest(lines.first_on, start_on) <= on_date then
                from_start := greatest(lines.first_on, start_on);
            end if;

            if lines.full_on is not null and (from_start is null or lines.full_on <= from_start) then
                qualifies := true;
                trigger_kind := 'payment';
                trigger_payment := lines.full_payment_id;
                trigger_on := lines.full_on;
            elsif from_start is not null then
                qualifies := true;
                if start_on > lines.first_on then
                    trigger_kind := 'academic_year_start';
                    trigger_on := start_on;
                else
                    trigger_kind := 'payment';
                    trigger_payment := lines.first_payment_id;
                    trigger_on := lines.first_on;
                end if;
            end if;
        end if;

        if qualifies then
            next_status := 'Enrolled';
            before_enrolled := case when target.status = 'Enrolled' then profile.status_before_enrolled else target.status end;
            clears_import := target.enrolled_by_import;
        elsif target.enrolled_by_import and target.status = 'Enrolled' then
            -- The import's Enrolled stands until a payment qualifies.
            next_status := target.status;
        elsif target.status = 'Enrolled' and profile.enrolled_trigger is not null then
            -- Interviewed when the earlier status was never kept: the status a
            -- lead holds once it may pay.
            next_status := coalesce(profile.status_before_enrolled, 'Interviewed');
        else
            next_status := target.status;
        end if;

        -- Becoming Enrolled fixes the Sibling result the lead holds now, the 10%
        -- or the full fee, whatever its siblings do later (R27, R35). A lead
        -- locked on an earlier enrolment keeps that lock.
        if next_status = 'Enrolled' and target.status <> 'Enrolled' then
            perform public.lock_sibling_result(target.id, recompute_lead_fee.cause, false);
            keeps_sibling := not coalesce(profile.sibling_kept, false) and exists (
                select 1 from public.lead_sibling_results r where r.lead_id = target.id and r.locked_result = 'ten'
            );
        end if;

        -- Also written, for its cause alone, when the status is about to move
        -- and the profile's cause is another one: a lead declined while Enrolled
        -- keeps its profile, and when a reopening enrols it again the history
        -- must say the reopening did it, not the payment that first did.
        if (profile.id is null and (before_enrolled is not null or trigger_kind is not null))
           or (profile.id is not null and (
               profile.status_before_enrolled,
               profile.enrolled_trigger,
               profile.enrolled_trigger_payment_id,
               profile.enrolled_on
           ) is distinct from (before_enrolled, trigger_kind, trigger_payment, trigger_on))
           or (profile.id is not null
               and next_status <> target.status
               and profile.recompute_cause is distinct from recompute_lead_fee.cause)
           or keeps_sibling then
            insert into public.lead_fee_profiles as p (
                lead_id, status_before_enrolled, enrolled_trigger, enrolled_trigger_payment_id, enrolled_on, recompute_cause,
                sibling_kept
            ) values (
                target.id, before_enrolled, trigger_kind, trigger_payment, trigger_on, recompute_lead_fee.cause, keeps_sibling
            )
            on conflict on constraint lead_fee_profiles_lead_id_key do update
            set status_before_enrolled = excluded.status_before_enrolled,
                enrolled_trigger = excluded.enrolled_trigger,
                enrolled_trigger_payment_id = excluded.enrolled_trigger_payment_id,
                enrolled_on = excluded.enrolled_on,
                recompute_cause = excluded.recompute_cause,
                sibling_kept = p.sibling_kept or excluded.sibling_kept;
        end if;

        if next_status <> target.status or clears_import then
            -- Slice 8's override lets this one update through on an Inactive or
            -- Archived lead; the caller's own override comes back after it.
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform public.set_lead_lifecycle_override('payment_recompute');
            update public.leads l
            set status = next_status,
                enrolled_by_import = l.enrolled_by_import and not clears_import
            where l.id = target.id;
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;
    end;
    $fn$;

    revoke execute on function public.recompute_lead_fee(uuid, text, date) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- 6. Opening, editing and bringing up streams.
    -- -----------------------------------------------------------------------

    -- The one label allocator: A … Z, then AA, AB … AZ, BA …, the first one
    -- no stream of that class and year clashes with (case does not count; a
    -- Mixed stream clashes with every stream, a Boys one with Boys and Mixed,
    -- a Girls one with Girls and Mixed).
    create function public.next_stream_label(schedule_year integer, class public.lead_class, takes public.stream_takes)
    returns text
    language plpgsql
    stable
    set search_path = ''
    as $fn$
    declare
        n integer := 0;
        candidate text;
        rest integer;
    begin
        loop
            candidate := '';
            rest := n + 1;
            while rest > 0 loop
                candidate := chr(65 + (rest - 1) % 26) || candidate;
                rest := (rest - 1) / 26;
            end loop;
            if not exists (
                select 1 from public.streams s
                where s.enrollment_year = schedule_year and s.class_name = class
                  and lower(s.label) = lower(candidate)
                  and public.stream_takes_range(s.takes) && public.stream_takes_range(next_stream_label.takes)
            ) then
                return candidate;
            end if;
            n := n + 1;
        end loop;
    end;
    $fn$;
    revoke execute on function public.next_stream_label(integer, public.lead_class, public.stream_takes)
        from public, anon, authenticated, service_role;

    create function public.stream_json(s public.streams)
    returns jsonb
    language sql
    stable
    set search_path = ''
    as $fn$
        select jsonb_build_object(
            'id', s.id, 'enrollment_year', s.enrollment_year, 'class_name', s.class_name, 'label', s.label,
            'takes', s.takes, 'seats', s.seats, 'position', s.position, 'brought_up_from', s.brought_up_from,
            'placed', (select count(*) from public.seat_placements p where p.stream_id = s.id)
        );
    $fn$;
    revoke execute on function public.stream_json(public.streams) from public, anon, authenticated, service_role;

    -- open_stream(year, class, label, takes, seats, request_id): appends a
    -- stream at the end of the class's order and places the children
    -- waiting there whom it takes. A retry with the same request_id hands
    -- back the stream already opened.
    create function public.open_stream(
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
        clean_label text := btrim(open_stream.label);
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
        if clean_label is null or char_length(clean_label) not between 1 and 20 then
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

        if exists (
            select 1 from public.streams s
            where s.enrollment_year = schedule_year and s.class_name = class
              and lower(s.label) = lower(clean_label)
              and public.stream_takes_range(s.takes) && public.stream_takes_range(open_stream.takes)
        ) then
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

        perform public.reconcile_class_seats(schedule_year, class, '{}'::jsonb, 'stream_opened', '{}');
        return public.stream_json(made);
    end;
    $fn$;
    revoke execute on function public.open_stream(integer, public.lead_class, text, public.stream_takes, integer, uuid)
        from public, anon, authenticated, service_role;
    grant execute on function public.open_stream(integer, public.lead_class, text, public.stream_takes, integer, uuid) to authenticated;

    -- edit_stream(stream, label, seats): corrects a stream's label and seats,
    -- never below the children placed in it. Raising the seats places
    -- children waiting there. Who it takes and its position never change.
    create function public.edit_stream(stream_id uuid, label text, seats integer)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        clean_label text := btrim(edit_stream.label);
        current_stream public.streams;
        placed integer;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('academic_years.manage') then
            raise exception 'not_permitted';
        end if;
        if public.seat_mode() <> 'named' then
            raise exception 'seat_mode_legacy';
        end if;
        if clean_label is null or char_length(clean_label) not between 1 and 20 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'label')::text;
        end if;
        if seats is null or seats < 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'seats')::text;
        end if;

        select * into current_stream from public.streams s where s.id = edit_stream.stream_id;
        if not found then
            raise exception 'not_found';
        end if;
        perform 1 from public.fee_schedules f where f.enrollment_year = current_stream.enrollment_year for key share;

        perform public.seat_lock();

        -- Read again after the wait.
        select * into current_stream from public.streams s where s.id = edit_stream.stream_id;
        select count(*) into placed from public.seat_placements p where p.stream_id = current_stream.id;
        if seats < placed then
            raise exception 'below_placed' using detail = jsonb_build_object('placed', placed)::text;
        end if;
        if exists (
            select 1 from public.streams s
            where s.enrollment_year = current_stream.enrollment_year and s.class_name = current_stream.class_name
              and s.id <> current_stream.id
              and lower(s.label) = lower(clean_label)
              and public.stream_takes_range(s.takes) && public.stream_takes_range(current_stream.takes)
        ) then
            raise exception 'label_taken';
        end if;

        update public.streams s
        set label = clean_label, seats = edit_stream.seats, updated_at = now()
        where s.id = current_stream.id
        returning * into current_stream;

        perform public.reconcile_class_seats(current_stream.enrollment_year, current_stream.class_name, '{}'::jsonb, 'seat_freed', '{}');
        return public.stream_json(current_stream);
    end;
    $fn$;
    revoke execute on function public.edit_stream(uuid, text, integer) from public, anon, authenticated, service_role;
    grant execute on function public.edit_stream(uuid, text, integer) to authenticated;

    -- bring_up_streams(year, sources): each source, a stream of the year
    -- before not yet brought up and not FORM 4, becomes a stream of the next
    -- class in `year` with the same label (the next free one if taken) and
    -- who it takes, and 0 seats, after the streams that class already has,
    -- in the sources' order. A source already brought up is skipped, so a
    -- second press adds nothing. No child moves.
    create function public.bring_up_streams(schedule_year integer, sources uuid[])
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
            new_label := case when exists (
                select 1 from public.streams s
                where s.enrollment_year = schedule_year and s.class_name = to_class
                  and lower(s.label) = lower(source.label)
                  and public.stream_takes_range(s.takes) && public.stream_takes_range(source.takes)
            ) then public.next_stream_label(schedule_year, to_class, source.takes) else source.label end;

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
            perform public.reconcile_class_seats(schedule_year, each_class, '{}'::jsonb, 'stream_opened', '{}');
        end loop;
        return out_list;
    end;
    $fn$;
    revoke execute on function public.bring_up_streams(integer, uuid[]) from public, anon, authenticated, service_role;
    grant execute on function public.bring_up_streams(integer, uuid[]) to authenticated;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
