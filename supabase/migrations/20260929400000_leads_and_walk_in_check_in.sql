-- Leads and their parent/guardian contacts (slice 2), with the one function
-- that creates a lead and the phone normalizer every later slice shares.
--
-- Both tables are audited under ADR 4's `lead` scope. Nothing writes to them
-- through the API: every write is a security definer function that checks the
-- permission itself, so a rule like "the Admission Number never changes" holds
-- however the database is reached.

-- ---------------------------------------------------------------------------
-- The fixed lists.
-- ---------------------------------------------------------------------------

create type public.lead_class as enum (
    'DAY CARE', 'KG 1', 'KG 2',
    'STD 1', 'STD 2', 'STD 3', 'STD 4', 'STD 5', 'STD 6', 'STD 7',
    'FORM 1', 'FORM 2', 'FORM 3', 'FORM 4'
);

-- All five statuses, because the lead table is this slice's. This slice sets
-- only Applied and Visited; later slices own the other moves.
create type public.lead_status as enum ('Applied', 'Visited', 'Interviewed', 'Enrolled', 'Declined');

-- A closure mark is not a status. Nothing in this slice sets one.
create type public.lead_closure as enum ('Inactive', 'Archived');

create type public.day_or_boarding as enum ('Day', 'Boarding');

create type public.guardian_relationship as enum ('Mother', 'Father', 'Guardian', 'Other');

create type public.contact_origin as enum ('front_desk', 'admission_form');

-- ---------------------------------------------------------------------------
-- Normalization, in the database only, so the front desk and the Admission
-- form can never disagree. Slice 4 calls normalize_phone for agents' phones.
-- ---------------------------------------------------------------------------

-- Strips spaces, dashes, dots and brackets. `0` plus nine digits, nine digits
-- alone and `255` plus nine digits become `+255` plus the nine digits. Any
-- other number must start with `+` and have 8 to 15 digits. Everything else
-- is not a phone number: null.
create function public.normalize_phone(phone text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select case
        when s ~ '^0[0-9]{9}$' then '+255' || substr(s, 2)
        when s ~ '^[0-9]{9}$' then '+255' || s
        when s ~ '^255[0-9]{9}$' then '+' || s
        when s ~ '^\+[0-9]{8,15}$' then s
    end
    from (select regexp_replace(normalize_phone.phone, '[\s.()\[\]-]', '', 'g') as s) cleaned;
$$;

revoke execute on function public.normalize_phone(text) from public, anon;
grant execute on function public.normalize_phone(text) to authenticated, service_role;

-- Lowercase, trimmed, inner spacing collapsed to single spaces.
create function public.normalize_student_name(name text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select lower(regexp_replace(btrim(normalize_student_name.name), '\s+', ' ', 'g'));
$$;

revoke execute on function public.normalize_student_name(text) from public, anon;
grant execute on function public.normalize_student_name(text) to authenticated, service_role;

-- Today's date at the school, whatever time zone the database runs in.
create function public.tanzania_today()
returns date
language sql
stable
set search_path = ''
as $$
    select (now() at time zone 'Africa/Dar_es_Salaam')::date;
$$;

revoke execute on function public.tanzania_today() from public, anon;
grant execute on function public.tanzania_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Parent/guardian contacts. A Family is the leads that share one contact row.
-- ---------------------------------------------------------------------------

create table public.guardian_contacts (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (btrim(full_name) <> ''),
    relationship public.guardian_relationship not null,
    -- Required exactly when the relationship is Other.
    relationship_description text,
    -- Stored normalized, so equal numbers are equal strings.
    phone text not null check (phone = public.normalize_phone(phone)),
    whatsapp text check (whatsapp = public.normalize_phone(whatsapp)),
    origin public.contact_origin not null,
    -- Admission form only: staff have not yet confirmed that this contact is
    -- the same person as the one it points at.
    pending_family_match_id uuid references public.guardian_contacts (id),
    created_at timestamptz not null default now(),
    check ((relationship = 'Other') = (relationship_description is not null)),
    check (relationship_description is null or btrim(relationship_description) <> ''),
    check (pending_family_match_id is distinct from id)
);

create index guardian_contacts_phone_idx on public.guardian_contacts (phone);
create index guardian_contacts_whatsapp_idx on public.guardian_contacts (whatsapp) where whatsapp is not null;
create index guardian_contacts_pending_match_idx
    on public.guardian_contacts (pending_family_match_id) where pending_family_match_id is not null;

-- ---------------------------------------------------------------------------
-- Leads.
-- ---------------------------------------------------------------------------

create table public.leads (
    id uuid primary key default gen_random_uuid(),
    -- ADMSN- and five digits. Never updatable (guard_lead_change).
    admission_number text not null unique check (admission_number ~ '^ADMSN-[0-9]{5}$'),
    student_name text not null check (btrim(student_name) <> ''),
    student_name_key text generated always as (public.normalize_student_name(student_name)) stored,
    class_name public.lead_class not null,
    enrollment_year integer not null check (enrollment_year between 2000 and 2100),
    day_or_boarding public.day_or_boarding not null,
    status public.lead_status not null,
    closure public.lead_closure,
    visit_date date,
    guardian_contact_id uuid not null references public.guardian_contacts (id),
    -- The two causes of the Returning family badge. Slice 2 sets and clears
    -- the first; slice 3 sets the second.
    returning_family_joined boolean not null default false,
    returning_family_reapplied boolean not null default false,
    created_at timestamptz not null default now(),
    check (status = 'Applied' or visit_date is not null)
);

create index leads_guardian_contact_id_idx on public.leads (guardian_contact_id);
create index leads_student_name_key_idx on public.leads (student_name_key);
create index leads_created_at_idx on public.leads (created_at desc);

-- The rules no caller may skip: the Admission Number never changes, and a
-- Visit date is never later than today in Tanzania.
create function public.guard_lead_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'UPDATE' and new.admission_number is distinct from old.admission_number then
        raise exception 'admission_number_locked';
    end if;

    if new.visit_date is not null
       and (tg_op = 'INSERT' or new.visit_date is distinct from old.visit_date)
       and new.visit_date > public.tanzania_today() then
        raise exception 'visit_date_in_future';
    end if;

    return new;
end;
$$;

create trigger guard_lead_change
    before insert or update on public.leads
    for each row
    execute function public.guard_lead_change();

-- Audit (ADR 4): contacts carry no lead id; leads' own id is theirs.
alter table public.audit_log
    add constraint audit_log_lead_id_fkey foreign key (lead_id) references public.leads (id);

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.leads', 'lead', 'id'),
    ('public.guardian_contacts', 'lead', null);

create trigger audit_row_change
    after insert or update on public.guardian_contacts
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.guardian_contacts
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.guardian_contacts
    for each statement
    execute function public.refuse_delete();

create trigger audit_row_change
    after insert or update on public.leads
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.leads
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.leads
    for each statement
    execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- Row-level security: reads only. Every write is a function below.
-- ---------------------------------------------------------------------------

alter table public.guardian_contacts enable row level security;
alter table public.leads enable row level security;

create policy "Staff who may view leads read contacts"
    on public.guardian_contacts for select
    to authenticated
    using ((select public.has_permission('leads.view')));

create policy "Staff who may view leads read leads"
    on public.leads for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.guardian_contacts from anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.leads from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_lead: the one function that creates every lead.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `invalid` (with the offending field as JSON in the detail) or
-- `unavailable`. A duplicate is not a refusal to the caller, who decides what
-- it means, so it comes back as data with the matching lead.
--
-- start_kind is `walk_in` (a staff member's own session; status Visited, with
-- a Visit date) or `admission_form` (the secret key only; status Applied).
-- The guardian is an existing contact id or new contact details.
-- ---------------------------------------------------------------------------

create function public.create_lead(
    start_kind text,
    existing_contact_id uuid,
    new_contact jsonb,
    student_details jsonb,
    visited_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    walk_in boolean;
    caller_role text := auth.role();
    contact public.guardian_contacts;
    contact_id uuid := existing_contact_id;
    contact_name text;
    contact_relationship public.guardian_relationship;
    contact_description text;
    contact_phone text;
    contact_whatsapp text;
    pupil_name text;
    student_class public.lead_class;
    student_year integer;
    student_boarding public.day_or_boarding;
    this_year integer := extract(year from public.tanzania_today());
    phones text[];
    one_phone text;
    match public.leads;
    pending_match uuid;
    joined boolean := false;
    new_lead_id uuid;
    new_number text;
    attempt integer;
begin
    -- Who may start which way. The staff start is refused from the secret
    -- key and the form start from any staff session, so neither can write as
    -- the other.
    if start_kind = 'walk_in' then
        walk_in := true;
        if caller_role is distinct from 'authenticated'
           or not public.has_permission('leads.create')
           or not public.has_permission('visits.record') then
            raise exception 'not_permitted';
        end if;
    elsif start_kind = 'admission_form' then
        walk_in := false;
        if caller_role is distinct from 'service_role' then
            raise exception 'not_permitted';
        end if;
        -- Each RPC is its own transaction, so the actor is set here.
        perform public.set_audit_actor('public_form', null);
    else
        raise exception 'invalid' using detail = jsonb_build_object('field', 'start')::text;
    end if;

    -- The guardian.
    if contact_id is not null then
        select * into contact from public.guardian_contacts g where g.id = contact_id;
        if not found or (not walk_in and contact.origin <> 'admission_form') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
        end if;
        contact_phone := contact.phone;
        contact_whatsapp := contact.whatsapp;
    else
        contact_name := btrim(coalesce(new_contact ->> 'full_name', ''));
        if contact_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
        end if;

        begin
            contact_relationship := (new_contact ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            contact_relationship := null;
        end;
        if contact_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;

        contact_description := nullif(btrim(coalesce(new_contact ->> 'relationship_description', '')), '');
        if contact_relationship = 'Other' and contact_description is null then
            raise exception 'invalid'
                using detail = jsonb_build_object('field', 'relationship_description')::text;
        end if;
        if contact_relationship <> 'Other' then
            contact_description := null;
        end if;

        contact_phone := public.normalize_phone(coalesce(new_contact ->> 'phone', ''));
        if contact_phone is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
        end if;

        contact_whatsapp := nullif(btrim(coalesce(new_contact ->> 'whatsapp', '')), '');
        if contact_whatsapp is not null then
            contact_whatsapp := public.normalize_phone(contact_whatsapp);
            if contact_whatsapp is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
            end if;
            if contact_whatsapp = contact_phone then
                contact_whatsapp := null;
            end if;
        end if;
    end if;

    -- The student.
    pupil_name := btrim(coalesce(student_details ->> 'full_name', ''));
    if pupil_name = '' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
    end if;

    begin
        student_class := (student_details ->> 'class_name')::public.lead_class;
    exception when invalid_text_representation then
        student_class := null;
    end;
    if student_class is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
    end if;

    begin
        student_year := (student_details ->> 'enrollment_year')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
        student_year := null;
    end;
    -- Staff choose from the current year and the next two.
    if student_year is null
       or (walk_in and student_year not between this_year and this_year + 2)
       or student_year not between 2000 and 2100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
    end if;

    begin
        student_boarding := (student_details ->> 'day_or_boarding')::public.day_or_boarding;
    exception when invalid_text_representation then
        student_boarding := null;
    end;
    if student_boarding is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
    end if;

    -- A walk-in has a Visit date, never later than today in Tanzania; the
    -- Admission form starts at Applied and has none.
    if walk_in then
        if visited_on is null or visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
    elsif visited_on is not null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    -- Serialize creations that share a phone number, in a fixed order so two
    -- callers can never wait on each other. Whoever comes second sees the
    -- first one's lead when it checks for a duplicate.
    phones := array(
        select distinct p from unnest(array[contact_phone, contact_whatsapp]) p where p is not null order by p
    );
    foreach one_phone in array phones loop
        perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
    end loop;

    -- A duplicate is the same student name with the same parent phone, in a
    -- lead of any status or closure mark.
    select l.* into match
    from public.leads l
    join public.guardian_contacts g on g.id = l.guardian_contact_id
    where l.student_name_key = public.normalize_student_name(pupil_name)
      and (g.phone = any (phones) or g.whatsapp = any (phones))
    order by l.created_at, l.id
    limit 1;
    if found then
        return jsonb_build_object(
            'result', 'duplicate',
            'lead_id', match.id,
            'admission_number', match.admission_number,
            'status', match.status,
            'closure', match.closure
        );
    end if;

    -- The Family link and the Returning family cause.
    if contact_id is not null then
        -- Joining a known Family at the front desk, or an Admission form
        -- child sharing its sibling's contact and that contact's pending match.
        joined := case when walk_in then true else contact.pending_family_match_id is not null end;
    elsif not walk_in then
        -- The form never joins a Family by itself: a known number leaves a
        -- pending match for staff to confirm.
        select g.id into pending_match
        from public.guardian_contacts g
        where g.phone = any (phones) or g.whatsapp = any (phones)
        order by g.created_at, g.id
        limit 1;
        joined := pending_match is not null;
    end if;

    if contact_id is null then
        insert into public.guardian_contacts (
            full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
        ) values (
            contact_name, contact_relationship, contact_description, contact_phone, contact_whatsapp,
            case when walk_in then 'front_desk'::public.contact_origin else 'admission_form'::public.contact_origin end,
            pending_match
        )
        returning id into contact_id;
    end if;

    -- ADMSN- and five random digits. The unique constraint catches a
    -- collision and the loop draws again.
    for attempt in 1..20 loop
        new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
        begin
            insert into public.leads (
                admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                status, visit_date, guardian_contact_id, returning_family_joined
            ) values (
                new_number, pupil_name, student_class, student_year, student_boarding,
                case when walk_in then 'Visited'::public.lead_status else 'Applied'::public.lead_status end,
                visited_on, contact_id, joined
            )
            returning id into new_lead_id;
            exit;
        exception when unique_violation then
            if attempt = 20 then
                raise exception 'unavailable';
            end if;
        end;
    end loop;

    return jsonb_build_object('result', 'created', 'lead_id', new_lead_id, 'admission_number', new_number);
end;
$$;

revoke execute on function public.create_lead(text, uuid, jsonb, jsonb, date) from public, anon;
grant execute on function public.create_lead(text, uuid, jsonb, jsonb, date) to authenticated, service_role;
