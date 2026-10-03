-- Marketing Agents (slice 4, #79): the agents table, Referral code
-- normalization and generation, registration and approval. Later slice 4
-- tickets put the code on leads (#80), add the public registration page (#82)
-- and the form's Discount code field.
--
-- The table is audited under ADR 4's `lead` scope with no lead id, as guardian
-- contacts are, so staff who may view leads read its history. Nothing writes
-- to it through the API: registration and approval are the functions below.
--
-- Refusal codes: `not_permitted`, `not_found`, `no_change`, `unavailable`,
-- and `invalid` with the offending field as JSON in the detail.

create type public.marketing_agent_status as enum ('Pending', 'Approved');

-- ---------------------------------------------------------------------------
-- Referral codes. Normalized in the database only, the same for every path:
-- trimmed, uppercased, every space removed. What is left must be 1 to 20
-- letters, digits, `-` and `.`; anything else is not a code: null.
-- ---------------------------------------------------------------------------

create function public.normalize_referral_code(code text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select case when s ~ '^[A-Z0-9.-]{1,20}$' then s end
    from (select upper(regexp_replace(normalize_referral_code.code, '\s', '', 'g')) as s) cleaned;
$$;

revoke execute on function public.normalize_referral_code(text) from public, anon;
grant execute on function public.normalize_referral_code(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.marketing_agents (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (btrim(full_name) <> '' and char_length(full_name) <= 100),
    -- Stored normalized, so equal numbers are equal strings.
    phone text not null check (phone = public.normalize_phone(phone)),
    whatsapp text check (whatsapp = public.normalize_phone(whatsapp)),
    code text not null unique check (code = public.normalize_referral_code(code)),
    status public.marketing_agent_status not null default 'Pending',
    registered_at timestamptz not null default now(),
    approved_at timestamptz,
    approved_by uuid references public.staff_members (id),
    -- What the staff screen's search box matches: the name in lowercase, the
    -- code, and both numbers as digits only.
    search_text text generated always as (
        lower(full_name) || ' ' || lower(code) || ' ' || regexp_replace(phone, '\D', '', 'g')
        || coalesce(' ' || regexp_replace(whatsapp, '\D', '', 'g'), '')
    ) stored,
    check ((status = 'Approved') = (approved_at is not null)),
    check ((approved_at is null) = (approved_by is null))
);

-- One agent per phone number.
create unique index marketing_agents_phone_key on public.marketing_agents (phone);
-- The Pending list, oldest first, and the Pending count.
create index marketing_agents_status_registered_at_idx on public.marketing_agents (status, registered_at);
create index marketing_agents_approved_by_idx on public.marketing_agents (approved_by) where approved_by is not null;

-- The code, the phone and the registration time never change, and approval
-- is set once: an Approved agent never goes back, and its approver and time
-- stay as recorded.
create function public.guard_marketing_agent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.code is distinct from old.code
       or new.phone is distinct from old.phone
       or new.registered_at is distinct from old.registered_at then
        raise exception 'agent_locked';
    end if;
    if old.status = 'Approved'
       and (new.status is distinct from old.status
            or new.approved_at is distinct from old.approved_at
            or new.approved_by is distinct from old.approved_by) then
        raise exception 'agent_locked';
    end if;
    return new;
end;
$$;

create trigger guard_marketing_agent_change
    before update on public.marketing_agents
    for each row
    execute function public.guard_marketing_agent_change();

-- Audit (ADR 4): lead scope, no lead id.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.marketing_agents', 'lead', null);

create trigger audit_row_change
    after insert or update on public.marketing_agents
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.marketing_agents
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.marketing_agents
    for each statement
    execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- Row-level security: reads only, for staff who may view leads. Every write
-- is a function below.
-- ---------------------------------------------------------------------------

alter table public.marketing_agents enable row level security;

create policy "Staff who may view leads read marketing agents"
    on public.marketing_agents for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.marketing_agents from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- marketing_agent_approvers: who approved each of the given agents, by name.
-- Staff who may view leads can't read other staff members' records, so this
-- looks the names up for them. Agents that aren't Approved are left out.
-- ---------------------------------------------------------------------------

create function public.marketing_agent_approvers(agent_ids uuid[])
returns table (agent_id uuid, approver_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return query
    select a.id, s.full_name
    from public.marketing_agents a
    join public.staff_members s on s.id = a.approved_by
    where a.id = any (marketing_agent_approvers.agent_ids);
end;
$$;

revoke execute on function public.marketing_agent_approvers(uuid[]) from public, anon;
grant execute on function public.marketing_agent_approvers(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Code generation: the initials of the first three words of the name (A to Z
-- only; `AR` if none survive), a hyphen and three random digits, such as
-- AJM-407. The caller retries on a collision.
-- ---------------------------------------------------------------------------

create function public.marketing_agent_code_prefix(full_name text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select coalesce(string_agg(w.initial, '' order by w.n), 'AR')
    from (
        select upper(left(t.word, 1)) as initial, t.n
        from regexp_split_to_table(btrim(marketing_agent_code_prefix.full_name), '\s+') with ordinality as t (word, n)
        where t.n <= 3
    ) w
    where w.initial ~ '^[A-Z]$';
$$;

revoke execute on function public.marketing_agent_code_prefix(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_marketing_agent: the public registration page's one write, with
-- the secret key only. Returns the agent's code. A phone that already holds
-- an agent returns that agent's code unchanged, so a retry after a dropped
-- connection gives the same code and never a second agent.
-- ---------------------------------------------------------------------------

create function public.register_marketing_agent(full_name text, phone text, whatsapp text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent_name text;
    agent_phone text;
    agent_whatsapp text;
    existing_code text;
    prefix text;
    candidate text;
    attempt integer;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    agent_name := regexp_replace(btrim(coalesce(register_marketing_agent.full_name, '')), '\s+', ' ', 'g');
    if char_length(agent_name) not between 2 and 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'full_name')::text;
    end if;

    agent_phone := public.normalize_phone(coalesce(register_marketing_agent.phone, ''));
    if agent_phone is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    agent_whatsapp := nullif(btrim(coalesce(register_marketing_agent.whatsapp, '')), '');
    if agent_whatsapp is not null then
        agent_whatsapp := public.normalize_phone(agent_whatsapp);
        if agent_whatsapp is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if agent_whatsapp = agent_phone then
            agent_whatsapp := null;
        end if;
    end if;

    -- Two registrations with the same phone wait for each other here, and the
    -- second finds the first one's agent.
    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || agent_phone, 0));

    select a.code into existing_code from public.marketing_agents a where a.phone = agent_phone;
    if found then
        return existing_code;
    end if;

    -- Three digits for ten tries, then four. The unique constraint catches a
    -- collision, including one with a registration running alongside.
    prefix := public.marketing_agent_code_prefix(agent_name);
    for attempt in 1..60 loop
        if attempt <= 10 then
            candidate := prefix || '-' || lpad(floor(random() * 1000)::integer::text, 3, '0');
        else
            candidate := prefix || '-' || lpad(floor(random() * 10000)::integer::text, 4, '0');
        end if;
        -- Skips the subtransaction below for a code already taken.
        continue when exists (select 1 from public.marketing_agents a where a.code = candidate);
        begin
            insert into public.marketing_agents (full_name, phone, whatsapp, code)
            values (agent_name, agent_phone, agent_whatsapp, candidate);
            return candidate;
        exception when unique_violation then
            -- Taken by a registration that committed after the check.
            null;
        end;
    end loop;

    raise exception 'unavailable';
end;
$$;

revoke execute on function public.register_marketing_agent(text, text, text) from public, anon, authenticated;
grant execute on function public.register_marketing_agent(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- approve_marketing_agent: Pending becomes Approved, with the approver and
-- the time. Needs agents.approve only, no lead permission. One-way: an
-- Approved agent is refused as `no_change`.
-- ---------------------------------------------------------------------------

create function public.approve_marketing_agent(agent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    agent public.marketing_agents;
    approver uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two approvals at once record one approver: the second is
    -- refused as no_change.
    select * into agent from public.marketing_agents a where a.id = approve_marketing_agent.agent_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if agent.status = 'Approved' then
        raise exception 'no_change';
    end if;

    select s.id into approver from public.staff_members s where s.user_id = auth.uid();

    update public.marketing_agents a
    set status = 'Approved', approved_at = now(), approved_by = approver
    where a.id = agent.id;
end;
$$;

revoke execute on function public.approve_marketing_agent(uuid) from public, anon;
grant execute on function public.approve_marketing_agent(uuid) to authenticated;
