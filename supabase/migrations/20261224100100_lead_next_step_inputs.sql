-- The Applicants list's Next step column (#415): what the next step of each
-- lead on a page is worked out from, in one read.
--
-- The record's Next step card and the Applicants side sheet read a lead's
-- next step from six reads (interviews, registration, reopenings, result
-- release, School fee, follow-ups), about six round trips each. Fifty rows a
-- page would make some three hundred. lead_next_step_inputs(lead_ids) returns
-- the same inputs for up to 200 leads in one call, and lib/lead-next-step.ts
-- still makes the one decision from them, so the list and the sheet can't
-- disagree on the rule.
--
-- Each input comes from the same SQL the per-lead reads use:
--   - the current interview: the newest registration, as getLeadInterviews
--     and result_release_state order them, with its fee status and result.
--     Its amount is the locked amount while Paid, else
--     expected_interview_amount, as getLeadInterviews works it out;
--   - registration: interview_registration_kind, which
--     interview_registration_open returns;
--   - enrol without a retake: reopened_to_enrol, the database's rule that
--     enrolsWithoutRetake mirrors;
--   - the release: blocked as result_release_state decides it; sent and
--     changed since sent from interview_release_status for the current
--     interview, whose last release is the one latest_result_release reads;
--   - the School fee, for staff with payments.view only, as lead_school_fee
--     refuses everyone else: readable when the lead's year has a Fee
--     schedule, with lead_seat_priority's priority;
--   - follow-ups: the open one (newest created, not replaced, no record
--     closing it), as getLeadFollowUps finds it, and follow_up_date_needed.
--
-- Security definer, because interview_registration_kind, reopened_to_enrol
-- and lead_seat_priority are granted to no API role. It checks leads.view,
-- which is what row-level security asks of every table it reads, so the
-- caller learns nothing they couldn't read one lead at a time. Unknown ids
-- are left out. No new table, so no new policy.

create function public.lead_next_step_inputs(lead_ids uuid[])
returns table (
    lead_id uuid,
    status public.lead_status,
    closure public.lead_closure,
    -- Null when the lead has no interview.
    interview_fee_status public.interview_fee_status,
    interview_amount integer,
    interview_result public.interview_result,
    -- 'first', 'retake' or null.
    registration text,
    enrol_without_retake boolean,
    release_blocked text,
    release_sent boolean,
    release_changed boolean,
    -- False for staff without payments.view, and for a year with no Fee
    -- schedule.
    fee_readable boolean,
    seat_priority public.seat_priority,
    follow_up_due_on date,
    follow_up_needs_date boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    sees_fee boolean := public.has_permission('payments.view');
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;
    if cardinality(lead_next_step_inputs.lead_ids) > 200 then
        raise exception 'too_many';
    end if;

    return query
    with needs_date as (
        select n.lead_id from public.follow_up_date_needed() n
    )
    select
        l.id,
        l.status,
        l.closure,
        cur.fee_status,
        case
            when cur.id is null then null
            when cur.locked_amount is not null then cur.locked_amount
            else (select e.amount from public.expected_interview_amount(l.id) e)
        end,
        cur.result,
        public.interview_registration_kind(l.id),
        public.reopened_to_enrol(l.id),
        case
            when cur.id is null then 'no_interview'
            when l.status = 'Declined' or l.closure is not null then 'lead_closed'
            when cur.result is null then 'no_result'
            when cur.fee_status <> 'Paid' then 'not_paid'
        end,
        rel.last_released_at is not null,
        coalesce(rel.last_released_at is not null and rel.changed_since_sent, false),
        sees_fee and exists (select 1 from public.fee_schedules s where s.enrollment_year = l.enrollment_year),
        case when sees_fee then (select seat.priority from public.lead_seat_priority(l.id) seat) end,
        open_plan.due_on,
        exists (select 1 from needs_date n where n.lead_id = l.id)
    from public.leads l
    left join lateral (
        select i.id, i.fee_status, i.result, i.locked_amount
        from public.interviews i
        where i.lead = l.id
        order by i.registered_at desc, i.serial_number desc
        limit 1
    ) cur on true
    left join lateral (
        select s.last_released_at, s.changed_since_sent
        from public.interview_release_status(array[cur.id]) s
    ) rel on true
    left join lateral (
        select f.due_on
        from public.follow_ups f
        where f.lead_id = l.id
          and not exists (select 1 from public.follow_ups r where r.replaces_id = f.id)
          and not exists (select 1 from public.follow_up_records c where c.follow_up_id = f.id)
        order by f.created_at desc, f.id desc
        limit 1
    ) open_plan on true
    where l.id = any (lead_next_step_inputs.lead_ids);
end;
$$;

revoke execute on function public.lead_next_step_inputs(uuid[]) from public, anon;
grant execute on function public.lead_next_step_inputs(uuid[]) to authenticated;
