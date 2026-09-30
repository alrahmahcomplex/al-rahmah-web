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
-- leads.edit.
-- ---------------------------------------------------------------------------

create function public.update_guardian_contact(contact_id uuid, changes jsonb)
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

revoke execute on function public.update_guardian_contact(uuid, jsonb) from public, anon;
grant execute on function public.update_guardian_contact(uuid, jsonb) to authenticated;

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
