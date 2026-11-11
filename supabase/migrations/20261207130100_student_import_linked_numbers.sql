-- #284: the same child under two parent numbers a sibling row links was
-- imported twice.
--
-- Rows in one file that share a parent phone share one new contact, the
-- first row's (confirm_student_import), so a row's application is stored
-- under its phone and the first row's WhatsApp. The duplicate check and the
-- on-file match compared each row's own numbers only, so in
--
--     row 2  Baraka  phone A  WhatsApp B
--     row 3  Asha    phone A
--     row 4  Asha    phone B
--
-- rows 3 and 4 shared no number, both passed, and the two Asha applications
-- ended on contacts overlapping on B.
--
-- A row's parent numbers are now its own phone and WhatsApp plus the
-- WhatsApp of every row with the same phone. student_import_rows refuses two
-- rows with the same name key and a parent number in common, and
-- student_import_verdicts matches a student on file on those numbers. The
-- parser (screenStudentRows in lib/student-import.ts) compares the same
-- numbers, so it never passes a file this refuses. Both functions are as
-- 20261204130500_student_import.sql made them otherwise.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- student_import_rows: the rows the app sends, read and re-checked. Each row
-- is an object with sheet_row, student_name, class_name, pre_form_one,
-- enrollment_year, day_or_boarding, guardian_name, relationship,
-- relationship_description, phone, whatsapp, visit_date, referral_code and
-- status, every value already as the database stores it. A row whose value
-- isn't is returned with `refused` and the field; a sheet row or a student
-- two rows share is `invalid` for the whole call, since the file's own
-- checks refuse those first. Internal.
-- ---------------------------------------------------------------------------

create or replace function public.student_import_rows(rows jsonb)
returns table (
    sheet_row integer,
    student_name text,
    name_key text,
    class_name text,
    pre_form_one boolean,
    enrollment_year integer,
    day_or_boarding text,
    guardian_name text,
    relationship text,
    relationship_description text,
    phone text,
    whatsapp text,
    visit_date date,
    referral_code text,
    status text,
    refused_field text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    this_year integer := extract(year from public.tanzania_today());
begin
    if jsonb_typeof(student_import_rows.rows) is distinct from 'array'
       or jsonb_array_length(student_import_rows.rows) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'rows')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(student_import_rows.rows) r
        where jsonb_typeof(r) is distinct from 'object'
           or jsonb_typeof(r -> 'sheet_row') is distinct from 'number'
           or (r ->> 'sheet_row') !~ '^[0-9]{1,7}$'
           or (r ->> 'sheet_row')::integer < 2
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;
    if exists (select 1 from jsonb_array_elements(student_import_rows.rows) r group by r ->> 'sheet_row' having count(*) > 1) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;
    -- The same student twice: the same name key with any parent number in
    -- common, as student_import_verdicts matches a student on file. A row's
    -- parent numbers are its own phone and WhatsApp plus the WhatsApp of
    -- every row with the same phone, whose shared contact carries the first
    -- one's. Two rows with the numbers swapped are one child, not two, and
    -- so are two rows a sibling row's phone and WhatsApp link (#284).
    if exists (
        select 1
        from jsonb_array_elements(student_import_rows.rows) r
        cross join lateral (
            select r ->> 'phone'
            union
            select r ->> 'whatsapp'
            union
            select o ->> 'whatsapp'
            from jsonb_array_elements(student_import_rows.rows) o
            where o ->> 'phone' = r ->> 'phone'
        ) as parent(number)
        where parent.number is not null
        group by public.normalize_student_name(coalesce(r ->> 'student_name', '')), parent.number
        having count(distinct r ->> 'sheet_row') > 1
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'duplicate_student')::text;
    end if;

    return query
    with raw as (
        select (r ->> 'sheet_row')::integer as sheet_row, r
        from jsonb_array_elements(student_import_rows.rows) r
    ),
    read as (
        select raw.sheet_row,
               raw.r ->> 'student_name' as student_name,
               raw.r ->> 'class_name' as class_name,
               raw.r -> 'pre_form_one' as pre_form_one,
               raw.r ->> 'enrollment_year' as enrollment_year,
               raw.r ->> 'day_or_boarding' as day_or_boarding,
               raw.r ->> 'guardian_name' as guardian_name,
               raw.r ->> 'relationship' as relationship,
               raw.r ->> 'relationship_description' as relationship_description,
               raw.r ->> 'phone' as phone,
               raw.r ->> 'whatsapp' as whatsapp,
               raw.r ->> 'visit_date' as visit_date,
               raw.r ->> 'referral_code' as referral_code,
               raw.r ->> 'status' as status
        from raw
    ),
    checked as (
        select x.*,
            case
                when x.student_name is null or btrim(x.student_name) = ''
                     or x.student_name <> regexp_replace(btrim(x.student_name), '\s+', ' ', 'g')
                     or char_length(x.student_name) > 100 then 'student_name'
                when x.class_name is null or x.class_name not in (
                    select e.enumlabel::text from pg_catalog.pg_enum e
                    where e.enumtypid = 'public.lead_class'::regtype
                ) then 'class_name'
                when jsonb_typeof(x.pre_form_one) is distinct from 'boolean'
                     or (x.pre_form_one = 'true'::jsonb and x.class_name <> 'FORM 1') then 'pre_form_one'
                when x.enrollment_year is null or x.enrollment_year !~ '^[0-9]{4}$'
                     or x.enrollment_year::integer not between this_year - 1 and this_year + 2 then 'enrollment_year'
                when x.day_or_boarding is null or x.day_or_boarding not in ('Day', 'Boarding') then 'day_or_boarding'
                when x.guardian_name is null or btrim(x.guardian_name) = ''
                     or x.guardian_name <> regexp_replace(btrim(x.guardian_name), '\s+', ' ', 'g')
                     or char_length(x.guardian_name) > 100 then 'guardian_name'
                when x.relationship is null or x.relationship not in ('Mother', 'Father', 'Guardian', 'Other') then 'relationship'
                when (x.relationship = 'Other') <> (x.relationship_description is not null)
                     or (x.relationship_description is not null
                         and (btrim(x.relationship_description) = '' or char_length(x.relationship_description) > 100)) then 'relationship_description'
                when x.phone is null or x.phone is distinct from public.normalize_phone(x.phone) then 'phone'
                when x.whatsapp is not null and (x.whatsapp is distinct from public.normalize_phone(x.whatsapp) or x.whatsapp = x.phone) then 'whatsapp'
                when x.visit_date is not null and (
                    x.visit_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    or not public.is_import_date(x.visit_date)
                ) then 'visit_date'
                when x.referral_code is not null and x.referral_code is distinct from public.normalize_referral_code(x.referral_code) then 'referral_code'
                when x.status is null or x.status not in ('Applied', 'Visited', 'Interviewed', 'Enrolled', 'Declined') then 'status'
            end as refused_field
        from read x
    )
    select c.sheet_row,
           c.student_name,
           public.normalize_student_name(coalesce(c.student_name, '')),
           c.class_name,
           coalesce(c.pre_form_one = 'true'::jsonb, false),
           case when c.refused_field is null then c.enrollment_year::integer end,
           c.day_or_boarding,
           c.guardian_name,
           c.relationship,
           c.relationship_description,
           c.phone,
           c.whatsapp,
           case when c.refused_field is null then c.visit_date::date end,
           c.referral_code,
           c.status,
           c.refused_field
    from checked c
    order by c.sheet_row;
end;
$$;

revoke execute on function public.student_import_rows(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- student_import_verdicts: each row's verdict against the leads and contacts
-- stored now, set-based. Rows sharing a parent phone are one group: the
-- first row's verdict decides the group's contact. Internal.
-- ---------------------------------------------------------------------------

create or replace function public.student_import_verdicts(rows jsonb)
returns table (sheet_row integer, verdict jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    with r as (
        select * from public.student_import_rows(student_import_verdicts.rows)
    ),
    -- Each row's parent numbers, as student_import_rows compares them: its
    -- own phone and WhatsApp plus the WhatsApp of every row with the same
    -- phone (#284).
    numbers as (
        select k.sheet_row, array_agg(k.number) as numbers
        from (
            select r.sheet_row, r.phone as number from r where r.phone is not null
            union
            select r.sheet_row, r.whatsapp from r where r.whatsapp is not null
            union
            select r.sheet_row, o.whatsapp from r join r o on o.phone = r.phone where o.whatsapp is not null
        ) k
        group by k.sheet_row
    ),
    present as (
        select r.sheet_row, l.id, l.admission_number, l.status
        from r
        join numbers n on n.sheet_row = r.sheet_row
        cross join lateral (
            select l.id, l.admission_number, l.status::text as status
            from public.leads l
            join public.guardian_contacts g on g.id = l.guardian_contact_id
            where r.refused_field is null
              and l.student_name_key = r.name_key
              and (g.phone = any (n.numbers) or g.whatsapp = any (n.numbers))
            order by l.created_at, l.id
            limit 1
        ) l
    ),
    -- The rows that create a lead, and the first such row for each phone.
    creating as (
        select r.*, min(r.sheet_row) over (partition by r.phone) as family_row
        from r
        where r.refused_field is null
          and not exists (select 1 from present p where p.sheet_row = r.sheet_row)
    ),
    -- A known Family for the group's first row, as create_lead picks one: a
    -- contact with children, a settled one before one still waiting on staff,
    -- then the oldest; a contact still waiting points at its Family.
    family as (
        select c.sheet_row, coalesce(m.pending_family_match_id, m.id) as contact_id
        from creating c
        cross join lateral (
            select g.id, g.pending_family_match_id
            from public.guardian_contacts g
            where (g.phone in (c.phone, c.whatsapp) or g.whatsapp in (c.phone, c.whatsapp))
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
            order by g.pending_family_match_id is not null, g.created_at, g.id
            limit 1
        ) m
        where c.sheet_row = c.family_row
    )
    select r.sheet_row,
        case
            when r.refused_field is not null
                then jsonb_build_object('verdict', 'refused', 'field', r.refused_field)
            when p.sheet_row is not null
                then jsonb_build_object('verdict', 'present', 'lead',
                    jsonb_build_object('id', p.id, 'admission_number', p.admission_number, 'status', p.status))
            else jsonb_build_object(
                'verdict', case when f.contact_id is not null then 'joins_family' else 'create' end,
                'family_row', case when c.family_row <> c.sheet_row then c.family_row end,
                'family', case when f.contact_id is not null then (
                    select jsonb_build_object('contact_id', g.id, 'full_name', g.full_name)
                    from public.guardian_contacts g where g.id = f.contact_id
                ) end,
                'unknown_code', r.referral_code is not null
                    and not exists (select 1 from public.code_discount(r.referral_code))
            )
        end
    from r
    left join present p on p.sheet_row = r.sheet_row
    left join creating c on c.sheet_row = r.sheet_row
    left join family f on f.sheet_row = c.family_row
    order by r.sheet_row;
$$;

revoke execute on function public.student_import_verdicts(jsonb) from public, anon, authenticated, service_role;

select set_config('audit.actor_kind', '', true);
