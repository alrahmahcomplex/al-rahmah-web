-- Discount codes in the v38 format (#404): the agent's initials, a hyphen and
-- the next number after the last generated code. ABC-123, then XYZ-124.
--
-- - agent_code_numbers: a sequence, the numbers generated codes end in. Only
--   create_agent_record takes from it. A sequence hands each caller its own
--   number at once and never the same one twice, so creations at the same
--   moment get different numbers without waiting for each other: no lock is
--   held, and an agent import never holds up a sign-up. A number taken by a
--   creation that then fails, or by a code that turns out to be taken, is
--   not handed out again.
-- - agent_code_number(code): the number a code ends in when it has the
--   generated shape (1 to 3 letters, a hyphen, digits), else null.
-- - The sequence starts after the number in the newest agent record's code
--   in that shape (by registered_at, retired records included), read once
--   here. With no such code the first code ends in 001.
-- - create_agent_record, re-created with its signature and grants unchanged,
--   generates every code without one given: the Discount code page's
--   sign-up, the Manager's Create agent and the agent import.
-- - A code someone types, and the code Recreate keeps, take no number. A
--   generated code another record holds or held, or a lead carries, is
--   skipped: the next number is taken until the code is free.
-- - The number has at least three digits; past 999 it prints in full
--   (ABC-1000).
-- - Supabase runs these statements one by one. A creation between the seed
--   and the new create_agent_record gets an old random code, which the new
--   one later skips if it ever meets it.

create sequence public.agent_code_numbers as bigint minvalue 0 start with 1 no cycle;

-- Not agent data, so not audited. No client may read it or take a number.
revoke all on sequence public.agent_code_numbers from public, anon, authenticated, service_role;

create function public.agent_code_number(code text)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select case when agent_code_number.code ~ '^[A-Z]{1,3}-[0-9]{1,15}$'
                then substring(agent_code_number.code from '[0-9]+$')::bigint end;
$$;

revoke execute on function public.agent_code_number(text) from public, anon, authenticated, service_role;

-- The number in the newest agent record's code in the generated shape, or 0.
-- The migration starts the sequence after it; the tests check the rule.
create function public.last_agent_code_number()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((
        select public.agent_code_number(a.code)
        from public.marketing_agents a
        where public.agent_code_number(a.code) is not null
        order by a.registered_at desc, a.id desc
        limit 1
    ), 0);
$$;

revoke execute on function public.last_agent_code_number() from public, anon, authenticated, service_role;

-- The next number is one more than this.
select setval('public.agent_code_numbers', public.last_agent_code_number(), true);

-- ---------------------------------------------------------------------------
-- create_agent_record, as 20261121120100_agent_import.sql made it, with the
-- generated code's number taken from the sequence instead of at random.
-- ---------------------------------------------------------------------------

create or replace function public.create_agent_record(
    full_name text,
    phone text,
    whatsapp text,
    email text,
    code text,
    status public.marketing_agent_status,
    approved_by uuid,
    new_agent_id uuid default null,
    new_user_id uuid default null,
    reuse_retired_code boolean default false,
    batch_id uuid default null
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
    number bigint;
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

    -- A generated code takes the next number until its code is free. The
    -- unique index catches a typed code committed alongside.
    for attempt in 1..100 loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
        else
            number := nextval('public.agent_code_numbers');
            candidate := prefix || '-' || lpad(number::text, greatest(3, char_length(number::text)), '0');
        end if;
        -- Skips the subtransaction below for a code already used.
        continue when draft.agent_code is null
            and (public.agent_code_issued(candidate)
                 or exists (select 1 from public.leads l where l.referral_code = candidate));
        begin
            insert into public.marketing_agents (id, full_name, phone, whatsapp, email, code, status, approved_at, approved_by, user_id, import_batch_id)
            values (
                new_id, draft.agent_name, draft.agent_phone, draft.agent_whatsapp, draft.agent_email, candidate,
                create_agent_record.status,
                case when create_agent_record.status = 'Approved' then now() end,
                create_agent_record.approved_by,
                create_agent_record.new_user_id,
                create_agent_record.batch_id
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
