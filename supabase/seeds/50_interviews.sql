-- Slice 5 (Interviews and interview payment) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- Every parent and child is made up, and every number is +255 700 000 xxx.
-- Names leave out "Fixture", so a name search for slice 2's leads still finds
-- those six only.
--
--   ADMSN-90501 Amani Interview      Visited, registered for interview: S/N 1 for 2027, no result yet
--   ADMSN-90502 Jabari Interview     Visited, not registered: kept for registering by hand on the lead screen
--   ADMSN-90503 Neema Interview      Interviewed: S/N 2 for 2027, Passed with 78.5% on 2026-09-22
--   ADMSN-90504 Baraka Interview     Interviewed: S/N 3 for 2027, Failed with 41% on 2026-09-22

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000501', 'Rukia Interview', 'Mother', null, '+255700000501', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000502', 'Saidi Interview', 'Father', null, '+255700000502', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000503', 'Zawadi Interview', 'Mother', null, '+255700000503', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000504', 'Hamisi Interview', 'Father', null, '+255700000504', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000501', 'ADMSN-90501', 'Amani Interview', 'STD 5', 2027, 'Day',
        'Visited', null, date '2026-09-15', 'c0c0c0c0-0000-4000-8000-000000000501', false),
    ('1ead0000-0000-4000-8000-000000000502', 'ADMSN-90502', 'Jabari Interview', 'KG 1', 2027, 'Boarding',
        'Visited', null, date '2026-09-16', 'c0c0c0c0-0000-4000-8000-000000000502', false),
    ('1ead0000-0000-4000-8000-000000000503', 'ADMSN-90503', 'Neema Interview', 'STD 1', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000503', false),
    ('1ead0000-0000-4000-8000-000000000504', 'ADMSN-90504', 'Baraka Interview', 'FORM 1', 2027, 'Boarding',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000504', false);

-- Registered by Test Admissions, as the lead screen would have done it, and
-- for 90503 and 90504 with the result recorded after the interview.
insert into public.interview_serial_counters (enrollment_year, last_number) values (2027, 3);

insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by)
values
    ('1e7e0000-0000-4000-8000-000000000501', '1ead0000-0000-4000-8000-000000000501', 1, 2027,
        timestamptz '2026-09-15 09:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003');

insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
values
    ('1e7e0000-0000-4000-8000-000000000503', '1ead0000-0000-4000-8000-000000000503', 2, 2027,
        timestamptz '2026-09-15 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', 78.5),
    ('1e7e0000-0000-4000-8000-000000000504', '1ead0000-0000-4000-8000-000000000504', 3, 2027,
        timestamptz '2026-09-15 10:15:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Failed', 41);

commit;
