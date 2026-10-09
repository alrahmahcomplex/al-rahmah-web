-- Enrol First instalment leads on the Academic-year start (slice 9, #109).
--
-- A First instalment lead becomes Enrolled on its year's Academic-year start
-- without anyone acting. #108's recompute_lead_fee already holds the rule:
-- given a date on or after the start, it enrols a First instalment lead,
-- with the trigger `academic_year_start` and the start date when the start
-- is the later of the two dates, and the payment otherwise. It already runs
-- when a payment is recorded and when the start changes. What nothing did
-- yet is reach these leads on the start day itself, when nothing about them
-- changes. This migration adds that:
--
--   - enrol_from_academic_year_start(as_of), replacing #105's stand-in with
--     the same signature, recomputes them through recompute_lead_fee;
--   - enrol_on_academic_year_start_daily(as_of) runs it as the `system`
--     actor, for the daily job;
--   - a pg_cron job runs that every day just after midnight Tanzania time.

-- ---------------------------------------------------------------------------
-- enrol_from_academic_year_start(as_of): recomputes, as of `as_of`, every
-- First instalment lead that isn't Enrolled yet in every year whose
-- Academic-year start is on or before `as_of`, and returns how many it
-- enrolled. Declined leads are never changed; Inactive and Archived leads
-- move through recompute_lead_fee's lifecycle override, as with a payment.
--
-- Leads are taken in id order, as recompute_year_fees takes them, so two
-- runs, or a run and a Fee schedule save, lock them in the same order.
--
-- set_academic_year (#105) calls it with today when a start of today or
-- earlier is set. Granted to no API role.
-- ---------------------------------------------------------------------------

create or replace function public.enrol_from_academic_year_start(as_of date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
    enrolled integer := 0;
begin
    if as_of is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'as_of')::text;
    end if;

    for each_lead in
        select l.id
        from public.leads l
        join public.fee_schedules s on s.enrollment_year = l.enrollment_year
        where s.academic_year_start <= enrol_from_academic_year_start.as_of
          and l.status not in ('Enrolled', 'Declined')
          and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id)
          and (public.lead_seat_priority(l.id)).priority = 'First instalment'
        order by l.id
    loop
        -- Locked before it is counted: a lead something else enrolled or
        -- declined since the list was read is skipped, not counted.
        perform 1 from public.leads l
        where l.id = each_lead and l.status not in ('Enrolled', 'Declined')
        for update;
        if not found then
            continue;
        end if;
        perform public.recompute_lead_fee(each_lead, 'academic_year_start', enrol_from_academic_year_start.as_of);
        if exists (select 1 from public.leads l where l.id = each_lead and l.status = 'Enrolled') then
            enrolled := enrolled + 1;
        end if;
    end loop;

    return enrolled;
end;
$$;

revoke execute on function public.enrol_from_academic_year_start(date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enrol_on_academic_year_start_daily(as_of): the daily job's one call. It
-- names the `system` actor for the transaction, so the lead history shows
-- the System enrolled each lead, then enrols as of `as_of`, today in
-- Tanzania unless given (tests give a date rather than wait for one).
-- Returns how many it enrolled. Granted to no API role.
-- ---------------------------------------------------------------------------

create function public.enrol_on_academic_year_start_daily(as_of date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.set_audit_actor('system');
    return public.enrol_from_academic_year_start(coalesce(as_of, public.tanzania_today()));
end;
$$;

revoke execute on function public.enrol_on_academic_year_start_daily(date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The daily job. pg_cron reads its schedule in UTC. Tanzania keeps UTC+3 all
-- year, with no daylight saving, so 21:05 UTC is 00:05 in Tanzania: just
-- after midnight, on the day tanzania_today() has just turned to. The job
-- runs as the role that scheduled it, the database owner.
--
-- Scheduling is idempotent: a job of the same name is removed first, so
-- running this again leaves one job.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
begin
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'enrol-on-academic-year-start';
    perform cron.schedule(
        'enrol-on-academic-year-start',
        '5 21 * * *',
        'select public.enrol_on_academic_year_start_daily()'
    );
end;
$$;
