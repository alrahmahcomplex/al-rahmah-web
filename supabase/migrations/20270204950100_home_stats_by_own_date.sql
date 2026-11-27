-- Home's two stat cards count every record by its own date (#519).
-- Read-only: nothing here writes a row.
--
-- Owner decisions of 2026-11-27: the cards read every interview and every
-- application in the system, imported or entered here, on the day it
-- happened, whatever admission year the child is applying for. The charts'
-- admission year (#518) does not change them; only each card's own calendar
-- does.
--
-- Both functions are security invoker, so row-level security decides what is
-- counted, as before: staff with leads.view count every lead and interview,
-- anyone else counts none. They hand back a day and a number, never a row.

-- Interviews on each day from from_day to to_day (Tanzania dates, both
-- included). An interview counts once its child was given an S/N, with a
-- result or not, whatever happened to the child after. Its day is the
-- interview date staff record with its result, the day the sitting was held,
-- imported or not. Before a result: for one a student import brought in, the
-- child's Visit date from the file; for any other, the day the S/N was given.
-- A retaken interview counts again on its own day.
--
-- Never the import day: when the file gave no Visit date, the import fills
-- in its own day (confirm_student_import), so an imported record whose Visit
-- date is the day it was created has no date of its own and is on no day.
create function public.home_interviews_by_day(from_day date, to_day date)
returns table (day date, interview_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select d.day, count(*)
    from (
        select case
            when i.interview_date is not null then i.interview_date
            when i.import_batch_id is not null then nullif(l.visit_date, (l.created_at at time zone 'Africa/Dar_es_Salaam')::date)
            else (i.registered_at at time zone 'Africa/Dar_es_Salaam')::date
        end as day
        from public.interviews i
        join public.leads l on l.id = i.lead
    ) d
    where d.day between home_interviews_by_day.from_day and home_interviews_by_day.to_day
    group by d.day;
$$;

-- Applications on each day from from_day to to_day (Tanzania dates, both
-- included), by each lead's own date: the day it was created, or for one a
-- student import brought in, its Visit date from the file. An imported lead
-- with no date of its own (no Visit date, or the one the import filled in
-- with its own day) is on no day.
create function public.home_applications_by_day(from_day date, to_day date)
returns table (day date, application_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select d.day, count(*)
    from (
        select case
            when l.import_batch_id is not null then nullif(l.visit_date, (l.created_at at time zone 'Africa/Dar_es_Salaam')::date)
            else (l.created_at at time zone 'Africa/Dar_es_Salaam')::date
        end as day
        from public.leads l
    ) d
    where d.day between home_applications_by_day.from_day and home_applications_by_day.to_day
    group by d.day;
$$;

revoke all on function public.home_interviews_by_day(date, date) from public, anon;
revoke all on function public.home_applications_by_day(date, date) from public, anon;
grant execute on function public.home_interviews_by_day(date, date) to authenticated;
grant execute on function public.home_applications_by_day(date, date) to authenticated;
