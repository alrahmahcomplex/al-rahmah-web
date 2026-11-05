-- Release status for many interviews at once (slice 6, #89): the Interviews
-- screen's Result sent column and Ready to send filter, and the lead screen's
-- changed-since-sent warning, all read from one rule here so the two screens
-- can't disagree.
--
--   - interview_release_status(interview_ids): for each interview, whether it
--     is its lead's current one, when its result was last sent, whether its
--     result or score has changed since, and whether it is ready to send.
--     One query, so every value comes from the same snapshot.
--   - result_ready_to_send(interviews): the Ready to send flag as a computed
--     column, so the Interviews list can filter and page on it.
--   - result_release_state(lead_id) now returns `changed_since_sent` with the
--     offer, from interview_release_status in the same snapshot as the
--     message values.
--
-- Changed since sent compares the result and score in the last release's
-- details with the interview's result and score now, by value: a correction
-- that ends where the release was is not a change.
--
-- No new table and no new grant on any table. The reads check leads.view, as
-- result_releases does; staff with leads.view already read the interviews'
-- results and scores and every release's.

-- The releases of one interview, newest first, without reading every lead
-- event. The lead comes first so the lookup stays within the lead's rows.
create index audit_log_result_released_idx
    on public.audit_log (lead_id, (new_values ->> 'interview_id'), created_at desc, id desc)
    where action = 'result_released';

-- ---------------------------------------------------------------------------
-- interview_release_status: one row per interview found among the ids;
-- unknown ids are left out. Ready to send is what release_result would
-- accept now, less the caller's own permission: the lead's current interview,
-- the lead open, a result recorded, the fee Paid, and either no release yet
-- or a result changed since the last one.
-- ---------------------------------------------------------------------------

create function public.interview_release_status(interview_ids uuid[])
returns table (
    interview_id uuid,
    is_current boolean,
    last_released_at timestamptz,
    changed_since_sent boolean,
    ready_to_send boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    return query
    select
        s.id,
        s.is_current,
        s.released_at,
        s.changed,
        s.is_current
            and s.lead_open
            and s.result is not null
            and s.fee_status = 'Paid'
            and (s.released_at is null or s.changed)
    from (
        select
            i.id,
            i.result,
            i.fee_status,
            cur.id = i.id as is_current,
            l.status <> 'Declined' and l.closure is null as lead_open,
            last.released_at,
            coalesce(
                last.released_at is not null
                and (last.result is distinct from i.result::text or last.score is distinct from i.score),
                false
            ) as changed
        from public.interviews i
        join public.leads l on l.id = i.lead
        cross join lateral (
            select c.id
            from public.interviews c
            where c.lead = i.lead
            order by c.registered_at desc, c.serial_number desc
            limit 1
        ) cur
        left join lateral (
            select a.created_at as released_at,
                   a.new_values ->> 'result' as result,
                   (a.new_values ->> 'score')::numeric as score
            from public.audit_log a
            where a.lead_id = i.lead
              and a.action = 'result_released'
              and a.new_values ->> 'interview_id' = i.id::text
            order by a.created_at desc, a.id desc
            limit 1
        ) last on true
        where i.id = any(interview_release_status.interview_ids)
    ) s;
end;
$$;

revoke execute on function public.interview_release_status(uuid[]) from public, anon;
grant execute on function public.interview_release_status(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- result_ready_to_send: a computed column on interviews for the API, so the
-- list filters with `result_ready_to_send=eq.true`. It reads through
-- interview_release_status, so it checks leads.view too; a caller without it
-- sees no interviews to compute it for.
-- ---------------------------------------------------------------------------

create function public.result_ready_to_send(public.interviews)
returns boolean
language sql
stable
set search_path = ''
as $$
    select s.ready_to_send from public.interview_release_status(array[$1.id]) s;
$$;

revoke execute on function public.result_ready_to_send(public.interviews) from public, anon;
grant execute on function public.result_ready_to_send(public.interviews) to authenticated;

-- ---------------------------------------------------------------------------
-- result_release_state: as 20261114600100_result_release.sql defines it, with
-- `changed_since_sent` beside the offer. It is still left out when the result
-- can't go or the caller can't send, as the warning only goes with a send.
-- ---------------------------------------------------------------------------

create or replace function public.result_release_state(lead_id uuid)
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
    changed boolean;
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
    select s.changed_since_sent into changed from public.interview_release_status(array[current_row.id]) s;

    return jsonb_build_object(
        'interview_id', current_row.id,
        'blocked', null,
        'amount_owed', null,
        'can_send', true,
        'channel', offered.channel,
        'number_used', offered.number_used,
        'whatsapp_phone', case when offered.channel = 'whatsapp' then offered.phone end,
        'whatsapp_fits', public.result_message_fits(contact.full_name, lead_row.student_name),
        'direct_phone', contact.phone,
        'result', current_row.result,
        'score', current_row.score,
        'changed_since_sent', coalesce(changed, false),
        'parent_name', contact.full_name,
        'student_name', lead_row.student_name,
        'admission_number', lead_row.admission_number,
        'class_name', lead_row.class_name,
        'enrollment_year', lead_row.enrollment_year
    );
end;
$$;
