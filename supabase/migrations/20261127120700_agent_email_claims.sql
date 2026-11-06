-- Sign-up with an email, and claiming an existing Discount code (slice 12,
-- #193).
--
-- - sign_up_marketing_agent: the Discount code page's new write, secret key
--   only. It takes an email and the "Already have a Discount code?" box, and
--   settles every combination with one ordered decision table (below). It
--   never sends email and never overwrites a stored email.
--   register_marketing_agent, the three-argument version, stays until T17.
-- - agent_email_claims: append-only. A claim row (pending, or competing when
--   another claim on the agent was already waiting) holds the agent, the
--   typed name and the email; one later row decides it (confirmed, rejected,
--   or auto_rejected when the Manager confirmed another claim), with who
--   decided and when.
-- - agent_events gains the `claim` kind for refused claims: no_match (no
--   agent) and phone_mismatch (the code's agent), with no typed values.
-- - marketing_agents.typed_code: a code typed at sign-up that wasn't
--   adopted, because an agent holds or held it, or leads already carry it.
--   The Agents screen flags it (agent_sign_up_notes).
-- - account_state returns awaiting_confirmation for an agent with no email
--   and a claim waiting, ahead of every state but retired and switched_off.
-- - agent_email_claim_queue and decide_agent_email_claim: the Manager's
--   "Awaiting email confirmation" queue. Confirming sets the email through
--   set_marketing_agent_email (so the agent hasn't joined, and nobody else
--   holds the address), auto-rejects the agent's other waiting claims, and
--   the server then sends the invite through the #191 path.

-- ---------------------------------------------------------------------------
-- agent_events: the claim kind.
-- ---------------------------------------------------------------------------

alter table public.agent_events
    drop constraint agent_events_kind_check,
    drop constraint agent_events_check2,
    drop constraint agent_events_check3;

alter table public.agent_events
    add constraint agent_events_kind_check check (kind in ('invite', 'claim')),
    add constraint agent_events_result_check check (
        (kind = 'invite' and result in (
            'started', 'sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error', 'access_off'
        ))
        or (kind = 'claim' and result in ('no_match', 'phone_mismatch'))
    ),
    add constraint agent_events_attempt_check check (
        (attempt_id is null) = (kind = 'claim' or result in ('started', 'access_off'))
    ),
    -- A refused claim keeps no typed value; no_match names no agent.
    add constraint agent_events_claim_check check (
        kind <> 'claim' or (email is null and (result = 'phone_mismatch') = (agent_id is not null))
    );

-- ---------------------------------------------------------------------------
-- marketing_agents.typed_code
-- ---------------------------------------------------------------------------

alter table public.marketing_agents
    add column typed_code text check (char_length(typed_code) <= 40);

-- ---------------------------------------------------------------------------
-- agent_email_claims
-- ---------------------------------------------------------------------------

create table public.agent_email_claims (
    id uuid primary key default gen_random_uuid(),
    agent_id uuid not null references public.marketing_agents (id),
    -- The claim this row decides; empty on the claim itself.
    claim_id uuid references public.agent_email_claims (id),
    outcome text not null check (outcome in ('pending', 'competing', 'confirmed', 'rejected', 'auto_rejected')),
    -- The name typed with the claim.
    full_name text check (char_length(full_name) between 2 and 100),
    -- The claimed email; on a confirmed row, the email the Manager saved.
    email text check (email = lower(btrim(email)) and char_length(email) <= 254),
    created_at timestamptz not null default clock_timestamp(),
    -- The staff member who decided; empty on the claim itself.
    decided_by uuid references public.staff_members (id),
    check ((claim_id is null) = (outcome in ('pending', 'competing'))),
    check ((claim_id is null) = (full_name is not null)),
    check ((claim_id is null) = (decided_by is null)),
    check (email is not null or outcome in ('rejected', 'auto_rejected'))
);

-- One decision per claim.
create unique index agent_email_claims_claim_idx on public.agent_email_claims (claim_id) where claim_id is not null;
create index agent_email_claims_agent_idx on public.agent_email_claims (agent_id, created_at);
create index agent_email_claims_decided_by_idx on public.agent_email_claims (decided_by) where decided_by is not null;

create trigger refuse_update
    before update on public.agent_email_claims
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.agent_email_claims
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.agent_email_claims
    for each statement
    execute function public.refuse_delete();

-- Audit (ADR 4): lead scope with no lead id, as for the other agent tables.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.agent_email_claims', 'lead', null);

create trigger audit_row_change
    after insert on public.agent_email_claims
    for each row
    execute function public.audit_row_change();

-- Read and written only through the functions below.
alter table public.agent_email_claims enable row level security;

revoke all on public.agent_email_claims from anon, authenticated, service_role;

-- The agent's claims still waiting for the Manager, oldest first.
create function public.agent_open_claims(agent_id uuid)
returns setof public.agent_email_claims
language sql
stable
security definer
set search_path = ''
as $$
    select c.*
    from public.agent_email_claims c
    where c.agent_id = agent_open_claims.agent_id
      and c.claim_id is null
      and not exists (select 1 from public.agent_email_claims d where d.claim_id = c.id)
    order by c.created_at, c.id;
$$;

revoke execute on function public.agent_open_claims(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- account_state, re-created with its signature and grants unchanged: an
-- agent with no email and a claim waiting is awaiting_confirmation, Pending
-- or Approved, so the queue and its count agree.
-- ---------------------------------------------------------------------------

create or replace function public.account_state(agent public.marketing_agents)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    sent_at timestamptz;
begin
    if not public.has_permission('leads.view') then
        return null;
    end if;
    if agent.retired_at is not null then
        return 'retired';
    end if;
    if agent.switched_off_at is not null then
        return 'switched_off';
    end if;
    if agent.email is null and exists (select 1 from public.agent_open_claims(agent.id)) then
        return 'awaiting_confirmation';
    end if;
    if agent.status <> 'Approved' then
        return null;
    end if;
    if agent.email is null then
        return 'no_email';
    end if;
    if agent.user_id is not null and public.agent_joined(agent.user_id) then
        return 'joined';
    end if;
    sent_at := public.agent_invite_sent_at(agent.id, agent.email);
    if sent_at is null then
        return 'invite_not_sent';
    end if;
    if sent_at <= now() - public.invite_link_lifetime() then
        return 'invite_expired';
    end if;
    return 'invited';
end;
$$;

-- ---------------------------------------------------------------------------
-- sign_up_marketing_agent: the Discount code page's write. Secret key only;
-- the server checks the rate limit and Turnstile first.
--
-- Refuses `not_permitted`, and `invalid` with the field as JSON in the
-- detail (full_name, phone, whatsapp, email, or code when the box is ticked
-- and no code is given or it can't be read). Otherwise answers one outcome,
-- as JSON, checked in this order:
--
--   access_off       agent access is off; nothing happens.
--   Box ticked, the code's agent found through agent_for_code:
--   no_match         no current agent holds the code, or it is switched off
--                    (retired records never match). Recorded, no values.
--   phone_mismatch   the code's agent has another phone. Recorded.
--   joined           the agent has joined: sign in.
--   invited          the agent has an email and an invite went to it.
--   claim_waiting    the agent has an email the school hasn't invited yet;
--                    or a claim with this email waits (another name); or a
--                    claim with another email waits, when this one is
--                    recorded as competing.
--   claimed          with code: the claim is recorded as pending, or the
--                    same email and name already wait (a retry).
--   email_unusable   staff, another current agent or a login holds it.
--   Box not ticked:
--   joined, invited  the phone's agent, same name, has joined (their stored
--                    email isn't read), or has this email and was invited.
--   registered       with code and email: no current agent has the phone, so
--                    a Pending agent is created with the email, or the
--                    phone's agent has this email and name (a retry). A
--                    typed code is adopted only if no record ever held it
--                    and no lead carries it; otherwise it is kept in
--                    typed_code and flagged.
--   code_needed      the phone's agent is someone else's record, or has
--                    another email or name: tick the box.
--   email_unusable   as above, for a new agent.
-- ---------------------------------------------------------------------------

create function public.sign_up_marketing_agent(
    full_name text, phone text, whatsapp text, email text, has_code boolean, code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    draft record;
    by_phone public.marketing_agents;
    by_code public.marketing_agents;
    agent public.marketing_agents;
    waiting public.agent_email_claims;
    made record;
    adopt boolean;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    select * into draft
    from public.agent_draft(
        sign_up_marketing_agent.full_name, sign_up_marketing_agent.phone, sign_up_marketing_agent.whatsapp,
        sign_up_marketing_agent.email, sign_up_marketing_agent.code
    );
    if draft.agent_email is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'email')::text;
    end if;
    if coalesce(sign_up_marketing_agent.has_code, false) and draft.agent_code is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;

    if not (select a.enabled from public.agent_access() a) then
        return jsonb_build_object('outcome', 'access_off');
    end if;

    -- The lock create_agent_record takes, so two sends with one phone wait
    -- for each other and the second sees what the first did.
    perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || draft.agent_phone, 0));
    select * into by_phone from public.marketing_agents a where a.phone = draft.agent_phone and a.retired_at is null;

    if coalesce(sign_up_marketing_agent.has_code, false) then
        select * into by_code from public.agent_for_code(draft.agent_code);
        if not found or by_code.switched_off_at is not null then
            insert into public.agent_events (kind, result) values ('claim', 'no_match');
            return jsonb_build_object('outcome', 'no_match');
        end if;
        if by_phone.id is distinct from by_code.id then
            insert into public.agent_events (agent_id, kind, result) values (by_code.id, 'claim', 'phone_mismatch');
            return jsonb_build_object('outcome', 'phone_mismatch');
        end if;

        -- Two claims on one agent wait for each other here.
        select * into agent from public.marketing_agents a where a.id = by_code.id for update;
        -- Switched off or retired while this waited for the row.
        if agent.retired_at is not null or agent.switched_off_at is not null then
            insert into public.agent_events (kind, result) values ('claim', 'no_match');
            return jsonb_build_object('outcome', 'no_match');
        end if;
        if agent.user_id is not null and public.agent_joined(agent.user_id) then
            return jsonb_build_object('outcome', 'joined');
        end if;
        if agent.email is not null then
            if public.agent_invite_sent_at(agent.id, agent.email) is not null then
                return jsonb_build_object('outcome', 'invited');
            end if;
            return jsonb_build_object('outcome', 'claim_waiting');
        end if;

        select * into waiting from public.agent_open_claims(agent.id) c where c.email = draft.agent_email limit 1;
        if found then
            if waiting.full_name = draft.agent_name then
                return jsonb_build_object('outcome', 'claimed', 'code', agent.code);
            end if;
            return jsonb_build_object('outcome', 'claim_waiting');
        end if;

        if public.agent_email_taken(draft.agent_email)
           or exists (select 1 from auth.users u where lower(u.email) = draft.agent_email) then
            return jsonb_build_object('outcome', 'email_unusable');
        end if;

        if exists (select 1 from public.agent_open_claims(agent.id)) then
            insert into public.agent_email_claims (agent_id, outcome, full_name, email)
            values (agent.id, 'competing', draft.agent_name, draft.agent_email);
            return jsonb_build_object('outcome', 'claim_waiting');
        end if;
        insert into public.agent_email_claims (agent_id, outcome, full_name, email)
        values (agent.id, 'pending', draft.agent_name, draft.agent_email);
        return jsonb_build_object('outcome', 'claimed', 'code', agent.code);
    end if;

    if by_phone.id is not null then
        if by_phone.switched_off_at is null and by_phone.full_name = draft.agent_name then
            -- A joined agent's email lives in Auth: the stored copy isn't read.
            if by_phone.user_id is not null and public.agent_joined(by_phone.user_id) then
                return jsonb_build_object('outcome', 'joined');
            end if;
            if by_phone.email is not distinct from draft.agent_email then
                if public.agent_invite_sent_at(by_phone.id, by_phone.email) is not null then
                    return jsonb_build_object('outcome', 'invited');
                end if;
                return jsonb_build_object('outcome', 'registered', 'code', by_phone.code, 'email', by_phone.email);
            end if;
        end if;
        return jsonb_build_object('outcome', 'code_needed');
    end if;

    if public.agent_email_taken(draft.agent_email)
       or exists (select 1 from auth.users u where lower(u.email) = draft.agent_email) then
        return jsonb_build_object('outcome', 'email_unusable');
    end if;

    adopt := draft.agent_code is not null
        and not public.agent_code_issued(draft.agent_code)
        and not exists (select 1 from public.leads l where l.referral_code = draft.agent_code);

    begin
        select * into made
        from public.create_agent_record(
            draft.agent_name, draft.agent_phone, draft.agent_whatsapp, draft.agent_email,
            case when adopt then draft.agent_code end,
            'Pending', null
        );
    exception when raise_exception then
        -- guard_login, or a creation alongside that took the email first.
        if sqlerrm = 'email_taken' then
            return jsonb_build_object('outcome', 'email_unusable');
        end if;
        raise;
    end;

    if draft.agent_code is not null and not adopt then
        update public.marketing_agents a set typed_code = draft.agent_code where a.id = made.agent_id;
    end if;

    select * into agent from public.marketing_agents a where a.id = made.agent_id;
    return jsonb_build_object('outcome', 'registered', 'code', agent.code, 'email', agent.email);
end;
$$;

revoke execute on function public.sign_up_marketing_agent(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.sign_up_marketing_agent(text, text, text, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- The Manager's queue.
-- ---------------------------------------------------------------------------

-- The agents awaiting email confirmation, the oldest waiting claim first:
-- the stored name, phone and code, and every waiting claim with its typed
-- name, email and time, oldest first. Staff who view leads.
create function public.agent_email_claim_queue()
returns table (
    agent_id uuid,
    full_name text,
    phone text,
    code text,
    status public.marketing_agent_status,
    claimed_at timestamptz,
    claims jsonb
)
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
        select a.id, a.full_name, a.phone, a.code, a.status, min(c.created_at), jsonb_agg(
            jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email, 'created_at', c.created_at)
            order by c.created_at, c.id
        )
        from public.marketing_agents a
        cross join lateral public.agent_open_claims(a.id) c
        where a.retired_at is null and a.switched_off_at is null and a.email is null
        group by a.id
        order by min(c.created_at), a.id;
end;
$$;

revoke execute on function public.agent_email_claim_queue() from public, anon;
grant execute on function public.agent_email_claim_queue() to authenticated;

-- Confirms or rejects one waiting claim. agents.approve. Refuses
-- `not_permitted`, `invalid` (decision), `not_found`, `already_decided`,
-- `retired`, `switched_off` and `has_email` (the agent got an email some other way; it is
-- never overwritten), and on confirm whatever set_marketing_agent_email
-- refuses (`already_joined`, `email_invalid`, `email_taken` with the holder).
-- Confirming saves `email` when given (Save and send invite), else the
-- claim's, and auto-rejects the agent's other waiting claims. Answers the
-- agent and the email saved (null on reject); the caller sends the invite.
create function public.decide_agent_email_claim(claim_id uuid, decision text, email text)
returns table (decided_agent_id uuid, saved_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    claim public.agent_email_claims;
    agent public.marketing_agents;
    address text;
    manager uuid := public.current_staff_id();
begin
    if not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    if decide_agent_email_claim.decision is null or decide_agent_email_claim.decision not in ('confirm', 'reject') then
        raise exception 'invalid';
    end if;

    select * into claim from public.agent_email_claims c
    where c.id = decide_agent_email_claim.claim_id and c.claim_id is null;
    if not found then
        raise exception 'not_found';
    end if;
    -- Decisions on one agent wait for each other here.
    select * into agent from public.marketing_agents a where a.id = claim.agent_id for update;
    if exists (select 1 from public.agent_email_claims d where d.claim_id = claim.id) then
        raise exception 'already_decided';
    end if;

    if decide_agent_email_claim.decision = 'reject' then
        insert into public.agent_email_claims (agent_id, claim_id, outcome, decided_by)
        values (agent.id, claim.id, 'rejected', manager);
        return query select agent.id, null::text;
        return;
    end if;

    if agent.retired_at is not null then
        raise exception 'retired';
    end if;
    if agent.switched_off_at is not null then
        raise exception 'switched_off';
    end if;
    if agent.email is not null then
        raise exception 'has_email';
    end if;
    address := coalesce(nullif(lower(btrim(coalesce(decide_agent_email_claim.email, ''))), ''), claim.email);
    perform 1 from public.set_marketing_agent_email(agent.id, address);

    insert into public.agent_email_claims (agent_id, claim_id, outcome, email, decided_by)
    values (agent.id, claim.id, 'confirmed', address, manager);
    insert into public.agent_email_claims (agent_id, claim_id, outcome, decided_by)
    select agent.id, o.id, 'auto_rejected', manager
    from public.agent_open_claims(agent.id) o
    where o.id <> claim.id;

    return query select agent.id, address;
end;
$$;

revoke execute on function public.decide_agent_email_claim(uuid, text, text) from public, anon;
grant execute on function public.decide_agent_email_claim(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Typed codes that weren't adopted, for the Agents screen.
-- ---------------------------------------------------------------------------

-- For each of the agents given that typed a code at sign-up that wasn't
-- adopted: the code, the current agent holding it (or null), whether only a
-- retired record held it, and how many leads carry it. Staff who view leads.
create function public.agent_sign_up_notes(agent_ids uuid[])
returns table (agent_id uuid, typed_code text, holder jsonb, retired_holder boolean, lead_count bigint)
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
        select
            a.id,
            a.typed_code,
            (select public.agent_ref(h) from public.agent_for_code(a.typed_code) h),
            not exists (select 1 from public.agent_for_code(a.typed_code)) and public.agent_code_issued(a.typed_code),
            (select count(*) from public.leads l where l.referral_code = a.typed_code)
        from public.marketing_agents a
        where a.id = any (agent_sign_up_notes.agent_ids) and a.typed_code is not null;
end;
$$;

revoke execute on function public.agent_sign_up_notes(uuid[]) from public, anon;
grant execute on function public.agent_sign_up_notes(uuid[]) to authenticated;
