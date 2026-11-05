-- The Manager creates an agent and recreates a retired one (slice 12, #189).
--
-- - marketing_agents gains `email`, confirmed by whoever stored it, and
--   `user_id`, the agent's login. Both are unique among records that aren't
--   retired; #188 adds the sign-in rules on top of them. Retiring a record
--   now detaches its login (user_id), so a retired record never holds one,
--   and agent_detached_logins keeps the detached id for the ban #188 adds.
-- - An email belongs to one login, staff or agent (owner decision 32). Agent
--   creation and invite_staff_member both take lock_login_email on the
--   lowercased email, then check the other table, so neither can take an
--   email the other holds or is saving.
-- - create_agent_record is the one internal creation function: it takes the
--   phone lock, then generates a code or checks a supplied one through
--   agent_for_code, inserts the agent and returns (agent_id, created,
--   existing_agent). Each caller sets the status and the audit actor: the
--   public registration (Pending, `public_form`), the Manager's create
--   (Approved, the Manager) and Recreate. Generated codes skip codes any
--   record has held and codes already on leads.
-- - check_marketing_agent shows the Manager the normalised values before
--   saving; create_marketing_agent saves. A phone a current agent uses
--   returns that agent and creates nothing; a supplied code a current agent
--   holds returns that agent; a code only a retired record held returns the
--   record and how many students carry the code, for Recreate.
-- - recreate_marketing_agent is Recreate, in one transaction: it retires the
--   old record (or, for a record already retired whose code no one holds,
--   records the recreation), creates the corrected one with the same code,
--   Approved and switched on, and moves the login. The history row records
--   both ids, the code, the student count and the lead ids.
--   agent_recreate_preview gives the Manager the record, the student count and
--   the fee-impact list first.
-- - retired_agent_for_code is a third code reader, beside agent_for_code and
--   agent_code_issued: the latest retired record that held a code.
-- - set_interview_fee_status holds that retired record in share mode while no
--   current record holds the code, so a payment and the Recreate of a retired
--   code wait for each other, as they already do for a current record.
--
-- Refusal codes: `not_permitted`, `not_found`, `agent_retired`,
-- `email_taken`, `phone_taken` (with the agent as JSON in the detail),
-- `code_taken`, `retired_code`, `unavailable`, and `invalid` with the field
-- as JSON in the detail. invite_staff_member adds `agent_email`, with the
-- email as JSON in the detail.

-- ---------------------------------------------------------------------------
-- email and user_id.
-- ---------------------------------------------------------------------------

alter table public.marketing_agents
    add column email text check (
        email = lower(btrim(email))
        and char_length(email) <= 254
        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
    add column user_id uuid references auth.users (id);

create unique index marketing_agents_email_key on public.marketing_agents (email) where retired_at is null;
create unique index marketing_agents_user_id_key on public.marketing_agents (user_id);

-- ---------------------------------------------------------------------------
-- agent_detached_logins: the login a Retire detached, beside the history row
-- that records the Retire. The ban step in agent sign-in (#188) reads it to
-- find the auth user to ban. Nobody reads or writes it through the API;
-- record_agent_status_change writes it as the owner. Recreate moves the
-- login to the new record instead, so it records nothing here.
-- ---------------------------------------------------------------------------

create table public.agent_detached_logins (
    status_change_id uuid primary key references public.agent_status_changes (id),
    user_id uuid not null references auth.users (id)
);

alter table public.agent_detached_logins enable row level security;

revoke all on public.agent_detached_logins from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lock_login_email: the lock both agent creation and invite_staff_member take
-- on an email before checking whether staff or an agent holds it. Held to
-- the end of the transaction, so the second of two at once waits, then sees
-- the first one's row.
-- ---------------------------------------------------------------------------

create function public.lock_login_email(email text)
returns void
language sql
set search_path = ''
as $$
    select pg_advisory_xact_lock(hashtextextended('login-email:' || lower(btrim(lock_login_email.email)), 0));
$$;

revoke execute on function public.lock_login_email(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- retired_agent_for_code: the most recently retired record that held a code,
-- or none. Internal, like agent_for_code: Recreate of a retired code and the
-- payment lock read through it.
-- ---------------------------------------------------------------------------

create function public.retired_agent_for_code(code text)
returns setof public.marketing_agents
language sql
stable
security definer
rows 1
set search_path = ''
as $$
    select a.*
    from public.marketing_agents a
    where a.code = public.normalize_referral_code(retired_agent_for_code.code)
      and a.retired_at is not null
    order by a.retired_at desc, a.id
    limit 1;
$$;

revoke execute on function public.retired_agent_for_code(text) from public, anon, authenticated, service_role;

-- Whether Recreate may start from a record: any current one, or a retired
-- one whose code no current record holds and that retired last of the
-- records holding it.
create function public.agent_recreatable(agent public.marketing_agents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select agent.retired_at is null
        or (
            not exists (select 1 from public.agent_for_code(agent.code))
            and exists (select 1 from public.retired_agent_for_code(agent.code) r where r.id = agent.id)
        );
$$;

revoke execute on function public.agent_recreatable(public.marketing_agents) from public, anon, authenticated, service_role;

-- An agent as the Manager's messages name them.
create function public.agent_ref(agent public.marketing_agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'id', agent.id,
        'full_name', agent.full_name,
        'code', agent.code,
        'state', case when agent.switched_off_at is not null then 'Switched off' else agent.status::text end
    );
$$;

revoke execute on function public.agent_ref(public.marketing_agents) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_draft: an agent's typed details, normalised as every creation path
-- stores them, or `invalid` with the field. A WhatsApp number equal to the
-- phone is dropped; an empty email or code is none.
-- ---------------------------------------------------------------------------

create function public.agent_draft(
    full_name text, phone text, whatsapp text, email text, code text,
    out agent_name text, out agent_phone text, out agent_whatsapp text, out agent_email text, out agent_code text
)
language plpgsql
stable
set search_path = ''
as $$
begin
    agent_name := regexp_replace(btrim(coalesce(agent_draft.full_name, '')), '\s+', ' ', 'g');
    if char_length(agent_name) not between 2 and 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'full_name')::text;
    end if;

    agent_phone := public.normalize_phone(coalesce(agent_draft.phone, ''));
    if agent_phone is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    agent_whatsapp := nullif(btrim(coalesce(agent_draft.whatsapp, '')), '');
    if agent_whatsapp is not null then
        agent_whatsapp := public.normalize_phone(agent_whatsapp);
        if agent_whatsapp is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if agent_whatsapp = agent_phone then
            agent_whatsapp := null;
        end if;
    end if;

    agent_email := nullif(lower(btrim(coalesce(agent_draft.email, ''))), '');
    if agent_email is not null
       and (char_length(agent_email) > 254 or agent_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'email')::text;
    end if;

    if nullif(btrim(coalesce(agent_draft.code, '')), '') is not null then
        agent_code := public.normalize_referral_code(agent_draft.code);
        if agent_code is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
        end if;
    end if;
end;
$$;

revoke execute on function public.agent_draft(text, text, text, text, text) from public, anon, authenticated, service_role;

-- Whether a current agent or a staff member already uses an email.
create function public.agent_email_taken(email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select agent_email_taken.email is not null and (
        exists (select 1 from public.marketing_agents a where a.email = agent_email_taken.email and a.retired_at is null)
        or exists (select 1 from public.staff_members s where s.email = agent_email_taken.email)
    );
$$;

revoke execute on function public.agent_email_taken(text) from public, anon, authenticated, service_role;

-- What a supplied code meets: null when it is free, else the Manager's
-- answer, `code_taken` with the current holder or `retired_code` with the
-- retired record and how many students carry the code.
create function public.agent_code_conflict(code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    holder public.marketing_agents;
    students integer;
begin
    select * into holder from public.agent_for_code(agent_code_conflict.code);
    if found then
        return jsonb_build_object('outcome', 'code_taken', 'agent', public.agent_ref(holder));
    end if;
    select * into holder from public.retired_agent_for_code(agent_code_conflict.code);
    if found then
        select count(*) into students from public.leads l where l.referral_code = holder.code;
        return jsonb_build_object(
            'outcome', 'retired_code',
            'agent', jsonb_build_object('id', holder.id, 'full_name', holder.full_name, 'code', holder.code),
            'student_count', students
        );
    end if;
    return null;
end;
$$;

revoke execute on function public.agent_code_conflict(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_agent_record: the one internal creation function. The caller names
-- the audit actor, the status and, for Approved, the approver.
--
-- - Takes the phone lock first, so two creations with one phone wait for
--   each other and the second finds the first one's agent.
-- - A phone a current agent uses returns (null, false, that agent) and
--   creates nothing.
-- - A supplied code is checked through agent_for_code: one a current agent
--   holds is `code_taken`; one only retired records held is `retired_code`
--   unless the caller is Recreate (reuse_retired_code), which has just made
--   it free.
-- - With no code, one is generated from the name, skipping codes any record
--   has held and codes on leads.
-- - Returns (the new agent, true, null).
-- ---------------------------------------------------------------------------

create function public.create_agent_record(
    full_name text,
    phone text,
    whatsapp text,
    email text,
    code text,
    status public.marketing_agent_status,
    approved_by uuid,
    new_agent_id uuid default null,
    new_user_id uuid default null,
    reuse_retired_code boolean default false
)
returns table (agent_id uuid, created boolean, existing_agent uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    draft record;
    existing uuid;
    new_id uuid := coalesce(create_agent_record.new_agent_id, gen_random_uuid());
    prefix text;
    candidate text;
    attempt integer;
    violated text;
begin
    select * into draft
    from public.agent_draft(
        create_agent_record.full_name, create_agent_record.phone, create_agent_record.whatsapp,
        create_agent_record.email, create_agent_record.code
    );
    if create_agent_record.status is null
       or (create_agent_record.status = 'Approved') <> (create_agent_record.approved_by is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'status')::text;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || draft.agent_phone, 0));

    select a.id into existing
    from public.marketing_agents a
    where a.phone = draft.agent_phone and a.retired_at is null;
    if found then
        return query select null::uuid, false, existing;
        return;
    end if;

    -- After the phone lock, the order Recreate also takes them in.
    if draft.agent_email is not null then
        perform public.lock_login_email(draft.agent_email);
    end if;
    if public.agent_email_taken(draft.agent_email) then
        raise exception 'email_taken';
    end if;

    if draft.agent_code is not null then
        if exists (select 1 from public.agent_for_code(draft.agent_code)) then
            raise exception 'code_taken' using detail = draft.agent_code;
        end if;
        if public.agent_code_issued(draft.agent_code) and not create_agent_record.reuse_retired_code then
            raise exception 'retired_code' using detail = draft.agent_code;
        end if;
    else
        prefix := public.marketing_agent_code_prefix(draft.agent_name);
    end if;

    -- Three digits for ten tries, then four. The unique index catches a
    -- collision with a creation running alongside.
    for attempt in 1..60 loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
        elsif attempt <= 10 then
            candidate := prefix || '-' || lpad(floor(random() * 1000)::integer::text, 3, '0');
        else
            candidate := prefix || '-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
        end if;
        -- Skips the subtransaction below for a code already used.
        continue when draft.agent_code is null
            and (public.agent_code_issued(candidate)
                 or exists (select 1 from public.leads l where l.referral_code = candidate));
        begin
            insert into public.marketing_agents (id, full_name, phone, whatsapp, email, code, status, approved_at, approved_by, user_id)
            values (
                new_id, draft.agent_name, draft.agent_phone, draft.agent_whatsapp, draft.agent_email, candidate,
                create_agent_record.status,
                case when create_agent_record.status = 'Approved' then now() end,
                create_agent_record.approved_by,
                create_agent_record.new_user_id
            );
            return query select new_id, true, null::uuid;
            return;
        exception when unique_violation then
            get stacked diagnostics violated = constraint_name;
            if violated = 'marketing_agents_email_key' then
                raise exception 'email_taken';
            end if;
            if violated <> 'marketing_agents_code_key' then
                raise;
            end if;
            -- A supplied code taken by a creation that committed after the check.
            if draft.agent_code is not null then
                raise exception 'code_taken' using detail = draft.agent_code;
            end if;
        end;
    end loop;

    raise exception 'unavailable';
end;
$$;

revoke execute on function public.create_agent_record(text, text, text, text, text, public.marketing_agent_status, uuid, uuid, uuid, boolean)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- register_marketing_agent, re-created with its signature and grants
-- unchanged on create_agent_record. A phone held by a current agent still
-- returns that agent's code, so a retry never makes a second agent.
-- ---------------------------------------------------------------------------

create or replace function public.register_marketing_agent(full_name text, phone text, whatsapp text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    made record;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    select * into made
    from public.create_agent_record(
        register_marketing_agent.full_name, register_marketing_agent.phone, register_marketing_agent.whatsapp,
        null, null, 'Pending', null
    );

    return (select a.code from public.marketing_agents a where a.id = coalesce(made.agent_id, made.existing_agent));
end;
$$;

-- ---------------------------------------------------------------------------
-- check_marketing_agent: what the Manager sees before saving. Saves nothing.
-- ---------------------------------------------------------------------------

create function public.check_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)
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
        raise exception 'email_taken';
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

revoke execute on function public.check_marketing_agent(text, text, text, text, text) from public, anon;
grant execute on function public.check_marketing_agent(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_marketing_agent: the Manager's create. Needs agents.approve. The
-- agent starts Approved, approved by the Manager, who is also the audit
-- actor; an email given here counts as confirmed by the Manager.
-- ---------------------------------------------------------------------------

create function public.create_marketing_agent(full_name text, phone text, whatsapp text, email text, code text)
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

revoke execute on function public.create_marketing_agent(text, text, text, text, text) from public, anon;
grant execute on function public.create_marketing_agent(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- agent_fee_change_leads, re-created with its signature unchanged: Recreate
-- of a retired record whose code no one holds gives the discount back to
-- every fee not yet Paid on the code.
-- ---------------------------------------------------------------------------

create or replace function public.agent_fee_change_leads(agent public.marketing_agents, kind text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
    select l.id
    from public.leads l
    where l.referral_code = agent.code
      and case
          when agent.retired_at is null then exists (
              select 1
              from public.agent_for_code(agent.code) holder
              where holder.id = agent.id
                and (holder.status = 'Approved' and holder.switched_off_at is null)
                    is distinct from case agent_fee_change_leads.kind
                        when 'switched_on' then holder.status = 'Approved'
                        when 'recreated' then true
                        else false
                    end
          )
          else agent_fee_change_leads.kind = 'recreated'
              and not exists (select 1 from public.agent_for_code(agent.code))
      end
      -- The current interview, the newest registration, is not Paid; or the
      -- lead has none yet.
      and (
          select i.fee_status
          from public.interviews i
          where i.lead = l.id
          order by i.registered_at desc, i.serial_number desc
          limit 1
      ) is distinct from 'Paid'
    order by l.id;
$$;

-- ---------------------------------------------------------------------------
-- record_agent_status_change, re-created with its signature unchanged:
-- - Retiring or recreating a current record also detaches its login
--   (user_id), in the same update as the cache, so a retired record never
--   holds one. Recreate moves it to the new record.
-- - `recreated` may also name a retired record that agent_recreatable
--   allows. Its cache stays as it is (retired_at is set once); the history
--   row records the recreation.
-- - A Retire that detaches a login records it in agent_detached_logins.
-- ---------------------------------------------------------------------------

create or replace function public.record_agent_status_change(agent_id uuid, kind text, reason text, new_agent_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    actor record;
    changed timestamptz;
    moved uuid[];
    affected integer;
    change_id uuid;
begin
    if record_agent_status_change.kind is null
       or record_agent_status_change.kind not in ('switched_off', 'switched_on', 'retired', 'recreated') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;
    if btrim(coalesce(record_agent_status_change.reason, '')) = ''
       or char_length(btrim(record_agent_status_change.reason)) > 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    if (record_agent_status_change.kind = 'recreated') <> (record_agent_status_change.new_agent_id is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'new_agent_id')::text;
    end if;

    select * into agent
    from public.marketing_agents a
    where a.id = record_agent_status_change.agent_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- Read after the lock, not now(): the transaction's start can come before
    -- a change that committed while this one waited or ran, and the history
    -- would then replay the two out of order.
    changed := clock_timestamp();
    if agent.retired_at is not null
       and (record_agent_status_change.kind <> 'recreated' or not public.agent_recreatable(agent)) then
        raise exception 'agent_retired';
    end if;
    if (record_agent_status_change.kind = 'switched_off' and agent.switched_off_at is not null)
       or (record_agent_status_change.kind = 'switched_on' and agent.switched_off_at is null) then
        raise exception 'no_change';
    end if;

    -- Counted before the cache changes, as the agent stands under the lock.
    select count(*) into affected
    from public.agent_fee_change_leads(agent, record_agent_status_change.kind);

    if record_agent_status_change.kind = 'recreated' then
        select coalesce(array_agg(l.id order by l.id), '{}') into moved
        from public.leads l
        where l.referral_code = agent.code;
    end if;

    if agent.retired_at is null then
        perform set_config('app.agent_status_change', agent.id::text, true);
        update public.marketing_agents a
        set switched_off_at = case record_agent_status_change.kind
                when 'switched_off' then changed
                when 'switched_on' then null
                else a.switched_off_at
            end,
            retired_at = case when record_agent_status_change.kind in ('retired', 'recreated') then changed end,
            user_id = case when record_agent_status_change.kind in ('retired', 'recreated') then null else a.user_id end
        where a.id = agent.id;
        perform set_config('app.agent_status_change', '', true);
    end if;

    select * into actor from public.audit_actor();

    insert into public.agent_status_changes (
        agent_id, kind, reason, changed_at, changed_by,
        old_agent_id, new_agent_id, code, student_count, lead_ids, fee_change_count
    ) values (
        agent.id,
        record_agent_status_change.kind,
        btrim(record_agent_status_change.reason),
        changed,
        actor.staff_id,
        case when moved is not null then agent.id end,
        record_agent_status_change.new_agent_id,
        case when moved is not null then agent.code end,
        cardinality(moved),
        moved,
        affected
    )
    returning id into change_id;

    if record_agent_status_change.kind = 'retired' and agent.user_id is not null then
        insert into public.agent_detached_logins (status_change_id, user_id) values (change_id, agent.user_id);
    end if;

    return change_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_status_fee_impact, re-created with its signature and grants
-- unchanged: a retired record that Recreate may start from lists the
-- families whose fee its recreation moves.
-- ---------------------------------------------------------------------------

create or replace function public.agent_status_fee_impact(agent_id uuid, kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    families jsonb;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('agents.approve')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if agent_status_fee_impact.kind is null
       or agent_status_fee_impact.kind not in ('switched_off', 'switched_on', 'retired', 'recreated') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;

    select * into agent from public.marketing_agents a where a.id = agent_status_fee_impact.agent_id;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.retired_at is not null
       and (agent_status_fee_impact.kind <> 'recreated' or not public.agent_recreatable(agent)) then
        raise exception 'agent_retired';
    end if;

    -- Every listed fee moves between the two amounts: the discount goes on
    -- for switching on and recreating, and comes off otherwise.
    select coalesce(jsonb_agg(jsonb_build_object(
            'lead_id', l.id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'class_name', l.class_name::text,
            'contact_name', c.full_name,
            'contact_phone', c.phone,
            'fee_now', public.interview_fee(agent_status_fee_impact.kind not in ('switched_on', 'recreated')),
            'fee_after', public.interview_fee(agent_status_fee_impact.kind in ('switched_on', 'recreated'))
        ) order by l.student_name, l.admission_number, l.id), '[]'::jsonb)
    into families
    from public.agent_fee_change_leads(agent, agent_status_fee_impact.kind) changed (id)
    join public.leads l on l.id = changed.id
    join public.guardian_contacts c on c.id = l.guardian_contact_id;

    return families;
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_recreate_preview: what the Recreate dialog shows first: the record,
-- how many students carry its code, and the families whose fee moves. Needs
-- agents.approve and leads.view, as the fee-impact list does.
-- ---------------------------------------------------------------------------

create function public.agent_recreate_preview(agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    students integer;
    families jsonb;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('agents.approve')
       or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into agent from public.marketing_agents a where a.id = agent_recreate_preview.agent_id;
    if not found then
        raise exception 'not_found';
    end if;
    if not public.agent_recreatable(agent) then
        raise exception 'agent_retired';
    end if;

    families := public.agent_status_fee_impact(agent.id, 'recreated');
    select count(*) into students from public.leads l where l.referral_code = agent.code;

    return jsonb_build_object(
        'agent', jsonb_build_object(
            'id', agent.id,
            'full_name', agent.full_name,
            'phone', agent.phone,
            'whatsapp', agent.whatsapp,
            'email', agent.email,
            'code', agent.code,
            'retired', agent.retired_at is not null
        ),
        'student_count', students,
        'families', families
    );
end;
$$;

revoke execute on function public.agent_recreate_preview(uuid) from public, anon;
grant execute on function public.agent_recreate_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- recreate_marketing_agent: Recreate, one transaction. Needs agents.approve
-- and a reason. Takes the new phone's lock, then the old record, so it never
-- waits for a phone while holding the record. The new record keeps the
-- code, starts Approved (by the Manager) and switched on, and takes the old
-- record's login. Returns the new record, the student count and how many
-- families' fees moved, as recorded on the history row.
-- ---------------------------------------------------------------------------

create function public.recreate_marketing_agent(agent_id uuid, full_name text, phone text, whatsapp text, email text, reason text)
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

    select * into made
    from public.create_agent_record(
        draft.agent_name, draft.agent_phone, draft.agent_whatsapp, draft.agent_email, old.code,
        'Approved', manager, new_id, login, true
    );
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

revoke execute on function public.recreate_marketing_agent(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.recreate_marketing_agent(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_interview_fee_status, re-created with its signature and grants
-- unchanged. While no current record holds the code, it now holds the
-- latest retired record that did, in share mode: Recreate of that record
-- holds it for update, so the two wait for each other and Recreate's count
-- stays true. After such a Recreate it holds the new record too, as before.
-- Lock order is unchanged: the lead, then the interview, then the agent
-- records, old before replacement.
-- ---------------------------------------------------------------------------

create or replace function public.set_interview_fee_status(interview_id uuid, fee_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    lead_code text;
    held uuid;
    holder uuid;
    expected record;
    new_amount integer;
    discounted boolean := false;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interview_payments.record') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = set_interview_fee_status.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead is held before the interview, in the order the other interview
    -- writes take them, so it can't be closed between the check and the
    -- change. Holding it also keeps its code from changing.
    select l.referral_code into lead_code from public.leads l where l.id = target.lead for share;
    perform public.assert_lead_open(target.lead);
    -- Locked, so two clicks at once change the fee once: the second finds the
    -- status already set.
    select * into target from public.interviews i where i.id = target.id for update;

    if set_interview_fee_status.fee_status is null
       or set_interview_fee_status.fee_status not in ('Paid', 'Not Paid') then
        raise exception 'invalid_status';
    end if;
    if target.fee_status::text = set_interview_fee_status.fee_status then
        raise exception 'no_change';
    end if;

    -- The code's current record, or while there is none the retired record
    -- Recreate would start from: a status change or Recreate holds the same
    -- one, so any in progress is waited for. Both ways: a fee going back to
    -- Not Paid starts moving with the code's discount again, so a count in
    -- progress must see it. Read in its own statement after the wait, the
    -- discount is the one that change leaves.
    --
    -- A Recreate this waited for has put a new record in place, which the
    -- locking statement couldn't see. So look the holder up again after
    -- each lock, and hold the new one too, until the record held is the
    -- code's current one. Otherwise a switch-off of the new record wouldn't
    -- wait, and would count this fee as unpaid.
    loop
        select c.id into holder from public.agent_for_code(lead_code) c;
        if holder is null then
            select r.id into holder from public.retired_agent_for_code(lead_code) r;
        end if;
        exit when holder is not distinct from held;
        perform 1 from public.marketing_agents a where a.id = holder for share;
        held := holder;
    end loop;

    if set_interview_fee_status.fee_status = 'Paid' then
        select e.amount, e.discount_applied into expected from public.expected_interview_amount(target.lead) e;
        new_amount := expected.amount;
        discounted := expected.discount_applied;
    end if;

    update public.interviews i
    set fee_status = set_interview_fee_status.fee_status::public.interview_fee_status,
        locked_amount = new_amount,
        locked_discount_applied = case when new_amount is null then null else discounted end
    where i.id = target.id;

    return jsonb_build_object(
        'interview_id', target.id,
        'fee_status', set_interview_fee_status.fee_status,
        'locked_amount', new_amount,
        'discount_applied', discounted
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- invite_staff_member, re-created with its signature and grants unchanged.
-- It now takes lock_login_email and refuses an email a current agent holds
-- (`agent_email`), so staff and agents never share one (owner decision 32).
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
    if not found then
        raise exception 'not_found';
    end if;
    if invited_role.retired then
        raise exception 'role_retired' using detail = jsonb_build_object('role', invited_role.name)::text;
    end if;

    select * into existing from public.staff_members s where s.email = invited_email;
    if found then
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end if;

    -- An agent being created with this email holds the lock until it commits,
    -- and is then found here.
    perform public.lock_login_email(invited_email);
    if exists (select 1 from public.marketing_agents a where a.email = invited_email and a.retired_at is null) then
        raise exception 'agent_email' using detail = jsonb_build_object('email', invited_email)::text;
    end if;

    begin
        insert into public.staff_members (full_name, email, role_id)
        values (invited_name, invited_email, invited_role.id)
        returning id into new_id;
    exception when unique_violation then
        -- Two Managers inviting the same email at once: the second loses here.
        select * into existing from public.staff_members s where s.email = invited_email;
        raise exception 'already_staff'
            using detail = jsonb_build_object('email', invited_email, 'name', existing.full_name, 'active', existing.active)::text;
    end;

    return public.staff_member_names(new_id) || jsonb_build_object('id', new_id, 'email', invited_email);
end;
$$;
