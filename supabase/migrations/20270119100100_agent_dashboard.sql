-- The agent dashboard (#497 slice D, owner's pick B in prototype v47):
-- agent_students also answers how many of the agent's students stand at each
-- step, and which of them could use a reminder. It can list one step only.
-- The owner agreed that an agent may see how long ago each step happened for
-- their own families (decision 61): the reminders carry that, in days.
--
-- agent_students(search, page_limit, page_offset, step) answers as before:
-- null for anyone who isn't an agent; `{ state }` alone while access is off,
-- or for a retired, switched-off or not-approved agent; for an active agent
-- `{ state: 'active', code, total, matched, students }` plus:
--
-- - `steps`: every lead carrying the code counted by status, all five keys,
--   whatever the search or step asks;
-- - `reminders`: the leads that have waited long enough at their step, the
--   longest wait first, each with only the name, the class, the step and the
--   whole days since that step, in Tanzanian dates:
--   - Applied, 14 days or more after the application was made;
--   - Visited, 14 days or more after the visit date;
--   - Interviewed, 7 days or more after the interview date, when the latest
--     interview's result is Passed and its fee Paid (the result shows only
--     then, as on the cards).
--   A lead with a closure mark is never listed. The waiting days are the
--   owner's (decision 62), so a change to them is a reviewed migration.
--
-- - `discount`: what the agent's code takes off the interview fee now, in
--   whole TZS (agent_discount_amount, the figure a family sees for that
--   code), for the amount in the agent's share messages (#497).
--
-- `step` keeps only the leads at that status in `matched` and `students`.
-- It is null for every status, or one of Applied, Visited, Interviewed,
-- Enrolled and Declined; anything else is refused with `invalid`, as is a
-- page outside 1 to 200 rows or a negative offset.
--
-- Each student carries what it carried before (20261127120900_agent_students.sql):
-- never a contact, a note, an amount or an id. The agent is the one
-- current_principal() names, and leads match through agent_for_code.

drop function public.agent_students(text, integer, integer);

create function public.agent_students(
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
            m.student_name,
            m.class_name,
            m.status::text as at_step,
            m.created_at,
            m.id,
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
    )
    select
        (select count(*) from mine),
        (select count(*) from found),
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
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
                    jsonb_build_object('student_name', w.student_name, 'class_name', w.class_name, 'step', w.at_step, 'days', w.days)
                    order by w.days desc, w.created_at desc, w.id desc
                )
                from waiting w
                where w.days >= case w.at_step when 'Interviewed' then 7 else 14 end
            ),
            '[]'::jsonb
        )
    into total, matched, students, steps, reminders;

    return jsonb_build_object(
        'state', 'active',
        'code', agent.code,
        'total', total,
        'matched', matched,
        'students', students,
        'steps', steps,
        'reminders', reminders,
        'discount', public.agent_discount_amount(agent)
    );
end;
$$;

revoke execute on function public.agent_students(text, integer, integer, text) from public, anon;
grant execute on function public.agent_students(text, integer, integer, text) to authenticated;
