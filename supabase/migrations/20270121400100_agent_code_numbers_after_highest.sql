-- Agent codes continue after the highest number in the system (#521, owner
-- 2026-11-21).
--
-- Until now the sequence agent_code_numbers was set once, from the newest
-- record's code (20261222100100), and nothing moved it: an imported code or
-- one the Manager typed kept its own number, and the next sign-up still got
-- a low one. Self-registered agents started again at 001 and repeated
-- numbers already held (SAH-002 and SMS-002 both exist; both stay).
--
-- - Saving an agent record moves the sequence past its code's number:
--   imported, typed on Create agent, generated, or kept by Recreate. A
--   trigger does it, so every way a code is saved is covered, now and later.
--   The next generated number is then one more than the highest any agent
--   code holds, retired records included.
-- - The sequence only moves forward, by taking numbers (nextval) until it
--   reaches the code's number. No lock is taken, so a sign-up never waits on
--   an import, and creations at the same moment still never get the same
--   number. The numbers passed over are never handed out, like any other
--   taken number. A generated code's number came from the sequence, so it
--   never moves it.
-- - Only a code in the ABC-123 shape has a number: its three digits. Every
--   agent code saved since 20261229100100 has that shape.
-- - Past 999 (lead, 2026-11-21): a generated code takes the lowest number no
--   agent record holds, retired records included, so one typed 999 never
--   starts a run of repeats. Numbers repeat only once all 999 are held; then
--   the sequence wraps round as before (20261229100100), skipping only a code
--   itself. The sequence is then ahead of every code's number, so codes saved
--   after that no longer move it.
-- - No lock is waited for. While a record is being saved, its number is held
--   with a transaction advisory lock that a creation past 999 only tries
--   (pg_try_advisory_xact_lock): a number another creation, an import or the
--   Manager is saving right now is passed over, not waited for. Before 999
--   the sequence alone keeps generated numbers apart, as before.
-- - The sequence moves past the highest number held today, the one-time fix,
--   once before the trigger and once after: a sign-up while this runs never
--   gets a number below it, and a code saved before the trigger is counted.
--   No stored code changes.
-- - Supabase runs these statements one by one, outside a transaction. Each
--   function is created and revoked in one block, so no client role can call
--   it in between.
-- - last_agent_code_number, which seeded the sequence once, is dropped:
--   highest_agent_code_number replaces it.

-- The functions, each created and revoked in one block.
do $migration$
begin
    -- The highest number any agent record's code holds, retired records
    -- included, or 0.
    create function public.highest_agent_code_number()
    returns bigint
    language sql
    stable
    security definer
    set search_path = ''
    as $$
        select coalesce(max(case when public.is_agent_code_shape(a.code) then right(a.code, 3)::bigint end), 0)
        from public.marketing_agents a;
    $$;
    revoke execute on function public.highest_agent_code_number() from public, anon, authenticated, service_role;

    -- Takes numbers from the sequence until the last one taken is at least
    -- `code_number`, never past 999; a sequence already there is left alone,
    -- so this takes at most 999 numbers. The position is read again before
    -- each number, so two moves at once stop as soon as either gets there.
    create function public.move_agent_code_numbers_to(code_number bigint)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
        target bigint := least(move_agent_code_numbers_to.code_number, 999);
    begin
        -- The sequence's own position, not a snapshot: it shows every number
        -- any session has taken, committed or not.
        while (select case when s.is_called then s.last_value else s.last_value - 1 end
               from public.agent_code_numbers s) < target loop
            perform nextval('public.agent_code_numbers');
        end loop;
    end;
    $$;
    revoke execute on function public.move_agent_code_numbers_to(bigint) from public, anon, authenticated, service_role;

    create function public.move_agent_code_numbers()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
        if public.is_agent_code_shape(new.code) then
            perform public.move_agent_code_numbers_to(right(new.code, 3)::bigint);
        end if;
        return null;
    end;
    $$;
    revoke execute on function public.move_agent_code_numbers() from public, anon, authenticated, service_role;

    -- The number a code holds while its record is being saved, for
    -- create_agent_record past 999 to pass over. Never waits: a creation
    -- that already holds it is the one that picked it.
    create function public.hold_agent_code_number()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
        if public.is_agent_code_shape(new.code) then
            perform pg_try_advisory_xact_lock(hashtextextended('agent-code-number:' || right(new.code, 3)::integer, 0));
        end if;
        return new;
    end;
    $$;
    revoke execute on function public.hold_agent_code_number() from public, anon, authenticated, service_role;
end;
$migration$;

-- The one-time fix, first: from here on a sign-up gets a number above every
-- code held now.
select public.move_agent_code_numbers_to(public.highest_agent_code_number());

-- After the row: a code refused by the unique index or another trigger never
-- moves the sequence. A creation that rolls back later leaves it moved, which
-- only passes over numbers no code holds.
create trigger move_agent_code_numbers
    after insert or update of code on public.marketing_agents
    for each row execute function public.move_agent_code_numbers();

-- Before the row, so the number is held before the row exists.
create trigger hold_agent_code_number
    before insert or update of code on public.marketing_agents
    for each row execute function public.hold_agent_code_number();

drop function public.last_agent_code_number();

-- Again, for a code an import or the Manager saved between the first fix and
-- the trigger.
select public.move_agent_code_numbers_to(public.highest_agent_code_number());

-- ---------------------------------------------------------------------------
-- create_agent_record, as 20261229100200_agent_import_names_and_code.sql made
-- it, taking the lowest number no agent holds once the sequence is past 999.
-- Its signature and grants are unchanged.
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
    tries integer := 0;
    past_999 boolean := false;
    all_held boolean := false;
    tried integer[] := '{}';
    lowest integer;
    violated text;
begin
    select * into draft
    from public.agent_draft(
        create_agent_record.full_name, create_agent_record.phone, create_agent_record.whatsapp,
        create_agent_record.email, create_agent_record.code, create_agent_record.batch_id is not null
    );
    if create_agent_record.status is null
       or (create_agent_record.status = 'Approved') <> (create_agent_record.approved_by is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'status')::text;
    end if;

    -- An imported agent may have no mobile: then no phone to lock or match.
    if draft.agent_phone is not null then
        perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || draft.agent_phone, 0));

        select a.id into existing
        from public.marketing_agents a
        where a.phone = draft.agent_phone and a.retired_at is null;
        if found then
            return query select null::uuid, false, existing;
            return;
        end if;
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

    -- A generated code takes the next number from the sequence. Past 999 it
    -- takes the lowest number no agent record holds, retired records
    -- included, passing over one another creation is saving right now. When
    -- every number is held, it takes the next number round again, 001 to
    -- 999, until its code is free; other creations take numbers from the
    -- same sequence meanwhile, so after 999 tries the free numbers left for
    -- these letters are looked for directly, lowest first; none left is
    -- `no_free_code`. A typed code is tried once, and either saves or raises.
    -- The unique index catches a code committed alongside.
    loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
        elsif not past_999 then
            number := nextval('public.agent_code_numbers');
            if number > 999 then
                past_999 := true;
                continue;
            end if;
            candidate := prefix || '-' || lpad(number::text, 3, '0');
        elsif not all_held then
            select min(g) into lowest
            from generate_series(1, 999) g
            where g <> all (tried)
              and g not in (
                  select right(a.code, 3)::integer from public.marketing_agents a
                  where public.is_agent_code_shape(a.code)
              );
            if lowest is null then
                all_held := true;
                continue;
            end if;
            tried := tried || lowest;
            candidate := prefix || '-' || lpad(lowest::text, 3, '0');
            -- Held by a creation still open: pass it over, never wait.
            continue when not pg_try_advisory_xact_lock(hashtextextended('agent-code-number:' || lowest, 0));
            -- Saved by one that committed before the lock came free.
            continue when exists (
                select 1 from public.marketing_agents a
                where case when public.is_agent_code_shape(a.code) then right(a.code, 3)::integer end = lowest
            );
        elsif tries < 999 then
            tries := tries + 1;
            number := (nextval('public.agent_code_numbers') - 1) % 999 + 1;
            candidate := prefix || '-' || lpad(number::text, 3, '0');
        else
            select c.code into candidate
            from (select prefix || '-' || lpad(g::text, 3, '0') as code from generate_series(1, 999) g) c
            where not public.agent_code_issued(c.code)
              and not exists (select 1 from public.leads l where l.referral_code in (c.code, public.discount_code_key(c.code)))
              and not public.promo_code_holds_key(c.code)
            order by c.code
            limit 1;
            if candidate is null then
                raise exception 'no_free_code' using detail = prefix;
            end if;
        end if;
        -- Skips the subtransaction below for a code already used.
        continue when draft.agent_code is null
            and (public.agent_code_issued(candidate)
                 or exists (
                     select 1 from public.leads l
                     where l.referral_code in (candidate, public.discount_code_key(candidate))
                 )
                 or public.promo_code_holds_key(candidate));
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
        when raise_exception then
            -- refuse_agent_code_taken: a Promo code with this key committed
            -- after the check. A generated code moves on to the next number.
            if sqlerrm <> 'code_taken' or draft.agent_code is not null then
                raise;
            end if;
        end;
    end loop;
end;
$$;
