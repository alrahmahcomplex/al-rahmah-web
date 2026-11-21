-- Agent codes continue after the highest number in the system (#521, owner
-- 2026-11-21).
--
-- Until now a generated code took the next number from the sequence
-- agent_code_numbers, which was set once from the newest record's code
-- (20261222100100) and moved by nothing else: an imported code or one the
-- Manager typed kept its own number, and the next sign-up still got a low
-- one. Self-registered agents started again at 001 and repeated numbers
-- already held (SAH-002 and SMS-002 both exist; both stay).
--
-- create_agent_record now picks a generated code's number from the agent
-- records themselves, every time:
--
-- - One more than the highest number any agent record holds, retired records
--   included: imported, typed on Create agent, generated or kept by Recreate.
--   Only a code in the ABC-123 shape has a number, its three digits; every
--   agent code saved since 20261229100100 has that shape. An import or a
--   typed code counts as soon as it is saved, so the next code is higher
--   still, and the codes held today count from the first creation after this
--   migration: nothing needs moving, and no stored code changes.
-- - Once 999 is held (lead, 2026-11-21), the lowest number no agent record
--   holds, so one typed 999 never starts a run of repeats.
-- - Once every number is held, numbers repeat: the lowest number whose code
--   with these letters is free, and with none left the creation is refused
--   as `no_free_code`.
-- - As before, a code a lead carries, or whose key a Promo code holds, is
--   passed over. When the only free numbers are ones these letters can't use
--   that way, these letters repeat a number.
--
-- No lock is waited for:
--
-- - While a record is being saved, its number is held with a transaction
--   advisory lock (`agent-code-number:<n>`). A generated code's creation
--   only tries it (pg_try_advisory_xact_lock): a number another creation, an
--   import or the Manager is saving right now is passed over, so creations
--   at the same moment never share a number, and a sign-up never waits on an
--   import. After the lock, a creation looks again for a record saved
--   meanwhile.
-- - The trigger hold_agent_code_number takes the lock for every saved code.
--   A generated code already holds it. A typed or imported code waits for
--   it while a sign-up is saving that number, so no generated code can take
--   a number a typed code is being saved with; a sign-up with a typed code
--   may wait that way on an import saving the same number.
-- - A creation checks a number's code before trying its lock, so it holds
--   only a number it will use.
-- - A code an open import or creation is still saving isn't visible yet, so
--   a sign-up at that moment may take a number below it, never the same one.
-- - If the only free numbers are ones other creations are saving right then,
--   numbers repeat early; once those creations finish every number is held
--   anyway.
--
-- The sequence agent_code_numbers no longer hands out numbers. Its position
-- stays at the last number the old function took, and a creation starts
-- above it too, so it never meets a number a call still running the old
-- function is saving. It stays until a later migration, so such a call never
-- fails. last_agent_code_number, which seeded it once, is dropped.
--
-- Supabase runs these statements one by one, outside a transaction. The
-- functions are created and revoked in one block, so no client role can call
-- them in between. The trigger goes in before create_agent_record changes,
-- so every record saved from then on holds its number.

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

    -- The number a code holds while its record is being saved, for
    -- create_agent_record to pass over. A generated code's creation already
    -- holds it, so this returns at once; a typed or imported code waits for
    -- a creation saving the same number to finish.
    create function public.hold_agent_code_number()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
        if public.is_agent_code_shape(new.code) then
            perform pg_advisory_xact_lock(hashtextextended('agent-code-number:' || right(new.code, 3)::integer, 0));
        end if;
        return new;
    end;
    $$;
    revoke execute on function public.hold_agent_code_number() from public, anon, authenticated, service_role;
end;
$migration$;

-- Before the row, so the number is held before the row exists.
create trigger hold_agent_code_number
    before insert or update of code on public.marketing_agents
    for each row execute function public.hold_agent_code_number();

-- ---------------------------------------------------------------------------
-- create_agent_record, as 20261229100200_agent_import_names_and_code.sql made
-- it, with the generated code's number chosen by the rule above. Its
-- signature and grants are unchanged.
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
    number integer;
    highest integer;
    floor_number integer;
    holders bigint;
    every_number_held boolean := false;
    tried integer[] := '{}';
    tried_again integer[] := '{}';
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

    -- A typed code is tried once, and either saves or raises. A generated
    -- code tries each number at most once in each of the two passes below,
    -- so the loop ends. The unique index catches a code committed alongside.
    loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
        elsif not every_number_held then
            -- No record holds the number: above the highest and the last
            -- number the old function took first, then any between, then the
            -- lowest.
            highest := public.highest_agent_code_number();
            select greatest(highest, case when s.is_called then s.last_value else s.last_value - 1 end) into floor_number
            from public.agent_code_numbers s;
            select g into number
            from generate_series(1, 999) g
            where g <> all (tried)
              and g not in (
                  select right(a.code, 3)::integer from public.marketing_agents a
                  where public.is_agent_code_shape(a.code)
              )
            order by g <= floor_number, g <= highest, g
            limit 1;
            if number is null then
                every_number_held := true;
                continue;
            end if;
            tried := tried || number;
            candidate := prefix || '-' || lpad(number::text, 3, '0');
            continue when public.agent_code_issued(candidate)
                or exists (select 1 from public.leads l where l.referral_code in (candidate, public.discount_code_key(candidate)))
                or public.promo_code_holds_key(candidate);
            -- Another creation is saving this number: pass it over, never wait.
            continue when not pg_try_advisory_xact_lock(hashtextextended('agent-code-number:' || number, 0));
            -- One that saved it and finished before the lock came free.
            continue when exists (
                select 1 from public.marketing_agents a
                where case when public.is_agent_code_shape(a.code) then right(a.code, 3)::integer end = number
            );
        else
            -- Every number held: the lowest whose code with these letters is
            -- free, and how many records hold it, read together.
            select g, (
                       select count(*) from public.marketing_agents a
                       where case when public.is_agent_code_shape(a.code) then right(a.code, 3)::integer end = g
                   )
            into number, holders
            from generate_series(1, 999) g
            where g <> all (tried_again)
              and not public.agent_code_issued(prefix || '-' || lpad(g::text, 3, '0'))
              and not exists (
                  select 1 from public.leads l
                  where l.referral_code in (prefix || '-' || lpad(g::text, 3, '0'), prefix || lpad(g::text, 3, '0'))
              )
              and not public.promo_code_holds_key(prefix || '-' || lpad(g::text, 3, '0'))
            order by g
            limit 1;
            if number is null then
                raise exception 'no_free_code' using detail = prefix;
            end if;
            tried_again := tried_again || number;
            candidate := prefix || '-' || lpad(number::text, 3, '0');
            continue when not pg_try_advisory_xact_lock(hashtextextended('agent-code-number:' || number, 0));
            -- Another creation saved it and finished before the lock came free.
            continue when (
                select count(*) from public.marketing_agents a
                where case when public.is_agent_code_shape(a.code) then right(a.code, 3)::integer end = number
            ) <> holders;
        end if;
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

drop function public.last_agent_code_number();
