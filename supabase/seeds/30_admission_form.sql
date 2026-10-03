-- Slice 3 (Public Admission form) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- Re-applications (#76): Admission forms that named a child already on file.
-- Every name is invented, every number is +255 700 000 3xx, and names end in
-- "Marudio" so a name search for other slices' fixtures never finds these.
--
--   ADMSN-90301 Zuberi Marudio   Applied, an unreviewed re-application that
--                                asks for STD 4 and gives a WhatsApp number
--   ADMSN-90302 Mariamu Marudio  Visited, a reviewed re-application that asks
--                                for Enrollment year 2031, which Leads by
--                                enrollment class must not count
--   ADMSN-90005 Hamisi Fixture   The Archived lead in 00_base.sql, re-applied
--                                for, unreviewed, still Archived
--
-- Each is recorded through record_re_application, as the form records one,
-- so each lead carries the re-applied cause of its Returning family badge.

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000301', 'Saida Marudio', 'Mother', null, '+255700000301', null, 'admission_form'),
    ('c0c0c0c0-0000-4000-8000-000000000302', 'Yusufu Marudio', 'Father', null, '+255700000302', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000301', 'ADMSN-90301', 'Zuberi Marudio', 'STD 3', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000301', false),
    ('1ead0000-0000-4000-8000-000000000302', 'ADMSN-90302', 'Mariamu Marudio', 'KG 2', 2027, 'Boarding',
        'Visited', null, date '2026-09-05', 'c0c0c0c0-0000-4000-8000-000000000302', false);

-- record_re_application sets the Admission form as the actor.
select public.record_re_application(
    '1ead0000-0000-4000-8000-000000000301',
    'f0f0f0f0-0000-4000-8000-000000000301',
    '{"contact": {"full_name": "Saida Marudio", "relationship": "Mother", "phone": "0700 000 301", "whatsapp": "0700 000 311"},
      "student": {"full_name": "Zuberi Marudio", "class_name": "STD 4", "enrollment_year": 2027, "day_or_boarding": "Day"}}'
);

select public.record_re_application(
    '1ead0000-0000-4000-8000-000000000302',
    'f0f0f0f0-0000-4000-8000-000000000302',
    '{"contact": {"full_name": "Yusufu Marudio", "relationship": "Father", "phone": "+255 700 000 302"},
      "student": {"full_name": "Mariamu Marudio", "class_name": "KG 2", "enrollment_year": 2031, "day_or_boarding": "Boarding"}}'
);

select public.record_re_application(
    '1ead0000-0000-4000-8000-000000000005',
    'f0f0f0f0-0000-4000-8000-000000000005',
    '{"contact": {"full_name": "Omari Fixture", "relationship": "Guardian", "phone": "0700000104"},
      "student": {"full_name": "Hamisi Fixture", "class_name": "STD 6", "enrollment_year": 2027, "day_or_boarding": "Boarding"}}'
);

commit;

-- The Admissions Manager reviewed Mariamu's.
begin;

select public.set_audit_actor('staff', 'a1a1a1a1-0000-4000-8000-000000000001');

update public.re_applications
set reviewed_at = timestamptz '2026-09-30 10:00+03',
    reviewed_by = 'a1a1a1a1-0000-4000-8000-000000000001'
where submission_key = 'f0f0f0f0-0000-4000-8000-000000000302';

commit;
