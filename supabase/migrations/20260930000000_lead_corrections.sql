-- Corrections to a lead (slice 2): the student's details, the parent/guardian
-- contact, and the Visit date. Each is a security definer function that checks
-- the permission itself, like create_lead. None of them reads an Admission
-- Number or a status, so no call can change either.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `closed`, `not_visited`, or `invalid` with the offending field
-- as JSON in the detail. A correction that would make a duplicate is refused
-- too, but comes back as data with the lead it matches, as create_lead does.

-- The first lead whose student name key is `name_key` and whose contact has
-- one of `phones` as its direct or WhatsApp number, leaving out the lead being
-- corrected and, when given, every lead on `except_contact_id`.
create function public.find_duplicate_lead(
    name_key text,
    phones text[],
    except_lead_id uuid,
    except_contact_id uuid default null
)
returns public.leads
language sql
stable
set search_path = ''
as $$
    select l.*
    from public.leads l
    join public.guardian_contacts g on g.id = l.guardian_contact_id
    where l.student_name_key = find_duplicate_lead.name_key
      and l.id is distinct from find_duplicate_lead.except_lead_id
      and l.guardian_contact_id is distinct from find_duplicate_lead.except_contact_id
      and (g.phone = any (find_duplicate_lead.phones) or g.whatsapp = any (find_duplicate_lead.phones))
    order by l.created_at, l.id
    limit 1;
$$;

revoke execute on function public.find_duplicate_lead(text, text[], uuid, uuid) from public, anon, authenticated;

-- Takes the same per-phone locks create_lead takes, in the same order, so a
-- correction and a creation that share a number never both pass the check.
create function public.lock_lead_phones(phones text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
    one_phone text;
begin
    foreach one_phone in array array(
        select distinct p from unnest(lock_lead_phones.phones) p where p is not null order by p
    ) loop
        perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
    end loop;
end;
$$;

revoke execute on function public.lock_lead_phones(text[]) from public, anon, authenticated;

create function public.duplicate_result(match public.leads)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object(
        'result', 'duplicate',
        'lead_id', match.id,
        'admission_number', match.admission_number,
        'status', match.status,
        'closure', match.closure
    );
$$;

revoke execute on function public.duplicate_result(public.leads) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- update_lead_details: the student's name, class, enrollment year and Day or
-- boarding. A key left out of `changes` keeps its value; any other key is
-- ignored. Needs leads.edit. A closed lead is read-only.
-- ---------------------------------------------------------------------------

create function public.update_lead_details(lead_id uuid, changes jsonb)
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
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two corrections made at once never undo each other's fields.
    select * into lead from public.leads l where l.id = update_lead_details.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if lead.status = 'Declined' or lead.closure is not null then
        raise exception 'closed';
    end if;

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
        day_or_boarding = student_boarding
    where l.id = lead.id;

    return jsonb_build_object('result', 'updated');
end;
$$;

revoke execute on function public.update_lead_details(uuid, jsonb) from public, anon;
grant execute on function public.update_lead_details(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- update_guardian_contact: the parent or guardian's name, relationship and
-- numbers, for every lead on the contact. A key left out of `changes` keeps
-- its value; an empty or null `whatsapp` means the same as the phone. Needs
-- leads.edit. A contact any closed lead is on is read-only, like the lead.
--
-- `expected_lead_ids` are the children the staff member was told the change
-- reaches. When given, a contact whose children have changed since is refused
-- as `children_changed`, so nobody's details change unannounced.
-- ---------------------------------------------------------------------------

create function public.update_guardian_contact(contact_id uuid, changes jsonb, expected_lead_ids uuid[] default null)
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

    -- Locked, so a child renamed at the same moment is checked against the
    -- numbers this saves, or this against the new name.
    select * into contact from public.guardian_contacts g where g.id = update_guardian_contact.contact_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if exists (
        select 1 from public.leads l
        where l.guardian_contact_id = contact.id and (l.status = 'Declined' or l.closure is not null)
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
-- correct_visit_date: puts right the Visit date of a lead that has one. Never
-- later than today in Tanzania. Needs visits.record. A closed lead is
-- read-only, and an Applied lead has no visit to correct.
-- ---------------------------------------------------------------------------

create function public.correct_visit_date(lead_id uuid, visited_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('visits.record') then
        raise exception 'not_permitted';
    end if;

    select * into lead from public.leads l where l.id = correct_visit_date.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    if lead.status = 'Declined' or lead.closure is not null then
        raise exception 'closed';
    end if;
    if lead.visit_date is null then
        raise exception 'not_visited';
    end if;
    if visited_on is null or visited_on > public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    update public.leads l set visit_date = visited_on where l.id = lead.id;
end;
$$;

revoke execute on function public.correct_visit_date(uuid, date) from public, anon;
grant execute on function public.correct_visit_date(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- create_lead, unchanged but for one lock: a child joining an existing contact
-- holds it shared, so a correction to that contact's numbers is checked with
-- the new child, or the new child against the corrected numbers.
-- ---------------------------------------------------------------------------

create or replace function public.create_lead(
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
        -- Shared, so a correction to this contact's numbers waits for this
        -- child, or this child is checked against the corrected numbers.
        select * into contact from public.guardian_contacts g where g.id = contact_id for share;
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
