-- Releasing an interview result (slice 6, #86): the database side the rest
-- of the slice builds on.
--
-- A release is an action event (ADR 4), not a row of its own: it changes
-- nothing and is written to audit_log through record_action as
-- `result_released`, which needs results.send and is read under the `lead`
-- scope, so it shows in the lead's history to everyone who may view the lead.
--
--   - result_release_channel(lead_id): the one rule for which channel a
--     result goes by and to which number. Granted to no API role; the
--     functions below call it.
--   - release_result(interview_id, channel): the whole gate and the record,
--     in one transaction. It returns the values the message templates need,
--     so the text staff send is built from what was checked here.
--   - result_releases(interview_id): an interview's releases, newest first,
--     for staff who may view leads.
--   - result_release_state(lead_id): what the lead screen's Result release
--     section shows. It records nothing.
--
-- A release is recorded when the message leaves the app: for WhatsApp, the
-- click on Send through WhatsApp. The app can't know whether the parent got
-- it, and the record doesn't claim so.
--
-- Refusal codes, in the order release_result checks them: `forbidden`,
-- `not-found`, `lead_closed` (from assert_lead_open), `not_current`,
-- `no_result`, `not_paid`, `no_whatsapp_number`; then `invalid_channel` for a
-- channel that is neither whatsapp nor sms, and `too_long` for names that
-- would take a WhatsApp message past its length budget.

insert into public.audit_action_kinds (kind, permission, scope) values
    ('result_released', 'results.send', 'lead');

-- ---------------------------------------------------------------------------
-- result_release_channel: numbers are stored normalized (`+255` and nine
-- digits for Tanzania), so a Tanzanian mobile is `+255`, then 6 or 7, then
-- eight digits. wa.me checks nothing, so only such a number is ever linked:
--
--   1. the contact's WhatsApp number, if it is a Tanzanian mobile;
--   2. otherwise the direct phone, if it is one;
--   3. otherwise SMS, to the direct phone.
--
-- `number_used` says which of the contact's numbers that is, so a release
-- records `whatsapp` or `direct` and never copies the number itself.
-- ---------------------------------------------------------------------------

create function public.result_release_channel(lead_id uuid, out channel text, out number_used text, out phone text)
language sql
stable
set search_path = ''
as $$
    select
        case when c.whatsapp ~ '^\+255[67][0-9]{8}$' or c.phone ~ '^\+255[67][0-9]{8}$' then 'whatsapp' else 'sms' end,
        case when c.whatsapp ~ '^\+255[67][0-9]{8}$' then 'whatsapp' else 'direct' end,
        case when c.whatsapp ~ '^\+255[67][0-9]{8}$' then c.whatsapp else c.phone end
    from public.leads l
    join public.guardian_contacts c on c.id = l.guardian_contact_id
    where l.id = result_release_channel.lead_id;
$$;

revoke execute on function public.result_release_channel(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- release_result: needs results.send, which only active staff on a current
-- role hold. Only the lead's current interview (its newest registration) is
-- sendable, so after a retake the earlier result never goes out. The lead is
-- held, then the interview, in the order the interview writes take them, so
-- neither a closure nor the Accountant's Not Paid can land between the check
-- and the record: whichever commits first wins.
-- ---------------------------------------------------------------------------

create function public.release_result(interview_id uuid, channel text)
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

    -- The WhatsApp message must stay within 1,000 characters (the research
    -- budget the message module enforces), and it can't be built until this
    -- transaction has recorded the release. So the names are bounded here,
    -- before the record: the fixed text and the other values come to at most
    -- 430 UTF-16 units, the student's name appears at most three times, and a
    -- name's UTF-8 bytes are never fewer than its UTF-16 units. Realistic
    -- names never come near it.
    if release_result.channel = 'whatsapp'
       and 430 + octet_length(contact.full_name) + 3 * octet_length(lead_row.student_name) > 1000 then
        raise exception 'too_long';
    end if;

    perform public.record_action('result_released', target.lead, jsonb_build_object(
        'interview_id', target.id,
        'serial_number', target.serial_number,
        'channel', release_result.channel,
        'number_used', used,
        'result', target.result,
        'score', target.score,
        'template_id', release_result.channel || '_' || lower(target.result::text) || '_v1'
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
-- result_releases: an interview's releases, newest first, with who sent each
-- by name, looked up now. Reads the same rows the audit log's `lead` scope
-- policy shows, and checks leads.view the same way.
-- ---------------------------------------------------------------------------

create function public.result_releases(interview_id uuid)
returns table (
    id bigint,
    released_at timestamptz,
    channel text,
    number_used text,
    result text,
    score numeric,
    template_id text,
    released_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    interview_lead uuid;
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select i.lead into interview_lead from public.interviews i where i.id = result_releases.interview_id;
    if not found then
        raise exception 'not-found';
    end if;

    return query
    select a.id, a.created_at, a.new_values ->> 'channel', a.new_values ->> 'number_used',
           a.new_values ->> 'result', (a.new_values ->> 'score')::numeric, a.new_values ->> 'template_id',
           s.full_name
    from public.audit_log a
    left join public.staff_members s on s.id = a.actor_staff_id
    where a.lead_id = interview_lead
      and a.scope = 'lead'
      and a.action = 'result_released'
      and a.new_values ->> 'interview_id' = result_releases.interview_id::text
    order by a.created_at desc, a.id desc;
end;
$$;

revoke execute on function public.result_releases(uuid) from public, anon;
grant execute on function public.result_releases(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- result_release_state: the Result release section for a lead, for staff who
-- may view leads. The lead's current interview, and either why its result
-- can't go now (`no_interview`, `lead_closed`, `no_result`, `not_paid`, with
-- the amount the family owes) or, to a caller holding results.send, the
-- offered channel, the numbers, and the values the message is built from.
-- A caller without results.send gets the gate and nothing to send.
-- ---------------------------------------------------------------------------

create function public.result_release_state(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_row public.leads;
    contact public.guardian_contacts;
    current_row public.interviews;
    offered record;
    blocked text;
    owed integer;
    can_send boolean := public.has_permission('results.send');
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select * into lead_row from public.leads l where l.id = result_release_state.lead_id;
    if not found then
        raise exception 'not-found';
    end if;

    select * into current_row
    from public.interviews i
    where i.lead = lead_row.id
    order by i.registered_at desc, i.serial_number desc
    limit 1;

    if current_row.id is null then
        blocked := 'no_interview';
    elsif lead_row.status = 'Declined' or lead_row.closure is not null then
        blocked := 'lead_closed';
    elsif current_row.result is null then
        blocked := 'no_result';
    elsif current_row.fee_status <> 'Paid' then
        blocked := 'not_paid';
        select e.amount into owed from public.expected_interview_amount(lead_row.id) e;
    end if;

    if blocked is not null or not can_send then
        return jsonb_build_object(
            'interview_id', current_row.id,
            'blocked', blocked,
            'amount_owed', owed,
            'can_send', can_send
        );
    end if;

    select * into contact from public.guardian_contacts c where c.id = lead_row.guardian_contact_id;
    select * into offered from public.result_release_channel(lead_row.id);

    return jsonb_build_object(
        'interview_id', current_row.id,
        'blocked', null,
        'amount_owed', null,
        'can_send', true,
        'channel', offered.channel,
        'number_used', offered.number_used,
        'whatsapp_phone', case when offered.channel = 'whatsapp' then offered.phone end,
        'direct_phone', contact.phone,
        'result', current_row.result,
        'score', current_row.score,
        'parent_name', contact.full_name,
        'student_name', lead_row.student_name,
        'admission_number', lead_row.admission_number,
        'class_name', lead_row.class_name,
        'enrollment_year', lead_row.enrollment_year
    );
end;
$$;

revoke execute on function public.result_release_state(uuid) from public, anon;
grant execute on function public.result_release_state(uuid) to authenticated;
