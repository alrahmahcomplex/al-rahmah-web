-- The Activity log on Home (#406): everything that happened today and what is
-- still waiting for someone, in one paged read. The agreed brief is on #406.
--
-- home_activity(row_offset, row_limit) returns { total, rows }. A row is one of:
--
--   expected          an Admission form sent in the 7 days before today with
--                     a child still Applied and open; one row per form, all
--                     day, naming only the waiting children.
--   new_application   a child created today by the Admission form, still
--                     Applied and open.
--   result_ready      a current interview whose result is ready to send
--                     (interview_release_status: never sent, or changed
--                     since it was sent), dated by the interview.
--   discount_request  a pending Staff child, Qualified orphan or Sibling
--                     request, whenever it was raised.
--   agent_claim       an agent with email claims waiting for the Manager,
--                     by the queue's own rule (agent_email_claim_queue).
--   re_application    an unreviewed re-application, whenever it came.
--   fee_paid          a school-fee payment recorded today, as its newest
--                     adjustment says; voided ones, Fee waived and the
--                     Pre-Form One fee are left out.
--   call_back         an open follow-up overdue or due today
--                     (open_follow_ups, the Follow-ups queue's rule).
--
-- Rows are ordered all-day rows first, then by time (a dated row at the start
-- of its day in Tanzania), then by kind and id, so pages never overlap.
-- "Today" is tanzania_today(). Full classes are not here: Home builds them
-- from the seats it already reads.
--
-- Who sees what. Every kind checks, with has_permission, what its tables'
-- row-level security asks, because this function reads as its owner:
--   leads.view                   expected, new_application, result_ready,
--                                discount_request, re_application, call_back
--   leads.view and payments.view fee_paid (the row names the student)
--   agents.approve               agent_claim; stricter than the claim
--                                queue's leads.view, as v38 shows it to the
--                                Manager only
-- A caller with none of leads.view and agents.approve is refused
-- (`not_permitted`), and so is anyone who is not a signed-in staff member:
-- has_permission is false for agents, deactivated staff and retired roles.
--
-- It is security definer because rows carry staff names, which
-- staff_members' policies hide from other staff, and Admission forms, which
-- no API role reads. It returns only what a row and its side sheet show: no
-- phone numbers. It reads no audit history of its own; result_ready goes
-- through interview_release_status, which existing screens call under
-- leads.view.
--
-- Refusals: `not_permitted`; `invalid` with the field in the detail
-- (`row_offset`, `row_limit`). row_limit is 1 to 100.

create index school_fee_payments_recorded_at_idx on public.school_fee_payments (recorded_at);
create index admission_submissions_created_at_idx on public.admission_submissions (created_at);
-- The interviews whose result might still need sending: a result, and the
-- fee Paid. result_ready starts from these.
create index interviews_paid_result_idx on public.interviews (lead) where result is not null and fee_status = 'Paid';

-- ---------------------------------------------------------------------------
-- open_follow_ups(): the open follow-ups, the Follow-ups queue's rule moved
-- out of follow_up_queue_items unchanged, so the Activity log reads them
-- without the queue's reopened-lead search. follow_up_queue_items keeps its
-- signature, sections and results.
-- ---------------------------------------------------------------------------

create function public.open_follow_ups()
returns table (lead_id uuid, follow_up_id uuid, due_on date, note text)
language sql
stable
security invoker
set search_path = ''
as $fn$
    -- Open follow-ups: no later follow-up replaces them and no record closes
    -- them, on a lead neither Declined, Enrolled nor closed.
    select f.lead_id, f.id, f.due_on, f.note
    from public.follow_ups f
    join public.leads l on l.id = f.lead_id
    where l.status not in ('Declined', 'Enrolled')
      and l.closure is null
      and not exists (select 1 from public.follow_ups r where r.replaces_id = f.id)
      and not exists (select 1 from public.follow_up_records c where c.follow_up_id = f.id);
$fn$;

revoke execute on function public.open_follow_ups() from public, anon;
grant execute on function public.open_follow_ups() to authenticated;

create or replace function public.follow_up_queue_items(section text)
returns table (kind text, lead_id uuid, follow_up_id uuid, due_on date, note text)
language sql
stable
security invoker
set search_path = ''
as $fn$
    select 'follow_up'::text, o.lead_id, o.follow_up_id, o.due_on, o.note
    from public.open_follow_ups() o
    where case follow_up_queue_items.section
          when 'overdue' then o.due_on < public.tanzania_today()
          when 'upcoming' then o.due_on >= public.tanzania_today()
          else false
      end
    union all
    -- Reopened leads with no follow-up date yet, dated from the approval.
    select 'needs_date'::text, n.lead_id, null::uuid, (n.approved_at at time zone 'Africa/Dar_es_Salaam')::date, null::text
    from public.follow_up_date_needed() n
    where follow_up_queue_items.section = 'overdue';
$fn$;

create function public.home_activity(row_offset integer, row_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    today date := public.tanzania_today();
    day_start timestamptz := (public.tanzania_today()::timestamp at time zone 'Africa/Dar_es_Salaam');
    week_start timestamptz := ((public.tanzania_today() - 7)::timestamp at time zone 'Africa/Dar_es_Salaam');
    sees_leads boolean;
    sees_payments boolean;
    sees_claims boolean;
    ready jsonb := '[]'::jsonb;
    result jsonb;
begin
    if auth.role() is distinct from 'authenticated' then
        raise exception 'not_permitted';
    end if;
    sees_leads := public.has_permission('leads.view');
    sees_payments := sees_leads and public.has_permission('payments.view');
    sees_claims := public.has_permission('agents.approve');
    if not (sees_leads or sees_claims) then
        raise exception 'not_permitted';
    end if;
    if row_offset is null or row_offset < 0 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_offset')::text;
    end if;
    if row_limit is null or row_limit < 1 or row_limit > 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_limit')::text;
    end if;

    -- Results to send: of an open lead's interviews with a result and the fee
    -- Paid, the ones interview_release_status calls ready (the lead's current
    -- interview, never sent or changed since). It refuses callers without
    -- leads.view, so it is asked only for those who have it.
    if sees_leads then
        select coalesce(jsonb_agg(jsonb_build_object(
                   'interview_id', st.interview_id,
                   'changed_since_sent', st.changed_since_sent
               )), '[]'::jsonb)
        into ready
        from public.interview_release_status(array(
            select c.id
            from public.interviews c
            join public.leads cl on cl.id = c.lead
            where c.result is not null
              and c.fee_status = 'Paid'
              and cl.status <> 'Declined'
              and cl.closure is null
        )) st
        where st.ready_to_send;
    end if;

    with
    -- The Admission form's children from the last 7 days and today, from the
    -- forms' own record of what each child became.
    form_children as (
        select s.submission_key, s.created_at as sent_at, l.*
        from public.admission_submissions s
        cross join lateral jsonb_each(s.outcomes) o
        join public.leads l on l.id = (o.value ->> 'lead_id')::uuid
        where sees_leads
          and s.created_at >= week_start
          and o.value ->> 'result' = 'created'
          and l.status = 'Applied'
          and l.closure is null
    ),
    expected as (
        select
            true as all_day,
            min(c.sent_at) as at,
            'expected'::text as kind,
            c.submission_key::text as id,
            jsonb_build_object(
                'sent_on', (min(c.sent_at) at time zone 'Africa/Dar_es_Salaam')::date,
                'children', jsonb_agg(jsonb_build_object(
                    'lead_id', c.id,
                    'admission_number', c.admission_number,
                    'student_name', c.student_name,
                    'class_name', c.class_name
                ) order by c.created_at, c.id)
            ) as body
        from form_children c
        where c.sent_at < day_start and c.created_at < day_start
        group by c.submission_key
    ),
    new_application as (
        select
            false, c.created_at, 'new_application'::text, c.id::text,
            jsonb_build_object(
                'lead_id', c.id,
                'admission_number', c.admission_number,
                'student_name', c.student_name,
                'class_name', c.class_name,
                'referral_code', c.referral_code
            )
        from form_children c
        where c.created_at >= day_start
    ),
    -- Results to send, worked out above (ready).
    result_ready as (
        select
            false, (i.interview_date::timestamp at time zone 'Africa/Dar_es_Salaam'), 'result_ready'::text, i.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'interview_date', i.interview_date,
                'result', i.result,
                'score', i.score,
                'changed_since_sent', st.changed_since_sent
            )
        from jsonb_to_recordset(ready) as st (interview_id uuid, changed_since_sent boolean)
        join public.interviews i on i.id = st.interview_id
        join public.leads l on l.id = i.lead
    ),
    discount_request as (
        select
            false, r.requested_at, 'discount_request'::text, r.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'discount', r.kind,
                'note', r.note,
                'requested_by', requester.full_name
            )
        from public.discount_requests r
        join public.leads l on l.id = r.lead_id
        left join public.staff_members requester on requester.id = r.requested_by
        where sees_leads and r.state = 'pending'
    ),
    agent_claim as (
        select
            false, min(c.created_at), 'agent_claim'::text, a.id::text,
            jsonb_build_object(
                'agent_id', a.id,
                'full_name', a.full_name,
                'code', a.code,
                'claims', count(*)
            )
        from public.marketing_agents a
        cross join lateral public.agent_open_claims(a.id) c
        where sees_claims
          and a.retired_at is null
          and a.switched_off_at is null
          and a.email is null
        group by a.id
    ),
    re_application as (
        select
            false, r.received_at, 're_application'::text, r.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'asked_class', r.class_name,
                'differing_fields', to_jsonb(r.differing_fields)
            )
        from public.re_applications r
        join public.leads l on l.id = r.lead_id
        where sees_leads and r.reviewed_at is null
    ),
    fee_paid as (
        select
            false, p.recorded_at, 'fee_paid'::text, p.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'payment_type', coalesce(a.payment_type, p.payment_type),
                'amount', case when a.id is null then p.amount else a.amount end,
                'recorded_by', recorder.full_name
            )
        from public.school_fee_payments p
        join public.leads l on l.id = p.lead_id
        left join public.staff_members recorder on recorder.id = p.recorded_by
        left join lateral (
            select x.id, x.voided, x.payment_type, x.amount
            from public.payment_adjustments x
            where x.payment_id = p.id
            order by x.sequence desc
            limit 1
        ) a on true
        where sees_payments
          and p.recorded_at >= day_start
          and not coalesce(a.voided, false)
          and coalesce(a.payment_type, p.payment_type) in
              ('full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment')
    ),
    call_back as (
        select
            false, (q.due_on::timestamp at time zone 'Africa/Dar_es_Salaam'), 'call_back'::text, q.follow_up_id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'due_on', q.due_on,
                'note', q.note,
                'custodian_name', g.full_name,
                'relationship', coalesce(l.custodian_relationship, g.relationship),
                'relationship_description', case
                    when l.custodian_relationship is not null then l.custodian_relationship_description
                    else g.relationship_description
                end
            )
        from public.open_follow_ups() q
        join public.leads l on l.id = q.lead_id
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where sees_leads and q.due_on <= today
    ),
    activity (all_day, at, kind, id, body) as (
        select * from expected
        union all select * from new_application
        union all select * from result_ready
        union all select * from discount_request
        union all select * from agent_claim
        union all select * from re_application
        union all select * from fee_paid
        union all select * from call_back
    ),
    ordered as (
        select a.*, count(*) over () as total,
               row_number() over (order by a.all_day desc, a.at, a.kind, a.id) as position
        from activity a
    )
    select jsonb_build_object(
        'total', coalesce(max(o.total), 0),
        'rows', coalesce(
            jsonb_agg(
                jsonb_build_object('kind', o.kind, 'id', o.id, 'all_day', o.all_day, 'at', o.at) || o.body
                order by o.position
            ) filter (where o.position > row_offset and o.position <= row_offset + row_limit),
            '[]'::jsonb
        )
    )
    into result
    from ordered o;

    return result;
end;
$$;

revoke execute on function public.home_activity(integer, integer) from public, anon;
grant execute on function public.home_activity(integer, integer) to authenticated;
