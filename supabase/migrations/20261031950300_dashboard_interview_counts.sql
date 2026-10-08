-- Interviewed leads, Passed interviews and Failed interviews on the dashboard
-- (slice 10, #118). dashboard_count gains three metrics read from slice 5's
-- interviews table. Same signature, same grants, same permission check and
-- period arithmetic; only the metric branches are new. Read-only, like the
-- rest of the dashboard.
--
--   interviewed_leads: distinct leads with at least one interview dated in
--   the period with a result recorded. It counts children, so a child who
--   sat a retake in the same period counts once.
--   passed_interviews / failed_interviews: interviews with that result dated
--   in the period. They count sittings, so a retake counts as its own.
--
-- A registered interview with no result has no interview date (the table's
-- interviews_result_complete constraint), so it counts nowhere. The fee
-- status makes no difference, and a Declined, Inactive or Archived lead's
-- interviews still count. The Enrollment year is the lead's current one, not
-- the year the S/N was issued in, so one child counts in one intake on every
-- panel.

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
        else
            raise exception 'invalid';
    end case;
end;
$$;

revoke execute on function public.dashboard_count(text, text, date, integer) from public, anon;
grant execute on function public.dashboard_count(text, text, date, integer) to authenticated;
