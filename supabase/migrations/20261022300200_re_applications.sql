-- Re-applications (slice 3, #76). When the Admission form names a child who
-- is already on file (create_lead's `duplicate`), the parent sees the same
-- confirmation as for a new child, with that lead's Admission Number, and no
-- second lead is made. The submission is kept on the matched lead as a
-- Re-application, for staff to review (#77, #78), and the lead is flagged
-- Returning family through its re-applied cause.
--
-- A re-application never changes the lead's details, status or closure mark.
-- It works the same on a lead of any status or closure mark, so the closed
-- lead guard gains one narrow path, `re_application`, that lets a closed lead
-- take the re-applied cause and nothing else.
--
-- Re-applications are lead data, audited under ADR 4's `lead` scope. Staff
-- with leads.view read them; nobody writes them through the API. They are
-- written by record_re_application, which only the secret key may call, and
-- reviewed (#77) through a function of their own.

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.re_applications (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    -- The Admission form's submission key, so one send is recorded once.
    submission_key uuid not null,
    received_at timestamptz not null default now(),
    -- The parent or guardian as submitted. The numbers as the parent typed
    -- them, and as the database normalized them (a WhatsApp number equal to
    -- the phone is stored as none, as on a contact).
    contact_name text not null check (btrim(contact_name) <> ''),
    relationship public.guardian_relationship not null,
    relationship_description text,
    phone_as_sent text not null,
    whatsapp_as_sent text,
    phone text not null check (phone = public.normalize_phone(phone)),
    whatsapp text check (whatsapp = public.normalize_phone(whatsapp)),
    -- The child as submitted.
    student_name text not null check (btrim(student_name) <> ''),
    class_name public.lead_class not null,
    enrollment_year integer not null check (enrollment_year between 2000 and 2100),
    day_or_boarding public.day_or_boarding not null,
    -- The fields that differed from the lead and its contact on arrival, by
    -- the Admission form's field names: student_name, class_name,
    -- enrollment_year, day_or_boarding, contact_name, relationship,
    -- relationship_description, phone, whatsapp.
    differing_fields text[] not null default '{}',
    -- Set together when staff review it (#77).
    reviewed_at timestamptz,
    reviewed_by uuid references public.staff_members (id),
    constraint re_applications_once_per_submission unique (lead_id, submission_key),
    constraint re_applications_relationship_check
        check ((relationship = 'Other') = (relationship_description is not null)),
    constraint re_applications_description_check
        check (relationship_description is null or btrim(relationship_description) <> ''),
    constraint re_applications_review_check check ((reviewed_at is null) = (reviewed_by is null)),
    constraint re_applications_differing_fields_check check (
        differing_fields <@ array[
            'student_name', 'class_name', 'enrollment_year', 'day_or_boarding',
            'contact_name', 'relationship', 'relationship_description', 'phone', 'whatsapp'
        ]::text[]
    )
);

create index re_applications_lead_received_idx on public.re_applications (lead_id, received_at desc);
create index re_applications_reviewed_by_idx on public.re_applications (reviewed_by) where reviewed_by is not null;

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.re_applications', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.re_applications
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.re_applications
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.re_applications
    for each statement
    execute function public.refuse_delete();

alter table public.re_applications enable row level security;

create policy "Staff who may view leads read re-applications"
    on public.re_applications for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.re_applications from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The closed lead guard, as in 20261013800000_closed_lead_read_only.sql, with
-- one more path. `re_application` lets a closed lead take the re-applied
-- cause of its Returning family badge, and refuses any other change, so a
-- re-application can flag an Archived or Declined lead without reopening it.
-- ---------------------------------------------------------------------------

create or replace function public.set_lead_lifecycle_override(path text)
returns void
language plpgsql
set search_path = ''
as $$
begin
    if path is null or path not in ('close', 'reopen', 'payment_recompute', 're_application') then
        raise exception 'invalid';
    end if;
    -- Transaction-local: it ends with the transaction that set it.
    perform set_config('app.lead_lifecycle_override', path, true);
end;
$$;

revoke execute on function public.set_lead_lifecycle_override(text) from public, anon, authenticated, service_role;

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
       ) then
        raise exception 'lead_closed';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_closed_lead_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_re_application(lead_id, submission_key, submitted): records one
-- Admission form child that matched the lead, and returns the
-- re-application's id. `submitted` holds `contact` and `student`, in the
-- shapes create_lead takes as new_contact and student_details.
--
--   - Sets the Admission form as the actor, for this transaction.
--   - Checks the submitted details as create_lead does: `invalid` with the
--     field. `not_found` for a lead that does not exist.
--   - The same lead and submission key a second time returns the first
--     re-application and writes nothing.
--   - Computes the differing fields against the lead and its contact as they
--     stand, with the lead held, so a correction running alongside finishes
--     first or waits.
--   - Sets the lead's re-applied cause, which stays once set. Nothing else on
--     the lead changes, whatever its status or closure mark.
--
-- Executable only by the secret key: submit_admission_form_child calls it.
-- ---------------------------------------------------------------------------

create function public.record_re_application(lead_id uuid, submission_key uuid, submitted jsonb)
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

    insert into public.re_applications (
        lead_id, submission_key, contact_name, relationship, relationship_description,
        phone_as_sent, whatsapp_as_sent, phone, whatsapp,
        student_name, class_name, enrollment_year, day_or_boarding, differing_fields
    ) values (
        lead.id, record_re_application.submission_key, contact_name, contact_relationship, contact_description,
        phone_as_sent, whatsapp_as_sent, contact_phone, contact_whatsapp,
        pupil_name, student_class, student_year, student_boarding, differing
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

-- ---------------------------------------------------------------------------
-- submit_admission_form_child, as in 20261010300100_admission_submissions.sql,
-- but a child already on file is recorded as a Re-application on the lead it
-- matched, and its outcome stored under the submission key like a created
-- child's: `re_applied`, with the lead's id and Admission Number. A retry
-- replays it and records nothing more, and a re-application counts as a
-- created child for an edited retry. The submission's contact stays the one
-- its first new child makes: a matched child leaves it alone.
--
-- A child that matches a lead this same submission created is the form
-- naming one child twice, refused as `invalid` with `duplicate_child`.
-- ---------------------------------------------------------------------------

create or replace function public.submit_admission_form_child(
    submission_key uuid,
    payload_hash text,
    child_count integer,
    child_index integer,
    new_contact jsonb,
    student_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    submission public.admission_submissions;
    stored jsonb;
    created jsonb;
    outcome jsonb;
    created_contact uuid;
    re_application_id uuid;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    if submit_admission_form_child.submission_key is null
       or submit_admission_form_child.payload_hash is null
       or submit_admission_form_child.payload_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'submission_key')::text;
    end if;
    if submit_admission_form_child.child_count is null or submit_admission_form_child.child_count not between 1 and 8
       or child_index is null or child_index not between 0 and submit_admission_form_child.child_count - 1 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'children')::text;
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended('admission-submission:' || submit_admission_form_child.submission_key::text, 0)
    );

    insert into public.admission_submissions (submission_key, payload_hash, child_count)
    values (
        submit_admission_form_child.submission_key,
        submit_admission_form_child.payload_hash,
        submit_admission_form_child.child_count
    )
    on conflict on constraint admission_submissions_pkey do nothing;

    select * into submission
    from public.admission_submissions s
    where s.submission_key = submit_admission_form_child.submission_key;

    if submission.payload_hash <> submit_admission_form_child.payload_hash then
        if submission.outcomes = '{}'::jsonb then
            update public.admission_submissions s
            set payload_hash = submit_admission_form_child.payload_hash,
                child_count = submit_admission_form_child.child_count,
                updated_at = now()
            where s.submission_key = submit_admission_form_child.submission_key;
        else
            raise exception 'submission_key_reused' using detail = jsonb_build_object(
                'complete', (select count(*) from jsonb_object_keys(submission.outcomes)) = submission.child_count,
                'children', (
                    select jsonb_agg(
                        jsonb_build_object('full_name', o.value ->> 'full_name', 'admission_number', o.value ->> 'admission_number')
                        order by o.key::integer
                    )
                    from jsonb_each(submission.outcomes) o
                )
            )::text;
        end if;
    end if;

    stored := submission.outcomes -> child_index::text;
    if stored is not null then
        return stored || jsonb_build_object('replayed', true);
    end if;

    -- create_lead sets the Admission form as the actor itself.
    created := public.create_lead(
        'admission_form',
        submission.contact_id,
        case when submission.contact_id is null then new_contact end,
        student_details
    );

    if created ->> 'result' = 'created' then
        if submission.contact_id is null then
            select l.guardian_contact_id into created_contact
            from public.leads l
            where l.id = (created ->> 'lead_id')::uuid;
        end if;
        outcome := created;
    elsif created ->> 'result' = 'duplicate' then
        if exists (
            select 1 from jsonb_each(submission.outcomes) o
            where o.value ->> 'lead_id' = created ->> 'lead_id'
        ) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'duplicate_child')::text;
        end if;
        re_application_id := public.record_re_application(
            (created ->> 'lead_id')::uuid,
            submit_admission_form_child.submission_key,
            jsonb_build_object('contact', new_contact, 'student', student_details)
        );
        outcome := jsonb_build_object(
            'result', 're_applied',
            'lead_id', created ->> 'lead_id',
            'admission_number', created ->> 'admission_number',
            're_application_id', re_application_id
        );
    else
        return created;
    end if;

    update public.admission_submissions s
    set outcomes = s.outcomes || jsonb_build_object(
            child_index::text,
            outcome || jsonb_build_object('full_name', student_details ->> 'full_name')
        ),
        contact_id = coalesce(s.contact_id, created_contact),
        updated_at = now()
    where s.submission_key = submit_admission_form_child.submission_key;

    return outcome || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.submit_admission_form_child(uuid, text, integer, integer, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.submit_admission_form_child(uuid, text, integer, integer, jsonb, jsonb) to service_role;
