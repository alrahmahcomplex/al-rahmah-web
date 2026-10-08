-- Approving or rejecting a Reopening request (slice 8, #101).
--
-- An approver (reopenings.approve) decides a Pending request from the lead
-- screen. Approving restores the lead in one transaction:
--
--   - a Declined lead goes back to the status it held before the decline,
--     except Enrolled, which comes back as Interviewed: nothing but slice 9's
--     recompute_lead_fee sets Enrolled, and slice 9 (#115) works it out again
--     from the payments when the status leaves Declined;
--   - its decline details are cleared and it keeps an Initially declined tag
--     for good;
--   - any Inactive or Archived mark is cleared with its reason, note, when and
--     who, and the status stays, so a lead both Declined and Archived needs
--     one approval.
--
-- The request records whether the lead was Declined, the status it was
-- restored to and, for a lead declined from Interviewed or Enrolled, whether
-- it enrols without a retaken interview. Those drive the Reopened after
-- decline note, and slices 5 and 9 read the choice from the latest approved
-- request.
--
-- Rejecting needs a written reason, which the requester reads on the lead.
-- An approver may decide a request they raised themselves.
--
-- Refusal codes: `not_permitted`, `not_found`, `not_pending` (already
-- withdrawn or decided), and `invalid` with the field as JSON in the detail.
-- A decision repeated by the same approver with the same answer, as a retried
-- click sends, is taken as already done.

-- ---------------------------------------------------------------------------
-- The Initially declined tag. Set by an approval that reopens a Declined
-- lead, and never cleared, so a lead declined again keeps it.
-- ---------------------------------------------------------------------------

alter table public.leads
    add column initially_declined boolean not null default false;

create function public.keep_initially_declined()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.initially_declined and not new.initially_declined then
        raise exception 'update_refused' using detail = 'initially_declined';
    end if;
    return new;
end;
$$;

revoke execute on function public.keep_initially_declined() from public, anon, authenticated;

create trigger keep_initially_declined
    before update of initially_declined on public.leads
    for each row
    execute function public.keep_initially_declined();

-- ---------------------------------------------------------------------------
-- approve_reopening_request(request_id, enrol_without_retake): needs
-- reopenings.approve. `enrol_without_retake` is required when the lead was
-- declined from Interviewed or Enrolled, and must be null otherwise.
-- ---------------------------------------------------------------------------

create function public.approve_reopening_request(request_id uuid, enrol_without_retake boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    request public.reopening_requests;
    target public.leads;
    staff_id uuid;
    was_declined boolean;
    status_before public.lead_status;
    restored public.lead_status;
    retake_applies boolean;
    earlier_override text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('reopenings.approve') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so an approval, a rejection and a withdrawal at the same moment
    -- take the request out of Pending once.
    select * into request from public.reopening_requests r where r.id = approve_reopening_request.request_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    if request.state <> 'pending' then
        -- The same approval again, as a retried click sends: already done.
        if request.state = 'approved'
           and request.decided_by = staff_id
           and request.enrol_without_retake is not distinct from approve_reopening_request.enrol_without_retake then
            return;
        end if;
        raise exception 'not_pending';
    end if;

    -- Locked, so a mark or a payment recompute on the lead waits for this.
    select * into target from public.leads l where l.id = request.lead_id for update;

    was_declined := target.status = 'Declined';
    if was_declined then
        -- A lead declined before declines recorded the earlier status goes
        -- back to the earliest status its Visit date allows.
        status_before := coalesce(
            target.status_before_decline,
            case when target.visit_date is null then 'Applied' else 'Visited' end::public.lead_status
        );
        restored := case when status_before = 'Enrolled' then 'Interviewed' else status_before end;
    else
        restored := target.status;
    end if;

    retake_applies := was_declined and status_before in ('Interviewed', 'Enrolled');
    if retake_applies is distinct from (approve_reopening_request.enrol_without_retake is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'enrol_without_retake')::text;
    end if;

    earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
    perform public.set_lead_lifecycle_override('reopen');

    update public.leads l
    set status = restored,
        declined_reason = null,
        declined_explanation = null,
        declined_at = null,
        declined_by = null,
        status_before_decline = null,
        initially_declined = l.initially_declined or was_declined,
        closure = null,
        closure_reason = null,
        closure_note = null,
        closed_at = null,
        closed_by = null
    where l.id = target.id;

    perform set_config('app.lead_lifecycle_override', earlier_override, true);

    update public.reopening_requests r
    set state = 'approved',
        decided_by = staff_id,
        decided_at = now(),
        enrol_without_retake = approve_reopening_request.enrol_without_retake,
        lead_was_declined = was_declined,
        restored_status = restored
    where r.id = request.id;
end;
$$;

revoke execute on function public.approve_reopening_request(uuid, boolean) from public, anon;
grant execute on function public.approve_reopening_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_reopening_request(request_id, reason): needs reopenings.approve and
-- a written reason. The lead stays closed.
-- ---------------------------------------------------------------------------

create function public.reject_reopening_request(request_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    request public.reopening_requests;
    why text := btrim(coalesce(reject_reopening_request.reason, ''));
    staff_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('reopenings.approve') then
        raise exception 'not_permitted';
    end if;
    if why = '' or char_length(why) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;

    select * into request from public.reopening_requests r where r.id = reject_reopening_request.request_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    if request.state <> 'pending' then
        -- The same rejection again, as a retried click sends: already done.
        if request.state = 'rejected' and request.decided_by = staff_id and request.rejection_reason = why then
            return;
        end if;
        raise exception 'not_pending';
    end if;

    update public.reopening_requests r
    set state = 'rejected',
        decided_by = staff_id,
        decided_at = now(),
        rejection_reason = why
    where r.id = request.id;
end;
$$;

revoke execute on function public.reject_reopening_request(uuid, text) from public, anon;
grant execute on function public.reject_reopening_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_reopening_requests(lead_id), as in
-- 20261019800300_reopening_requests.sql, plus what an approval recorded:
-- whether the lead was Declined, the status it came back with, and the
-- retake choice.
-- ---------------------------------------------------------------------------

create or replace function public.lead_reopening_requests(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if not exists (select 1 from public.leads l where l.id = lead_reopening_requests.lead_id) then
        raise exception 'not_found';
    end if;

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', r.id,
            'source', r.source,
            'reason', r.reason,
            'state', r.state,
            'requested_at', r.requested_at,
            'requested_by_id', r.requested_by,
            'requested_by', requester.full_name,
            'decided_at', r.decided_at,
            'decided_by', decider.full_name,
            'rejection_reason', r.rejection_reason,
            'enrol_without_retake', r.enrol_without_retake,
            'lead_was_declined', r.lead_was_declined,
            'restored_status', r.restored_status
        ) order by r.requested_at desc, r.id)
        from public.reopening_requests r
        join public.staff_members requester on requester.id = r.requested_by
        left join public.staff_members decider on decider.id = r.decided_by
        where r.lead_id = lead_reopening_requests.lead_id
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.lead_reopening_requests(uuid) from public, anon;
grant execute on function public.lead_reopening_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_closure(lead_id), as in 20261018800200_mark_lead.sql, plus the
-- Initially declined tag and the Reopened after decline note: the latest
-- approval that reopened the lead from Declined, when and by whom.
-- ---------------------------------------------------------------------------

create or replace function public.lead_closure(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.leads;
    decliner text;
    closer text;
    reopened jsonb;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.leads l where l.id = lead_closure.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select s.full_name into decliner from public.staff_members s where s.id = target.declined_by;
    select s.full_name into closer from public.staff_members s where s.id = target.closed_by;

    select jsonb_build_object(
        'reopened_at', r.decided_at,
        'approved_by', s.full_name,
        'restored_status', r.restored_status,
        'enrol_without_retake', r.enrol_without_retake
    ) into reopened
    from public.reopening_requests r
    join public.staff_members s on s.id = r.decided_by
    where r.lead_id = target.id and r.state = 'approved' and r.lead_was_declined
    order by r.decided_at desc, r.id
    limit 1;

    return jsonb_build_object(
        'decline',
        case when target.declined_reason is null then null else jsonb_build_object(
            'reason', target.declined_reason,
            'explanation', target.declined_explanation,
            'declined_at', target.declined_at,
            'declined_by', decliner,
            'status_before', target.status_before_decline
        ) end,
        'closure',
        case when target.closure is null then null else jsonb_build_object(
            'mark', target.closure,
            'reason', target.closure_reason,
            'note', target.closure_note,
            'closed_at', target.closed_at,
            'closed_by', closer
        ) end,
        'initially_declined', target.initially_declined,
        'reopened_after_decline', reopened
    );
end;
$$;

revoke execute on function public.lead_closure(uuid) from public, anon;
grant execute on function public.lead_closure(uuid) to authenticated;
