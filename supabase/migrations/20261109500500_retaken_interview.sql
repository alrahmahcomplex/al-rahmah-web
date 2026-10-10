-- A retaken interview after a Retake reopening (slice 5, #71).
--
-- A lead reopened with Retake the interview may be registered for one
-- retaken interview: it is Interviewed, its latest Approved Reopening request
-- has `enrol_without_retake` false, and no interview was registered after
-- that approval. The retake takes the next S/N in the lead's enrollment year,
-- starts Not Paid with no locked amount, and, as the newest registration,
-- becomes the current interview. Recording its result already keeps the lead
-- Interviewed (record_interview_result moves only an Applied or Visited lead),
-- and the fee and result functions already act on the interview they name.
--
-- interview_registration_kind(lead_id) holds both registration rules in one
-- place: register_for_interview applies it, and the lead screen asks
-- interview_registration_open(lead_id) whether to offer Register, and which.

-- ---------------------------------------------------------------------------
-- interview_registration_kind(lead_id): `first` for an Applied or Visited
-- lead with no interview, `retake` for a lead the retake rule allows, else
-- null (closed, Enrolled, already registered, or a retake used or not
-- chosen). Granted to no API role; security definer callers check the
-- permission first.
-- ---------------------------------------------------------------------------

create function public.interview_registration_kind(lead_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
    select case
        when l.status = 'Declined' or l.closure is not null or l.status = 'Enrolled' then null
        when l.status in ('Applied', 'Visited') then
            case when exists (select 1 from public.interviews i where i.lead = l.id) then null else 'first' end
        when l.status = 'Interviewed' and exists (
            select 1
            from (
                select r.enrol_without_retake, r.decided_at
                from public.reopening_requests r
                where r.lead_id = l.id and r.state = 'approved'
                order by r.decided_at desc, r.id desc
                limit 1
            ) latest
            where latest.enrol_without_retake is false
              -- One retake per approval: an interview registered at or after
              -- the approval is that retake.
              and not exists (
                  select 1 from public.interviews i
                  where i.lead = l.id and i.registered_at >= latest.decided_at
              )
        ) then 'retake'
        else null
    end
    from public.leads l
    where l.id = interview_registration_kind.lead_id;
$$;

revoke execute on function public.interview_registration_kind(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- interview_registration_open(lead_id): what the lead screen may offer,
-- `first`, `retake` or null. Needs leads.view, so anyone who sees the panel
-- can ask; registering itself still needs interviews.record.
-- ---------------------------------------------------------------------------

create function public.interview_registration_open(lead_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if not exists (select 1 from public.leads l where l.id = interview_registration_open.lead_id) then
        raise exception 'not_found';
    end if;
    return public.interview_registration_kind(interview_registration_open.lead_id);
end;
$$;

revoke execute on function public.interview_registration_open(uuid) from public, anon;
grant execute on function public.interview_registration_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- register_for_interview, as 20261011500100_interview_registration.sql made
-- it, now registering a retaken interview too, and returning which kind it
-- registered. Its refusals are unchanged: `not_permitted`, `not_found`,
-- `lead_closed`, `lead_enrolled`, `already_registered`.
-- ---------------------------------------------------------------------------

create or replace function public.register_for_interview(lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    kind text;
    staff_id uuid;
    issued integer;
    new_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interviews.record') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two staff registering the same lead at once register it
    -- once: whoever comes second finds the interview, first or retaken.
    select * into target from public.leads l where l.id = register_for_interview.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);

    if target.status = 'Enrolled' then
        raise exception 'lead_enrolled';
    end if;
    kind := public.interview_registration_kind(target.id);
    if kind is null then
        raise exception 'already_registered';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.interview_serial_counters as c (enrollment_year, last_number)
    values (target.enrollment_year, 1)
    on conflict (enrollment_year) do update set last_number = c.last_number + 1
    returning c.last_number into issued;

    -- Stamped with the time of the insert, not the start of the transaction.
    -- A registration that began before an approval and waited on the lead's
    -- lock until it committed would otherwise carry a time before that
    -- approval's, and the retake rule would not count it as the retake.
    insert into public.interviews (lead, serial_number, serial_year, registered_by, registered_at)
    values (target.id, issued, target.enrollment_year, staff_id, clock_timestamp())
    returning id into new_id;

    return jsonb_build_object(
        'interview_id', new_id,
        'serial_number', issued,
        'serial_year', target.enrollment_year,
        'retake', kind = 'retake'
    );
end;
$$;
