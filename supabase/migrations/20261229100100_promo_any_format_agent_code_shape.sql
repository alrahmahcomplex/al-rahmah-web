-- Promo codes in any format; agent codes exactly ABC-123 (#462).
--
-- - normalize_referral_code keeps its cleaning (every space removed,
--   capitals) and now takes any printable character, not only letters,
--   digits, `-` and `.`: 1 to 20 of `!` to `~`. Every code stored so far
--   still reads the same, so the checks on leads and agents stay valid.
-- - discount_code_key(code): the code with the hyphen the Admission form's
--   box adds removed, so ABC-123 and ABC123 have one key. The box puts a
--   hyphen between three letters and a digit by itself, and the form looks
--   a code up as typed and then without that hyphen, so two codes with one
--   key can't both be reached. Agent codes and Promo codes are unique by
--   key across both tables: the triggers lock and compare keys, and a
--   unique index holds it among Promo codes.
-- - Promo codes: 1 to 15 printable characters in any shape, an agent's
--   ABC-123 included (owner, 2026-11-17), as long as no agent code has the
--   same key. Never three letters followed by two or more hyphens, which
--   the box shortens to one (ABC--1 to ABC-1), so the form could not find
--   them.
-- - Agent codes: every new code, typed or generated, is exactly three
--   letters, a hyphen and three digits. agent_draft refuses a typed code of
--   another shape as `invalid` on the code, and a trigger refuses any other
--   insert or code change the same way. Records already stored keep their
--   codes; hosted held no agent record and no Promo code when this was
--   written (2026-11-17).
-- - The generated code: three letters from the name (the first letter of
--   each of the first three words, then the name's next unused letters in
--   reading order, then X), a hyphen and a number from 001 to 999. The
--   number comes from the sequence agent_code_numbers as before, wrapped
--   into 001 to 999, so each set of letters has 999 codes. A code another
--   record holds or held, a lead carries, or whose key a Promo code holds
--   is skipped. After 999 numbers in a row are skipped the creation is
--   refused as `no_free_code`.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- The cleaning and the key.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_referral_code(code text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select case when s ~ '^[!-~]{1,20}$' then s end
    from (select upper(regexp_replace(normalize_referral_code.code, '\s', '', 'g')) as s) cleaned;
$$;

create function public.discount_code_key(code text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select regexp_replace(discount_code_key.code, '^([A-Z]{3})-([0-9])', '\1\2');
$$;

revoke execute on function public.discount_code_key(text) from public, anon, authenticated, service_role;

create function public.is_agent_code_shape(code text)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select is_agent_code_shape.code ~ '^[A-Z]{3}-[0-9]{3}$';
$$;

revoke execute on function public.is_agent_code_shape(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Promo codes: the new rule, and one key among them.
-- ---------------------------------------------------------------------------

alter table public.promo_codes drop constraint promo_codes_code_check;
-- IS TRUE: a code normalize_referral_code can't read gives null, which a
-- plain check would let through.
alter table public.promo_codes add constraint promo_codes_code_check check ((
    code = public.normalize_referral_code(code)
    and char_length(code) <= 15
    and code !~ '^[A-Z]{3}-{2,}'
) is true);

create unique index promo_codes_code_key_idx on public.promo_codes (public.discount_code_key(code));
create index marketing_agents_code_key_idx on public.marketing_agents (public.discount_code_key(code));

-- ---------------------------------------------------------------------------
-- One code namespace, by key.
-- ---------------------------------------------------------------------------

create or replace function public.lock_discount_code(code text)
returns void
language sql
set search_path = ''
as $$
    select pg_advisory_xact_lock(hashtextextended('discount-code:' || public.discount_code_key(lock_discount_code.code), 0));
$$;

create or replace function public.refuse_promo_code_taken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_discount_code(new.code);
    -- Any agent record that ever held the code or one with its key, retired
    -- ones included: a retired code comes back only through Recreate, for
    -- the same person.
    if exists (select 1 from public.marketing_agents a where public.discount_code_key(a.code) = public.discount_code_key(new.code)) then
        raise exception 'code_taken' using detail = new.code;
    end if;
    return new;
end;
$$;

-- Whether a Promo code holds this code's key.
create function public.promo_code_holds_key(code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.promo_codes p
        where public.discount_code_key(p.code) = public.discount_code_key(public.normalize_referral_code(promo_code_holds_key.code))
    );
$$;

revoke execute on function public.promo_code_holds_key(text) from public, anon, authenticated, service_role;

create or replace function public.refuse_agent_code_taken()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_discount_code(new.code);
    if public.promo_code_holds_key(new.code) then
        raise exception 'code_taken' using detail = new.code;
    end if;
    return new;
end;
$$;

-- Every new agent code is ABC-123. Codes already stored are not checked
-- again unless they change.
create function public.refuse_agent_code_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if not coalesce(public.is_agent_code_shape(new.code), false) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_agent_code_shape() from public, anon, authenticated;

create trigger refuse_agent_code_shape
    before insert or update of code on public.marketing_agents
    for each row
    execute function public.refuse_agent_code_shape();

-- The triggers above check every new code by key. Codes stored before them
-- must not share a key either: an agent's ABC-123 and a Promo code's ABC123
-- would leave one of them unreachable from the form. The share locks wait
-- for any write still running under the old triggers, then hold the tables
-- still while they are compared. Hosted held no agent record and no Promo
-- code on 2026-11-17; if a pair exists by merge time the migration stops
-- here, naming it, for staff to resolve before it runs again.
do $$
declare
    pair record;
begin
    lock table public.promo_codes, public.marketing_agents in share mode;
    select p.code as promo_code, a.code as agent_code into pair
    from public.promo_codes p
    join public.marketing_agents a on public.discount_code_key(a.code) = public.discount_code_key(p.code)
    limit 1;
    if found then
        raise exception 'discount_code_key_clash' using detail = format('Promo code %s and agent code %s share a key', pair.promo_code, pair.agent_code);
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_promo_code, as 20261204130300_discount_code_writes.sql made it,
-- with the code cleaned by normalize_referral_code and checked by the
-- table's rule.
-- ---------------------------------------------------------------------------

create or replace function public.create_promo_code(name text, code text, amount integer, ends_on date, note text)
returns public.promo_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    clean_name text := public.promo_code_name(create_promo_code.name);
    clean_note text := public.promo_code_note(create_promo_code.note);
    clean_code text := public.normalize_referral_code(coalesce(create_promo_code.code, ''));
    made public.promo_codes;
    moved uuid[];
begin
    if clean_code is null
       or char_length(clean_code) > 15
       or clean_code ~ '^[A-Z]{3}-{2,}' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;
    perform public.check_discount_amount(create_promo_code.amount);
    if create_promo_code.ends_on is not null and create_promo_code.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;

    -- refuse_promo_code_taken checks agent records under the key's lock;
    -- the unique indexes catch another Promo code with the code or its key.
    begin
        insert into public.promo_codes (code, name, note, amount, ends_on, created_by)
        values (clean_code, clean_name, clean_note, create_promo_code.amount, create_promo_code.ends_on, staff_id)
        returning * into made;
    exception when unique_violation then
        raise exception 'code_taken' using detail = clean_code;
    end;

    -- Leads that already carry the code, typed before it existed, take its
    -- discount on every fee not yet Paid.
    moved := case when public.promo_amount_off(made.amount, made.state, made.ends_on) > 0
        then public.unpaid_leads_for_codes(array[made.code]) else '{}'::uuid[] end;

    insert into public.discount_amount_changes (kind, promo_code_id, new_value, changed_by, student_count, lead_ids)
    values ('promo_created', made.id, made.amount::text, staff_id, cardinality(moved), moved);

    return made;
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_draft, as 20261120120100_agent_create_recreate.sql made it, with a
-- typed code held to ABC-123.
-- ---------------------------------------------------------------------------

create or replace function public.agent_draft(
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
        if agent_code is null or not public.is_agent_code_shape(agent_code) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
        end if;
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- agent_code_conflict, as 20261204130200_discount_amounts_and_promo_codes.sql
-- made it, with a Promo code holding the code's key refused as one holding
-- the code.
-- ---------------------------------------------------------------------------

create or replace function public.agent_code_conflict(code text)
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
    if public.promo_code_holds_key(agent_code_conflict.code) then
        raise exception 'code_taken' using detail = public.normalize_referral_code(agent_code_conflict.code);
    end if;
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

-- ---------------------------------------------------------------------------
-- agent_import_verdicts, as 20261204130200_discount_amounts_and_promo_codes.sql
-- made it, with `promo_code` for a Promo code holding the code's key.
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

-- ---------------------------------------------------------------------------
-- The generated code's letters: always three.
-- ---------------------------------------------------------------------------

create or replace function public.marketing_agent_code_prefix(full_name text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
    name text := upper(regexp_replace(btrim(marketing_agent_code_prefix.full_name), '\s+', ' ', 'g'));
    letters text := '';
    used integer[] := '{}';
    word_start boolean := true;
    word_count integer := 0;
    ch text;
    i integer;
begin
    -- The first letter of each of the first three words, when it is A to Z.
    for i in 1..char_length(name) loop
        ch := substr(name, i, 1);
        if ch = ' ' then
            word_start := true;
        else
            if word_start then
                word_count := word_count + 1;
                if word_count <= 3 and ch ~ '^[A-Z]$' then
                    letters := letters || ch;
                    used := used || i;
                end if;
            end if;
            word_start := false;
        end if;
    end loop;
    -- Then the name's next unused letters A to Z, in reading order.
    i := 1;
    while char_length(letters) < 3 and i <= char_length(name) loop
        ch := substr(name, i, 1);
        if ch ~ '^[A-Z]$' and not i = any(used) then
            letters := letters || ch;
        end if;
        i := i + 1;
    end loop;
    return rpad(letters, 3, 'X');
end;
$$;

-- ---------------------------------------------------------------------------
-- create_agent_record, as 20261222100100_agent_code_numbers.sql made it,
-- with the number wrapped into 001 to 999 and a code whose key a Promo code
-- holds skipped.
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

select set_config('audit.actor_kind', '', true);
