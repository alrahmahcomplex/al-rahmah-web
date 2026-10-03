-- The dashboard's counts (slice 10, #33). Read-only: nothing here writes a
-- row, so reading the dashboard leaves no trace in the audit history.
--
-- dashboard_count answers one single-number metric over a period and an
-- Enrollment year. It supports `visited_leads`; later dashboard tickets add
-- their metric as one more branch with `create or replace`, keeping the
-- signature, the permission check and the period arithmetic as they are.
--
-- Refusal codes: `forbidden` (no leads.view; raised so a missing permission
-- never reads as an empty intake) and `invalid` (an unknown metric or period).

-- ---------------------------------------------------------------------------
-- The period's bounds: the first day it covers and the first day after it.
-- Both are null for All time. Weeks run Monday to Sunday, which is what
-- date_trunc('week') gives. Anchors are calendar dates in Tanzania time, and
-- the dates compared against them are too.
-- ---------------------------------------------------------------------------

create function public.dashboard_period_bounds(period_kind text, anchor date, out starts date, out ends date)
language plpgsql
immutable
set search_path = ''
as $$
begin
    if period_kind = 'all' then
        return;
    end if;
    if anchor is null then
        raise exception 'invalid';
    end if;

    case period_kind
        when 'date' then
            starts := anchor;
            ends := anchor + 1;
        when 'week' then
            starts := date_trunc('week', anchor::timestamp)::date;
            ends := starts + 7;
        when 'month' then
            starts := date_trunc('month', anchor::timestamp)::date;
            ends := (starts + interval '1 month')::date;
        when 'year' then
            starts := date_trunc('year', anchor::timestamp)::date;
            ends := (starts + interval '1 year')::date;
        else
            raise exception 'invalid';
    end case;
end;
$$;

revoke execute on function public.dashboard_period_bounds(text, date) from public, anon;
grant execute on function public.dashboard_period_bounds(text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- dashboard_count: one metric's count. Security invoker, so each table's own
-- select policy decides what it reads; the explicit check comes first so a
-- staff member without leads.view is refused rather than shown zero.
--
--   visited_leads: leads whose Visit date falls in the period, whatever their
--   status or closure mark now. An Applied lead has no Visit date.
--
-- The Enrollment year is the lead's current one, on every metric.
-- ---------------------------------------------------------------------------

create function public.dashboard_count(metric text, period_kind text, anchor date, enrollment_year integer)
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
        else
            raise exception 'invalid';
    end case;
end;
$$;

revoke execute on function public.dashboard_count(text, text, date, integer) from public, anon;
grant execute on function public.dashboard_count(text, text, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_enrollment_years: the Enrollment years leads carry, newest first,
-- for the Enrollment year filter. Same permission rule as dashboard_count.
-- ---------------------------------------------------------------------------

create function public.dashboard_enrollment_years()
returns setof integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    return query
        select distinct l.enrollment_year from public.leads l order by l.enrollment_year desc;
end;
$$;

revoke execute on function public.dashboard_enrollment_years() from public, anon;
grant execute on function public.dashboard_enrollment_years() to authenticated;
