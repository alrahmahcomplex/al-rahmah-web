-- Leads by enrollment class, the dashboard's per-class panel (slice 10, #117).
-- Read-only, like the rest of the dashboard: nothing here writes a row.
--
-- dashboard_leads_by_class returns one row per class of slice 2's lead_class
-- enum, in its declared order (school order), zeros included. A lead counts
-- by the date it was created, taken as a date in Tanzania time, whatever its
-- status or closure mark now, under its current class and Enrollment year.
-- The period arithmetic is dashboard_period_bounds, shared with
-- dashboard_count.
--
-- Refusal codes: `forbidden` (no leads.view; raised so a missing permission
-- never reads as an empty intake) and `invalid` (an unknown period).

create function public.dashboard_leads_by_class(period_kind text, anchor date, enrollment_year integer)
returns table (class_name public.lead_class, lead_count bigint)
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

    return query
        select c.value, count(l.id)
        from unnest(enum_range(null::public.lead_class)) with ordinality as c (value, position)
        left join public.leads l
            on l.class_name = c.value
           and (bounds.starts is null or (
                   (l.created_at at time zone 'Africa/Dar_es_Salaam')::date >= bounds.starts
               and (l.created_at at time zone 'Africa/Dar_es_Salaam')::date < bounds.ends))
           and (dashboard_leads_by_class.enrollment_year is null
                or l.enrollment_year = dashboard_leads_by_class.enrollment_year)
        group by c.value, c.position
        order by c.position;
end;
$$;

revoke execute on function public.dashboard_leads_by_class(text, date, integer) from public, anon;
grant execute on function public.dashboard_leads_by_class(text, date, integer) to authenticated;
