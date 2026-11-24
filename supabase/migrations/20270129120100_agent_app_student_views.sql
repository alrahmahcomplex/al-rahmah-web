-- The agents app (#539, prototype v5): opaque student ids for /students/[id],
-- the signed-in agent's phone for the Profile sheet, the 7-day recent changes
-- list for the bell, and a single-student reader (`agent_student`).
--
-- No new table: the bell's unread state lives on the device only.
--
-- Security invariants (unchanged from #195 and #497):
-- - Only an active agent (current_principal().kind = 'agent', access on,
--   Approved, not switched off or retired) gets data. Staff and visitors get
--   null; refused states get `{ state }` alone.
-- - Leads match strictly through agent_for_code(agent.code) where ac.id = agent.id.
-- - `agent_student(lead_id)` returns `{ state: 'active', student: null }` for
--   both a missing lead and another agent's lead (identical answer).
-- - Neither function ever returns a family contact, parent phone, note,
--   amount, or staff-only explanation.

create or replace function public.agent_students(
    search text default null,
    page_limit integer default 20,
    page_offset integer default 0,
    step text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    access_on boolean;
    state text;
    name_key text;
    today date := public.tanzania_today();
    total bigint;
    matched bigint;
    students jsonb;
    steps jsonb;
    reminders jsonb;
    recent jsonb;
begin
    select a.* into agent
    from public.current_principal() p
    join public.marketing_agents a on a.id = p.agent_id
    where p.kind = 'agent';
    if agent.id is null then
        return null;
    end if;

    select acc.enabled into access_on from public.agent_access() acc;
    state := case
        when not access_on then 'access_off'
        when agent.retired_at is not null then 'retired'
        when agent.switched_off_at is not null then 'switched_off'
        when agent.status <> 'Approved' then 'not_approved'
        else 'active'
    end;
    if state <> 'active' then
        return jsonb_build_object('state', state);
    end if;

    if page_limit is null or page_limit not between 1 and 200 or page_offset is null or page_offset < 0
       or (step is not null and step not in ('Applied', 'Visited', 'Interviewed', 'Enrolled', 'Declined')) then
        raise exception 'invalid';
    end if;

    name_key := nullif(public.normalize_student_name(coalesce(search, '')), '');

    with mine as (
        select l.*
        from public.agent_for_code(agent.code) ac
        join public.leads l on l.referral_code = ac.code
        where ac.id = agent.id
    ),
    found as (
        select m.*
        from mine m
        where (name_key is null or strpos(m.student_name_key, name_key) > 0)
          and (step is null or m.status::text = step)
    ),
    page as (
        select f.*
        from found f
        order by f.created_at desc, f.id desc
        limit page_limit offset page_offset
    ),
    waiting as (
        select
            m.id,
            m.student_name,
            m.class_name,
            m.status::text as at_step,
            m.created_at,
            case m.status::text
                when 'Applied' then today - (m.created_at at time zone 'Africa/Dar_es_Salaam')::date
                when 'Visited' then today - m.visit_date
                when 'Interviewed' then today - latest.interview_date
            end as days
        from mine m
        left join lateral (
            select i.interview_date, i.result, i.fee_status
            from public.interviews i
            where i.lead = m.id
            order by i.registered_at desc, i.id desc
            limit 1
        ) latest on true
        where m.closure is null
          and (
              m.status::text in ('Applied', 'Visited')
              or (
                  m.status::text = 'Interviewed'
                  and latest.fee_status = 'Paid'
                  and latest.result = 'Passed'
                  and latest.interview_date is not null
              )
          )
    ),
    changed as (
        select
            m.id,
            m.student_name,
            m.status,
            greatest(
                m.created_at,
                (
                    select max(al.created_at)
                    from public.audit_log al
                    where al.lead_id = m.id and al.table_name in ('leads', 'interviews')
                )
            ) as changed_at
        from mine m
    ),
    recent_rows as (
        select
            c.id,
            c.student_name,
            c.status,
            c.changed_at,
            greatest(0, today - (c.changed_at at time zone 'Africa/Dar_es_Salaam')::date) as days
        from changed c
        where today - (c.changed_at at time zone 'Africa/Dar_es_Salaam')::date <= 7
        order by c.changed_at desc, c.id desc
        limit 5
    )
    select
        (select count(*) from mine),
        (select count(*) from found),
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'id', p.id,
                        'student_name', p.student_name,
                        'class_name', p.class_name,
                        'status', p.status,
                        'not_active', p.closure is not null,
                        'last_change', (
                            greatest(
                                p.created_at,
                                (
                                    select max(al.created_at)
                                    from public.audit_log al
                                    where al.lead_id = p.id and al.table_name in ('leads', 'interviews')
                                )
                            ) at time zone 'Africa/Dar_es_Salaam'
                        )::date,
                        'declined_reason', case when p.status = 'Declined' then p.declined_reason end,
                        'interview_registered', latest.id is not null,
                        'interview_result', case when latest.fee_status = 'Paid' then latest.result end,
                        'interview_score', case when latest.fee_status = 'Paid' then latest.score end
                    )
                    order by p.created_at desc, p.id desc
                )
                from page p
                left join lateral (
                    select i.id, i.fee_status, i.result, i.score
                    from public.interviews i
                    where i.lead = p.id
                    order by i.registered_at desc, i.id desc
                    limit 1
                ) latest on true
            ),
            '[]'::jsonb
        ),
        (
            select jsonb_build_object(
                'Applied', count(*) filter (where m.status::text = 'Applied'),
                'Visited', count(*) filter (where m.status::text = 'Visited'),
                'Interviewed', count(*) filter (where m.status::text = 'Interviewed'),
                'Enrolled', count(*) filter (where m.status::text = 'Enrolled'),
                'Declined', count(*) filter (where m.status::text = 'Declined')
            )
            from mine m
        ),
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object('id', w.id, 'student_name', w.student_name, 'class_name', w.class_name, 'step', w.at_step, 'days', w.days)
                    order by w.days desc, w.created_at desc, w.id desc
                )
                from waiting w
                where w.days >= case w.at_step when 'Interviewed' then 7 else 14 end
            ),
            '[]'::jsonb
        ),
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'id', r.id,
                        'student_name', r.student_name,
                        'status', r.status,
                        'days', r.days,
                        'changed_at', r.changed_at
                    )
                    order by r.changed_at desc, r.id desc
                )
                from recent_rows r
            ),
            '[]'::jsonb
        )
    into total, matched, students, steps, reminders, recent;

    return jsonb_build_object(
        'state', 'active',
        'code', agent.code,
        'phone', agent.phone,
        'total', total,
        'matched', matched,
        'students', students,
        'steps', steps,
        'reminders', reminders,
        'recent', recent,
        'discount', public.agent_discount_amount(agent)
    );
end;
$$;

create function public.agent_student(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    access_on boolean;
    state text;
    today date := public.tanzania_today();
    student jsonb;
begin
    select a.* into agent
    from public.current_principal() p
    join public.marketing_agents a on a.id = p.agent_id
    where p.kind = 'agent';
    if agent.id is null then
        return null;
    end if;

    select acc.enabled into access_on from public.agent_access() acc;
    state := case
        when not access_on then 'access_off'
        when agent.retired_at is not null then 'retired'
        when agent.switched_off_at is not null then 'switched_off'
        when agent.status <> 'Approved' then 'not_approved'
        else 'active'
    end;
    if state <> 'active' then
        return jsonb_build_object('state', state);
    end if;

    if lead_id is null then
        return jsonb_build_object('state', 'active', 'student', null);
    end if;

    with matched as (
        select l.*
        from public.agent_for_code(agent.code) ac
        join public.leads l on l.referral_code = ac.code
        where ac.id = agent.id
          and l.id = lead_id
        limit 1
    ),
    enriched as (
        select
            m.*,
            latest.id as latest_interview_id,
            latest.fee_status as latest_fee_status,
            latest.result as latest_result,
            latest.score as latest_score,
            latest.interview_date as latest_interview_date,
            case
                when m.closure is not null then null
                when m.status::text = 'Applied' then today - (m.created_at at time zone 'Africa/Dar_es_Salaam')::date
                when m.status::text = 'Visited' then today - m.visit_date
                when m.status::text = 'Interviewed'
                     and latest.fee_status = 'Paid'
                     and latest.result = 'Passed'
                     and latest.interview_date is not null
                    then today - latest.interview_date
                else null
            end as wait_days
        from matched m
        left join lateral (
            select i.id, i.fee_status, i.result, i.score, i.interview_date
            from public.interviews i
            where i.lead = m.id
            order by i.registered_at desc, i.id desc
            limit 1
        ) latest on true
    )
    select jsonb_build_object(
        'id', e.id,
        'student_name', e.student_name,
        'class_name', e.class_name,
        'status', e.status,
        'not_active', e.closure is not null,
        'last_change', (
            greatest(
                e.created_at,
                (
                    select max(al.created_at)
                    from public.audit_log al
                    where al.lead_id = e.id and al.table_name in ('leads', 'interviews')
                )
            ) at time zone 'Africa/Dar_es_Salaam'
        )::date,
        'declined_reason', case when e.status = 'Declined' then e.declined_reason end,
        'interview_registered', e.latest_interview_id is not null,
        'interview_result', case when e.latest_fee_status = 'Paid' then e.latest_result end,
        'interview_score', case when e.latest_fee_status = 'Paid' then e.latest_score end,
        'reminder_step', case
            when e.wait_days >= case e.status::text when 'Interviewed' then 7 else 14 end
                then e.status::text
        end,
        'reminder_days', case
            when e.wait_days >= case e.status::text when 'Interviewed' then 7 else 14 end
                then e.wait_days
        end
    )
    into student
    from enriched e;

    return jsonb_build_object('state', 'active', 'student', student);
end;
$$;

revoke execute on function public.agent_student(uuid) from public, anon;
grant execute on function public.agent_student(uuid) to authenticated;
