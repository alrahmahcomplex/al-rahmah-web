-- An email already in use, said without naming anyone the caller can't see
-- (#250, owner decisions of 2026-11-08). The managed set limits what a
-- manager may change, not what they may learn exists: telling them an email
-- is taken is fine, but the holder's name, role and kind stay out of the
-- refusal unless the caller can already see that person. The detail is
-- readable by the caller, so the database leaves them out, not just the UI.
--
-- - invite_staff_member answers `email_in_use`, with only the email in the
--   detail, for every holder the caller can't see: staff outside their
--   managed set, the Super Admin, any Marketing Agent, and any other sign-in
--   guard_login finds. It replaces `forbidden`, `email_taken` and
--   `agent_email` there, in the concurrent unique-violation path too. Staff
--   inside the managed set still answer `already_staff` with name and status.
-- - email_in_use_detail(email, except_agent): what an Agents screen refusal
--   may say about the holder. Another current agent is named with their
--   code, since whoever manages agents sees them all. Anyone else, staff,
--   the Super Admin or another sign-in, gets only the email.
-- - set_marketing_agent_email (and so decide_agent_email_claim, which saves
--   through it) sends that detail with `email_taken`, never a staff name.
-- - check_marketing_agent, create_marketing_agent and
--   recreate_marketing_agent sent `email_taken` with no detail; they now
--   send the same detail, so Create agent and Recreate agent can name an
--   agent holder as the other agent screens do.
--
-- Signatures and grants are unchanged. A refused call raises, so it writes
-- no audit row.

-- ---------------------------------------------------------------------------
-- What an Agents screen refusal may say about an email's holder.
-- ---------------------------------------------------------------------------

create function public.email_in_use_detail(email text, except_agent uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (
            select jsonb_build_object(
                'email', lower(btrim(email_in_use_detail.email)),
                'holder', 'agent', 'name', a.full_name, 'code', a.code
            )
            from public.agent_email_holders(email_in_use_detail.email) h
            join public.marketing_agents a on a.id = h.agent_id
            where a.id is distinct from email_in_use_detail.except_agent
            order by a.id
            limit 1
        ),
        jsonb_build_object('email', lower(btrim(email_in_use_detail.email)))
    )::text;
$$;

revoke execute on function public.email_in_use_detail(text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- invite_staff_member, as 20261130990500_roles_from_templates.sql made it,
-- with `email_in_use` for every holder the caller can't see.
-- ---------------------------------------------------------------------------

create or replace function public.invite_staff_member(full_name text, email text, role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    invited_name text := btrim(coalesce(invite_staff_member.full_name, ''));
    invited_email text := lower(btrim(coalesce(invite_staff_member.email, '')));
    invited_role public.roles;
    existing public.staff_members;
    new_id uuid;
begin
    perform public.require_staff_administrator();

    if invited_name = '' then
        raise exception 'name_required';
    end if;
    if invited_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'email_invalid';
    end if;

    -- Staff members before roles, the order the other writes lock them in, so
    -- an invite never deadlocks against them. It is the lock the insert below
    -- takes anyway, taken early.
    lock table public.staff_members in row exclusive mode;

    -- Held until commit, so the role can't be retired between this check and the insert.
    select * into invited_role from public.roles r where r.id = invite_staff_member.role_id for share;
    if not found or invited_role.id = public.super_admin_role_id() then
        raise exception 'not_found';
    end if;
    perform public.require_manages(invited_role.id);
    if invited_role.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', invited_role.name)::text;
    end if;

    -- Only someone the caller manages is named, with their status. Anyone
    -- else holding the email, the Super Admin included, is just in use.
    select * into existing from public.staff_members s where s.email = invited_email;
    if found and (public.hidden_staff_member(existing.id) or not public.manages_role(existing.role_id)) then
        raise exception 'email_in_use' using detail = jsonb_build_object('email', invited_email)::text;
    end if;
    if found then
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end if;

    -- An agent being created with this email holds the lock until it commits,
    -- and is then found here.
    perform public.lock_login_email(invited_email);
    if exists (select 1 from public.agent_email_holders(invited_email)) then
        raise exception 'email_in_use' using detail = jsonb_build_object('email', invited_email)::text;
    end if;

    begin
        insert into public.staff_members (full_name, email, role_id)
        values (invited_name, invited_email, invited_role.id)
        returning id into new_id;
    exception
        when unique_violation then
            -- Two people inviting the same email at once: the second loses
            -- here, and learns who holds it only if they manage that person.
            select * into existing from public.staff_members s where s.email = invited_email;
            if public.hidden_staff_member(existing.id) or not public.manages_role(existing.role_id) then
                raise exception 'email_in_use' using detail = jsonb_build_object('email', invited_email)::text;
            end if;
            raise exception 'already_staff'
                using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
        when raise_exception then
            -- guard_login: another sign-in already has this email.
            if sqlerrm = 'email_taken' then
                raise exception 'email_in_use' using detail = jsonb_build_object('email', invited_email)::text;
            end if;
            raise;
    end;

    return public.staff_member_names(new_id) || jsonb_build_object('id', new_id, 'email', invited_email);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_marketing_agent_email, as 20261130990400_super_admin_history_readers.sql
-- made it, with the holder told through email_in_use_detail.
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
    if exists (select 1 from public.staff_members s where s.email = address)
       or exists (select 1 from public.agent_email_holders(address) h where h.agent_id <> agent.id)
       or exists (select 1 from auth.users u where lower(u.email) = address and u.id is distinct from agent.user_id) then
        raise exception 'email_taken' using detail = public.email_in_use_detail(address, agent.id);
    end if;

    unused_login := agent.user_id;
    update public.marketing_agents a set email = address, user_id = null where a.id = agent.id;
    if unused_login is not null then
        delete from auth.users u where u.id = unused_login and coalesce(u.encrypted_password, '') = '';
    end if;
    return query select agent.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- check_marketing_agent and create_marketing_agent, as
-- 20261120120100_agent_create_recreate.sql made them, with the holder told
-- in `email_taken`'s detail.
-- ---------------------------------------------------------------------------

create or replace function public.check_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    draft record;
    holder public.marketing_agents;
    conflict jsonb;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    select * into draft
    from public.agent_draft(
        check_marketing_agent.full_name, check_marketing_agent.phone, check_marketing_agent.whatsapp,
        check_marketing_agent.email, check_marketing_agent.code
    );

    select * into holder from public.marketing_agents a where a.phone = draft.agent_phone and a.retired_at is null;
    if found then
        return jsonb_build_object('outcome', 'phone_taken', 'agent', public.agent_ref(holder));
    end if;
    if public.agent_email_taken(draft.agent_email) then
        raise exception 'email_taken' using detail = public.email_in_use_detail(draft.agent_email);
    end if;
    if draft.agent_code is not null then
        conflict := public.agent_code_conflict(draft.agent_code);
        if conflict is not null then
            return conflict;
        end if;
    end if;

    return jsonb_build_object(
        'outcome', 'ready',
        'full_name', draft.agent_name,
        'phone', draft.agent_phone,
        'whatsapp', draft.agent_whatsapp,
        'email', draft.agent_email,
        'code', draft.agent_code,
        'code_prefix', public.marketing_agent_code_prefix(draft.agent_name)
    );
end;
$$;

create or replace function public.create_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    manager uuid;
    made record;
    agent public.marketing_agents;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    select s.id into manager from public.staff_members s where s.user_id = auth.uid();

    begin
        select * into made
        from public.create_agent_record(
            create_marketing_agent.full_name, create_marketing_agent.phone, create_marketing_agent.whatsapp,
            create_marketing_agent.email, create_marketing_agent.code, 'Approved', manager
        );
    exception when raise_exception then
        if sqlerrm in ('code_taken', 'retired_code') then
            return public.agent_code_conflict(public.normalize_referral_code(create_marketing_agent.code));
        end if;
        -- create_agent_record's own check, or guard_login's.
        if sqlerrm = 'email_taken' then
            raise exception 'email_taken' using detail = public.email_in_use_detail(create_marketing_agent.email);
        end if;
        raise;
    end;

    if not made.created then
        select * into agent from public.marketing_agents a where a.id = made.existing_agent;
        return jsonb_build_object('outcome', 'phone_taken', 'agent', public.agent_ref(agent));
    end if;

    select * into agent from public.marketing_agents a where a.id = made.agent_id;
    return jsonb_build_object(
        'outcome', 'created',
        'agent', jsonb_build_object('id', agent.id, 'full_name', agent.full_name, 'code', agent.code, 'phone', agent.phone)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- recreate_marketing_agent, as 20261121120100_agent_import.sql made it, with
-- the holder told in `email_taken`'s detail. The old record is retired by
-- then, so it never names itself.
-- ---------------------------------------------------------------------------

create or replace function public.recreate_marketing_agent(agent_id uuid, full_name text, phone text, whatsapp text, email text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    draft record;
    manager uuid;
    old public.marketing_agents;
    login uuid;
    new_id uuid := gen_random_uuid();
    change_id uuid;
    made record;
    holder public.marketing_agents;
    history public.agent_status_changes;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if btrim(coalesce(recreate_marketing_agent.reason, '')) = ''
       or char_length(btrim(recreate_marketing_agent.reason)) > 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    select * into draft
    from public.agent_draft(
        recreate_marketing_agent.full_name, recreate_marketing_agent.phone, recreate_marketing_agent.whatsapp,
        recreate_marketing_agent.email, null
    );
    select s.id into manager from public.staff_members s where s.user_id = auth.uid();

    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || draft.agent_phone, 0));
    -- The email before the old record, as an import takes its emails before
    -- the agents it updates. create_agent_record takes it again below.
    if draft.agent_email is not null then
        perform public.lock_login_email(draft.agent_email);
    end if;

    select * into old from public.marketing_agents a where a.id = recreate_marketing_agent.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if not public.agent_recreatable(old) then
        raise exception 'agent_retired';
    end if;
    login := old.user_id;

    -- Retires the old record and detaches its login before the new record
    -- takes the code, the phone and the login.
    change_id := public.record_agent_status_change(old.id, 'recreated', recreate_marketing_agent.reason, new_id);

    begin
        select * into made
        from public.create_agent_record(
            draft.agent_name, draft.agent_phone, draft.agent_whatsapp, draft.agent_email, old.code,
            'Approved', manager, new_id, login, true
        );
    exception when raise_exception then
        if sqlerrm = 'email_taken' then
            raise exception 'email_taken' using detail = public.email_in_use_detail(draft.agent_email, old.id);
        end if;
        raise;
    end;
    if not made.created then
        select * into holder from public.marketing_agents a where a.id = made.existing_agent;
        raise exception 'phone_taken' using detail = public.agent_ref(holder)::text;
    end if;

    select * into history from public.agent_status_changes c where c.id = change_id;
    return jsonb_build_object(
        'agent', jsonb_build_object('id', new_id, 'full_name', draft.agent_name, 'code', old.code),
        'student_count', history.student_count,
        'fee_change_count', history.fee_change_count
    );
end;
$$;
