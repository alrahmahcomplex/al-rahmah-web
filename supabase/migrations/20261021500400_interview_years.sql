-- The Interviews screen (slice 5, #70) offers the enrollment years that have
-- interview registrations. interview_years lists them, oldest first.
--
-- It runs as the caller (security invoker), so row-level security on
-- interviews decides what it sees: staff with leads.view get every year, and
-- anyone else gets none. Reading the years through the API would otherwise
-- fetch one row per registration.

create function public.interview_years()
returns setof integer
language sql
stable
security invoker
set search_path = ''
as $$
    select distinct i.serial_year from public.interviews i order by 1;
$$;

revoke execute on function public.interview_years() from public, anon;
grant execute on function public.interview_years() to authenticated;
