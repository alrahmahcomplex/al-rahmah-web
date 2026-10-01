-- A lead's School fee (slice 9, #106): the lead fee profile table, and the
-- fee calculation the lead screen reads.
--
-- The profile holds what slice 9 adds to a lead without adding columns to
-- slice 2's leads table. This migration only creates it; later slice 9
-- tickets fill it through their own functions.
--
-- The fee is the schedule's Day or Boarding fee for the lead's class band, in
-- the lead's own enrollment year. Discounts and payments come in later
-- tickets, which replace lead_fee_amounts and lead_school_fee with
-- `create or replace`; until then the School fee is the band fee and Total
-- paid is 0.
--
-- Refusal codes: `forbidden`, `not_found`.

-- ---------------------------------------------------------------------------
-- The lead fee profile. One row per lead, audited under the `lead` scope.
-- ---------------------------------------------------------------------------

create table public.lead_fee_profiles (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null unique references public.leads (id),
    -- The Pre-Form One tick. Accepted only on a FORM 1 lead; it stays
    -- recorded if a correction moves the lead off FORM 1.
    pre_form_one boolean not null default false,
    -- The prior-sibling tick: an older brother or sister already at the
    -- school before the system, with their name and class.
    prior_sibling boolean not null default false,
    prior_sibling_name text check (prior_sibling_name is null or btrim(prior_sibling_name) <> ''),
    prior_sibling_class public.lead_class,
    -- Written only by the recompute function. True once the lead became
    -- Enrolled while holding the Sibling discount.
    sibling_kept boolean not null default false,
    -- The status the lead had before it became Enrolled, restored if it no
    -- longer qualifies.
    status_before_enrolled public.lead_status check (status_before_enrolled <> 'Enrolled'),
    -- What enrolled the lead, a payment or the Academic-year start, and the
    -- date. The payment's foreign key arrives with the payments table.
    enrolled_trigger text check (enrolled_trigger in ('payment', 'academic_year_start')),
    enrolled_trigger_payment_id uuid,
    enrolled_on date,
    created_at timestamptz not null default now(),
    check (prior_sibling = (prior_sibling_name is not null)),
    check ((prior_sibling_name is null) = (prior_sibling_class is null)),
    check ((enrolled_trigger is null) = (enrolled_on is null)),
    check ((enrolled_trigger is not distinct from 'payment') = (enrolled_trigger_payment_id is not null))
);

-- Audit (ADR 4): the lead's history.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.lead_fee_profiles', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.lead_fee_profiles
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.lead_fee_profiles
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.lead_fee_profiles
    for each statement
    execute function public.refuse_delete();

-- Reads only, for staff who may view leads. Every write is a slice 9
-- function that checks its own permission.
alter table public.lead_fee_profiles enable row level security;

create policy "Staff who may view leads read lead fee profiles"
    on public.lead_fee_profiles for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.lead_fee_profiles from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_fee_amounts: the fee calculation, for slice 9's own functions. No
-- permission check, so no API role may call it. Every amount is empty when
-- the lead's year has no schedule.
--
-- School fee = the band fee, already whole shillings; the discount ticket
-- adds the discount and its rounding. The first and second instalments are
-- the split percentages of it, rounded to the whole shilling; the third is
-- the remainder, so the three add up exactly.
-- ---------------------------------------------------------------------------

create function public.lead_fee_amounts(
    lead_id uuid,
    out enrollment_year integer,
    out band public.fee_band,
    out day_or_boarding public.day_or_boarding,
    out has_schedule boolean,
    out school_fee integer,
    out first_amount integer,
    out first_due date,
    out second_amount integer,
    out second_due date,
    out third_amount integer,
    out third_due date
)
language plpgsql
stable
set search_path = ''
as $$
declare
    lead public.leads;
    schedule public.fee_schedules;
    band_fee integer;
begin
    select * into lead from public.leads l where l.id = lead_fee_amounts.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    enrollment_year := lead.enrollment_year;
    band := public.fee_band_of(lead.class_name);
    day_or_boarding := lead.day_or_boarding;

    select * into schedule from public.fee_schedules s where s.enrollment_year = lead.enrollment_year;
    has_schedule := found;
    if not has_schedule then
        return;
    end if;

    select case lead.day_or_boarding when 'Day' then a.day_fee else a.boarding_fee end
    into band_fee
    from public.fee_band_amounts a
    where a.enrollment_year = lead.enrollment_year and a.band = lead_fee_amounts.band;

    school_fee := band_fee;
    first_amount := round(school_fee::numeric * schedule.first_share / 100)::integer;
    second_amount := round(school_fee::numeric * schedule.second_share / 100)::integer;
    third_amount := school_fee - first_amount - second_amount;
    first_due := schedule.first_due;
    second_due := schedule.second_due;
    third_due := schedule.third_due;
end;
$$;

revoke execute on function public.lead_fee_amounts(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_school_fee: the lead's School fee as the lead screen shows it, for
-- staff who may view both leads and payments. Total paid is 0 until the
-- payments ticket replaces this function.
-- ---------------------------------------------------------------------------

create function public.lead_school_fee(
    lead_id uuid,
    out enrollment_year integer,
    out band public.fee_band,
    out day_or_boarding public.day_or_boarding,
    out has_schedule boolean,
    out school_fee integer,
    out total_paid integer,
    out balance integer,
    out first_amount integer,
    out first_due date,
    out second_amount integer,
    out second_due date,
    out third_amount integer,
    out third_due date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    fee record;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;

    select * into fee from public.lead_fee_amounts(lead_school_fee.lead_id);

    enrollment_year := fee.enrollment_year;
    band := fee.band;
    day_or_boarding := fee.day_or_boarding;
    has_schedule := fee.has_schedule;
    if not has_schedule then
        return;
    end if;

    school_fee := fee.school_fee;
    total_paid := 0;
    balance := school_fee - total_paid;
    first_amount := fee.first_amount;
    first_due := fee.first_due;
    second_amount := fee.second_amount;
    second_due := fee.second_due;
    third_amount := fee.third_amount;
    third_due := fee.third_due;
end;
$$;

revoke execute on function public.lead_school_fee(uuid) from public, anon;
grant execute on function public.lead_school_fee(uuid) to authenticated;
