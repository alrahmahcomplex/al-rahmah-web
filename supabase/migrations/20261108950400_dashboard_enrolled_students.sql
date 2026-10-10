-- Enrolled students on the dashboard (slice 10, #120). dashboard_count gains
-- the metric, read from slice 2's leads and slice 9's lead fee profiles.
-- Same signature, same grants, same permission check and period arithmetic
-- as 20261031950300_dashboard_interview_counts.sql; only the new branch is
-- added. Read-only, like the rest of the dashboard.
--
--   enrolled_students: leads whose status is Enrolled now, counted by the
--   date their lead fee profile says Enrolled was triggered (enrolled_on).
--
-- Slice 9 decides that date and keeps it current: the date a payment reached
-- Full, or the date First instalment was reached once the Academic-year start
-- has passed (the start itself when it came later). Every recompute derives
-- it again, so an adjustment moves it. The dashboard decides none of it. A
-- lead that went back below the line is no longer Enrolled, and a lead
-- Declined after it was Enrolled keeps its profile but not its status, so the
-- status test leaves both out. A closure mark isn't a status, so an Inactive
-- or Archived Enrolled lead still counts. Lead fee profiles are readable under
-- leads.view, the permission the function already checks.

create or replace function public.dashboard_count(metric text, period_kind text, anchor date, enrollment_year integer)
returns bigint
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    bounds record;
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select * into bounds from public.dashboard_period_bounds(period_kind, anchor);

    case metric
        when 'visited_leads' then
            return (
                select count(*)
                from public.leads l
                where l.visit_date is not null
                  and (bounds.starts is null or (l.visit_date >= bounds.starts and l.visit_date < bounds.ends))
                  and (dashboard_count.enrollment_year is null or l.enrollment_year = dashboard_count.enrollment_year)
            );
        when 'interviewed_leads', 'passed_interviews', 'failed_interviews' then
            return (
                select case dashboard_count.metric
                    when 'interviewed_leads' then count(distinct i.lead)
                    when 'passed_interviews' then count(*) filter (where i.result = 'Passed')
                    else count(*) filter (where i.result = 'Failed')
                end
                from public.interviews i
                join public.leads l on l.id = i.lead
                where i.result is not null
                  and (bounds.starts is null or (i.interview_date >= bounds.starts and i.interview_date < bounds.ends))
                  and (dashboard_count.enrollment_year is null or l.enrollment_year = dashboard_count.enrollment_year)
            );
        when 'enrolled_students' then
            return (
                select count(*)
                from public.leads l
                join public.lead_fee_profiles p on p.lead_id = l.id
                where l.status = 'Enrolled'
                  and p.enrolled_on is not null
                  and (bounds.starts is null or (p.enrolled_on >= bounds.starts and p.enrolled_on < bounds.ends))
                  and (dashboard_count.enrollment_year is null or l.enrollment_year = dashboard_count.enrollment_year)
            );
        else
            raise exception 'invalid';
    end case;
end;
$$;

revoke execute on function public.dashboard_count(text, text, date, integer) from public, anon;
grant execute on function public.dashboard_count(text, text, date, integer) to authenticated;
