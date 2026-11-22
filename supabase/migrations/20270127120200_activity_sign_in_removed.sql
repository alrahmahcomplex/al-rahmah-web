-- Home's Activity log shows each removed sign-in (#503 slice 4b, lead
-- decision on prototype v58 R2's line): "Rehema M. removed the sign-in of
-- ABK-014 (07•• ••• 123), joined 21 Nov 10:42. Signed out everywhere."
--
-- home_activity, as 20270117100100_relationship_on_the_child.sql made it,
-- with the sign_in_removed branch.
--
-- Rollback: re-run home_activity from that migration.

create or replace function public.home_activity(row_offset integer, row_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Agents are read under leads.view (marketing_agents' policy and the
    -- claim queue), and confirming a claim needs agents.approve.
    sees_claims := sees_leads and public.has_permission('agents.approve');
    if not sees_leads then
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
    -- interview, never sent or changed since). Asked only under sees_leads,
    -- like every branch, though a caller without it is refused above.
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
        where c.sent_at < day_start
          and c.created_at < day_start
          and c.status = 'Applied'
          and c.closure is null
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
                'referral_code', c.referral_code,
                'status', c.status,
                'closure', c.closure
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
                'relationship', l.custodian_relationship,
                'relationship_description', l.custodian_relationship_description
            )
        from public.open_follow_ups() q
        join public.leads l on l.id = q.lead_id
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where sees_leads and q.due_on <= today
    ),
    -- Remove this sign-in (#503, v58 R2): the last 7 days' and today's
    -- removals, for everyone who sees the Activity log.
    sign_in_removed as (
        select
            false, r.removed_at, 'sign_in_removed'::text, r.id::text,
            jsonb_build_object(
                'agent_id', a.id,
                'full_name', a.full_name,
                'code', a.code,
                'signed_in_with', r.signed_in_with,
                'joined_at', r.joined_at,
                'removed_by', s.full_name
            )
        from public.agent_sign_in_removals r
        join public.marketing_agents a on a.id = r.agent_id
        left join public.staff_members s on s.id = r.removed_by
        where sees_leads and r.removed_at >= week_start
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
        union all select * from sign_in_removed
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
            ) filter (where o.position > row_offset and o.position <= row_offset::bigint + row_limit),
            '[]'::jsonb
        )
    )
    into result
    from ordered o;

    return result;
end;
$function$;
