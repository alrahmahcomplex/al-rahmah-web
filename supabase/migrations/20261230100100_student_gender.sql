-- Boy or girl on each child (#449, slice 1 of the brief on the ticket).
-- Database and services only: no screen asks it until slices 2 and 3, and
-- nothing reads it until streams arrive in slice 4. No fee, discount,
-- status or Seat priority moves, and no existing row is written.
--
-- 1. The enum student_gender (Boy, Girl) and leads.gender, nullable: empty
--    means the child came in before the question existed, or from the
--    workbook import, which has no such column.
-- 2. student_gender_of(answer, student): the one check every path uses.
--    A missing or JSON-null answer is empty; anything other than "Boy" or
--    "Girl" is refused as `invalid` with field `gender`. Internal.
-- 3. create_lead (and so the Admission form and the front desk),
--    register_students and complete_admission_visit take `gender` in each
--    student's details. Check-in keeps the family's answer unless staff give
--    one. update_lead_details takes it as a correction and never clears it.
-- 4. A Re-application for a child on file with no answer fills it from the
--    one sent; an answer already there is never overwritten (owner's answer
--    Q20). The closed-lead guard lets a Re-application fill that one gap on
--    a Declined, Inactive or Archived child, and nothing else.
--
-- Each function below is the latest definition (20261223100100,
-- 20261214100200, 20261213100100) with the Boy / Girl lines added; same
-- signatures, so grants are restated as they were.
--
-- Rollback: a new migration putting those functions back as they were, then
-- dropping leads.gender, student_gender_of and the enum.

do $migration$
begin
    create type public.student_gender as enum ('Boy', 'Girl');
    comment on type public.student_gender is 'Whether a student is a boy or a girl (#449).';

    alter table public.leads add column gender public.student_gender;
    comment on column public.leads.gender is
        'Boy or Girl, as the Admission form or staff registration gave it, or as staff corrected it. Empty for a child from before the question (#449) or from the workbook import. A Re-application fills it when empty and never overwrites it.';

    -- The one Boy / Girl check. `student` numbers the student in a
    -- multi-student refusal, as the other per-student checks do.
    create function public.student_gender_of(answer jsonb, student integer)
    returns public.student_gender
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    begin
        if answer is null or jsonb_typeof(answer) = 'null' then
            return null;
        end if;
        if jsonb_typeof(answer) = 'string' and answer #>> '{}' in ('Boy', 'Girl') then
            return (answer #>> '{}')::public.student_gender;
        end if;
        raise exception 'invalid' using detail = (
            case when student is null
                then jsonb_build_object('field', 'gender')
                else jsonb_build_object('student', student, 'field', 'gender')
            end
        )::text;
    end;
    $fn$;

    revoke execute on function public.student_gender_of(jsonb, integer) from public, anon, authenticated, service_role;

    -- create_lead, as 20261223100100 made it, storing the answer.
    create or replace function public.create_lead(
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
        pupil_father text;
        named record;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        student_gender public.student_gender;
        this_year integer := extract(year from public.tanzania_today());
        phones text[];
        extra_phones text[] := '{}';
        one_phone text;
        match public.leads;
        pending_match uuid;
        matched_contact public.guardian_contacts;
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
            -- The Family lock first (#297): the new lead joins this Family, and
            -- confirming a match into it takes this lock before the phone locks
            -- below, so taking it after them could deadlock.
            perform public.lock_families(array[contact_id]);
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
            -- The three name parts (#400), or the one box of the live
            -- Admission form, stored as typed.
            if new_contact ?| array['first_name', 'middle_name', 'last_name'] then
                contact_name := coalesce(public.registration_person_name(new_contact, null), '');
                if contact_name = '' then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_first_name')::text;
                end if;
            else
                contact_name := btrim(coalesce(new_contact ->> 'full_name', ''));
            end if;
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

        -- The student: the student's own name and the father's three names
        -- (#400), or the one box of the live Admission form, stored as
        -- typed, whose father's name the insert trigger derives as before.
        if student_details ?| array['first_name', 'father_first', 'father_middle', 'father_last'] then
            select * into named from public.registration_name(student_details, null);
            pupil_name := named.student_name;
            pupil_father := named.father_full_name;
        else
            pupil_name := btrim(coalesce(student_details ->> 'full_name', ''));
        end if;
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

        -- Boy or girl (#449): empty from a form that does not ask it yet.
        student_gender := public.student_gender_of(student_details -> 'gender', null);

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
            -- A contact with children, a settled one before one that is itself
            -- still waiting on staff, then the oldest. Held shared, so staff
            -- settling that contact's own match wait for this, or this reads
            -- how they settled it.
            select g.* into matched_contact
            from public.guardian_contacts g
            where (g.phone = any (phones) or g.whatsapp = any (phones))
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
            order by g.pending_family_match_id is not null, g.created_at, g.id
            limit 1
            for share of g;
            -- A contact still waiting on staff is not a Family: the match goes to
            -- the Family it waits on. A match always points at a contact with no
            -- match of its own, so there is never a chain to follow, and that
            -- contact keeps its children: confirming only adds to them, and
            -- separating never takes the last one.
            pending_match := coalesce(matched_contact.pending_family_match_id, matched_contact.id);
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
                    status, visit_date, guardian_contact_id, returning_family_joined,
                    father_full_name, father_full_name_source, gender
                ) values (
                    new_number, pupil_name, student_class, student_year, student_boarding,
                    case when walk_in then 'Visited'::public.lead_status else 'Applied'::public.lead_status end,
                    visited_on, contact_id, joined,
                    -- Empty for a one-box name: the insert trigger derives it.
                    pupil_father, case when pupil_father is not null then 'entered'::public.father_name_source end,
                    student_gender
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

    -- record_re_application, as 20261223100100 made it, filling an empty answer.
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
        sent_father text;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        sent_gender public.student_gender;
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
        -- The father's full name the form built from its three parts (#400),
        -- kept as sent, never put on the lead. Empty from a one-box form.
        sent_father := public.clean_father_name(sent_student ->> 'father_full_name');
        if char_length(sent_father) > 200 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
        end if;
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
        sent_gender := public.student_gender_of(sent_student -> 'gender', null);

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
            student_name, class_name, enrollment_year, day_or_boarding, discount_code, differing_fields, father_full_name
        ) values (
            lead.id, record_re_application.submission_key, contact_name, contact_relationship, contact_description,
            phone_as_sent, whatsapp_as_sent, contact_phone, contact_whatsapp,
            pupil_name, student_class, student_year, student_boarding, sent_code, differing, sent_father
        )
        returning id into new_id;

        -- A child on file with no Boy / Girl answer takes the one sent; an
        -- answer already there is never overwritten (#449, Q20).
        if not lead.returning_family_reapplied or (lead.gender is null and sent_gender is not null) then
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform public.set_lead_lifecycle_override('re_application');
            update public.leads l
            set returning_family_reapplied = true,
                gender = coalesce(l.gender, sent_gender)
            where l.id = lead.id;
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;

        return new_id;
    end;
    $$;

    revoke execute on function public.record_re_application(uuid, uuid, jsonb) from public, anon, authenticated;
    grant execute on function public.record_re_application(uuid, uuid, jsonb) to service_role;

    -- refuse_closed_lead_change, as 20261213100100 made it, letting a
    -- Re-application fill an empty answer on a closed child.
    create or replace function public.refuse_closed_lead_change()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
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
               -- A Re-application may fill a missing Boy / Girl answer, never change one.
               and (old.gender is null or new.gender is not distinct from old.gender)
               and (to_jsonb(new) - 'returning_family_reapplied' - 'student_name_key' - 'gender')
                   = (to_jsonb(old) - 'returning_family_reapplied' - 'student_name_key' - 'gender')
           )
           and not (
               privileged
               and override = 'custodian_sync'
               and (to_jsonb(new) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
                   = (to_jsonb(old) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
           )
           and not (
               privileged
               and override = 'father_name_typo'
               and new.father_full_name_source = 'typo_confirmed'
               and (to_jsonb(new) - 'father_full_name' - 'father_full_name_source' - 'student_name_key')
                   = (to_jsonb(old) - 'father_full_name' - 'father_full_name_source' - 'student_name_key')
           ) then
            raise exception 'lead_closed';
        end if;
        return new;
    end;
    $fn$;

    -- register_students, as 20261223100100 made it, storing each answer.
    create or replace function public.register_students(visited_on date, people jsonb, students jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        this_year integer := extract(year from public.tanzania_today());
        n integer;
        np integer;
        i integer;
        j integer;
        k integer;
        item jsonb;
        person jsonb;
        -- People, by number.
        p_contact uuid[] := '{}';
        p_name text[] := '{}';
        p_phone text[] := '{}';
        p_whatsapp text[] := '{}';
        p_extra jsonb[] := '{}';
        p_rel public.guardian_relationship[] := '{}';
        p_desc text[] := '{}';
        p_used boolean[] := '{}';
        p_father_name text[] := '{}';
        -- The relationship stored on each person once saved.
        p_stored_rel public.guardian_relationship[] := '{}';
        p_stored_desc text[] := '{}';
        one_phone text;
        extra text[];
        -- Students, by number.
        s_name text[] := '{}';
        s_father text[] := '{}';
        s_class public.lead_class[] := '{}';
        s_year integer[] := '{}';
        s_boarding public.day_or_boarding[] := '{}';
        s_gender public.student_gender[] := '{}';
        s_person integer[] := '{}';
        s_rel public.guardian_relationship[] := '{}';
        s_desc text[] := '{}';
        s_by_name text[] := '{}';
        s_by_phone text[] := '{}';
        s_by_rel text[] := '{}';
        s_school text[] := '{}';
        s_school_type public.previous_school_type[] := '{}';
        s_school_region text[] := '{}';
        s_school_unknown boolean[] := '{}';
        s_sib_student integer[] := '{}';
        s_sib_lead uuid[] := '{}';
        s_not_sibling boolean[] := '{}';
        s_choice jsonb[] := '{}';
        s_lead uuid[] := '{}';
        s_number text[] := '{}';
        s_comp integer[] := '{}';
        s_sibling jsonb[] := '{}';
        parsed record;
        custodian record;
        target uuid;
        targets uuid[] := '{}';
        existing uuid[] := '{}';
        contact public.guardian_contacts;
        phones text[];
        student_phones text[];
        match public.leads;
        duplicates jsonb := '[]';
        questions jsonb := '[]';
        changed boolean;
        attempt integer;
        new_number text;
        new_id uuid;
        kept uuid[];
        touched uuid[] := '{}';
        pending integer[];
        blocked boolean[] := '{}';
        progressed boolean;
        saved jsonb;
        same_lead public.leads;
        result_rows jsonb := '[]';
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('leads.create')
           or not public.has_permission('visits.record') then
            raise exception 'not_permitted';
        end if;

        if register_students.visited_on is null or register_students.visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
        if register_students.students is null or jsonb_typeof(register_students.students) <> 'array'
           or jsonb_array_length(register_students.students) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students')::text;
        end if;
        n := jsonb_array_length(register_students.students);
        -- At most 8 students on one form (decision 1).
        if n > 8 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students', 'reason', 'too_many')::text;
        end if;
        if register_students.people is null or jsonb_typeof(register_students.people) <> 'array'
           or jsonb_array_length(register_students.people) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people')::text;
        end if;
        np := jsonb_array_length(register_students.people);
        if np > n then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people', 'reason', 'too_many')::text;
        end if;

        -- ------------------------------------------------------------------
        -- The people.
        -- ------------------------------------------------------------------
        for k in 1..np loop
            person := register_students.people -> (k - 1);
            if jsonb_typeof(person) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person')::text;
            end if;
            p_used[k] := false;
            p_rel[k] := null;
            p_desc[k] := null;
            p_father_name[k] := null;
            if nullif(person ->> 'contact_id', '') is not null then
                begin
                    p_contact[k] := (person ->> 'contact_id')::uuid;
                exception when invalid_text_representation then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end;
                if p_contact[k] = any (p_contact[1:k - 1]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact', 'reason', 'repeated_on_form')::text;
                end if;
                -- The stored person is kept (S6): nothing typed may replace it.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null
                   or public.name_part(person ->> 'first_name') is not null
                   or public.name_part(person ->> 'middle_name') is not null
                   or public.name_part(person ->> 'last_name') is not null
                   or nullif(btrim(coalesce(person ->> 'phone', '')), '') is not null
                   or nullif(btrim(coalesce(person ->> 'whatsapp', '')), '') is not null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                extra := '{}';
                if person -> 'also_check_phones' is not null and jsonb_typeof(person -> 'also_check_phones') <> 'null' then
                    if jsonb_typeof(person -> 'also_check_phones') <> 'array' then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'also_check_phones')::text;
                    end if;
                    extra := array(
                        select x from jsonb_array_elements_text(person -> 'also_check_phones') e, public.normalize_phone(e) x
                        where x is not null
                    );
                end if;
                p_extra[k] := to_jsonb(extra);
                p_name[k] := null;
                p_phone[k] := null;
                p_whatsapp[k] := null;
            else
                p_contact[k] := null;
                p_extra[k] := '[]';
                -- The name in its three parts (#400). A one-box name is
                -- refused, so no caller stores one by mistake.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact_name', 'reason', 'name_parts')::text;
                end if;
                p_name[k] := public.registration_person_name(person, k);
                p_phone[k] := public.normalize_phone(coalesce(person ->> 'phone', ''));
                if p_phone[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'phone')::text;
                end if;
                p_whatsapp[k] := nullif(btrim(coalesce(person ->> 'whatsapp', '')), '');
                if p_whatsapp[k] is not null then
                    p_whatsapp[k] := public.normalize_phone(p_whatsapp[k]);
                    if p_whatsapp[k] is null then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'whatsapp')::text;
                    end if;
                    if p_whatsapp[k] = p_phone[k] then
                        p_whatsapp[k] := null;
                    end if;
                end if;
                -- A person is stored once per phone: two new people on one
                -- form never share a number.
                for j in 1..k - 1 loop
                    if p_contact[j] is null
                       and array[p_phone[k], p_whatsapp[k]] && array_remove(array[p_phone[j], p_whatsapp[j]], null) then
                        raise exception 'invalid'
                            using detail = jsonb_build_object('person', k, 'field', 'phone', 'reason', 'repeated_on_form')::text;
                    end if;
                end loop;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The students.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            item := register_students.students -> (i - 1);
            if jsonb_typeof(item) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'student')::text;
            end if;

            select * into parsed from public.registration_name(item, i);
            s_name[i] := parsed.student_name;
            s_father[i] := parsed.father_full_name;

            begin
                s_class[i] := (item ->> 'class_name')::public.lead_class;
            exception when invalid_text_representation then
                s_class[i] := null;
            end;
            if s_class[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'class_name')::text;
            end if;
            begin
                s_year[i] := (item ->> 'enrollment_year')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                s_year[i] := null;
            end;
            -- Staff choose from the current year and the next two.
            if s_year[i] is null or s_year[i] not between this_year and this_year + 2 then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'enrollment_year')::text;
            end if;
            begin
                s_boarding[i] := (item ->> 'day_or_boarding')::public.day_or_boarding;
            exception when invalid_text_representation then
                s_boarding[i] := null;
            end;
            if s_boarding[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'day_or_boarding')::text;
            end if;
            s_gender[i] := public.student_gender_of(item -> 'gender', i);

            select * into custodian from public.registration_custodian(item -> 'custodian', i);
            begin
                k := (item -> 'custodian' ->> 'person')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                k := null;
            end;
            if k is null or k not between 1 and np then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'custodian')::text;
            end if;
            s_person[i] := k;
            s_rel[i] := custodian.relationship;
            s_desc[i] := custodian.relationship_description;
            if not p_used[k] then
                p_used[k] := true;
                p_rel[k] := custodian.relationship;
                p_desc[k] := custodian.relationship_description;
            end if;
            -- "The father is the main custodian": a new person with no name
            -- typed takes the father's full name. Two children can share
            -- that person only with the same father's name.
            if custodian.father and p_contact[k] is null and p_name[k] is null then
                if p_father_name[k] is null then
                    p_father_name[k] := s_father[i];
                elsif public.normalize_father_name(p_father_name[k]) <> public.normalize_father_name(s_father[i]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'custodian', 'reason', 'father_names_differ')::text;
                end if;
            end if;

            select * into parsed from public.registration_brought_by(item -> 'brought_by', i);
            s_by_name[i] := parsed.name;
            s_by_phone[i] := parsed.phone;
            s_by_rel[i] := parsed.relationship;

            select * into parsed from public.registration_previous_school(item -> 'previous_school', s_class[i], i);
            s_school[i] := parsed.name;
            s_school_type[i] := parsed.school_type;
            s_school_region[i] := parsed.region;
            s_school_unknown[i] := parsed.not_known;

            -- The sibling choice: another student on the form, a lead on
            -- file, or none.
            s_sib_student[i] := null;
            s_sib_lead[i] := null;
            s_not_sibling[i] := coalesce(item -> 'not_a_sibling' = 'true'::jsonb, false);
            if item -> 'sibling_of' is not null and jsonb_typeof(item -> 'sibling_of') <> 'null' then
                if s_not_sibling[i] or jsonb_typeof(item -> 'sibling_of') <> 'object' then
                    raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                end if;
                if item -> 'sibling_of' ? 'student' then
                    begin
                        s_sib_student[i] := (item -> 'sibling_of' ->> 'student')::integer;
                    exception when invalid_text_representation or numeric_value_out_of_range then
                        s_sib_student[i] := null;
                    end;
                    if s_sib_student[i] is null or s_sib_student[i] not between 1 and n or s_sib_student[i] = i then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                else
                    begin
                        s_sib_lead[i] := (item -> 'sibling_of' ->> 'lead_id')::uuid;
                    exception when invalid_text_representation then
                        s_sib_lead[i] := null;
                    end;
                    if s_sib_lead[i] is null then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                    targets := targets || s_sib_lead[i];
                end if;
            end if;
            -- The answers the link may need. The student's own father's
            -- name comes from its name fields, never from here.
            s_choice[i] := jsonb_strip_nulls(jsonb_build_object(
                'sibling_father_full_name', item -> 'sibling_father_full_name',
                'name_answer', item -> 'name_answer',
                'request_note', item -> 'request_note',
                'request_id', item -> 'request_id'
            ));
        end loop;

        for k in 1..np loop
            if not p_used[k] then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person', 'reason', 'unused')::text;
            end if;
            if p_contact[k] is null then
                p_name[k] := coalesce(p_name[k], p_father_name[k]);
                if p_name[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact_name')::text;
                end if;
            else
                existing := existing || p_contact[k];
            end if;
        end loop;

        if exists (select 1 from unnest(s_sib_student) x where x is not null) or cardinality(targets) > 0 then
            if not public.has_permission('leads.edit') then
                raise exception 'not_permitted';
            end if;
        end if;

        -- ------------------------------------------------------------------
        -- Every lock, before the first write.
        -- ------------------------------------------------------------------
        perform public.lock_registration(existing, targets);

        -- The known people's rows, shared, so a correction to their numbers
        -- waits for this form, or this form checks the corrected numbers.
        perform 1 from public.guardian_contacts g where g.id = any (existing) order by g.id for share;
        for k in 1..np loop
            if p_contact[k] is not null then
                select * into contact from public.guardian_contacts g where g.id = p_contact[k];
                if not found then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                p_phone[k] := contact.phone;
                p_whatsapp[k] := contact.whatsapp;
                p_stored_rel[k] := contact.relationship;
                p_stored_desc[k] := contact.relationship_description;
            else
                p_stored_rel[k] := p_rel[k];
                p_stored_desc[k] := p_desc[k];
            end if;
        end loop;

        -- The same student twice on the form: the same name with custodians
        -- sharing any phone, known people included (their stored numbers and
        -- the ones staff typed).
        for i in 2..n loop
            for j in 1..i - 1 loop
                if public.normalize_student_name(s_name[i]) = public.normalize_student_name(s_name[j])
                   and array_remove(
                           array[p_phone[s_person[i]], p_whatsapp[s_person[i]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[i]])), null)
                       && array_remove(
                           array[p_phone[s_person[j]], p_whatsapp[s_person[j]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[j]])), null) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'student_name', 'reason', 'repeated_on_form', 'same_as_student', j)::text;
                end if;
            end loop;
        end loop;

        -- Creations that share a phone number one after the other, in one
        -- order (as create_lead).
        phones := array(
            select distinct p from (
                select unnest(p_phone) as p
                union all select unnest(p_whatsapp)
                union all select jsonb_array_elements_text(e) from unnest(p_extra) e
            ) s where p is not null order by p
        );
        foreach one_phone in array phones loop
            perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
        end loop;

        -- The on-file siblings' rows, in id order.
        perform 1 from public.leads l where l.id = any (targets) order by l.id for update;
        for i in 1..n loop
            if s_sib_lead[i] is not null and not exists (select 1 from public.leads l where l.id = s_sib_lead[i]) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'not_found')::text;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Duplicates: the same name with the same custodian phone, on file
        -- under any status or closure mark (as create_lead).
        -- ------------------------------------------------------------------
        for i in 1..n loop
            k := s_person[i];
            student_phones := array_remove(
                array[p_phone[k], p_whatsapp[k]] || array(select jsonb_array_elements_text(p_extra[k])), null
            );
            select l.* into match
            from public.leads l
            join public.guardian_contacts g on g.id = l.guardian_contact_id
            where l.student_name_key = public.normalize_student_name(s_name[i])
              and (g.phone = any (student_phones) or g.whatsapp = any (student_phones))
            order by l.created_at, l.id
            limit 1;
            if found then
                duplicates := duplicates || jsonb_build_array(jsonb_build_object(
                    'student', i,
                    'lead_id', match.id,
                    'admission_number', match.admission_number,
                    'status', match.status,
                    'closure', match.closure
                ));
            end if;
        end loop;
        if jsonb_array_length(duplicates) > 0 then
            return jsonb_build_object('result', 'duplicate', 'duplicates', duplicates);
        end if;

        -- ------------------------------------------------------------------
        -- Same father, no choice (R8): staff are asked "Sibling of [X]?".
        -- Students linked to each other on the form, directly or through
        -- others, are one set; an on-file lead one of them links to belongs
        -- to that set.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            s_comp[i] := i;
        end loop;
        loop
            changed := false;
            for i in 1..n loop
                j := s_sib_student[i];
                if j is not null and s_comp[i] <> s_comp[j] then
                    s_comp[i] := least(s_comp[i], s_comp[j]);
                    s_comp[j] := s_comp[i];
                    changed := true;
                end if;
            end loop;
            exit when not changed;
        end loop;

        for i in 1..n loop
            if s_sib_student[i] is not null or s_sib_lead[i] is not null or s_not_sibling[i] then
                continue;
            end if;
            for j in 1..n loop
                if j <> i and s_comp[j] <> s_comp[i]
                   and public.normalize_father_name(s_father[j]) = public.normalize_father_name(s_father[i])
                   -- A student that answered Not a sibling settled it. Two
                   -- students with no choice: the later one is asked.
                   and not s_not_sibling[j]
                   and (s_sib_student[j] is not null or s_sib_lead[j] is not null or j < i) then
                    questions := questions || jsonb_build_array(jsonb_build_object(
                        'student', i, 'question', 'same_father', 'other_student', j
                    ));
                    exit;
                end if;
            end loop;
            if exists (select 1 from jsonb_array_elements(questions) q where (q ->> 'student')::integer = i) then
                continue;
            end if;
            select l.* into same_lead
            from public.leads l
            where l.guardian_contact_id = any (existing)
              and l.status <> 'Declined' and l.closure is null
              and public.normalize_father_name(l.father_full_name) = public.normalize_father_name(s_father[i])
              and not exists (
                  select 1 from generate_subscripts(s_sib_lead, 1) x
                  where s_comp[x] = s_comp[i] and s_sib_lead[x] = l.id
              )
            order by l.created_at, l.id
            limit 1;
            if found then
                questions := questions || jsonb_build_array(jsonb_build_object(
                    'student', i, 'question', 'same_father',
                    'other_lead_id', same_lead.id, 'other_admission_number', same_lead.admission_number
                ));
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The writes, in one subtransaction: a question undoes them all.
        -- ------------------------------------------------------------------
        begin
            -- New people.
            for k in 1..np loop
                if p_contact[k] is null then
                    insert into public.guardian_contacts (
                        full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
                    ) values (
                        p_name[k], p_rel[k], p_desc[k], p_phone[k], p_whatsapp[k], 'front_desk', null
                    )
                    returning id into new_id;
                    p_contact[k] := new_id;
                end if;
            end loop;

            -- The students, with no legacy group (S1, R5).
            perform set_config('app.sibling_registration', 'on', true);
            for i in 1..n loop
                k := s_person[i];
                -- ADMSN- and five random digits. The unique constraint
                -- catches a collision and the loop draws again.
                for attempt in 1..20 loop
                    new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
                    begin
                        insert into public.leads (
                            admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                            status, visit_date, guardian_contact_id, returning_family_joined,
                            father_full_name, father_full_name_source,
                            custodian_relationship, custodian_relationship_description, custodian_relationship_own,
                            brought_by_name, brought_by_phone, brought_by_relationship,
                            previous_school_name, previous_school_type, previous_school_region, previous_school_not_known,
                            gender
                        ) values (
                            new_number, s_name[i], s_class[i], s_year[i], s_boarding[i],
                            'Visited', register_students.visited_on, p_contact[k],
                            -- Joining a known Family at the front desk.
                            p_contact[k] = any (existing),
                            s_father[i], 'entered',
                            s_rel[i], s_desc[i],
                            -- Its own when it differs from the person's.
                            (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k]),
                            s_by_name[i], s_by_phone[i], s_by_rel[i],
                            s_school[i], s_school_type[i], s_school_region[i], s_school_unknown[i],
                            s_gender[i]
                        )
                        returning id into new_id;
                        exit;
                    exception when unique_violation then
                        if attempt = 20 then
                            raise exception 'unavailable';
                        end if;
                    end;
                end loop;
                s_lead[i] := new_id;
                s_number[i] := new_number;
                insert into public.sibling_group_members (lead_id, group_id, legacy, cause, sibling_choice_made)
                values (new_id, null, false, 'registration', true);
            end loop;
            perform set_config('app.sibling_registration', '', true);

            -- A link never raises a fee by itself (R38): every member of an
            -- on-file sibling's group holding an automatic 10% keeps it.
            kept := array(
                select m.lead_id
                from public.sibling_group_members m
                join public.lead_sibling_results r on r.lead_id = m.lead_id
                where m.group_id in (
                    select t.group_id from public.sibling_group_members t
                    where t.lead_id = any (targets) and t.group_id is not null
                )
                  and r.result = 'ten' and r.source = 'auto'
            );
            perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

            -- The links: a student after the student it links to, so a
            -- student joins its target's group before anyone joins its own.
            -- A link waiting on an answer holds back the students linked to
            -- it, so they get no question built on a group that may change.
            pending := array(select x from generate_series(1, n) x where s_sib_student[x] is not null or s_sib_lead[x] is not null);
            for i in 1..n loop
                blocked[i] := false;
                s_sibling[i] := null;
            end loop;
            while cardinality(pending) > 0 loop
                progressed := false;
                foreach i in array pending loop
                    j := s_sib_student[i];
                    if j is not null and j = any (pending) then
                        continue;
                    end if;
                    pending := array_remove(pending, i);
                    progressed := true;
                    if j is not null and blocked[j] then
                        blocked[i] := true;
                        continue;
                    end if;
                    target := coalesce(s_lead[j], s_sib_lead[i]);
                    saved := public.save_sibling_choice(s_lead[i], target, s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end loop;
                if not progressed then
                    -- Students linked in a ring: the lowest number goes first.
                    i := (select min(x) from unnest(pending) x);
                    pending := array_remove(pending, i);
                    saved := public.save_sibling_choice(s_lead[i], s_lead[s_sib_student[i]], s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end if;
            end loop;

            if jsonb_array_length(questions) > 0 then
                raise exception using errcode = 'P0114', message = 'registration_questions';
            end if;

            -- Each touched group once, then requests that no longer ask
            -- anything.
            perform public.recompute_sibling_groups_once(touched, 'sibling');
            perform public.withdraw_stale_sibling_requests(array(
                select distinct x from (
                    select unnest(public.sibling_group_leads(g)) as x
                    from unnest(touched) g where g is not null
                    union all select unnest(s_lead)
                ) s
            ));
            perform set_config('app.sibling_keep_ten', '', true);
        exception when sqlstate 'P0114' then
            -- A student on this form is named by its number: its lead was
            -- rolled back with everything else.
            return jsonb_build_object(
                'result', 'questions',
                'questions', (
                    select jsonb_agg(
                        case
                            when x.n is not null then (q - 'sibling_lead_id') || jsonb_build_object('sibling_student', x.n)
                            else q
                        end
                        order by (q ->> 'student')::integer, q ->> 'question')
                    from jsonb_array_elements(questions) q
                    left join lateral (
                        select y as n from generate_subscripts(s_lead, 1) y
                        where s_lead[y]::text = q ->> 'sibling_lead_id'
                    ) x on true
                )
            );
        end;

        for i in 1..n loop
            result_rows := result_rows || jsonb_build_array(jsonb_build_object(
                'student', i,
                'lead_id', s_lead[i],
                'admission_number', s_number[i],
                'sibling', s_sibling[i]
            ));
        end loop;
        return jsonb_build_object('result', 'created', 'students', result_rows);
    end;
    $fn$;

    revoke execute on function public.register_students(date, jsonb, jsonb) from public, anon;
    grant execute on function public.register_students(date, jsonb, jsonb) to authenticated;

    -- complete_admission_visit, as 20261223100100 made it: staff's answer,
    -- or the family's when staff give none.
    create or replace function public.complete_admission_visit(visited_on date, people jsonb, students jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        n integer;
        np integer;
        i integer;
        j integer;
        k integer;
        item jsonb;
        person jsonb;
        -- People, by number.
        p_contact uuid[] := '{}';
        p_known boolean[] := '{}';
        p_name text[] := '{}';
        p_phone text[] := '{}';
        p_whatsapp text[] := '{}';
        p_extra jsonb[] := '{}';
        extra text[];
        p_rel public.guardian_relationship[] := '{}';
        p_desc text[] := '{}';
        p_stored_rel public.guardian_relationship[] := '{}';
        p_stored_desc text[] := '{}';
        p_used boolean[] := '{}';
        p_father_name text[] := '{}';
        -- Students, by number.
        s_lead uuid[] := '{}';
        s_item jsonb[] := '{}';
        s_name text[] := '{}';
        s_father text[] := '{}';
        s_person integer[] := '{}';
        s_rel public.guardian_relationship[] := '{}';
        s_desc text[] := '{}';
        s_by_given boolean[] := '{}';
        s_by_name text[] := '{}';
        s_by_phone text[] := '{}';
        s_by_rel text[] := '{}';
        s_school_given boolean[] := '{}';
        s_school text[] := '{}';
        s_school_type public.previous_school_type[] := '{}';
        s_school_region text[] := '{}';
        s_school_unknown boolean[] := '{}';
        s_gender public.student_gender[] := '{}';
        s_sib_student integer[] := '{}';
        s_sib_lead uuid[] := '{}';
        s_not_sibling boolean[] := '{}';
        s_linked boolean[] := '{}';
        s_choice jsonb[] := '{}';
        s_comp integer[] := '{}';
        s_sibling jsonb[] := '{}';
        s_number text[] := '{}';
        parsed record;
        custodian record;
        lead public.leads;
        member public.sibling_group_members;
        contact public.guardian_contacts;
        targets uuid[] := '{}';
        existing uuid[] := '{}';
        all_leads uuid[];
        submission uuid;
        one_phone text;
        phones text[];
        match public.leads;
        same_lead public.leads;
        duplicates jsonb := '[]';
        questions jsonb := '[]';
        changed boolean;
        new_id uuid;
        kept uuid[];
        touched uuid[] := '{}';
        pending integer[];
        blocked boolean[] := '{}';
        progressed boolean;
        target uuid;
        saved jsonb;
        old_group uuid;
        result_rows jsonb := '[]';
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('visits.record')
           or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;

        if complete_admission_visit.visited_on is null or complete_admission_visit.visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
        if complete_admission_visit.students is null or jsonb_typeof(complete_admission_visit.students) <> 'array'
           or jsonb_array_length(complete_admission_visit.students) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students')::text;
        end if;
        n := jsonb_array_length(complete_admission_visit.students);
        -- One Admission form holds at most 8 children.
        if n > 8 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students', 'reason', 'too_many')::text;
        end if;
        if complete_admission_visit.people is null or jsonb_typeof(complete_admission_visit.people) <> 'array'
           or jsonb_array_length(complete_admission_visit.people) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people')::text;
        end if;
        np := jsonb_array_length(complete_admission_visit.people);
        if np > n then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people', 'reason', 'too_many')::text;
        end if;

        -- ------------------------------------------------------------------
        -- The people, as register_students reads them.
        -- ------------------------------------------------------------------
        for k in 1..np loop
            person := complete_admission_visit.people -> (k - 1);
            if jsonb_typeof(person) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person')::text;
            end if;
            p_used[k] := false;
            p_rel[k] := null;
            p_desc[k] := null;
            p_father_name[k] := null;
            if nullif(person ->> 'contact_id', '') is not null then
                begin
                    p_contact[k] := (person ->> 'contact_id')::uuid;
                exception when invalid_text_representation then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end;
                if p_contact[k] = any (p_contact[1:k - 1]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact', 'reason', 'repeated_on_form')::text;
                end if;
                -- The stored person is kept (S6): nothing typed may replace it.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null
                   or public.name_part(person ->> 'first_name') is not null
                   or public.name_part(person ->> 'middle_name') is not null
                   or public.name_part(person ->> 'last_name') is not null
                   or nullif(btrim(coalesce(person ->> 'phone', '')), '') is not null
                   or nullif(btrim(coalesce(person ->> 'whatsapp', '')), '') is not null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                -- The numbers staff typed for the person they confirmed,
                -- which the stored person may not hold: the duplicate check
                -- covers them too.
                extra := '{}';
                if person -> 'also_check_phones' is not null and jsonb_typeof(person -> 'also_check_phones') <> 'null' then
                    if jsonb_typeof(person -> 'also_check_phones') <> 'array' then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'also_check_phones')::text;
                    end if;
                    extra := array(
                        select x from jsonb_array_elements_text(person -> 'also_check_phones') e, public.normalize_phone(e) x
                        where x is not null
                    );
                end if;
                p_extra[k] := to_jsonb(extra);
                p_known[k] := true;
                p_name[k] := null;
                p_phone[k] := null;
                p_whatsapp[k] := null;
                existing := existing || p_contact[k];
            else
                p_known[k] := false;
                p_extra[k] := '[]';
                p_contact[k] := null;
                -- The name in its three parts (#400). A one-box name is
                -- refused, so no caller stores one by mistake.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact_name', 'reason', 'name_parts')::text;
                end if;
                p_name[k] := public.registration_person_name(person, k);
                p_phone[k] := public.normalize_phone(coalesce(person ->> 'phone', ''));
                if p_phone[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'phone')::text;
                end if;
                p_whatsapp[k] := nullif(btrim(coalesce(person ->> 'whatsapp', '')), '');
                if p_whatsapp[k] is not null then
                    p_whatsapp[k] := public.normalize_phone(p_whatsapp[k]);
                    if p_whatsapp[k] is null then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'whatsapp')::text;
                    end if;
                    if p_whatsapp[k] = p_phone[k] then
                        p_whatsapp[k] := null;
                    end if;
                end if;
                for j in 1..k - 1 loop
                    if not p_known[j]
                       and array[p_phone[k], p_whatsapp[k]] && array_remove(array[p_phone[j], p_whatsapp[j]], null) then
                        raise exception 'invalid'
                            using detail = jsonb_build_object('person', k, 'field', 'phone', 'reason', 'repeated_on_form')::text;
                    end if;
                end loop;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The students: what does not need the stored lead.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            item := complete_admission_visit.students -> (i - 1);
            if jsonb_typeof(item) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'student')::text;
            end if;
            s_item[i] := item;
            begin
                s_lead[i] := (item ->> 'lead_id')::uuid;
            exception when invalid_text_representation then
                s_lead[i] := null;
            end;
            if s_lead[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'lead_id')::text;
            end if;
            if s_lead[i] = any (s_lead[1:i - 1]) then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'repeated_on_form')::text;
            end if;

            select * into parsed from public.registration_name(item, i);
            s_name[i] := parsed.student_name;
            s_father[i] := parsed.father_full_name;

            select * into custodian from public.registration_custodian(item -> 'custodian', i);
            begin
                k := (item -> 'custodian' ->> 'person')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                k := null;
            end;
            if k is null or k not between 1 and np then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'custodian')::text;
            end if;
            s_person[i] := k;
            s_rel[i] := custodian.relationship;
            s_desc[i] := custodian.relationship_description;
            if not p_used[k] then
                p_used[k] := true;
                p_rel[k] := custodian.relationship;
                p_desc[k] := custodian.relationship_description;
            end if;
            -- "The father is the main custodian": a new person with no name
            -- typed takes the father's full name.
            if custodian.father and not p_known[k] and p_name[k] is null then
                if p_father_name[k] is null then
                    p_father_name[k] := s_father[i];
                elsif public.normalize_father_name(p_father_name[k]) <> public.normalize_father_name(s_father[i]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'custodian', 'reason', 'father_names_differ')::text;
                end if;
            end if;

            s_by_given[i] := item -> 'brought_by' is not null and jsonb_typeof(item -> 'brought_by') <> 'null';
            select * into parsed from public.registration_brought_by(item -> 'brought_by', i);
            s_by_name[i] := parsed.name;
            s_by_phone[i] := parsed.phone;
            s_by_rel[i] := parsed.relationship;

            s_sib_student[i] := null;
            s_sib_lead[i] := null;
            s_not_sibling[i] := coalesce(item -> 'not_a_sibling' = 'true'::jsonb, false);
            if item -> 'sibling_of' is not null and jsonb_typeof(item -> 'sibling_of') <> 'null' then
                if s_not_sibling[i] or jsonb_typeof(item -> 'sibling_of') <> 'object' then
                    raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                end if;
                if item -> 'sibling_of' ? 'student' then
                    begin
                        s_sib_student[i] := (item -> 'sibling_of' ->> 'student')::integer;
                    exception when invalid_text_representation or numeric_value_out_of_range then
                        s_sib_student[i] := null;
                    end;
                    if s_sib_student[i] is null or s_sib_student[i] not between 1 and n or s_sib_student[i] = i then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                else
                    begin
                        s_sib_lead[i] := (item -> 'sibling_of' ->> 'lead_id')::uuid;
                    exception when invalid_text_representation then
                        s_sib_lead[i] := null;
                    end;
                    if s_sib_lead[i] is null or s_sib_lead[i] = s_lead[i] then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                end if;
            end if;
            s_choice[i] := jsonb_strip_nulls(jsonb_build_object(
                'sibling_father_full_name', item -> 'sibling_father_full_name',
                'name_answer', item -> 'name_answer',
                'request_note', item -> 'request_note',
                'request_id', item -> 'request_id'
            ));
        end loop;

        -- A lead on file that is another child of this form is that student.
        for i in 1..n loop
            if s_sib_lead[i] is not null then
                j := array_position(s_lead, s_sib_lead[i]);
                if j is not null then
                    s_sib_student[i] := j;
                    s_sib_lead[i] := null;
                else
                    targets := targets || s_sib_lead[i];
                end if;
            end if;
        end loop;

        for k in 1..np loop
            if not p_used[k] then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person', 'reason', 'unused')::text;
            end if;
            if not p_known[k] then
                p_name[k] := coalesce(p_name[k], p_father_name[k]);
                if p_name[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact_name')::text;
                end if;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Every lock, before the first write.
        -- ------------------------------------------------------------------
        all_leads := array(select distinct x from unnest(s_lead || targets) x order by 1);
        perform public.lock_registration(existing, all_leads);

        perform 1 from public.guardian_contacts g where g.id = any (existing) order by g.id for share;
        for k in 1..np loop
            if p_known[k] then
                select * into contact from public.guardian_contacts g where g.id = p_contact[k];
                if not found then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                if contact.pending_family_match_id is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'family_match')::text;
                end if;
                p_phone[k] := contact.phone;
                p_whatsapp[k] := contact.whatsapp;
                p_stored_rel[k] := contact.relationship;
                p_stored_desc[k] := contact.relationship_description;
            else
                p_stored_rel[k] := p_rel[k];
                p_stored_desc[k] := p_desc[k];
            end if;
        end loop;

        -- The same student twice on the form: the same name with custodians
        -- sharing any phone, known people included.
        for i in 2..n loop
            for j in 1..i - 1 loop
                if public.normalize_student_name(s_name[i]) = public.normalize_student_name(s_name[j])
                   and array_remove(
                           array[p_phone[s_person[i]], p_whatsapp[s_person[i]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[i]])), null)
                       && array_remove(
                           array[p_phone[s_person[j]], p_whatsapp[s_person[j]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[j]])), null) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'student_name', 'reason', 'repeated_on_form', 'same_as_student', j)::text;
                end if;
            end loop;
        end loop;

        phones := array(
            select distinct p from (
                select unnest(p_phone) as p
                union all select unnest(p_whatsapp)
                union all select jsonb_array_elements_text(e) from unnest(p_extra) e
            ) s where p is not null order by p
        );
        foreach one_phone in array phones loop
            perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
        end loop;

        perform 1 from public.leads l where l.id = any (all_leads) order by l.id for update;

        -- ------------------------------------------------------------------
        -- The stored leads: one submission's Applied children.
        -- ------------------------------------------------------------------
        select s.submission_key into submission
        from public.admission_submissions s
        cross join lateral jsonb_each(s.outcomes) o
        where o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = s_lead[1]::text
        limit 1;
        if submission is null then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', 1, 'field', 'lead_id', 'reason', 'not_admission_form')::text;
        end if;

        for i in 1..n loop
            select * into lead from public.leads l where l.id = s_lead[i];
            if not found then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'not_found')::text;
            end if;
            if not exists (
                select 1 from public.admission_submissions s cross join lateral jsonb_each(s.outcomes) o
                where s.submission_key = submission
                  and o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = s_lead[i]::text
            ) then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'other_submission')::text;
            end if;
            if lead.closure is not null or lead.status = 'Declined' then
                raise exception 'lead_closed' using detail = jsonb_build_object('student', i)::text;
            end if;
            if lead.status <> 'Applied' then
                raise exception 'not_applied' using detail = jsonb_build_object('student', i)::text;
            end if;
            if exists (
                select 1 from public.guardian_contacts g
                where g.id = lead.guardian_contact_id and g.pending_family_match_id is not null
            ) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'family_match')::text;
            end if;
            s_number[i] := lead.admission_number;

            -- The previous school: what staff give, or what the lead holds.
            item := s_item[i];
            s_school_given[i] := (item -> 'previous_school' is not null and jsonb_typeof(item -> 'previous_school') <> 'null')
                or not (lead.previous_school_name is not null or lead.previous_school_not_known);
            if s_school_given[i] then
                select * into parsed from public.registration_previous_school(item -> 'previous_school', lead.class_name, i);
                s_school[i] := parsed.name;
                s_school_type[i] := parsed.school_type;
                s_school_region[i] := parsed.region;
                s_school_unknown[i] := parsed.not_known;
            end if;

            -- Boy or girl: what staff give, or what the family gave.
            s_gender[i] := public.student_gender_of(item -> 'gender', i);

            -- A child linked before check-in keeps its link (rule 5).
            select * into member from public.sibling_group_members m where m.lead_id = lead.id;
            s_linked[i] := member.group_id is not null and not member.legacy;
            if s_linked[i] and s_not_sibling[i] then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'already_linked')::text;
            end if;
            if s_linked[i] and member.basis in ('matched', 'typo_confirmed')
               and public.father_name_match(lead.father_full_name, s_father[i]) is distinct from 'same' then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'father_full_name', 'reason', 'linked_member')::text;
            end if;
        end loop;

        for i in 1..n loop
            if s_sib_lead[i] is not null and not exists (select 1 from public.leads l where l.id = s_sib_lead[i]) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'not_found')::text;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Duplicates: a corrected name, the new custodian's phones, or a number
        -- staff typed for the person they confirmed.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            k := s_person[i];
            select * into lead from public.leads l where l.id = s_lead[i];
            if public.normalize_student_name(s_name[i]) <> lead.student_name_key
               or p_contact[k] is distinct from lead.guardian_contact_id
               or jsonb_array_length(p_extra[k]) > 0 then
                match := public.find_duplicate_lead(
                    public.normalize_student_name(s_name[i]),
                    array_remove(array[p_phone[k], p_whatsapp[k]] || array(select jsonb_array_elements_text(p_extra[k])), null),
                    lead.id
                );
                if match.id is not null then
                    duplicates := duplicates || jsonb_build_array(jsonb_build_object(
                        'student', i,
                        'lead_id', match.id,
                        'admission_number', match.admission_number,
                        'status', match.status,
                        'closure', match.closure
                    ));
                end if;
            end if;
        end loop;
        if jsonb_array_length(duplicates) > 0 then
            return jsonb_build_object('result', 'duplicate', 'duplicates', duplicates);
        end if;

        -- ------------------------------------------------------------------
        -- Same father, no choice (R8), as register_students asks it. The
        -- children on file are those of every contact the form's children
        -- sit on or move to.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            s_comp[i] := i;
        end loop;
        loop
            changed := false;
            for i in 1..n loop
                j := s_sib_student[i];
                if j is not null and s_comp[i] <> s_comp[j] then
                    s_comp[i] := least(s_comp[i], s_comp[j]);
                    s_comp[j] := s_comp[i];
                    changed := true;
                end if;
            end loop;
            exit when not changed;
        end loop;

        for i in 1..n loop
            if s_sib_student[i] is not null or s_sib_lead[i] is not null or s_not_sibling[i] or s_linked[i] then
                continue;
            end if;
            for j in 1..n loop
                if j <> i and s_comp[j] <> s_comp[i]
                   and public.normalize_father_name(s_father[j]) = public.normalize_father_name(s_father[i])
                   and not s_not_sibling[j]
                   and (s_sib_student[j] is not null or s_sib_lead[j] is not null or s_linked[j] or j < i) then
                    questions := questions || jsonb_build_array(jsonb_build_object(
                        'student', i, 'question', 'same_father', 'other_student', j
                    ));
                    exit;
                end if;
            end loop;
            if exists (select 1 from jsonb_array_elements(questions) q where (q ->> 'student')::integer = i) then
                continue;
            end if;
            select l.* into same_lead
            from public.leads l
            where l.guardian_contact_id in (
                      select x from unnest(existing) x
                      union select l2.guardian_contact_id from public.leads l2 where l2.id = any (s_lead)
                  )
              and l.id <> all (s_lead)
              and l.status <> 'Declined' and l.closure is null
              and public.normalize_father_name(l.father_full_name) = public.normalize_father_name(s_father[i])
              and not exists (
                  select 1 from generate_subscripts(s_sib_lead, 1) x
                  where s_comp[x] = s_comp[i] and s_sib_lead[x] = l.id
              )
            order by l.created_at, l.id
            limit 1;
            if found then
                questions := questions || jsonb_build_array(jsonb_build_object(
                    'student', i, 'question', 'same_father',
                    'other_lead_id', same_lead.id, 'other_admission_number', same_lead.admission_number
                ));
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The writes, in one subtransaction: a question undoes them all.
        -- ------------------------------------------------------------------
        begin
            for k in 1..np loop
                if not p_known[k] then
                    insert into public.guardian_contacts (
                        full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
                    ) values (
                        p_name[k], p_rel[k], p_desc[k], p_phone[k], p_whatsapp[k], 'front_desk', null
                    )
                    returning id into new_id;
                    p_contact[k] := new_id;
                end if;
            end loop;

            -- Never a fee raise (R38): every automatic 10% in a group this
            -- call reaches, and each child's own, is kept.
            kept := array(
                select r.lead_id
                from public.lead_sibling_results r
                where r.result = 'ten' and r.source = 'auto'
                  and (
                      r.lead_id = any (s_lead)
                      or exists (
                          select 1 from public.sibling_group_members m
                          join public.sibling_groups g on g.id = m.group_id
                          where m.lead_id = r.lead_id
                            and (
                                g.contact_ids && (existing || array(
                                    select l.guardian_contact_id from public.leads l where l.id = any (all_leads)
                                ))
                                or g.id in (
                                    select t.group_id from public.sibling_group_members t
                                    where t.lead_id = any (all_leads) and t.group_id is not null
                                )
                            )
                      )
                  )
            );
            perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

            -- Each child's choice is made here: it never joins a Family's
            -- legacy group again.
            for i in 1..n loop
                insert into public.sibling_group_members as m (lead_id, group_id, legacy, cause, sibling_choice_made)
                values (s_lead[i], null, false, 'visit_completion', true)
                on conflict on constraint sibling_group_members_lead_id_key do update
                set sibling_choice_made = true,
                    updated_at = now()
                where not m.sibling_choice_made;
            end loop;

            -- The details staff confirmed or completed, and the visit.
            for i in 1..n loop
                select * into lead from public.leads l where l.id = s_lead[i];
                update public.leads l
                set student_name = s_name[i],
                    father_full_name = s_father[i],
                    father_full_name_source = case
                        when s_father[i] is not distinct from lead.father_full_name
                             and lead.father_full_name_source in ('edited', 'typo_confirmed')
                            then lead.father_full_name_source
                        else 'entered'
                    end,
                    brought_by_name = case when s_by_given[i] then s_by_name[i] else l.brought_by_name end,
                    brought_by_phone = case when s_by_given[i] then s_by_phone[i] else l.brought_by_phone end,
                    brought_by_relationship = case when s_by_given[i] then s_by_rel[i] else l.brought_by_relationship end,
                    previous_school_name = case when s_school_given[i] then s_school[i] else l.previous_school_name end,
                    previous_school_type = case when s_school_given[i] then s_school_type[i] else l.previous_school_type end,
                    previous_school_region = case when s_school_given[i] then s_school_region[i] else l.previous_school_region end,
                    previous_school_not_known = case when s_school_given[i] then s_school_unknown[i] else l.previous_school_not_known end,
                    gender = coalesce(s_gender[i], l.gender),
                    status = 'Visited',
                    visit_date = complete_admission_visit.visited_on
                where l.id = s_lead[i];
            end loop;

            -- Every child leaves its Family's legacy group before any link,
            -- so the links alone make the groups: two pairs of siblings on
            -- one form make two groups, and a child left out of the check-in
            -- stays legacy in the old one, outside them.
            for i in 1..n loop
                select * into member from public.sibling_group_members m where m.lead_id = s_lead[i];
                if member.legacy and member.group_id is not null then
                    touched := touched || member.group_id;
                    perform public.leave_legacy_sibling_group(s_lead[i], 'visit_completion');
                    perform public.refresh_sibling_group_contacts(member.group_id);
                end if;
            end loop;

            -- The custodians, before any link. The move's trigger leaves
            -- its recomputes to the final pass below (a child linked before
            -- check-in keeps its group through the move), so no group is
            -- recomputed before every link is made.
            perform set_config('app.sibling_defer_contact_recompute', 'on', true);
            for i in 1..n loop
                k := s_person[i];
                select * into lead from public.leads l where l.id = s_lead[i];
                if lead.guardian_contact_id is distinct from p_contact[k] then
                    old_group := public.lead_sibling_group(lead.id);
                    touched := touched || old_group;
                    update public.leads l
                    set guardian_contact_id = p_contact[k],
                        -- Joining a known Family at the front desk.
                        returning_family_joined = p_known[k]
                    where l.id = lead.id;
                    -- The group the move left the child in, should it differ.
                    touched := touched || public.lead_sibling_group(lead.id);
                end if;
                -- Its own relationship when it differs from the person's.
                update public.leads l
                set custodian_relationship = s_rel[i],
                    custodian_relationship_description = s_desc[i],
                    custodian_relationship_own = (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k])
                where l.id = lead.id
                  and (l.custodian_relationship, l.custodian_relationship_description, l.custodian_relationship_own)
                      is distinct from (s_rel[i], s_desc[i], (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k]));
            end loop;
            perform set_config('app.sibling_defer_contact_recompute', '', true);

            -- The links, as register_students makes them: a student after
            -- the student it links to.
            pending := array(select x from generate_series(1, n) x where s_sib_student[x] is not null or s_sib_lead[x] is not null);
            for i in 1..n loop
                blocked[i] := false;
                s_sibling[i] := null;
            end loop;
            while cardinality(pending) > 0 loop
                progressed := false;
                foreach i in array pending loop
                    j := s_sib_student[i];
                    if j is not null and j = any (pending) then
                        continue;
                    end if;
                    pending := array_remove(pending, i);
                    progressed := true;
                    if j is not null and blocked[j] then
                        blocked[i] := true;
                        continue;
                    end if;
                    target := coalesce(s_lead[j], s_sib_lead[i]);
                    saved := public.save_sibling_choice(s_lead[i], target, s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end loop;
                if not progressed then
                    -- Students linked in a ring: the lowest number goes first.
                    i := (select min(x) from unnest(pending) x);
                    pending := array_remove(pending, i);
                    saved := public.save_sibling_choice(s_lead[i], s_lead[s_sib_student[i]], s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end if;
            end loop;

            if jsonb_array_length(questions) > 0 then
                raise exception using errcode = 'P0114', message = 'registration_questions';
            end if;

            -- Each touched group once, then each child's own result, then
            -- requests that no longer ask anything.
            perform public.recompute_sibling_groups_once(touched, 'sibling');
            for i in 1..n loop
                perform public.recompute_lead_fee(s_lead[i], 'sibling');
            end loop;
            perform public.withdraw_stale_sibling_requests(array(
                select distinct x from (
                    select unnest(public.sibling_group_leads(g)) as x
                    from unnest(touched) g where g is not null
                    union all select unnest(s_lead)
                ) s
            ));
            perform set_config('app.sibling_keep_ten', '', true);
        exception when sqlstate 'P0114' then
            return jsonb_build_object(
                'result', 'questions',
                -- Another child of this form is named by its number.
                'questions', (
                    select jsonb_agg(
                        case
                            when x.n is not null then (q - 'sibling_lead_id') || jsonb_build_object('sibling_student', x.n)
                            else q
                        end
                        order by (q ->> 'student')::integer, q ->> 'question')
                    from jsonb_array_elements(questions) q
                    left join lateral (
                        select y as n from generate_subscripts(s_lead, 1) y
                        where s_lead[y]::text = q ->> 'sibling_lead_id'
                    ) x on true
                )
            );
        end;

        for i in 1..n loop
            result_rows := result_rows || jsonb_build_array(jsonb_build_object(
                'student', i,
                'lead_id', s_lead[i],
                'admission_number', s_number[i],
                'sibling', s_sibling[i]
            ));
        end loop;
        return jsonb_build_object('result', 'completed', 'students', result_rows);
    end;
    $fn$;

    revoke execute on function public.complete_admission_visit(date, jsonb, jsonb) from public, anon;
    grant execute on function public.complete_admission_visit(date, jsonb, jsonb) to authenticated;

    -- update_lead_details, as 20261214100200 made it, correcting the answer.
    create or replace function public.update_lead_details(lead_id uuid, changes jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        lead public.leads;
        contact public.guardian_contacts;
        pupil_name text;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        student_gender public.student_gender;
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
        father_name text;
        father_source public.father_name_source;
        effective_father text;
        father_answer text;
        father_spelling text;
        member public.sibling_group_members;
        check_verdict text;
        check_other_lead uuid;
        check_other_name text;
        typo_replaced text;
        typo_mode boolean := false;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;

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

        -- Boy or girl: staff may give or correct it, never clear it.
        student_gender := lead.gender;
        if changes ? 'gender' then
            student_gender := public.student_gender_of(changes -> 'gender', null);
            if student_gender is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'gender')::text;
            end if;
        end if;

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

        -- The father's full name (#301). Left out, it stays, or follows a
        -- corrected student name while it was derived or backfilled (the
        -- derive trigger does that on the update below).
        father_name := lead.father_full_name;
        father_source := lead.father_full_name_source;
        if changes ? 'father_full_name' then
            father_name := public.clean_father_name(changes ->> 'father_full_name');
            if father_name is null or char_length(father_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            father_source := case
                when father_name is not distinct from lead.father_full_name
                     and lead.father_full_name_source in ('edited', 'typo_confirmed')
                    then lead.father_full_name_source
                else 'edited'
            end;
            effective_father := father_name;
        elsif pupil_name is distinct from lead.student_name and lead.father_full_name_source in ('derived', 'backfilled') then
            effective_father := public.derive_father_full_name(pupil_name);
        else
            effective_father := lead.father_full_name;
        end if;

        father_answer := nullif(btrim(coalesce(changes ->> 'father_name_answer', '')), '');
        if father_answer is not null and father_answer not in ('typo', 'different') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_answer')::text;
        end if;

        -- A new name must not make this child a duplicate of another lead, a
        -- brother or sister on the same contact included.
        if public.normalize_student_name(pupil_name) <> lead.student_name_key then
            select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;
            phones := array[contact.phone, contact.whatsapp];
            perform public.lock_lead_phones(phones);
            match := public.find_duplicate_lead(public.normalize_student_name(pupil_name), phones, lead.id);
            if match.id is not null then
                return public.duplicate_result(match);
            end if;
        end if;

        -- A member that counts by its name, about to get a name close to its
        -- group's: the typing-mistake question first (S5, R36).
        select * into member from public.sibling_group_members m where m.lead_id = lead.id;
        if member.group_id is not null and not member.legacy and member.basis in ('matched', 'typo_confirmed')
           and public.father_name_match(lead.father_full_name, effective_father) is distinct from 'same' then
            select c.verdict, c.other_lead_id, c.other_name into check_verdict, check_other_lead, check_other_name
            from public.sibling_name_check(lead.id, effective_father, member.group_id) c;
        end if;
        if check_verdict = 'close' then
            if father_answer is null then
                raise exception 'father_name_question' using detail = jsonb_build_object(
                    'father_full_name', effective_father,
                    'sibling_lead_id', check_other_lead,
                    'sibling_father_full_name', check_other_name
                )::text;
            elsif father_answer = 'typo' then
                father_spelling := public.clean_father_name(changes ->> 'father_name_spelling');
                if father_spelling is null
                   or not (public.father_name_match(father_spelling, effective_father) = 'same'
                           or public.father_name_match(father_spelling, check_other_name) = 'same') then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_spelling')::text;
                end if;
                typo_replaced := case when public.father_name_match(father_spelling, effective_father) = 'same'
                                      then check_other_name else effective_father end;
                father_name := father_spelling;
                father_source := 'typo_confirmed';
                typo_mode := true;
            end if;
        elsif father_answer is not null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_answer')::text;
        end if;

        if typo_mode then
            perform set_config('app.sibling_typo_group', member.group_id::text, true);
        end if;

        update public.leads l
        set student_name = pupil_name,
            class_name = student_class,
            enrollment_year = student_year,
            day_or_boarding = student_boarding,
            gender = student_gender,
            brought_by_name = brought_name,
            brought_by_phone = brought_phone,
            brought_by_relationship = brought_relationship,
            previous_school_name = school_name,
            previous_school_type = school_type,
            previous_school_region = school_region,
            previous_school_not_known = school_not_known,
            father_full_name = father_name,
            father_full_name_source = father_source
        where l.id = lead.id;

        if typo_mode then
            perform public.write_typo_spelling(member.group_id, father_spelling, typo_replaced);
            update public.sibling_group_members m
            set basis = 'typo_confirmed', cause = 'father_name', updated_at = now()
            where m.id = member.id and m.basis is distinct from 'typo_confirmed';
        end if;

        return jsonb_build_object('result', 'updated');
    end;
    $fn$;

    revoke execute on function public.update_lead_details(uuid, jsonb) from public, anon;
    grant execute on function public.update_lead_details(uuid, jsonb) to authenticated;
end;
$migration$;
