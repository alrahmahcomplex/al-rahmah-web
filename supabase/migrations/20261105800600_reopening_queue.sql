-- The Reopening requests queue (slice 8, #100): every Pending request,
-- oldest first, and how many there are, for the approvers' page and the
-- count beside its navigation entry.
--
-- The table stays readable under leads.view, which a lead's own requests
-- need. The queue and its count are approvers' work, so they are read
-- through these two functions, which need reopenings.approve and refuse
-- anyone else with `not_permitted`. They also need leads.view: an approver
-- decides on the lead screen, which needs it, and the queue names leads.
-- Neither is executable by `anon`.

-- ---------------------------------------------------------------------------
-- pending_reopening_requests(): every Pending request with its lead and its
-- requester's name, oldest first. Ties keep a fixed order by id.
-- ---------------------------------------------------------------------------

create function public.pending_reopening_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('reopenings.approve')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', r.id,
            'lead_id', r.lead_id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'status', l.status,
            'closure', l.closure,
            'source', r.source,
            'reason', r.reason,
            'requested_at', r.requested_at,
            'requested_by', requester.full_name
        ) order by r.requested_at, r.id)
        from public.reopening_requests r
        join public.leads l on l.id = r.lead_id
        left join public.staff_members requester on requester.id = r.requested_by
        where r.state = 'pending'
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.pending_reopening_requests() from public, anon;
grant execute on function public.pending_reopening_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- pending_reopening_request_count(): how many requests are Pending.
-- ---------------------------------------------------------------------------

create function public.pending_reopening_request_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('reopenings.approve')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return (select count(*)::integer from public.reopening_requests where state = 'pending');
end;
$$;

revoke execute on function public.pending_reopening_request_count() from public, anon;
grant execute on function public.pending_reopening_request_count() to authenticated;
