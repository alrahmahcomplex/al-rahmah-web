-- The Admission form family of one lead, for check-in (#309): the children
-- one Admission form submission created, the parent that form gave, and the
-- other children on file with that parent, which check-in offers as "Sibling
-- of" choices. complete_admission_visit (#305) saves what check-in collects;
-- this reads what the form already gave, so staff are asked only the rest.
--
-- admission_form_family(lead_id) returns one of:
--   {"result": "not_found"}           no such lead.
--   {"result": "not_admission_form"}  no Admission form submission created it.
--   {"result": "family", "sent_on", "contact", "children", "on_file"}
--       sent_on   the day the form was sent, in Tanzania.
--       contact   the parent the form gave (id, full_name, relationship,
--                 relationship_description, phone, whatsapp, and
--                 family_match: a Family match waits on it), or null.
--       children  every child the form created, in the form's order, with
--                 what the lead holds now: names, Boy or girl, class, year,
--                 Day or Boarding, status, closure, previous school, who
--                 brought them, and `linked`, true when the child is already
--                 in a sibling group outside the old family rule.
--       on_file   the parent's other children, open or not, each with its
--                 father's name.
--
-- Needs leads.view, which every table it reads asks of staff. It is security
-- definer because no API role reads admission_submissions. Anyone else,
-- agents included, is refused with `not_permitted`. It writes nothing.

create function public.admission_form_family(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
    submission public.admission_submissions;
    found_lead boolean;
    child_ids uuid[];
    contact public.guardian_contacts;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select exists (select 1 from public.leads l where l.id = admission_form_family.lead_id) into found_lead;
    if not found_lead then
        return jsonb_build_object('result', 'not_found');
    end if;

    select s.* into submission
    from public.admission_submissions s
    cross join lateral jsonb_each(s.outcomes) o
    where o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = admission_form_family.lead_id::text
    order by s.created_at
    limit 1;
    if submission.submission_key is null then
        return jsonb_build_object('result', 'not_admission_form');
    end if;

    child_ids := array(
        select (o.value ->> 'lead_id')::uuid
        from jsonb_each(submission.outcomes) o
        where o.value ->> 'result' = 'created'
        order by (o.key)::integer
    );

    select g.* into contact from public.guardian_contacts g where g.id = submission.contact_id;

    return jsonb_build_object(
        'result', 'family',
        'sent_on', (submission.created_at at time zone 'Africa/Dar_es_Salaam')::date,
        'contact', case when contact.id is null then null else jsonb_build_object(
            'id', contact.id,
            'full_name', contact.full_name,
            'relationship', contact.relationship,
            'relationship_description', contact.relationship_description,
            'phone', contact.phone,
            'whatsapp', contact.whatsapp,
            'family_match', contact.pending_family_match_id is not null
        ) end,
        'children', coalesce((
            select jsonb_agg(jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'father_full_name', l.father_full_name,
                'gender', l.gender,
                'class_name', l.class_name,
                'enrollment_year', l.enrollment_year,
                'day_or_boarding', l.day_or_boarding,
                'status', l.status,
                'closure', l.closure,
                'previous_school_name', l.previous_school_name,
                'previous_school_type', l.previous_school_type,
                'previous_school_region', l.previous_school_region,
                'previous_school_not_known', l.previous_school_not_known,
                'brought_by_name', l.brought_by_name,
                'linked', exists (
                    select 1 from public.sibling_group_members m
                    where m.lead_id = l.id and m.group_id is not null and not m.legacy
                )
            ) order by x.position)
            from unnest(child_ids) with ordinality as x (id, position)
            join public.leads l on l.id = x.id
        ), '[]'::jsonb),
        'on_file', coalesce((
            select jsonb_agg(jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'status', l.status,
                'closure', l.closure,
                'father_full_name', l.father_full_name
            ) order by l.created_at, l.id)
            from public.leads l
            where contact.id is not null
              and l.guardian_contact_id = contact.id
              and l.id <> all (child_ids)
        ), '[]'::jsonb)
    );
end;
$fn$;

revoke execute on function public.admission_form_family(uuid) from public, anon;
grant execute on function public.admission_form_family(uuid) to authenticated;
