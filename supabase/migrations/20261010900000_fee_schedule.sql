-- The Fee schedule (slice 9, #104): one schedule per enrollment year, with a
-- Day and a Boarding annual fee for each class band, the instalment split and
-- its due dates, the minimum Initial deposit and the Pre-Form One programme
-- fees. Later slice 9 tickets add the Academic-year start, seats, payments
-- and the fee calculation on top of these tables.
--
-- Both tables are audited under ADR 4's `payment` scope with no lead id.
-- Nothing writes to them through the API: the Accountant's amounts go through
-- save_fee_schedule, which checks payments.record itself.
--
-- Refusal codes: `not_permitted`, and `invalid` with the offending field as
-- JSON in the detail.

-- ---------------------------------------------------------------------------
-- Class bands. The class list is fixed, so the mapping is a fixed function.
-- ---------------------------------------------------------------------------

create type public.fee_band as enum ('nursery', 'primary_lower', 'primary_upper', 'secondary');

create function public.fee_band_of(class_name public.lead_class)
returns public.fee_band
language sql
immutable
set search_path = ''
as $$
    select case class_name
        when 'DAY CARE' then 'nursery'
        when 'KG 1' then 'nursery'
        when 'KG 2' then 'nursery'
        when 'STD 1' then 'primary_lower'
        when 'STD 2' then 'primary_lower'
        when 'STD 3' then 'primary_lower'
        when 'STD 4' then 'primary_lower'
        when 'STD 5' then 'primary_upper'
        when 'STD 6' then 'primary_upper'
        when 'STD 7' then 'primary_upper'
        when 'FORM 1' then 'secondary'
        when 'FORM 2' then 'secondary'
        when 'FORM 3' then 'secondary'
        when 'FORM 4' then 'secondary'
    end::public.fee_band;
$$;

revoke execute on function public.fee_band_of(public.lead_class) from public, anon;
grant execute on function public.fee_band_of(public.lead_class) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The tables. Amounts are whole TZS above zero.
-- ---------------------------------------------------------------------------

create table public.fee_schedules (
    id uuid primary key default gen_random_uuid(),
    enrollment_year integer not null unique check (enrollment_year between 2000 and 2999),
    -- Whole percentages of the School fee for each instalment.
    first_share smallint not null default 40 check (first_share between 1 and 98),
    second_share smallint not null default 40 check (second_share between 1 and 98),
    third_share smallint not null default 20 check (third_share between 1 and 98),
    first_due date not null,
    second_due date not null,
    third_due date not null,
    minimum_deposit integer not null check (minimum_deposit > 0),
    pre_form_one_day_fee integer not null check (pre_form_one_day_fee > 0),
    pre_form_one_boarding_fee integer not null check (pre_form_one_boarding_fee > 0),
    -- Set by the Admissions Manager in a later ticket; a date in January of
    -- the enrollment year.
    academic_year_start date check (
        academic_year_start is null
        or (extract(month from academic_year_start) = 1 and extract(year from academic_year_start) = enrollment_year)
    ),
    created_at timestamptz not null default now(),
    check (first_share + second_share + third_share = 100),
    check (first_due <= second_due and second_due <= third_due)
);

create table public.fee_band_amounts (
    id uuid primary key default gen_random_uuid(),
    enrollment_year integer not null references public.fee_schedules (enrollment_year),
    band public.fee_band not null,
    day_fee integer not null check (day_fee > 0),
    boarding_fee integer not null check (boarding_fee > 0),
    unique (enrollment_year, band)
);

-- Audit (ADR 4): payment scope, no lead id.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.fee_schedules', 'payment', null),
    ('public.fee_band_amounts', 'payment', null);

create trigger audit_row_change
    after insert or update on public.fee_schedules
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.fee_schedules
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.fee_schedules
    for each statement
    execute function public.refuse_delete();

create trigger audit_row_change
    after insert or update on public.fee_band_amounts
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.fee_band_amounts
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.fee_band_amounts
    for each statement
    execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- Row-level security: reads only, for staff who may view payments. Every
-- write is a function below.
-- ---------------------------------------------------------------------------

alter table public.fee_schedules enable row level security;
alter table public.fee_band_amounts enable row level security;

create policy "Staff who may view payments read fee schedules"
    on public.fee_schedules for select
    to authenticated
    using ((select public.has_permission('payments.view')));

create policy "Staff who may view payments read fee band amounts"
    on public.fee_band_amounts for select
    to authenticated
    using ((select public.has_permission('payments.view')));

revoke insert, update, delete, truncate on public.fee_schedules from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.fee_band_amounts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading the Accountant's input. Each raises `invalid` naming the field.
-- ---------------------------------------------------------------------------

create function public.fee_input_invalid(field text)
returns void
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'invalid' using detail = jsonb_build_object('field', field)::text;
end;
$$;

-- A whole number from low to high, given as a JSON number.
create function public.fee_input_whole(value jsonb, field text, low numeric, high numeric)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
    amount numeric;
begin
    if value is null or jsonb_typeof(value) <> 'number' then
        perform public.fee_input_invalid(field);
    end if;
    amount := (value #>> '{}')::numeric;
    if amount <> trunc(amount) or amount < low or amount > high then
        perform public.fee_input_invalid(field);
    end if;
    return amount::integer;
end;
$$;

-- A YYYY-MM-DD date, given as a JSON string.
create function public.fee_input_date(value jsonb, field text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
    if value is null or jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform public.fee_input_invalid(field);
    end if;
    return (value #>> '{}')::date;
exception when invalid_datetime_format or datetime_field_overflow then
    perform public.fee_input_invalid(field);
    return null;
end;
$$;

revoke execute on function public.fee_input_invalid(text) from public, anon, authenticated;
revoke execute on function public.fee_input_whole(jsonb, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.fee_input_date(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- save_fee_schedule: creates a year's schedule, or replaces its amounts, split
-- and due dates. Needs payments.record. Every value is required and checked
-- before anything is written, so a schedule is never half-valid. The
-- Academic-year start is not touched.
--
-- `amounts` holds first_share, second_share, third_share, first_due,
-- second_due, third_due, minimum_deposit, pre_form_one_day_fee,
-- pre_form_one_boarding_fee, and `bands`: for each band, day_fee and
-- boarding_fee. Refused fields are named as those keys, a band's as
-- `<band>.day_fee`, and a split that doesn't add up to 100 as `split`.
-- ---------------------------------------------------------------------------

create function public.save_fee_schedule(schedule_year integer, amounts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    -- Above this, an amount no longer fits the columns.
    most constant numeric := 2147483647;
    shares integer[];
    dues date[];
    deposit integer;
    pre_form_one_day integer;
    pre_form_one_boarding integer;
    each_band public.fee_band;
    band_input jsonb;
    day_fees integer[] := '{}';
    boarding_fees integer[] := '{}';
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    if schedule_year is null or schedule_year not between 2000 and 2999 then
        perform public.fee_input_invalid('enrollment_year');
    end if;
    if amounts is null or jsonb_typeof(amounts) <> 'object' then
        perform public.fee_input_invalid('amounts');
    end if;

    -- Checked in the order the screen shows them, so the first refusal named
    -- is the first one the Accountant reaches.
    foreach each_band in array enum_range(null::public.fee_band) loop
        band_input := amounts -> 'bands' -> each_band::text;
        day_fees := day_fees || public.fee_input_whole(band_input -> 'day_fee', each_band || '.day_fee', 1, most);
        boarding_fees := boarding_fees
            || public.fee_input_whole(band_input -> 'boarding_fee', each_band || '.boarding_fee', 1, most);
    end loop;

    shares := array[
        public.fee_input_whole(amounts -> 'first_share', 'first_share', 1, 98),
        public.fee_input_whole(amounts -> 'second_share', 'second_share', 1, 98),
        public.fee_input_whole(amounts -> 'third_share', 'third_share', 1, 98)
    ];
    if shares[1] + shares[2] + shares[3] <> 100 then
        perform public.fee_input_invalid('split');
    end if;

    dues := array[
        public.fee_input_date(amounts -> 'first_due', 'first_due'),
        public.fee_input_date(amounts -> 'second_due', 'second_due'),
        public.fee_input_date(amounts -> 'third_due', 'third_due')
    ];
    if dues[2] < dues[1] then
        perform public.fee_input_invalid('second_due');
    end if;
    if dues[3] < dues[2] then
        perform public.fee_input_invalid('third_due');
    end if;

    deposit := public.fee_input_whole(amounts -> 'minimum_deposit', 'minimum_deposit', 1, most);
    pre_form_one_day := public.fee_input_whole(amounts -> 'pre_form_one_day_fee', 'pre_form_one_day_fee', 1, most);
    pre_form_one_boarding :=
        public.fee_input_whole(amounts -> 'pre_form_one_boarding_fee', 'pre_form_one_boarding_fee', 1, most);

    insert into public.fee_schedules as s (
        enrollment_year, first_share, second_share, third_share, first_due, second_due, third_due,
        minimum_deposit, pre_form_one_day_fee, pre_form_one_boarding_fee
    ) values (
        schedule_year, shares[1], shares[2], shares[3], dues[1], dues[2], dues[3],
        deposit, pre_form_one_day, pre_form_one_boarding
    )
    on conflict (enrollment_year) do update
    set first_share = excluded.first_share,
        second_share = excluded.second_share,
        third_share = excluded.third_share,
        first_due = excluded.first_due,
        second_due = excluded.second_due,
        third_due = excluded.third_due,
        minimum_deposit = excluded.minimum_deposit,
        pre_form_one_day_fee = excluded.pre_form_one_day_fee,
        pre_form_one_boarding_fee = excluded.pre_form_one_boarding_fee;

    insert into public.fee_band_amounts as a (enrollment_year, band, day_fee, boarding_fee)
    select schedule_year, b.band, b.day_fee, b.boarding_fee
    from unnest(enum_range(null::public.fee_band), day_fees, boarding_fees) as b (band, day_fee, boarding_fee)
    on conflict (enrollment_year, band) do update
    set day_fee = excluded.day_fee,
        boarding_fee = excluded.boarding_fee;
end;
$$;

revoke execute on function public.save_fee_schedule(integer, jsonb) from public, anon;
grant execute on function public.save_fee_schedule(integer, jsonb) to authenticated;
