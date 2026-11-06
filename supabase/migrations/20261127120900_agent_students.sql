-- The students using a signed-in agent's Discount code (#195), for the
-- Discount code pages. Agents get no table policies: this one function is
-- the only way an agent session reads a lead, and it returns only what an
-- agent may see.
--
-- agent_students(search, page_limit, page_offset) returns one JSON object:
--
-- - null for anyone who isn't an agent (staff, a visitor, a stray login);
-- - `{ state }` with `access_off`, `retired`, `switched_off` or
--   `not_approved`, and nothing else, so a still-valid token after a
--   switch-off reads no data;
-- - for an active agent: `{ state: 'active', code, total, matched, students }`.
--   `total` counts every lead carrying the code, `matched` those the search
--   matches, and `students` is one page of the matches, newest first.
--
-- Each student carries the name, class, status, whether a closure mark is set
-- (`not_active`, never which mark or why), the Tanzanian date of the last
-- change to the lead or its interviews, the Declined reason (never the
-- explanation), whether an interview is registered, and the latest
-- interview's result and score only once that interview's fee is Paid.
-- Never a contact, a note, an amount or an id.
--
-- The agent is the one current_principal() names; leads match through
-- agent_for_code, as lead_count does, so a retired record's leads follow the
-- code to the current record. Refusal code: `invalid`, for a page outside
-- 1 to 200 rows or a negative offset.

create function public.agent_students(search text default null, page_limit integer default 20, page_offset integer default 0)
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
    total bigint;
    matched bigint;
    students jsonb;
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

    if page_limit is null or page_limit not between 1 and 200 or page_offset is null or page_offset < 0 then
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
        where name_key is null or strpos(m.student_name_key, name_key) > 0
    ),
    page as (
        select f.*
        from found f
        order by f.created_at desc, f.id desc
        limit page_limit offset page_offset
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
        )
    into total, matched, students;

    return jsonb_build_object(
        'state', 'active',
        'code', agent.code,
        'total', total,
        'matched', matched,
        'students', students
    );
end;
$$;

revoke execute on function public.agent_students(text, integer, integer) from public, anon;
grant execute on function public.agent_students(text, integer, integer) to authenticated;
