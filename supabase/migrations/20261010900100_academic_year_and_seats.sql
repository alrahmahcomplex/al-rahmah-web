-- The Academic-year start and class seats (slice 9, #105). The Admissions
-- Manager sets both on a year's Fee schedule: the start on the schedule's own
-- row, and the number of seats in each class, for day and for boarding, in
-- class_seats. A class with no row has its seats not set.
--
-- class_seats is audited under ADR 4's `payment` scope with no lead id, like
-- the rest of the schedule. Nothing writes to it through the API: the
-- Manager's changes go through set_academic_year, which checks
-- academic_years.manage itself.
--
-- Refusal codes: `not_permitted`, `no_schedule` when the year has no Fee
-- schedule yet, and `invalid` with the offending field as JSON in the detail.

create table public.class_seats (
    id uuid primary key default gen_random_uuid(),
    enrollment_year integer not null references public.fee_schedules (enrollment_year),
    class_name public.lead_class not null,
    day_or_boarding public.day_or_boarding not null,
    seats integer not null check (seats >= 0),
    unique (enrollment_year, class_name, day_or_boarding)
);

-- Audit (ADR 4): payment scope, no lead id.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.class_seats', 'payment', null);

create trigger audit_row_change
    after insert or update on public.class_seats
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.class_seats
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.class_seats
    for each statement
    execute function public.refuse_delete();

-- Row-level security: reads only, for staff who may view payments, as for
-- the rest of the schedule. Every write is set_academic_year below.
alter table public.class_seats enable row level security;

create policy "Staff who may view payments read class seats"
    on public.class_seats for select
    to authenticated
    using ((select public.has_permission('payments.view')));

revoke insert, update, delete, truncate on public.class_seats from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_academic_year: sets a year's Academic-year start and seats. Needs
-- academic_years.manage. The year needs a Fee schedule first, since the start
-- lives on it; the Accountant creates that.
--
-- `settings` holds `academic_year_start`, a YYYY-MM-DD date in January of the
-- year, and `seats`, a list of { class_name, day_or_boarding, seats }. A seat
-- count is a whole number, 0 or more. Classes the list leaves out keep what
-- they have. Null leaves a start or a class that isn't set as it is, but a
-- start or a seat count, once set, can be changed and not cleared.
--
-- Everything is checked before anything is written. Refused fields are named
-- `academic_year_start`, `seats` for a list that can't be read, and
-- `seats.<class>.<Day|Boarding>` for one count.
-- ---------------------------------------------------------------------------

create function public.set_academic_year(schedule_year integer, settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    most constant numeric := 2147483647;
    current_start date;
    new_start date;
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

    if settings -> 'academic_year_start' is null or jsonb_typeof(settings -> 'academic_year_start') = 'null' then
        if current_start is not null then
            perform public.fee_input_invalid('academic_year_start');
        end if;
    else
        new_start := public.fee_input_date(settings -> 'academic_year_start', 'academic_year_start');
        if extract(month from new_start) <> 1 or extract(year from new_start) <> schedule_year then
            perform public.fee_input_invalid('academic_year_start');
        end if;
    end if;

    if settings -> 'seats' is not null and jsonb_typeof(settings -> 'seats') <> 'null' then
        if jsonb_typeof(settings -> 'seats') <> 'array' then
            perform public.fee_input_invalid('seats');
        end if;

        for entry in select value from jsonb_array_elements(settings -> 'seats') loop
            if jsonb_typeof(entry) <> 'object'
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

            if entry -> 'seats' is null or jsonb_typeof(entry -> 'seats') = 'null' then
                if exists (
                    select 1 from public.class_seats c
                    where c.enrollment_year = schedule_year and c.class_name = entry_class and c.day_or_boarding = entry_choice
                ) then
                    perform public.fee_input_invalid(entry_field);
                end if;
            else
                classes := classes || entry_class;
                choices := choices || entry_choice;
                counts := counts || public.fee_input_whole(entry -> 'seats', entry_field, 0, most);
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
end;
$$;

revoke execute on function public.set_academic_year(integer, jsonb) from public, anon;
grant execute on function public.set_academic_year(integer, jsonb) to authenticated;
