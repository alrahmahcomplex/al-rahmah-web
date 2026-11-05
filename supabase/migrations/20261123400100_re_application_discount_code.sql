-- A Discount code on a Re-application (slice 4, #84). When the Admission form
-- sends a code for a child already on file, the code goes onto the
-- re-application, never onto the lead, so nothing from the public overwrites
-- a checked record. Staff compare it with the lead's Referral code and Apply
-- it through set_lead_referral_code, which accepts only a registered agent's
-- code.
--
-- The admission-form service passes the code inside the child's details, as
-- `discount_code`, so submit_admission_form_child hands it on unchanged in
-- `submitted -> 'student'`. create_lead reads only its own keys and ignores it.

alter table public.re_applications
    -- The code as normalized, recognised or not. Null when the form sent none.
    add column discount_code text
        constraint re_applications_discount_code_normalized
            check (discount_code = public.normalize_referral_code(discount_code)),
    drop constraint re_applications_differing_fields_check,
    add constraint re_applications_differing_fields_check check (
        differing_fields <@ array[
            'student_name', 'class_name', 'enrollment_year', 'day_or_boarding',
            'contact_name', 'relationship', 'relationship_description', 'phone', 'whatsapp',
            'discount_code'
        ]::text[]
    );

comment on column public.re_applications.discount_code is
    'The Discount code the Admission form sent with this child, normalized, whether or not an agent holds it. It never reaches the lead from the form: staff Apply it as the lead''s Referral code. Null when the form sent none.';

-- ---------------------------------------------------------------------------
-- record_re_application, as in 20261022300200_re_applications.sql, with the
-- same signature. It now also reads `submitted -> 'student' ->> 'discount_code'`,
-- stores it normalized (`invalid` with `discount_code` for a value that is not
-- a code), and lists `discount_code` among the differing fields when a code
-- was sent and it is not the lead's Referral code. A form with no code
-- records none and no difference. Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.record_re_application(lead_id uuid, submission_key uuid, submitted jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
    contact public.guardian_contacts;
    sent_contact jsonb := coalesce(submitted -> 'contact', '{}'::jsonb);
    sent_student jsonb := coalesce(submitted -> 'student', '{}'::jsonb);
    contact_name text;
    contact_relationship public.guardian_relationship;
    contact_description text;
    phone_as_sent text;
    whatsapp_as_sent text;
    contact_phone text;
    contact_whatsapp text;
    pupil_name text;
    student_class public.lead_class;
    student_year integer;
    student_boarding public.day_or_boarding;
    sent_code text;
    differing text[] := '{}';
    existing uuid;
    new_id uuid;
    earlier_override text;
begin
    perform public.set_audit_actor('public_form', null);

    if record_re_application.lead_id is null or record_re_application.submission_key is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'submission_key')::text;
    end if;

    -- The parent or guardian, checked as create_lead checks a new contact.
    contact_name := btrim(coalesce(sent_contact ->> 'full_name', ''));
    if contact_name = '' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
    end if;
    begin
        contact_relationship := (sent_contact ->> 'relationship')::public.guardian_relationship;
    exception when invalid_text_representation then
        contact_relationship := null;
    end;
    if contact_relationship is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
    end if;
    contact_description := nullif(btrim(coalesce(sent_contact ->> 'relationship_description', '')), '');
    if contact_relationship = 'Other' and contact_description is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
    end if;
    if contact_relationship <> 'Other' then
        contact_description := null;
    end if;

    phone_as_sent := btrim(coalesce(sent_contact ->> 'phone', ''));
    contact_phone := public.normalize_phone(phone_as_sent);
    if contact_phone is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;
    whatsapp_as_sent := nullif(btrim(coalesce(sent_contact ->> 'whatsapp', '')), '');
    if whatsapp_as_sent is not null then
        contact_whatsapp := public.normalize_phone(whatsapp_as_sent);
        if contact_whatsapp is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if contact_whatsapp = contact_phone then
            contact_whatsapp := null;
        end if;
    end if;

    -- The child.
    pupil_name := regexp_replace(btrim(coalesce(sent_student ->> 'full_name', '')), '\s+', ' ', 'g');
    if pupil_name = '' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
    end if;
    begin
        student_class := (sent_student ->> 'class_name')::public.lead_class;
    exception when invalid_text_representation then
        student_class := null;
    end;
    if student_class is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
    end if;
    begin
        student_year := (sent_student ->> 'enrollment_year')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
        student_year := null;
    end;
    if student_year is null or student_year not between 2000 and 2100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
    end if;
    begin
        student_boarding := (sent_student ->> 'day_or_boarding')::public.day_or_boarding;
    exception when invalid_text_representation then
        student_boarding := null;
    end;
    if student_boarding is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
    end if;

    -- The Discount code, normalized as every path normalizes it. An empty one
    -- is none.
    if nullif(btrim(coalesce(sent_student ->> 'discount_code', '')), '') is not null then
        sent_code := public.normalize_referral_code(sent_student ->> 'discount_code');
        if sent_code is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'discount_code')::text;
        end if;
    end if;

    -- Held, so the differing fields are read against the lead as it stands
    -- and two sends of one form record it once.
    select * into lead from public.leads l where l.id = record_re_application.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    select r.id into existing
    from public.re_applications r
    where r.lead_id = lead.id and r.submission_key = record_re_application.submission_key;
    if found then
        return existing;
    end if;

    select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;

    if pupil_name <> lead.student_name then differing := array_append(differing, 'student_name'); end if;
    if student_class <> lead.class_name then differing := array_append(differing, 'class_name'); end if;
    if student_year <> lead.enrollment_year then differing := array_append(differing, 'enrollment_year'); end if;
    if student_boarding <> lead.day_or_boarding then differing := array_append(differing, 'day_or_boarding'); end if;
    if contact_name <> contact.full_name then differing := array_append(differing, 'contact_name'); end if;
    if contact_relationship <> contact.relationship then differing := array_append(differing, 'relationship'); end if;
    if contact_description is distinct from contact.relationship_description then
        differing := array_append(differing, 'relationship_description');
    end if;
    if contact_phone <> contact.phone then differing := array_append(differing, 'phone'); end if;
    if contact_whatsapp is distinct from contact.whatsapp then differing := array_append(differing, 'whatsapp'); end if;
    if sent_code is not null and sent_code is distinct from lead.referral_code then
        differing := array_append(differing, 'discount_code');
    end if;

    insert into public.re_applications (
        lead_id, submission_key, contact_name, relationship, relationship_description,
        phone_as_sent, whatsapp_as_sent, phone, whatsapp,
        student_name, class_name, enrollment_year, day_or_boarding, discount_code, differing_fields
    ) values (
        lead.id, record_re_application.submission_key, contact_name, contact_relationship, contact_description,
        phone_as_sent, whatsapp_as_sent, contact_phone, contact_whatsapp,
        pupil_name, student_class, student_year, student_boarding, sent_code, differing
    )
    returning id into new_id;

    if not lead.returning_family_reapplied then
        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('re_application');
        update public.leads l set returning_family_reapplied = true where l.id = lead.id;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end if;

    return new_id;
end;
$$;

revoke execute on function public.record_re_application(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_re_application(uuid, uuid, jsonb) to service_role;
