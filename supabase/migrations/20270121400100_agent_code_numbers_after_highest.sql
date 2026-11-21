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
-- - Numbers run from 001 to 999 and start again (20261229100100). Once the
--   sequence has gone past 999 it is ahead of every code's number, so codes
--   saved after that no longer move it.
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

drop function public.last_agent_code_number();

-- Again, for a code an import or the Manager saved between the first fix and
-- the trigger.
select public.move_agent_code_numbers_to(public.highest_agent_code_number());
