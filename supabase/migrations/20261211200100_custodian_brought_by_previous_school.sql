-- The custodian's relationship on each lead, who brought the student, and the
-- previous school (#298, spec #296, align brief S6 and S9, R7, R14, R21, R22).
-- Data only: no screen reads or writes these yet.
--
-- 1. The custodian relationship and its description move onto the lead,
--    because one person can be Mother to one child and Aunt to another. For
--    this release the guardian contact stays the place staff edit it, and
--    the lead mirrors it:
--      - every existing lead gets its contact's relationship (backfill);
--      - a new lead, or a lead moved to another contact, takes that
--        contact's relationship unless the writer sets its own;
--      - a change to a contact's relationship is copied to every lead on it.
--    Readers still read the contact. The release that writes the relationship
--    per child replaces the contact-to-lead copy, and a later migration drops
--    the contact's columns after rewriting every reader (R14).
-- 2. Who brought the student: a name, a phone and a relationship, all
--    optional, plain text, a record only (R7). It grants nothing and joins no
--    Family, so the phone is normalized but never matched.
-- 3. The previous school: a name, `private` or `public`, and a region; or
--    "Not known yet". The region is checked against previous_school_regions():
--    Tanzania's 31 regions plus "Outside Tanzania" (R22). No constraint ties
--    the school to the class (R21).
-- 4. previous_school_asked(class) and previous_school_answer_missing(...):
--    the shared check the New Student form and visit completion will call.
--    From STD 2 to FORM 4 an answer is needed, and "Not known yet" is one.
--    Below STD 2 nothing is asked. Nothing calls them yet, so no lead is
--    refused for a missing previous school today.
-- 5. update_lead_details also corrects who brought the student and the
--    previous school. The audit trigger records every change with who and
--    when, so lead_history shows it.
-- 6. Lock order: contact corrections take the Family lock, then the
--    contact's leads, then the contact row; decline_lead and
--    approve_reopening_request now take the Family lock before their row
--    locks too, so none of them can deadlock with another.
--
-- No fee, discount, status or Seat priority moves: the backfill runs inside
-- one `do` block that compares fee_snapshot() before and after, and raises on
-- any difference.
--
-- If the backfill raises, the statements before it (the type, the region
-- functions, the columns and the copy triggers) stay; they change no fee and
-- no screen reads them. Find the moved lead in the error's detail, fix the
-- cause in a new migration, and apply the rest of this file from the backfill
-- on.

-- ---------------------------------------------------------------------------
-- The region list and the previous-school check. Internal: no API role may
-- call them.
-- ---------------------------------------------------------------------------

create type public.previous_school_type as enum ('private', 'public');

-- Tanzania's 31 regions (26 on the mainland, 5 in Zanzibar), then "Outside
-- Tanzania". Changing the list is one migration (R22).
create function public.previous_school_regions()
returns text[]
language sql
immutable
set search_path = ''
as $$
    select array[
        'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi',
        'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro',
        'Mtwara', 'Mwanza', 'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga',
        'Simiyu', 'Singida', 'Songwe', 'Tabora', 'Tanga',
        'Kaskazini Pemba', 'Kaskazini Unguja', 'Kusini Pemba', 'Kusini Unguja', 'Mjini Magharibi',
        'Outside Tanzania'
    ]::text[];
$$;

revoke execute on function public.previous_school_regions() from public, anon, authenticated, service_role;

-- The list's spelling of a region, ignoring case and spacing at either end;
-- empty for anything not on the list.
create function public.previous_school_region(region text)
returns text
language sql
immutable
set search_path = ''
as $$
    select r
    from unnest(public.previous_school_regions()) r
    where lower(r) = lower(regexp_replace(coalesce(previous_school_region.region, ''), '^\s+|\s+$', '', 'g'))
    limit 1;
$$;

revoke execute on function public.previous_school_region(text) from public, anon, authenticated, service_role;

-- Whether staff ask a student in this class for the previous school: STD 2
-- to STD 7 and FORM 1 to FORM 4, because from STD 2 a student is registered
-- with the Ministry of Education on PREMS. Not DAY CARE, KG 1, KG 2 or
-- STD 1.
create function public.previous_school_asked(class_name public.lead_class)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select coalesce(previous_school_asked.class_name >= 'STD 2'::public.lead_class, false);
$$;

revoke execute on function public.previous_school_asked(public.lead_class) from public, anon, authenticated, service_role;

-- Whether a save for a student in this class still lacks the previous-school
-- answer: the school's name (its type and region come with it, by the table
-- constraints) or "Not known yet". Never for a class below STD 2.
create function public.previous_school_answer_missing(
    class_name public.lead_class,
    school_name text,
    not_known boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select public.previous_school_asked(previous_school_answer_missing.class_name)
       and not coalesce(previous_school_answer_missing.not_known, false)
       and nullif(btrim(coalesce(previous_school_answer_missing.school_name, '')), '') is null;
$$;

revoke execute on function public.previous_school_answer_missing(public.lead_class, text, boolean)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The columns. All empty until the backfill below, except "Not known yet",
-- which starts false. The relationship becomes required after the backfill.
-- ---------------------------------------------------------------------------

alter table public.leads
    add column custodian_relationship public.guardian_relationship,
    add column custodian_relationship_description text,
    add column brought_by_name text,
    add column brought_by_phone text,
    add column brought_by_relationship text,
    add column previous_school_name text,
    add column previous_school_type public.previous_school_type,
    add column previous_school_region text,
    add column previous_school_not_known boolean not null default false,
    -- As on guardian_contacts: a description exactly when the relationship is Other.
    add constraint leads_custodian_relationship_described
        check ((custodian_relationship = 'Other') = (custodian_relationship_description is not null)),
    add constraint leads_custodian_relationship_description_not_blank
        check (custodian_relationship_description is null or btrim(custodian_relationship_description) <> ''),
    add constraint leads_brought_by_name_check
        check (brought_by_name is null
               or (brought_by_name = btrim(brought_by_name) and char_length(brought_by_name) between 1 and 120)),
    add constraint leads_brought_by_phone_normalized
        check (brought_by_phone is null or brought_by_phone is not distinct from public.normalize_phone(brought_by_phone)),
    add constraint leads_brought_by_relationship_check
        check (brought_by_relationship is null
               or (brought_by_relationship = btrim(brought_by_relationship)
                   and char_length(brought_by_relationship) between 1 and 60)),
    -- A phone or a relationship belongs to someone named.
    add constraint leads_brought_by_has_name
        check (brought_by_name is not null or (brought_by_phone is null and brought_by_relationship is null)),
    add constraint leads_previous_school_name_check
        check (previous_school_name is null
               or (previous_school_name = btrim(previous_school_name)
                   and char_length(previous_school_name) between 2 and 120)),
    add constraint leads_previous_school_region_on_list
        check (previous_school_region is null
               or previous_school_region is not distinct from public.previous_school_region(previous_school_region)),
    -- The three details come together, or not at all.
    add constraint leads_previous_school_complete
        check ((previous_school_name is null) = (previous_school_type is null)
               and (previous_school_name is null) = (previous_school_region is null)),
    -- "Not known yet" is an answer instead of the details, never beside them.
    add constraint leads_previous_school_not_known_alone
        check (not previous_school_not_known or previous_school_name is null);

comment on column public.leads.custodian_relationship is
    'The custodian''s relationship to this child. Until the per-child release, a copy of the guardian contact''s relationship (20261211200100).';
comment on column public.leads.custodian_relationship_description is
    'Who the custodian is to this child, when the relationship is Other.';
comment on column public.leads.brought_by_name is
    'Who brought the student to the visit or registration. A record only; grants nothing.';
comment on column public.leads.brought_by_phone is
    'The phone of the person who brought the student, normalized. Never matched to a Family.';
comment on column public.leads.brought_by_relationship is
    'Who the person who brought the student is to the family, as staff typed it.';
comment on column public.leads.previous_school_name is
    'The school the student attended before. Asked from STD 2 up; read by no fee or status rule.';
comment on column public.leads.previous_school_type is
    'Whether the previous school is private or public.';
comment on column public.leads.previous_school_region is
    'The previous school''s region: one of previous_school_regions().';
comment on column public.leads.previous_school_not_known is
    'Staff answered "Not known yet" for the previous school; the details can be added later.';

-- ---------------------------------------------------------------------------
-- The closed-lead guard, as 20261022300200_re_applications.sql made it, now
-- also letting the contact-to-lead copy below change a closed lead's
-- custodian relationship and nothing else. update_guardian_contact already
-- corrects a contact while one open child holds it, and the closed siblings'
-- copies must follow.
-- ---------------------------------------------------------------------------

create or replace function public.refuse_closed_lead_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    privileged boolean := current_user not in ('authenticated', 'anon');
    override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
begin
    if (old.status = 'Declined' or old.closure is not null)
       and not (privileged and override in ('close', 'reopen', 'payment_recompute'))
       and not (
           privileged
           and override = 're_application'
           and new.returning_family_reapplied
           -- Generated columns are not yet computed in a before trigger.
           and (to_jsonb(new) - 'returning_family_reapplied' - 'student_name_key')
               = (to_jsonb(old) - 'returning_family_reapplied' - 'student_name_key')
       )
       and not (
           privileged
           and override = 'custodian_sync'
           and (to_jsonb(new) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
               = (to_jsonb(old) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
       ) then
        raise exception 'lead_closed';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_closed_lead_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A new lead, or a lead moved to another contact, takes the contact's
-- relationship unless the writer set the lead's own. The contact row is read
-- with a key-share lock, as the foreign-key check takes anyway, so a
-- relationship correction in flight finishes first and its value is the one
-- copied.
-- ---------------------------------------------------------------------------

create function public.set_lead_custodian_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    contact public.guardian_contacts;
begin
    if tg_op = 'INSERT' then
        if new.custodian_relationship is not null then
            return new;
        end if;
    elsif new.guardian_contact_id is not distinct from old.guardian_contact_id
          or new.custodian_relationship is distinct from old.custodian_relationship
          or new.custodian_relationship_description is distinct from old.custodian_relationship_description then
        -- Same contact, or the update sets the relationship itself.
        return new;
    end if;

    select * into contact from public.guardian_contacts g where g.id = new.guardian_contact_id for key share;
    if found then
        new.custodian_relationship := contact.relationship;
        new.custodian_relationship_description := contact.relationship_description;
    end if;
    return new;
end;
$$;

revoke execute on function public.set_lead_custodian_relationship() from public, anon, authenticated, service_role;

create trigger set_lead_custodian_relationship
    before insert or update of guardian_contact_id on public.leads
    for each row
    execute function public.set_lead_custodian_relationship();

-- A change to a contact's relationship is copied to every lead on it, closed
-- ones included, under the custodian_sync override, which lets only these two
-- columns change on a closed lead. The copy is audited with the actor of the
-- contact change. The caller holds the contact's leads before the contact row
-- (update_guardian_contact below), so this takes no new lock.
create function public.sync_lead_custodian_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    earlier_override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
begin
    perform set_config('app.lead_lifecycle_override', 'custodian_sync', true);
    update public.leads l
    set custodian_relationship = new.relationship,
        custodian_relationship_description = new.relationship_description
    where l.guardian_contact_id = new.id
      and (l.custodian_relationship is distinct from new.relationship
           or l.custodian_relationship_description is distinct from new.relationship_description);
    perform set_config('app.lead_lifecycle_override', earlier_override, true);
    return null;
end;
$$;

revoke execute on function public.sync_lead_custodian_relationship() from public, anon, authenticated, service_role;

create trigger sync_lead_custodian_relationship
    after update of relationship, relationship_description on public.guardian_contacts
    for each row
    when (old.relationship is distinct from new.relationship
          or old.relationship_description is distinct from new.relationship_description)
    execute function public.sync_lead_custodian_relationship();

-- ---------------------------------------------------------------------------
-- Backfill: every lead gets its contact's relationship. One `do` block, so it
-- is one statement and one transaction however the runner sends the file:
-- the audit actor and the override hold for the update, and a raised check
-- undoes it. Leads are locked first, so no lead or fee changes between the
-- two snapshots. Contacts are not: a relationship corrected while this runs
-- reaches the leads through the copy trigger above, which waits for this
-- lock and then applies the newer value.
-- ---------------------------------------------------------------------------

do $$
begin
    perform public.set_audit_actor('system');

    lock table public.leads in share row exclusive mode;

    create temporary table custodian_fee_snapshot on commit drop as
    select * from public.fee_snapshot();

    perform set_config('app.lead_lifecycle_override', 'custodian_sync', true);
    update public.leads l
    set custodian_relationship = g.relationship,
        custodian_relationship_description = g.relationship_description
    from public.guardian_contacts g
    where g.id = l.guardian_contact_id
      and l.custodian_relationship is null;
    perform set_config('app.lead_lifecycle_override', '', true);

    perform public.assert_fee_snapshot_unchanged('pg_temp.custodian_fee_snapshot');

    drop table custodian_fee_snapshot;
    perform set_config('audit.actor_kind', '', true);
end;
$$;

-- Every lead now holds one, and the trigger fills each new lead's.
alter table public.leads alter column custodian_relationship set not null;

-- ---------------------------------------------------------------------------
-- update_guardian_contact, as 20261013800000_closed_lead_read_only.sql made
-- it, now taking the contact's Family lock and then its leads, in id order,
-- before the contact row: the documented order (Family, rows) and the order
-- lock_lead_contact uses. The relationship copy above then updates leads
-- this already holds, so it cannot deadlock with a correction or a Family
-- change on a sibling. Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.update_guardian_contact(contact_id uuid, changes jsonb, expected_lead_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    contact public.guardian_contacts;
    contact_name text;
    contact_relationship public.guardian_relationship;
    contact_description text;
    contact_phone text;
    contact_whatsapp text;
    phones text[];
    match public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- The Family, then its children, then the contact (#298).
    perform public.lock_families(array[update_guardian_contact.contact_id]);
    perform 1 from public.leads l
    where l.guardian_contact_id = update_guardian_contact.contact_id
    order by l.id
    for update;

    -- Locked, so a child renamed at the same moment is checked against the
    -- numbers this saves, or this against the new name.
    select * into contact from public.guardian_contacts g where g.id = update_guardian_contact.contact_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if not exists (
        select 1 from public.leads l
        where l.guardian_contact_id = contact.id and l.status <> 'Declined' and l.closure is null
    ) then
        raise exception 'closed';
    end if;
    if expected_lead_ids is not null and exists (
        (select l.id from public.leads l where l.guardian_contact_id = contact.id
         except select unnest(expected_lead_ids))
        union all
        (select unnest(expected_lead_ids)
         except select l.id from public.leads l where l.guardian_contact_id = contact.id)
    ) then
        raise exception 'children_changed';
    end if;

    contact_name := contact.full_name;
    if changes ? 'full_name' then
        contact_name := btrim(coalesce(changes ->> 'full_name', ''));
        if contact_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
        end if;
    end if;

    contact_relationship := contact.relationship;
    contact_description := contact.relationship_description;
    if changes ? 'relationship' then
        begin
            contact_relationship := (changes ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            contact_relationship := null;
        end;
        if contact_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;
    end if;
    if changes ? 'relationship_description' then
        contact_description := nullif(btrim(coalesce(changes ->> 'relationship_description', '')), '');
    end if;
    if contact_relationship = 'Other' and contact_description is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
    end if;
    if contact_relationship <> 'Other' then
        contact_description := null;
    end if;

    contact_phone := contact.phone;
    if changes ? 'phone' then
        contact_phone := public.normalize_phone(coalesce(changes ->> 'phone', ''));
        if contact_phone is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
        end if;
    end if;

    contact_whatsapp := contact.whatsapp;
    if changes ? 'whatsapp' then
        contact_whatsapp := nullif(btrim(coalesce(changes ->> 'whatsapp', '')), '');
        if contact_whatsapp is not null then
            contact_whatsapp := public.normalize_phone(contact_whatsapp);
            if contact_whatsapp is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
            end if;
        end if;
    end if;
    if contact_whatsapp = contact_phone then
        contact_whatsapp := null;
    end if;

    -- New numbers must not make any child on this contact a duplicate of a
    -- lead on another contact. Children on one contact never share a name,
    -- so the contact's own leads are left out.
    phones := array(
        select p from unnest(array[contact_phone, contact_whatsapp]) p
        where p is not null and p is distinct from contact.phone and p is distinct from contact.whatsapp
    );
    if cardinality(phones) > 0 then
        perform public.lock_lead_phones(array[contact_phone, contact_whatsapp]);
        select m.* into match
        from public.leads child
        cross join lateral public.find_duplicate_lead(child.student_name_key, phones, child.id, contact.id) m
        where child.guardian_contact_id = contact.id and m.id is not null
        order by m.created_at, m.id
        limit 1;
        if match.id is not null then
            return public.duplicate_result(match);
        end if;
    end if;

    update public.guardian_contacts g
    set full_name = contact_name,
        relationship = contact_relationship,
        relationship_description = contact_description,
        phone = contact_phone,
        whatsapp = contact_whatsapp
    where g.id = contact.id;

    return jsonb_build_object('result', 'updated');
end;
$$;

revoke execute on function public.update_guardian_contact(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_guardian_contact(uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- update_guardian_contact_for_lead, as
-- 20261115300400_re_application_contact_guard.sql made it, now taking the
-- Family lock and every lead on the contact before the source lead's own
-- check and the contact row, in the order update_guardian_contact takes
-- them. Holding only the source lead first, then the contact, then its
-- siblings for the copy, could deadlock with lock_lead_contact on a sibling.
-- Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.update_guardian_contact_for_lead(
    lead_id uuid,
    contact_id uuid,
    changes jsonb,
    expected_lead_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    current_phone text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- The Family, then its children (#298), then the source lead, then the
    -- contact. A concurrent closure either wins before these locks, or waits
    -- until the contact correction commits. Reassignment cannot change the
    -- contact between this check and the write either.
    perform public.lock_families(array[update_guardian_contact_for_lead.contact_id]);
    perform 1 from public.leads l
    where l.guardian_contact_id = update_guardian_contact_for_lead.contact_id
    order by l.id
    for update;
    select * into target from public.leads l
    where l.id = update_guardian_contact_for_lead.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);
    if target.guardian_contact_id is distinct from contact_id then
        raise exception 'children_changed';
    end if;

    select c.phone into current_phone from public.guardian_contacts c
    where c.id = contact_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- A single-field Apply must not report success when normalization would
    -- clear the submitted WhatsApp number. Check after any phone edit that
    -- held this contact, while keeping the contact locked through the write.
    if changes ? 'whatsapp' and not (changes ? 'phone')
       and public.normalize_phone(coalesce(changes ->> 'whatsapp', '')) = current_phone then
        raise exception 'phone_first';
    end if;

    return public.update_guardian_contact(contact_id, changes, expected_lead_ids);
end;
$$;

revoke execute on function public.update_guardian_contact_for_lead(uuid, uuid, jsonb, uuid[])
    from public, anon, service_role;
grant execute on function public.update_guardian_contact_for_lead(uuid, uuid, jsonb, uuid[])
    to authenticated;

-- ---------------------------------------------------------------------------
-- update_lead_details, as 20261211100100_sibling_result.sql made it, now also
-- correcting who brought the student and the previous school. A key left out
-- keeps its value; an empty string or null clears a text field. The result
-- must hold together: a brought-by phone or relationship needs a name; the
-- school's name, type and region come together; "Not known yet" goes with no
-- details. A refusal is `invalid` with the field. Nothing else changes.
--
--   brought_by_name, brought_by_phone, brought_by_relationship
--   previous_school_name (2 to 120 characters), previous_school_type
--   (`private` or `public`), previous_school_region (one of
--   previous_school_regions(), any case), previous_school_not_known (a
--   JSON boolean)
-- ---------------------------------------------------------------------------

create or replace function public.update_lead_details(lead_id uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
    contact public.guardian_contacts;
    pupil_name text;
    student_class public.lead_class;
    student_year integer;
    student_boarding public.day_or_boarding;
    this_year integer := extract(year from public.tanzania_today());
    phones text[];
    match public.leads;
    brought_name text;
    brought_phone text;
    brought_relationship text;
    school_name text;
    school_type public.previous_school_type;
    school_region text;
    school_not_known boolean;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two corrections made at once never undo each other's fields.
    -- The Family lock first (#297): a rename takes the phone locks below, and
    -- a class, year or boarding change recomputes the fee under this lock,
    -- so taking it last could deadlock with a child being added to the
    -- Family, which takes it before the phone locks.
    perform public.lock_lead_family(update_lead_details.lead_id);
    select * into lead from public.leads l where l.id = update_lead_details.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(lead.id);

    pupil_name := lead.student_name;
    if changes ? 'full_name' then
        pupil_name := btrim(coalesce(changes ->> 'full_name', ''));
        if pupil_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
        end if;
    end if;

    student_class := lead.class_name;
    if changes ? 'class_name' then
        begin
            student_class := (changes ->> 'class_name')::public.lead_class;
        exception when invalid_text_representation then
            student_class := null;
        end;
        if student_class is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
        end if;
    end if;

    -- A new year is one staff could choose today: this year or the next two.
    -- An older year already on the lead stays as it is.
    student_year := lead.enrollment_year;
    if changes ? 'enrollment_year' then
        begin
            student_year := (changes ->> 'enrollment_year')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
            student_year := null;
        end;
        if student_year is null
           or (student_year <> lead.enrollment_year and student_year not between this_year and this_year + 2) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
        end if;
    end if;

    student_boarding := lead.day_or_boarding;
    if changes ? 'day_or_boarding' then
        begin
            student_boarding := (changes ->> 'day_or_boarding')::public.day_or_boarding;
        exception when invalid_text_representation then
            student_boarding := null;
        end;
        if student_boarding is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
        end if;
    end if;

    -- Who brought the student (#298).
    brought_name := lead.brought_by_name;
    if changes ? 'brought_by_name' then
        brought_name := nullif(btrim(coalesce(changes ->> 'brought_by_name', '')), '');
        if char_length(brought_name) > 120 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_name')::text;
        end if;
    end if;

    brought_phone := lead.brought_by_phone;
    if changes ? 'brought_by_phone' then
        brought_phone := nullif(btrim(coalesce(changes ->> 'brought_by_phone', '')), '');
        if brought_phone is not null then
            brought_phone := public.normalize_phone(brought_phone);
            if brought_phone is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_phone')::text;
            end if;
        end if;
    end if;

    brought_relationship := lead.brought_by_relationship;
    if changes ? 'brought_by_relationship' then
        brought_relationship := nullif(btrim(coalesce(changes ->> 'brought_by_relationship', '')), '');
        if char_length(brought_relationship) > 60 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_relationship')::text;
        end if;
    end if;

    if brought_name is null and (brought_phone is not null or brought_relationship is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_name')::text;
    end if;

    -- The previous school (#298).
    school_name := lead.previous_school_name;
    if changes ? 'previous_school_name' then
        school_name := nullif(btrim(coalesce(changes ->> 'previous_school_name', '')), '');
        if char_length(school_name) not between 2 and 120 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_name')::text;
        end if;
    end if;

    school_type := lead.previous_school_type;
    if changes ? 'previous_school_type' then
        if nullif(btrim(coalesce(changes ->> 'previous_school_type', '')), '') is null then
            school_type := null;
        else
            begin
                school_type := (changes ->> 'previous_school_type')::public.previous_school_type;
            exception when invalid_text_representation then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_type')::text;
            end;
        end if;
    end if;

    school_region := lead.previous_school_region;
    if changes ? 'previous_school_region' then
        if nullif(btrim(coalesce(changes ->> 'previous_school_region', '')), '') is null then
            school_region := null;
        else
            school_region := public.previous_school_region(changes ->> 'previous_school_region');
            if school_region is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_region')::text;
            end if;
        end if;
    end if;

    school_not_known := lead.previous_school_not_known;
    if changes ? 'previous_school_not_known' then
        if jsonb_typeof(changes -> 'previous_school_not_known') is distinct from 'boolean' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_not_known')::text;
        end if;
        school_not_known := (changes ->> 'previous_school_not_known')::boolean;
    end if;

    if school_not_known and (school_name is not null or school_type is not null or school_region is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_not_known')::text;
    end if;
    if school_name is not null or school_type is not null or school_region is not null then
        if school_name is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_name')::text;
        elsif school_type is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_type')::text;
        elsif school_region is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_region')::text;
        end if;
    end if;

    -- A new name must not make this child a duplicate of another lead, a
    -- brother or sister on the same contact included.
    if public.normalize_student_name(pupil_name) <> lead.student_name_key then
        -- Shared, so a change to the contact's numbers waits until this
        -- check is done, and is then checked against the new name.
        select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;
        phones := array[contact.phone, contact.whatsapp];
        perform public.lock_lead_phones(phones);
        match := public.find_duplicate_lead(public.normalize_student_name(pupil_name), phones, lead.id);
        if match.id is not null then
            return public.duplicate_result(match);
        end if;
    end if;

    update public.leads l
    set student_name = pupil_name,
        class_name = student_class,
        enrollment_year = student_year,
        day_or_boarding = student_boarding,
        brought_by_name = brought_name,
        brought_by_phone = brought_phone,
        brought_by_relationship = brought_relationship,
        previous_school_name = school_name,
        previous_school_type = school_type,
        previous_school_region = school_region,
        previous_school_not_known = school_not_known
    where l.id = lead.id;

    return jsonb_build_object('result', 'updated');
end;
$$;

revoke execute on function public.update_lead_details(uuid, jsonb) from public, anon;
grant execute on function public.update_lead_details(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- decline_lead, as 20261017800100_decline_lead.sql made it, now taking the
-- lead's Family lock before any row lock, in the documented order (Family,
-- rows). Contact corrections now take the Family lock and then the contact's leads, so a decline holding its row first could deadlock with one (review of #298). Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.decline_lead(lead_id uuid, reason text, explanation text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    chosen public.declined_reason;
    note text := nullif(btrim(coalesce(decline_lead.explanation, '')), '');
    staff_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.decline') then
        raise exception 'not_permitted';
    end if;

    begin
        chosen := decline_lead.reason::public.declined_reason;
    exception when invalid_text_representation then
        chosen := null;
    end;
    if chosen is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    if chosen = 'No seat available' and not public.has_permission('academic_years.manage') then
        raise exception 'not_permitted';
    end if;
    if (chosen = 'Other' and note is null) or char_length(note) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'explanation')::text;
    end if;

    -- The Family lock first (#298): declining an Enrolled lead recomputes its
    -- siblings under this lock, and a contact correction takes it before the
    -- contact's leads, so taking it after the row lock could deadlock.
    perform public.lock_lead_family(decline_lead.lead_id);
    -- Locked, so two staff declining the same lead at once decline it once:
    -- whoever comes second finds it closed.
    select * into target from public.leads l where l.id = decline_lead.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    update public.leads l
    set status = 'Declined',
        declined_reason = chosen,
        declined_explanation = note,
        declined_at = now(),
        declined_by = staff_id,
        status_before_decline = target.status
    where l.id = target.id;
end;
$$;

revoke execute on function public.decline_lead(uuid, text, text) from public, anon;
grant execute on function public.decline_lead(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_reopening_request, as 20261029800400_approve_reopening.sql made it, now taking the
-- lead's Family lock before any row lock, in the documented order (Family,
-- rows). Same reason as decline_lead above. Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.approve_reopening_request(request_id uuid, enrol_without_retake boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    request public.reopening_requests;
    target public.leads;
    staff_id uuid;
    was_declined boolean;
    status_before public.lead_status;
    restored public.lead_status;
    retake_applies boolean;
    earlier_override text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('reopenings.approve') then
        raise exception 'not_permitted';
    end if;

    -- The Family lock first (#298): reopening recomputes the lead under this
    -- lock, and a contact correction takes it before the contact's leads, so
    -- taking it after the lead's row lock could deadlock. A request never
    -- changes lead, so its lead is read before the request is locked.
    perform public.lock_lead_family(
        (select r.lead_id from public.reopening_requests r where r.id = approve_reopening_request.request_id)
    );

    -- Locked, so an approval, a rejection and a withdrawal at the same moment
    -- take the request out of Pending once.
    select * into request from public.reopening_requests r where r.id = approve_reopening_request.request_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    if request.state <> 'pending' then
        -- The same approval again, as a retried click sends: already done.
        if request.state = 'approved'
           and request.decided_by = staff_id
           and request.enrol_without_retake is not distinct from approve_reopening_request.enrol_without_retake then
            return;
        end if;
        raise exception 'not_pending';
    end if;

    -- Locked, so a mark or a payment recompute on the lead waits for this.
    select * into target from public.leads l where l.id = request.lead_id for update;

    was_declined := target.status = 'Declined';
    if was_declined then
        -- A lead declined before declines recorded the earlier status goes
        -- back to the earliest status its Visit date allows.
        status_before := coalesce(
            target.status_before_decline,
            case when target.visit_date is null then 'Applied' else 'Visited' end::public.lead_status
        );
        restored := case when status_before = 'Enrolled' then 'Interviewed' else status_before end;
    else
        restored := target.status;
    end if;

    retake_applies := was_declined and status_before in ('Interviewed', 'Enrolled');
    if retake_applies is distinct from (approve_reopening_request.enrol_without_retake is not null) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'enrol_without_retake')::text;
    end if;

    earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
    perform public.set_lead_lifecycle_override('reopen');

    update public.leads l
    set status = restored,
        declined_reason = null,
        declined_explanation = null,
        declined_at = null,
        declined_by = null,
        status_before_decline = null,
        initially_declined = l.initially_declined or was_declined,
        closure = null,
        closure_reason = null,
        closure_note = null,
        closed_at = null,
        closed_by = null
    where l.id = target.id;

    perform set_config('app.lead_lifecycle_override', earlier_override, true);

    update public.reopening_requests r
    set state = 'approved',
        decided_by = staff_id,
        decided_at = now(),
        enrol_without_retake = approve_reopening_request.enrol_without_retake,
        lead_was_declined = was_declined,
        restored_status = restored
    where r.id = request.id;
end;
$$;

revoke execute on function public.approve_reopening_request(uuid, boolean) from public, anon;
grant execute on function public.approve_reopening_request(uuid, boolean) to authenticated;
