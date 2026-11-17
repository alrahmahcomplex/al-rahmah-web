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
    -- until its code is free. A typed code is tried once, and either saves
    -- or raises. The unique index catches a code committed alongside.
    loop
        if draft.agent_code is not null then
            candidate := draft.agent_code;
        else
            tries := tries + 1;
            if tries > 999 then
                raise exception 'no_free_code' using detail = prefix;
            end if;
            number := (nextval('public.agent_code_numbers') - 1) % 999 + 1;
            candidate := prefix || '-' || lpad(number::text, 3, '0');
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
        end;
    end loop;
end;
$$;

select set_config('audit.actor_kind', '', true);
