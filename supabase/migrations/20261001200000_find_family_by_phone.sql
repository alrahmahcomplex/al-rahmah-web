-- Matching a walk-in parent to a known Family (slice 2). The front desk asks
-- for the parent first, then looks for every contact that already holds one
-- of their numbers, so staff can confirm it is the same person before any
-- child is typed.
--
-- A read, so it runs as the caller and row-level security still applies. It
-- checks leads.view itself anyway, so a staff member without it is told so
-- instead of being told nobody matched. Refusals raise a stable code as the
-- error message: `not_permitted`, or `invalid` with the field as JSON in the
-- detail, as create_lead does.

-- Every contact whose direct or WhatsApp number equals either given number
-- after normalize_phone, oldest first, each with the children on it. Names
-- are never compared. Returns the numbers as normalized too, so the screen can
-- compare what was typed with what is on file.
create function public.find_family_by_phone(phone text, whatsapp text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    direct text;
    other text;
    phones text[];
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    direct := public.normalize_phone(coalesce(find_family_by_phone.phone, ''));
    if direct is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    other := nullif(btrim(coalesce(find_family_by_phone.whatsapp, '')), '');
    if other is not null then
        other := public.normalize_phone(other);
        if other is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if other = direct then
            other := null;
        end if;
    end if;

    phones := array_remove(array[direct, other], null);

    return jsonb_build_object(
        'phone', direct,
        'whatsapp', other,
        'contacts', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', g.id,
                    'full_name', g.full_name,
                    'relationship', g.relationship,
                    'relationship_description', g.relationship_description,
                    'phone', g.phone,
                    'whatsapp', g.whatsapp,
                    'children', coalesce((
                        select jsonb_agg(
                            jsonb_build_object(
                                'id', l.id,
                                'admission_number', l.admission_number,
                                'student_name', l.student_name,
                                'class_name', l.class_name,
                                'enrollment_year', l.enrollment_year,
                                'status', l.status,
                                'closure', l.closure
                            )
                            order by l.created_at, l.id
                        )
                        from public.leads l
                        where l.guardian_contact_id = g.id
                    ), '[]'::jsonb)
                )
                order by g.created_at, g.id
            )
            from public.guardian_contacts g
            where g.phone = any (phones) or g.whatsapp = any (phones)
        ), '[]'::jsonb)
    );
end;
$$;

revoke execute on function public.find_family_by_phone(text, text) from public, anon;
grant execute on function public.find_family_by_phone(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_lead gains `also_check_phones`: the numbers staff typed when they
-- confirm a walk-in parent as a known contact. The child joins that contact,
-- but the duplicate check (and its per-phone locks) covers the typed numbers
-- as well as the stored ones. Everything else is as in
-- 20260930000000_lead_corrections.sql. The old five-argument version is
-- dropped so no call can reach it by mistake.
-- ---------------------------------------------------------------------------

drop function public.create_lead(text, uuid, jsonb, jsonb, date);

create function public.create_lead(
    start_kind text,
    existing_contact_id uuid,
    new_contact jsonb,
    student_details jsonb,
    visited_on date default null,
    also_check_phones text[] default null
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
    extra_phones text[] := '{}';
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

        -- The numbers staff typed for a walk-in parent they confirmed, which
        -- the stored contact may not hold. The duplicate check covers them
        -- too, so keeping the stored details never lets through a child who
        -- is on file under the other number.
        if also_check_phones is not null then
            if not walk_in then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
            end if;
            extra_phones := array(
                select n from unnest(also_check_phones) p, public.normalize_phone(p) n where n is not null
            );
        end if;
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
        select distinct p from unnest(array[contact_phone, contact_whatsapp] || extra_phones) p
        where p is not null order by p
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

revoke execute on function public.create_lead(text, uuid, jsonb, jsonb, date, text[]) from public, anon;
grant execute on function public.create_lead(text, uuid, jsonb, jsonb, date, text[]) to authenticated, service_role;
