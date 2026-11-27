-- The Conditional interview result and its agreement (owner decisions of
-- 2026-11-27, prototype v7).
--
--   1. agreements.mark, "Mark agreement signed": the heads of school hold the
--      agreements and mark them signed with their own logins. No role gets it
--      here; it is granted on the Roles screen. It needs nothing else to be
--      granted, though its holder needs leads.view to reach the button.
--   2. interviews.agreement_signed_at and agreement_signed_by: when, and by
--      whom, the agreement for a Conditional result was marked signed. Set
--      only by mark_agreement_signed, never cleared: a result corrected away
--      from Conditional and back keeps the mark, as the paper does.
--   3. mark_agreement_signed(interview_id) and interview_agreement(
--      interview_id), the write and the read.
--   4. record_interview_result accepts Conditional.
--   5. check_school_fee_payment lets a Conditional result pay, as Passed does.
--      The agreement is not checked: an unmarked agreement is a warning on the
--      payment form, never a refusal (owner decision 2, option A).
--   6. dashboard_count counts conditional_interviews.
--   7. lead_next_step_inputs says whether the current interview's agreement
--      is marked.
--   8. release_result records the current template version of each result:
--      whatsapp_conditional_v1 and sms_conditional_v1, and the Failed
--      messages' v2, which give the school's number by level instead of the
--      admissions office's (lib/result-messages.ts holds the texts).
--   9. result_message_fits allows 520 characters for the fixed text and the
--      other values, up from 430: the Conditional WhatsApp message comes to
--      517 with the longest of them (tests/unit/result-messages.test.ts).
--
-- The agent reminder after a Passed interview stays for Passed only: its text
-- says the child passed.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- 1. The permission.
-- ---------------------------------------------------------------------------

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'agreements.mark', 'Mark agreement signed'
from public.permissions;

-- ---------------------------------------------------------------------------
-- 2. The agreement on the interview.
-- ---------------------------------------------------------------------------

alter table public.interviews
    add column agreement_signed_at timestamptz,
    add column agreement_signed_by uuid references public.staff_members (id),
    add constraint interviews_agreement_complete check ((agreement_signed_at is null) = (agreement_signed_by is null));

create index interviews_agreement_signed_by_idx on public.interviews (agreement_signed_by) where agreement_signed_by is not null;

-- ---------------------------------------------------------------------------
-- 3. Marking it, and reading who marked it.
--
-- mark_agreement_signed refuses with a stable code: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `not_current` (an
-- earlier interview of a lead with a retake), or `not_conditional`. Marking
-- one already marked changes nothing and answers `already_signed: true`.
-- ---------------------------------------------------------------------------

create function public.mark_agreement_signed(interview_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    current_id uuid;
    marker uuid := public.current_staff_id();
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agreements.mark') or marker is null then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = mark_agreement_signed.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead, then the interview, in the order record_interview_result
    -- takes them, so a correction and the mark never pass each other.
    perform 1 from public.leads l where l.id = target.lead for update;
    perform public.assert_lead_open(target.lead);

    select i.id into current_id
    from public.interviews i
    where i.lead = target.lead
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    if current_id is distinct from target.id then
        raise exception 'not_current';
    end if;

    select * into target from public.interviews i where i.id = target.id for update;
    if target.result is distinct from 'Conditional' then
        raise exception 'not_conditional';
    end if;

    if target.agreement_signed_at is not null then
        return jsonb_build_object('interview_id', target.id, 'signed_at', target.agreement_signed_at, 'already_signed', true);
    end if;

    update public.interviews i
    set agreement_signed_at = now(),
        agreement_signed_by = marker
    where i.id = target.id
    returning * into target;

    return jsonb_build_object('interview_id', target.id, 'signed_at', target.agreement_signed_at, 'already_signed', false);
end;
$$;

revoke execute on function public.mark_agreement_signed(uuid) from public, anon;
grant execute on function public.mark_agreement_signed(uuid) to authenticated;

-- When the agreement was marked and the name of who marked it; no row while
-- it is unmarked. For staff with leads.view, as the interview itself.
create function public.interview_agreement(interview_id uuid)
returns table (signed_at timestamptz, signed_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    return query
    select i.agreement_signed_at, s.full_name
    from public.interviews i
    left join public.staff_members s on s.id = i.agreement_signed_by
    where i.id = interview_agreement.interview_id
      and i.agreement_signed_at is not null;
end;
$$;

revoke execute on function public.interview_agreement(uuid) from public, anon;
grant execute on function public.interview_agreement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_interview_result, as 20261016500200 made it, accepting
--    Conditional.
-- ---------------------------------------------------------------------------

create or replace function public.record_interview_result(
    interview_id uuid,
    interviewed_on date,
    outcome text,
    score numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    the_lead public.leads;
    current_id uuid;
    first_recording boolean;
    changed boolean;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interviews.record') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = record_interview_result.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead is locked before the interview, in the order registration
    -- takes them, so two staff recording the same first result at once move
    -- the lead once.
    select * into the_lead from public.leads l where l.id = target.lead for update;
    perform public.assert_lead_open(the_lead.id);
    select * into target from public.interviews i where i.id = target.id for update;

    if interviewed_on is null or score is null or outcome is null or outcome not in ('Passed', 'Conditional', 'Failed') then
        raise exception 'incomplete';
    end if;
    if score < 0 or score > 100 then
        raise exception 'score_out_of_range';
    end if;
    if score <> round(score, 1) then
        raise exception 'score_too_precise';
    end if;
    if interviewed_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
    if interviewed_on < (target.registered_at at time zone 'Africa/Dar_es_Salaam')::date then
        raise exception 'date_before_registration';
    end if;

    first_recording := target.result is null;
    changed := first_recording
        or target.interview_date is distinct from interviewed_on
        or target.result::text is distinct from outcome
        or target.score is distinct from score;

    -- The lead's current interview is its newest registration.
    select i.id into current_id
    from public.interviews i
    where i.lead = the_lead.id
    order by i.registered_at desc, i.serial_number desc
    limit 1;

    if first_recording and current_id = target.id and the_lead.status in ('Applied', 'Visited') then
        if the_lead.status = 'Applied' then
            -- Checks visits.record itself, refusing with not_permitted.
            perform public.record_visit(the_lead.id, interviewed_on);
        end if;
        update public.leads l set status = 'Interviewed' where l.id = the_lead.id;
    end if;

    -- An unchanged correction writes nothing, so the history holds only real
    -- changes.
    if changed then
        update public.interviews i
        set interview_date = interviewed_on,
            result = outcome::public.interview_result,
            score = record_interview_result.score
        where i.id = target.id;
    end if;

    return jsonb_build_object(
        'interview_id', target.id,
        'first_recording', first_recording,
        'changed', changed
    );
end;
$$;

revoke execute on function public.record_interview_result(uuid, date, text, numeric) from public, anon;
grant execute on function public.record_interview_result(uuid, date, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. check_school_fee_payment, as 20270107100100 made it, letting a
--    Conditional result pay. The refusal keeps its code, `not_passed`.
-- ---------------------------------------------------------------------------

create or replace function public.check_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date
)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
declare
    current_result public.interview_result;
    current_from_import boolean;
    lead_year integer;
    from_workbook boolean;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    select l.enrollment_year, l.imported_as_enrolled into lead_year, from_workbook
    from public.leads l where l.id = check_school_fee_payment.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(check_school_fee_payment.lead_id);

    select i.result, i.import_batch_id is not null into current_result, current_from_import
    from public.interviews i
    where i.lead = check_school_fee_payment.lead_id
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    -- The workbook pass holds only while the current interview is still the
    -- one the import registered, with no result. A retake after a reopening,
    -- or a result recorded on the imported interview, puts the lead back
    -- under the usual rule.
    if (current_result is null or current_result not in ('Passed', 'Conditional'))
       and not public.reopened_to_enrol(check_school_fee_payment.lead_id)
       and not (from_workbook and coalesce(current_from_import, false) and current_result is null) then
        raise exception 'not_passed';
    end if;

    if not exists (select 1 from public.fee_schedules s where s.enrollment_year = lead_year) then
        raise exception 'no_schedule';
    end if;

    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment', 'fee_waived',
        'pre_form_one_fee'
    ) then
        raise exception 'invalid_type';
    end if;

    if payment_type = 'pre_form_one_fee'
       and not (select p.applies from public.lead_pre_form_one(check_school_fee_payment.lead_id) p) then
        raise exception 'not_pre_form_one';
    end if;

    if payment_type = 'fee_waived' then
        if not exists (
            select 1 from public.discount_requests r
            where r.lead_id = check_school_fee_payment.lead_id and r.kind = 'qualified_orphan' and r.state = 'granted'
        ) then
            raise exception 'not_waivable';
        end if;
        if amount is not null then
            raise exception 'amount_not_allowed';
        end if;
        if exists (
            select 1 from public.effective_school_fee_payments(check_school_fee_payment.lead_id) e
            where e.payment_type = 'fee_waived'
        ) then
            raise exception 'already_waived';
        end if;
    else
        if amount is null or amount <= 0 then
            raise exception 'amount_not_positive';
        end if;
        if amount <> trunc(amount) then
            raise exception 'amount_not_whole';
        end if;
        if amount > 2147483647 then
            raise exception 'amount_too_large';
        end if;
    end if;

    if paid_on is null then
        raise exception 'date_missing';
    end if;
    if paid_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;

    -- Streams (#449): a school-fee payment by a child with no Seat priority
    -- and no seat, in a class and year with streams, waits for a stream that
    -- can take them. Any amount; never the Pre-Form One fee.
    if payment_type <> 'pre_form_one_fee' and public.payment_needs_stream(check_school_fee_payment.lead_id) then
        raise exception 'no_class';
    end if;
end;
$fn$;

revoke execute on function public.check_school_fee_payment(uuid, text, numeric, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. dashboard_count, as 20261108950400 made it, with conditional_interviews.
-- ---------------------------------------------------------------------------

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
        when 'interviewed_leads', 'passed_interviews', 'conditional_interviews', 'failed_interviews' then
            return (
                select case dashboard_count.metric
                    when 'interviewed_leads' then count(distinct i.lead)
                    when 'passed_interviews' then count(*) filter (where i.result = 'Passed')
                    when 'conditional_interviews' then count(*) filter (where i.result = 'Conditional')
                    else count(*) filter (where i.result = 'Failed')
                end
                from public.interviews i
                join public.leads l on l.id = i.lead
                where i.result is not null
                  and (bounds.starts is null or (i.interview_date >= bounds.starts and i.interview_date < bounds.ends))
                  and (dashboard_count.enrollment_year is null or l.enrollment_year = dashboard_count.enrollment_year)
            );
        when 'enrolled_students' then
            return (
                select count(*)
                from public.leads l
                join public.lead_fee_profiles p on p.lead_id = l.id
                where l.status = 'Enrolled'
                  and p.enrolled_on is not null
                  and (bounds.starts is null or (p.enrolled_on >= bounds.starts and p.enrolled_on < bounds.ends))
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
-- 7. lead_next_step_inputs, as 20261224100100 made it, with
--    interview_agreement_signed. The returned columns change, so it is
--    dropped and created again.
-- ---------------------------------------------------------------------------

drop function public.lead_next_step_inputs(uuid[]);

create function public.lead_next_step_inputs(lead_ids uuid[])
returns table (
    lead_id uuid,
    status public.lead_status,
    closure public.lead_closure,
    -- Null when the lead has no interview.
    interview_fee_status public.interview_fee_status,
    interview_amount integer,
    interview_result public.interview_result,
    -- Whether the current interview's agreement is marked signed. Means
    -- something only for a Conditional result.
    interview_agreement_signed boolean,
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
        cur.agreement_signed_at is not null,
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
        select i.id, i.fee_status, i.result, i.locked_amount, i.agreement_signed_at
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

-- ---------------------------------------------------------------------------
-- 8. release_result, as 20261114600100 made it, recording each result's
--    current template version: Passed and Conditional v1, Failed v2.
-- ---------------------------------------------------------------------------

create or replace function public.release_result(interview_id uuid, channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    current_id uuid;
    offered record;
    used text;
    lead_row public.leads;
    contact public.guardian_contacts;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('results.send') then
        raise exception 'forbidden';
    end if;

    select * into target from public.interviews i where i.id = release_result.interview_id;
    if not found then
        raise exception 'not-found';
    end if;

    -- Held to the end, so the lead, and below its contact, read here are the
    -- ones the release is recorded and the message built from.
    select * into lead_row from public.leads l where l.id = target.lead for share;
    perform public.assert_lead_open(target.lead);

    select i.id into current_id
    from public.interviews i
    where i.lead = target.lead
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    if current_id is distinct from target.id then
        raise exception 'not_current';
    end if;

    -- Read again under the lock, so the result and fee are as they stand now.
    select * into target from public.interviews i where i.id = target.id for share;
    if target.result is null then
        raise exception 'no_result';
    end if;
    if target.fee_status <> 'Paid' then
        raise exception 'not_paid';
    end if;

    select * into contact from public.guardian_contacts c where c.id = lead_row.guardian_contact_id for share;
    select * into offered from public.result_release_channel(target.lead);
    if release_result.channel = 'whatsapp' then
        if offered.channel is distinct from 'whatsapp' then
            raise exception 'no_whatsapp_number';
        end if;
        used := offered.number_used;
    elsif release_result.channel = 'sms' then
        used := 'direct';
    else
        raise exception 'invalid_channel';
    end if;

    if release_result.channel = 'whatsapp'
       and not public.result_message_fits(contact.full_name, lead_row.student_name) then
        raise exception 'too_long';
    end if;

    perform public.record_action('result_released', target.lead, jsonb_build_object(
        'interview_id', target.id,
        'serial_number', target.serial_number,
        'channel', release_result.channel,
        'number_used', used,
        'result', target.result,
        'score', target.score,
        'template_id', release_result.channel || '_' || lower(target.result::text)
            || case when target.result = 'Failed' then '_v2' else '_v1' end
    ));

    return jsonb_build_object(
        'channel', release_result.channel,
        -- The number the message goes to, for the wa.me link or the SMS.
        'phone', case when used = 'whatsapp' then contact.whatsapp else contact.phone end,
        'result', target.result,
        'score', target.score,
        'parent_name', contact.full_name,
        'student_name', lead_row.student_name,
        'admission_number', lead_row.admission_number,
        'class_name', lead_row.class_name,
        'enrollment_year', lead_row.enrollment_year
    );
end;
$$;

revoke execute on function public.release_result(uuid, text) from public, anon;
grant execute on function public.release_result(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. result_message_fits, as 20261114600100 made it, with room for the
--    longest message: the fixed text and the other values come to at most
--    520 UTF-16 units (the Conditional message, 517), the student's name
--    appears at most three times, and a name's UTF-8 bytes are never fewer
--    than its UTF-16 units. release_result and result_release_state both ask
--    it, so the preview never offers a message the release would refuse.
-- ---------------------------------------------------------------------------

create or replace function public.result_message_fits(parent_name text, student_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select 520 + octet_length(parent_name) + 3 * octet_length(student_name) <= 1000;
$$;

revoke execute on function public.result_message_fits(text, text) from public, anon, authenticated;
