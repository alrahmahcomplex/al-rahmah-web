-- Slice 8 (Decline, Inactive/Archive and reopening) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- 00_base.sql already holds the closed leads slice 8 reads: ADMSN-90005
-- Hamisi Fixture (Visited, Archived) and ADMSN-90006 Rehema Fixture
-- (Declined). Below, a Family with one closed child and one open one, whose
-- shared parent stays editable from the open child's screen (#96). Their
-- names leave out "Fixture", so a name search for the base leads still finds
-- those six only.
--
--   ADMSN-90080 Asha Kibwana         Declined
--   ADMSN-90081 Daudi Kibwana        Visited, the open sibling

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000080', 'Mariamu Kibwana', 'Mother', null, '+255700000180', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000080', 'ADMSN-90080', 'Asha Kibwana', 'STD 6', 2027, 'Day',
        'Declined', null, date '2026-08-24', 'c0c0c0c0-0000-4000-8000-000000000080', false),
    ('1ead0000-0000-4000-8000-000000000081', 'ADMSN-90081', 'Daudi Kibwana', 'STD 2', 2027, 'Day',
        'Visited', null, date '2026-08-24', 'c0c0c0c0-0000-4000-8000-000000000080', true);

commit;
