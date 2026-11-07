-- The last two event-by-event readers become the Super Admin's (#237), and
-- the agent email check stops naming the hidden holder.
--
-- 1. result_releases (every release of an interview) needs audit.view. The
--    Result release section reads latest_result_release instead: the newest
--    release and how many there are, which the send guard compares.
-- 2. agent_status_changes is read through marketing_agent_status_notes (the
--    newest change per agent, for the status line); the table itself is
--    readable only with audit.view.
-- 3. set_marketing_agent_email reports the Super Admin's address as taken
--    by another sign-in, with no name, to anyone but the holder. Confirming
--    an email claim calls it, so the claim queue says the same.

-- ---------------------------------------------------------------------------
-- 1. Result releases.
-- ---------------------------------------------------------------------------

-- result_releases as 20261114600100_result_release.sql made it, for
-- audit.view alone.
create or replace function public.result_releases(interview_id uuid)
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
    if not public.has_permission('audit.view') then
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

-- An interview's newest release, with who sent it, and how many releases it
-- has. Always one row: with no release, every field but the count is empty.
-- For staff with leads.view; `forbidden` otherwise, `not-found` for no
-- interview.
create function public.latest_result_release(interview_id uuid)
returns table (
    id bigint,
    released_at timestamptz,
    channel text,
    number_used text,
    result text,
    score numeric,
    template_id text,
    released_by text,
    release_count bigint
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

    select i.lead into interview_lead from public.interviews i where i.id = latest_result_release.interview_id;
    if not found then
        raise exception 'not-found';
    end if;

    return query
    with releases as (
        select a.*
        from public.audit_log a
        where a.lead_id = interview_lead
          and a.scope = 'lead'
          and a.action = 'result_released'
          and a.new_values ->> 'interview_id' = latest_result_release.interview_id::text
    )
    select n.id, n.created_at, n.new_values ->> 'channel', n.new_values ->> 'number_used',
           n.new_values ->> 'result', (n.new_values ->> 'score')::numeric, n.new_values ->> 'template_id',
           s.full_name, (select count(*) from releases)
    from (select 1) one
    left join lateral (
        select r.* from releases r order by r.created_at desc, r.id desc limit 1
    ) n on true
    left join public.staff_members s on s.id = n.actor_staff_id;
end;
$$;

revoke execute on function public.latest_result_release(uuid) from public, anon;
grant execute on function public.latest_result_release(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Agent status changes: the table for the Super Admin alone.
-- ---------------------------------------------------------------------------

drop policy "Staff who may view leads read agent status changes" on public.agent_status_changes;
create policy "Only the Super Admin reads agent status changes"
    on public.agent_status_changes for select
    to authenticated
    using ((select public.has_permission('audit.view')));

-- ---------------------------------------------------------------------------
-- 3. set_marketing_agent_email as 20261125120950_joined_agent_auth_email.sql
--    made it, with the hidden holder's address reported as another sign-in.
-- ---------------------------------------------------------------------------

create or replace function public.set_marketing_agent_email(agent_id uuid, email text)
returns table (previous_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    address text := lower(btrim(coalesce(set_marketing_agent_email.email, '')));
    holder record;
    unused_login uuid;
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if address = '' or char_length(address) > 254 or address !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'email_invalid';
    end if;

    select * into agent from public.marketing_agents a where a.id = set_marketing_agent_email.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    -- Locks the login first, so the agent can't finish joining between the
    -- joined check and the delete below and be left with an orphaned login.
    if agent.user_id is not null then
        perform 1 from auth.users u where u.id = agent.user_id for update;
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        raise exception 'already_joined';
    end if;
    if agent.email is not distinct from address then
        raise exception 'no_change';
    end if;

    perform public.lock_login_email(address);
    -- The Super Admin is no staff member anyone else can see.
    select case when public.hidden_staff_member(s.id) then 'login' else 'staff' end as kind,
           case when public.hidden_staff_member(s.id) then null else s.full_name end as name,
           null::text as code
    into holder
    from public.staff_members s where s.email = address;
    if not found then
        select 'agent' as kind, a.full_name as name, a.code into holder
        from public.agent_email_holders(address) h
        join public.marketing_agents a on a.id = h.agent_id
        where a.id <> agent.id;
    end if;
    if not found then
        select 'login' as kind, null::text as name, null::text as code into holder
        from auth.users u where lower(u.email) = address and u.id is distinct from agent.user_id;
    end if;
    if found then
        raise exception 'email_taken' using detail = jsonb_build_object(
            'email', address, 'holder', holder.kind, 'name', holder.name, 'code', holder.code
        )::text;
    end if;

    unused_login := agent.user_id;
    update public.marketing_agents a set email = address, user_id = null where a.id = agent.id;
    if unused_login is not null then
        delete from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '';
    end if;
    return query select agent.email;
end;
$$;
