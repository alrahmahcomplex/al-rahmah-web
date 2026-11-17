-- Agents import with only three names and an ABC-123 code (#463).
--
-- - marketing_agents.phone may be empty, but only on a record an import made
--   (import_batch_id set). Sign-up, Create agent and Recreate still need a
--   mobile: agent_draft refuses a missing one unless the caller says the
--   mobile is optional, and only create_agent_record for an import does.
-- - An import row needs three names (three words or more) and a code; the
--   code is already held to ABC-123 (#462). Mobile, WhatsApp and email are
--   optional and still read as before when given. agent_import_rows refuses
--   a row with fewer than three names, as the file's own check does first.
-- - A row with no mobile takes no phone lock and matches no agent by phone.
--   A stored agent is matched by code and name; the import never changes a
--   stored mobile.
-- - Hosted held no agent record when this was written (2026-11-17), and every
--   stored record has a mobile, so the new check holds for every row.

select public.set_audit_actor('system');

alter table public.marketing_agents alter column phone drop not null;
alter table public.marketing_agents
    add constraint marketing_agents_phone_needed check (phone is not null or import_batch_id is not null);

-- The staff screens' search text, as 20261016400100_marketing_agents.sql made
-- it, with the mobile optional: joined to a missing mobile it was null, and
-- the agent could not be found by name or code. Dropped and added again, as
-- a stored generated column's expression can't otherwise change everywhere
-- this runs.
alter table public.marketing_agents drop column search_text;
alter table public.marketing_agents
    add column search_text text generated always as (
        lower(full_name) || ' ' || lower(code)
        || coalesce(' ' || regexp_replace(phone, '\D', '', 'g'), '')
        || coalesce(' ' || regexp_replace(whatsapp, '\D', '', 'g'), '')
    ) stored;

-- ---------------------------------------------------------------------------
-- agent_draft, as 20261229100100_promo_any_format_agent_code_shape.sql made
-- it, with phone_optional: an empty mobile is none instead of refused.
-- Every other caller leaves it false.
-- ---------------------------------------------------------------------------

drop function public.agent_draft(text, text, text, text, text);

create function public.agent_draft(
    full_name text, phone text, whatsapp text, email text, code text, phone_optional boolean default false,
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

    -- An import row may leave the mobile empty: none is stored.
    if agent_draft.phone_optional and nullif(btrim(coalesce(agent_draft.phone, '')), '') is null then
        agent_phone := null;
    else
        agent_phone := public.normalize_phone(coalesce(agent_draft.phone, ''));
    end if;
    if agent_phone is null and not agent_draft.phone_optional then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    agent_whatsapp := nullif(btrim(coalesce(agent_draft.whatsapp, '')), '');
    if agent_whatsapp is not null then
        agent_whatsapp := public.normalize_phone(agent_whatsapp);
        if agent_whatsapp is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if agent_whatsapp is not distinct from agent_phone then
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
        if agent_code is null or not public.is_agent_code_shape(agent_code) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
        end if;
    end if;
end;
$$;

revoke execute on function public.agent_draft(text, text, text, text, text, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_import_rows, as 20261121120100_agent_import.sql made it, with the
-- mobile optional and three names required.
-- ---------------------------------------------------------------------------

create or replace function public.agent_import_rows(rows jsonb)
returns table (sheet_row integer, code text, full_name text, phone text, whatsapp text, email text)
language plpgsql
stable
set search_path = ''
as $$
declare
    bad record;
begin
    if jsonb_typeof(agent_import_rows.rows) is distinct from 'array'
       or jsonb_array_length(agent_import_rows.rows) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'rows')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(agent_import_rows.rows) r
        where jsonb_typeof(r) is distinct from 'object'
           or jsonb_typeof(r -> 'sheet_row') is distinct from 'number'
           or (r ->> 'sheet_row') !~ '^[0-9]{1,7}$'
           or (r ->> 'sheet_row')::integer < 2
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;

    -- Each value as agent_draft would store it, the WhatsApp number never the
    -- mobile itself. agent_draft raises `invalid` with the field itself for a
    -- value it can't read at all.
    for bad in
        select (r ->> 'sheet_row')::integer as sheet_row,
               r ->> 'code' as code, r ->> 'full_name' as full_name, r ->> 'phone' as phone,
               r ->> 'whatsapp' as whatsapp, r ->> 'email' as email,
               d.agent_code, d.agent_name, d.agent_phone, d.agent_whatsapp, d.agent_email
        from jsonb_array_elements(agent_import_rows.rows) r
        cross join lateral public.agent_draft(r ->> 'full_name', r ->> 'phone', r ->> 'whatsapp', r ->> 'email', r ->> 'code', true) d
    loop
        if bad.code is null or bad.code is distinct from bad.agent_code then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'code', 'sheet_row', bad.sheet_row)::text;
        end if;
        if bad.full_name is distinct from bad.agent_name
           or coalesce(array_length(regexp_split_to_array(bad.agent_name, ' '), 1), 0) < 3 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'full_name', 'sheet_row', bad.sheet_row)::text;
        end if;
        if bad.phone is distinct from bad.agent_phone then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone', 'sheet_row', bad.sheet_row)::text;
        end if;
        if bad.whatsapp is distinct from bad.agent_whatsapp then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp', 'sheet_row', bad.sheet_row)::text;
        end if;
        if bad.email is distinct from bad.agent_email then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'email', 'sheet_row', bad.sheet_row)::text;
        end if;
    end loop;

    -- No two rows share a sheet row, code, mobile or email: the file's own
    -- checks refuse those rows before they are sent.
    if exists (select 1 from jsonb_array_elements(agent_import_rows.rows) r group by r ->> 'sheet_row' having count(*) > 1) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;
    if exists (select 1 from jsonb_array_elements(agent_import_rows.rows) r group by r ->> 'code' having count(*) > 1) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(agent_import_rows.rows) r
        where r ->> 'phone' is not null
        group by r ->> 'phone' having count(*) > 1
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(agent_import_rows.rows) r
        where r ->> 'email' is not null
        group by r ->> 'email' having count(*) > 1
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'email')::text;
    end if;

    return query
    select (r ->> 'sheet_row')::integer, r ->> 'code', r ->> 'full_name', r ->> 'phone', r ->> 'whatsapp', r ->> 'email'
    from jsonb_array_elements(agent_import_rows.rows) r
    order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_agent_import, as 20261121120100_agent_import.sql made it, locking
-- only the mobiles the file gives.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_agent_import(file_name text, row_count integer, rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    manager uuid;
    batch_file text := btrim(coalesce(confirm_agent_import.file_name, ''));
    lock_key text;
    checked jsonb;
    changed jsonb;
    creates integer;
    email_adds integer;
    batch uuid;
    item record;
    made record;
    updated integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    select s.id into manager from public.staff_members s where s.user_id = auth.uid();
    if batch_file = '' or char_length(batch_file) > 255 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'file_name')::text;
    end if;
    if jsonb_typeof(confirm_agent_import.rows) is distinct from 'array'
       or confirm_agent_import.row_count is null
       or confirm_agent_import.row_count not between greatest(jsonb_array_length(confirm_agent_import.rows), 1) and 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_count')::text;
    end if;

    -- One import at a time.
    perform pg_advisory_xact_lock(hashtextextended('agent-import', 0));

    -- Every phone, then every email, each in sorted order, then the agents
    -- it updates: the lock order in the header. A creation or a Recreate
    -- holding one finishes first, and the verdicts below see it.
    for lock_key in
        select r.phone from public.agent_import_rows(confirm_agent_import.rows) r where r.phone is not null order by r.phone
    loop
        perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || lock_key, 0));
    end loop;
    for lock_key in
        select r.email from public.agent_import_rows(confirm_agent_import.rows) r where r.email is not null order by r.email
    loop
        perform public.lock_login_email(lock_key);
    end loop;

    -- Each row with its verdict now and the verdict the Manager saw.
    select coalesce(jsonb_agg(jsonb_build_object(
            'sheet_row', v.sheet_row,
            'verdict', v.verdict,
            'expected', e.value -> 'expected',
            'row', e.value
        ) order by v.sheet_row), '[]'::jsonb)
    into checked
    from public.agent_import_verdicts(confirm_agent_import.rows) v
    join jsonb_array_elements(confirm_agent_import.rows) e on (e.value ->> 'sheet_row')::integer = v.sheet_row;

    select coalesce(jsonb_agg(jsonb_build_object('sheet_row', c -> 'sheet_row', 'verdict', c -> 'verdict')
               order by (c ->> 'sheet_row')::integer), '[]'::jsonb)
    into changed
    from jsonb_array_elements(checked) c
    where c -> 'verdict' is distinct from c -> 'expected';
    if jsonb_array_length(changed) > 0 then
        return jsonb_build_object('outcome', 'changed', 'rows', changed);
    end if;

    select count(*) filter (where c -> 'verdict' ->> 'verdict' = 'create'),
           count(*) filter (where c -> 'verdict' ->> 'verdict' = 'email_to_add')
    into creates, email_adds
    from jsonb_array_elements(checked) c;
    if creates + email_adds = 0 then
        raise exception 'nothing_to_import';
    end if;

    insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
    values ('agents', batch_file, manager, confirm_agent_import.row_count, creates, email_adds,
            confirm_agent_import.row_count - creates - email_adds)
    returning id into batch;

    for item in
        select (c ->> 'sheet_row')::integer as sheet_row,
               c -> 'row' ->> 'full_name' as full_name, c -> 'row' ->> 'phone' as phone,
               c -> 'row' ->> 'whatsapp' as whatsapp, c -> 'row' ->> 'email' as email, c -> 'row' ->> 'code' as code
        from jsonb_array_elements(checked) c
        where c -> 'verdict' ->> 'verdict' = 'create'
        order by 1
    loop
        select * into made
        from public.create_agent_record(
            item.full_name, item.phone, item.whatsapp, item.email, item.code, 'Approved', manager,
            null, null, false, batch
        );
        if not made.created then
            raise exception 'import_conflict' using detail = jsonb_build_object('sheet_row', item.sheet_row)::text;
        end if;
    end loop;

    -- An email for an agent who had none: only while they are still current
    -- and still have none.
    update public.marketing_agents a
    set email = c -> 'row' ->> 'email'
    from jsonb_array_elements(checked) c
    where c -> 'verdict' ->> 'verdict' = 'email_to_add'
      and a.id = (c -> 'verdict' -> 'agent' ->> 'id')::uuid
      and a.email is null
      and a.retired_at is null;
    get diagnostics updated = row_count;
    if updated <> email_adds then
        raise exception 'import_conflict';
    end if;

    return jsonb_build_object(
        'outcome', 'imported',
        'batch_id', batch,
        'created', creates,
        'emails_added', email_adds,
        'skipped', confirm_agent_import.row_count - creates - email_adds
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_agent_record, as 20261229100100_promo_any_format_agent_code_shape.sql
-- made it, with the mobile optional for an import (batch_id given).
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

    -- A generated code takes the next number, 001 to 999 and round again,
    -- until its code is free. Other creations take numbers from the same
    -- sequence meanwhile, so after 999 tries the free numbers left for these
    -- letters are looked for directly, lowest first; none left is
    -- `no_free_code`. A typed code is tried once, and either saves or
    -- raises. The unique index catches a code committed alongside.
    loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
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

-- ---------------------------------------------------------------------------
-- Claiming an imported agent's code (#463, owner 2026-11-17). On the
-- Discount code page "Do you already have a Discount code? Yes" claims an
-- agent by code. An agent imported with no mobile is matched by code and
-- three names instead of by phone, and the mobile typed must belong to no
-- current agent. The claim keeps the mobile and WhatsApp typed; the
-- Manager's confirm stores them on the record with the email, only into an
-- empty mobile, and refuses with `phone_taken` if another current agent has
-- the mobile by then.
-- ---------------------------------------------------------------------------

alter table public.agent_events drop constraint agent_events_result_check;
alter table public.agent_events
    add constraint agent_events_result_check check (
        (kind in ('invite', 'reset') and result in (
            'started', 'sent', 'rate_limited', 'smtp_error', 'rejected_address', 'other_error', 'access_off'
        ))
        or (kind = 'claim' and result in ('no_match', 'phone_mismatch', 'name_mismatch'))
    );
-- A refused claim keeps no typed value; only no_match names no agent.
alter table public.agent_events drop constraint agent_events_claim_check;
alter table public.agent_events
    add constraint agent_events_claim_check check (
        kind <> 'claim' or (email is null and (result in ('phone_mismatch', 'name_mismatch')) = (agent_id is not null))
    );

alter table public.agent_email_claims
    add column phone text check (phone = public.normalize_phone(phone)),
    add column whatsapp text check (whatsapp = public.normalize_phone(whatsapp)),
    add constraint agent_email_claims_contact_on_claim check ((phone is null and whatsapp is null) or claim_id is null);

-- ---------------------------------------------------------------------------
-- The agent guard, as 20261121120100_agent_import.sql made it, letting
-- decide_agent_email_claim fill an empty mobile once.
-- ---------------------------------------------------------------------------

create or replace function public.guard_marketing_agent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    writer text := case when current_user not in ('authenticated', 'anon')
        then coalesce(current_setting('app.agent_status_change', true), '') else '' end;
    -- decide_agent_email_claim fills an imported agent's empty mobile.
    filling text := case when current_user not in ('authenticated', 'anon')
        then coalesce(current_setting('app.agent_fill_mobile', true), '') else '' end;
begin
    if tg_op = 'INSERT' then
        if new.retired_at is not null or new.switched_off_at is not null then
            raise exception 'agent_status_cached';
        end if;
        return new;
    end if;

    if (new.retired_at is distinct from old.retired_at or new.switched_off_at is distinct from old.switched_off_at)
       and (writer is distinct from old.id::text or old.retired_at is not null) then
        raise exception 'agent_status_cached';
    end if;
    if old.retired_at is not null then
        raise exception 'agent_locked';
    end if;
    if new.code is distinct from old.code
       or (new.phone is distinct from old.phone
           and not (old.phone is null and new.phone is not null and filling = old.id::text))
       or new.registered_at is distinct from old.registered_at
       or new.import_batch_id is distinct from old.import_batch_id then
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

-- ---------------------------------------------------------------------------
-- sign_up_marketing_agent, as 20261127120700_agent_email_claims.sql made it,
-- matching an agent with no mobile by code and names.
-- ---------------------------------------------------------------------------

create or replace function public.sign_up_marketing_agent(
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
        if by_code.phone is null then
            -- An agent imported with no mobile (#463): the code and the three
            -- names identify them, and the mobile typed must be nobody's.
            if lower(regexp_replace(btrim(by_code.full_name), '\s+', ' ', 'g')) <> lower(draft.agent_name) then
                insert into public.agent_events (agent_id, kind, result) values (by_code.id, 'claim', 'name_mismatch');
                return jsonb_build_object('outcome', 'name_mismatch');
            end if;
            if by_phone.id is not null then
                insert into public.agent_events (agent_id, kind, result) values (by_code.id, 'claim', 'phone_mismatch');
                return jsonb_build_object('outcome', 'phone_mismatch');
            end if;
        elsif by_phone.id is distinct from by_code.id then
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
            insert into public.agent_email_claims (agent_id, outcome, full_name, email, phone, whatsapp)
            values (agent.id, 'competing', draft.agent_name, draft.agent_email,
                    case when agent.phone is null then draft.agent_phone end,
                    case when agent.phone is null then draft.agent_whatsapp end);
            return jsonb_build_object('outcome', 'claim_waiting');
        end if;
        insert into public.agent_email_claims (agent_id, outcome, full_name, email, phone, whatsapp)
        values (agent.id, 'pending', draft.agent_name, draft.agent_email,
                case when agent.phone is null then draft.agent_phone end,
                case when agent.phone is null then draft.agent_whatsapp end);
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

-- ---------------------------------------------------------------------------
-- agent_email_claim_queue, as 20261127120700_agent_email_claims.sql made it,
-- with each claim's mobile and WhatsApp.
-- ---------------------------------------------------------------------------

create or replace function public.agent_email_claim_queue()
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
            jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'whatsapp', c.whatsapp, 'created_at', c.created_at)
            order by c.created_at, c.id
        )
        from public.marketing_agents a
        cross join lateral public.agent_open_claims(a.id) c
        where a.retired_at is null and a.switched_off_at is null and a.email is null
        group by a.id
        order by min(c.created_at), a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- decide_agent_email_claim, as 20261127120700_agent_email_claims.sql made it,
-- filling an imported agent's empty mobile on confirm.
-- ---------------------------------------------------------------------------

create or replace function public.decide_agent_email_claim(claim_id uuid, decision text, email text)
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
    holder public.marketing_agents;
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
    -- A claim carrying a mobile takes its lock first, the order creation and
    -- Recreate take them in.
    if claim.phone is not null then
        perform pg_advisory_xact_lock(hashtextextended('agent-phone:' || claim.phone, 0));
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
    -- An agent imported with no mobile takes the mobile and WhatsApp the
    -- claim typed (#463), unless another current agent has that mobile now.
    -- A stored mobile is never changed.
    if agent.phone is null and claim.phone is not null then
        select * into holder from public.marketing_agents a where a.phone = claim.phone and a.retired_at is null;
        if found then
            raise exception 'phone_taken' using detail = public.agent_ref(holder)::text;
        end if;
    end if;
    address := coalesce(nullif(lower(btrim(coalesce(decide_agent_email_claim.email, ''))), ''), claim.email);
    perform 1 from public.set_marketing_agent_email(agent.id, address);
    if agent.phone is null and claim.phone is not null then
        perform set_config('app.agent_fill_mobile', agent.id::text, true);
        update public.marketing_agents a
        set phone = claim.phone,
            whatsapp = coalesce(a.whatsapp, nullif(claim.whatsapp, claim.phone))
        where a.id = agent.id;
        perform set_config('app.agent_fill_mobile', '', true);
    end if;

    insert into public.agent_email_claims (agent_id, claim_id, outcome, email, decided_by)
    values (agent.id, claim.id, 'confirmed', address, manager);
    insert into public.agent_email_claims (agent_id, claim_id, outcome, decided_by)
    select agent.id, o.id, 'auto_rejected', manager
    from public.agent_open_claims(agent.id) o
    where o.id <> claim.id;

    return query select agent.id, address;
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_import_verdicts, as 20261229100100_promo_any_format_agent_code_shape.sql
-- made it, where a row's mobile for an agent stored with none reads as
-- mobile_differs (not changed) instead of already present.
-- ---------------------------------------------------------------------------

create or replace function public.agent_import_verdicts(rows jsonb)
returns table (sheet_row integer, verdict jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select r.sheet_row,
        case
            when public.promo_code_holds_key(r.code)
                then jsonb_build_object('verdict', 'promo_code')
            when holder.id is not null then
                case
                    when lower(regexp_replace(btrim(holder.full_name), '\s+', ' ', 'g')) <> lower(r.full_name)
                        then jsonb_build_object('verdict', 'code_exists', 'agent', public.agent_import_ref(holder))
                    -- A mobile in the row that isn't the stored one, none stored
                    -- included: the import never changes or fills a mobile.
                    when r.phone is not null and holder.phone is distinct from r.phone
                        then jsonb_build_object('verdict', 'mobile_differs', 'agent', public.agent_import_ref(holder))
                    when r.email is null or r.email = holder.email
                        then jsonb_build_object('verdict', 'present', 'agent', public.agent_import_ref(holder))
                    when holder.email is not null
                        then jsonb_build_object('verdict', 'email_differs', 'agent', public.agent_import_ref(holder))
                    when public.agent_email_taken(r.email)
                        then jsonb_build_object('verdict', 'email_taken')
                    else jsonb_build_object('verdict', 'email_to_add', 'agent', public.agent_import_ref(holder))
                end
            when public.agent_code_issued(r.code) then jsonb_build_object('verdict', 'retired_code')
            when phone_holder.id is not null
                then jsonb_build_object('verdict', 'mobile_taken', 'agent', public.agent_import_ref(phone_holder))
            when public.agent_email_taken(r.email) then jsonb_build_object('verdict', 'email_taken')
            else jsonb_build_object('verdict', 'create')
        end
    from public.agent_import_rows(agent_import_verdicts.rows) r
    left join lateral (select h.* from public.agent_for_code(r.code) h) holder on true
    left join lateral (
        select a.* from public.marketing_agents a where a.phone = r.phone and a.retired_at is null
    ) phone_holder on true
    order by r.sheet_row;
$$;

select set_config('audit.actor_kind', '', true);
