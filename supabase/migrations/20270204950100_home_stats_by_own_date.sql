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
-- result or not, whatever happened to the child after. Its day is the date
-- recorded with its result; before a result, the day the S/N was given; and
-- for one a student import brought in, the child's Visit date from the file,
-- never the import day. A retaken interview counts again on its own day.
create function public.home_interviews_by_day(from_day date, to_day date)
returns table (day date, interview_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
    select d.day, count(*)
    from (
        select coalesce(
            i.interview_date,
            case when i.import_batch_id is not null then l.visit_date end,
            (i.registered_at at time zone 'Africa/Dar_es_Salaam')::date
        ) as day
        from public.interviews i
        join public.leads l on l.id = i.lead
    ) d
    where d.day between home_interviews_by_day.from_day and home_interviews_by_day.to_day
    group by d.day;
$$;

-- Applications on each day from from_day to to_day (Tanzania dates, both
-- included), by each lead's own date: the day it was created, or for one a
-- student import brought in, its Visit date from the file (the import day
-- only when the file gave none). The same date Home's Months chart uses.
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
            when l.import_batch_id is not null and l.visit_date is not null then l.visit_date
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
