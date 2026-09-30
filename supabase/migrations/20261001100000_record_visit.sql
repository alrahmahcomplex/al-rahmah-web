-- Recording the visit of an Applied family (slice 2): the one move from
-- Applied to Visited. A security definer function that checks the permission
-- itself, like the corrections, and touches only the status and the Visit
-- date. No table or policy changes: leads keep their read-only RLS, and every
-- write stays a function.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `not_applied` (any status but Applied, so no lead goes
-- backwards or records a second first visit), `closed` (an Applied lead marked
-- Inactive or Archived), or `invalid` with the field as JSON in the detail.

create function public.record_visit(lead_id uuid, visited_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('visits.record') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two staff recording the same arrival at once record it once:
    -- whoever comes second finds the lead Visited.
    select * into lead from public.leads l where l.id = record_visit.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if lead.status <> 'Applied' then
        raise exception 'not_applied';
    end if;
    if lead.closure is not null then
        raise exception 'closed';
    end if;
    -- Never later than today in Tanzania, as at a walk-in.
    if visited_on is null or visited_on > public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    update public.leads l set status = 'Visited', visit_date = visited_on where l.id = lead.id;
end;
$$;

revoke execute on function public.record_visit(uuid, date) from public, anon;
grant execute on function public.record_visit(uuid, date) to authenticated;
