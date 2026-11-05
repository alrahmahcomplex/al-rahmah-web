-- The Manager imports existing agents from a CSV (slice 12, #190).
--
-- - import_batches records each import: its kind, file name, who ran it,
--   when, and its counts. It is general, so the student import reuses it,
--   append-only and audited. marketing_agents.import_batch_id names the
--   import that created an agent; it is set on insert and never changes.
-- - The app reads and normalises the file (lib/import, lib/agent-import) and
--   sends the rows that passed the file's own checks. agent_import_rows
--   re-checks each value is normalised as agent_draft stores it, and that no
--   two rows share a sheet row, code, mobile or email.
-- - agent_import_verdicts is the one classification against stored agents,
--   set-based, used by the check and by confirm. Codes are looked up only
--   through agent_for_code and agent_code_issued. A code held by a current
--   agent whose name matches (ignoring case and extra spaces) is that agent:
--   mobile differs, else already present, else email differs or email to
--   add. A code held under another name is code_exists; a code only a
--   retired record held is retired_code. Then a mobile a current agent uses
--   is mobile_taken, and an email staff or a current agent uses is
--   email_taken. Everything else is create.
-- - check_agent_import gives the check screen its verdicts. Saves nothing.
-- - confirm_agent_import is the one all-or-nothing write. Under one
--   import-wide lock it takes every row's phone lock, then every email lock,
--   each in sorted order, then re-runs the verdicts. If any row's verdict is
--   not the one the Manager saw, it writes nothing and returns those rows.
--   Otherwise it records the batch and creates each new agent through
--   create_agent_record, Approved by the Manager, with the batch; and adds
--   the email to each agent that had none. The Manager is the audit actor.
--   It sends no email: an imported email counts as confirmed by the Manager.
-- - create_agent_record takes the batch as a new last argument, with every
--   other rule carried forward from 20261120120100_agent_create_recreate.sql.
--
-- Refusal codes: `not_permitted`, `invalid` with the field as JSON in the
-- detail, `nothing_to_import`, `import_conflict`, and create_agent_record's
-- own `code_taken`, `retired_code` and `email_taken`, which mean a creation
-- outside the import took a value between the check and the write.

-- ---------------------------------------------------------------------------
-- import_batches.
-- ---------------------------------------------------------------------------

create table public.import_batches (
    id uuid primary key default gen_random_uuid(),
    -- What was imported. The student import adds its kind.
    kind text not null check (kind in ('agents')),
    file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 255),
    imported_by uuid not null references public.staff_members (id),
    imported_at timestamptz not null default now(),
    -- Rows in the file; rows that created a record; rows that changed one;
    -- the rest.
    row_count integer not null check (row_count between 1 and 1000),
    created_count integer not null check (created_count >= 0),
    updated_count integer not null check (updated_count >= 0),
    skipped_count integer not null check (skipped_count >= 0),
    check (created_count + updated_count + skipped_count = row_count)
);

create index import_batches_kind_imported_at_idx on public.import_batches (kind, imported_at desc);
create index import_batches_imported_by_idx on public.import_batches (imported_by);

-- An import is history: never changed after it is written.
create trigger refuse_update
    before update on public.import_batches
    for each row
    execute function public.refuse_agent_status_change_update();

create trigger refuse_delete
    before delete on public.import_batches
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.import_batches
    for each statement
    execute function public.refuse_delete();

-- Audit (ADR 4): lead scope with no lead id, as for marketing_agents.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.import_batches', 'lead', null);

create trigger audit_row_change
    after insert on public.import_batches
    for each row
    execute function public.audit_row_change();

alter table public.import_batches enable row level security;

-- Agent imports are read by those who read the agents they made.
create policy "Staff who may view leads read agent imports"
    on public.import_batches for select
    to authenticated
    using (kind = 'agents' and (select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.import_batches from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- marketing_agents.import_batch_id.
-- ---------------------------------------------------------------------------

alter table public.marketing_agents
    add column import_batch_id uuid references public.import_batches (id);

create index marketing_agents_import_batch_idx on public.marketing_agents (import_batch_id) where import_batch_id is not null;

-- ---------------------------------------------------------------------------
-- The agent guard, re-created from 20261112120100_agent_for_code.sql with
-- one more rule: the import that created an agent never changes.
-- ---------------------------------------------------------------------------

create or replace function public.guard_marketing_agent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    writer text := case when current_user not in ('authenticated', 'anon')
        then coalesce(current_setting('app.agent_status_change', true), '') else '' end;
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
       or new.phone is distinct from old.phone
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
-- create_agent_record, re-created from 20261120120100_agent_create_recreate.sql
-- with a last argument, the import batch, stored on the new agent. Every
-- caller keeps its call: the new argument defaults to none.
-- ---------------------------------------------------------------------------

drop function public.create_agent_record(text, text, text, text, text, public.marketing_agent_status, uuid, uuid, uuid, boolean);

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

revoke execute on function public.create_agent_record(text, text, text, text, text, public.marketing_agent_status, uuid, uuid, uuid, boolean, uuid)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_import_rows: the rows the app sends, read and re-checked. Each row
-- is an object with sheet_row, code, full_name, phone, whatsapp and email,
-- every value already normalised as agent_draft stores it. A row that isn't
-- is `invalid` with the field and the sheet row, as is a sheet row, code,
-- mobile or email two rows share. Internal.
-- ---------------------------------------------------------------------------

create function public.agent_import_rows(rows jsonb)
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
        cross join lateral public.agent_draft(r ->> 'full_name', r ->> 'phone', r ->> 'whatsapp', r ->> 'email', r ->> 'code') d
    loop
        if bad.code is null or bad.code is distinct from bad.agent_code then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'code', 'sheet_row', bad.sheet_row)::text;
        end if;
        if bad.full_name is distinct from bad.agent_name then
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
    if exists (select 1 from jsonb_array_elements(agent_import_rows.rows) r group by r ->> 'phone' having count(*) > 1) then
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
revoke execute on function public.agent_import_rows(jsonb) from public, anon, authenticated, service_role;

-- A stored agent as the import's verdicts name them.
create function public.agent_import_ref(agent public.marketing_agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select jsonb_build_object(
        'id', agent.id,
        'full_name', agent.full_name,
        'code', agent.code,
        'phone', agent.phone,
        'email', agent.email
    );
$$;

revoke execute on function public.agent_import_ref(public.marketing_agents) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- agent_import_verdicts: each row's verdict against the agents stored now,
-- in one set-based query. Internal.
-- ---------------------------------------------------------------------------

create function public.agent_import_verdicts(rows jsonb)
returns table (sheet_row integer, verdict jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    select r.sheet_row,
        case
            when holder.id is not null then
                case
                    when lower(regexp_replace(btrim(holder.full_name), '\s+', ' ', 'g')) <> lower(r.full_name)
                        then jsonb_build_object('verdict', 'code_exists', 'agent', public.agent_import_ref(holder))
                    when holder.phone <> r.phone
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

revoke execute on function public.agent_import_verdicts(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_agent_import: the check screen's verdicts, as a JSON array of
-- {sheet_row, verdict}. Needs agents.approve. Saves nothing.
-- ---------------------------------------------------------------------------

create function public.check_agent_import(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('agents.approve') then
        raise exception 'not_permitted';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object('sheet_row', v.sheet_row, 'verdict', v.verdict) order by v.sheet_row), '[]'::jsonb)
        from public.agent_import_verdicts(check_agent_import.rows) v
    );
end;
$$;

revoke execute on function public.check_agent_import(jsonb) from public, anon;
grant execute on function public.check_agent_import(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_agent_import: the one write. Needs agents.approve.
--
-- - rows: the rows the check sent, each with `expected`, the verdict the
--   Manager saw. row_count: every row in the file, those the file's own
--   checks stopped included.
-- - Returns {outcome: 'changed', rows: [{sheet_row, verdict}]} with each row
--   whose verdict is no longer the one expected, having written nothing; or
--   {outcome: 'imported', batch_id, created, emails_added, skipped}.
-- ---------------------------------------------------------------------------

create function public.confirm_agent_import(file_name text, row_count integer, rows jsonb)
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

    -- Every phone, then every email, each in sorted order, as a single
    -- creation takes its one phone and then its one email, so the two never
    -- wait for each other in a cycle. A creation elsewhere holding one
    -- finishes first, and the verdicts below see it.
    for lock_key in
        select r.phone from public.agent_import_rows(confirm_agent_import.rows) r order by r.phone
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

revoke execute on function public.confirm_agent_import(text, integer, jsonb) from public, anon;
grant execute on function public.confirm_agent_import(text, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_batch_importers: who ran each import, by name, for staff who may
-- read the imports. Staff rows are otherwise out of their reach, as for
-- marketing_agent_approvers.
-- ---------------------------------------------------------------------------

create function public.import_batch_importers(batch_ids uuid[])
returns table (batch_id uuid, importer_name text)
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
    select b.id, s.full_name
    from public.import_batches b
    join public.staff_members s on s.id = b.imported_by
    where b.id = any (import_batch_importers.batch_ids)
      and b.kind = 'agents';
end;
$$;

revoke execute on function public.import_batch_importers(uuid[]) from public, anon;
grant execute on function public.import_batch_importers(uuid[]) to authenticated;
