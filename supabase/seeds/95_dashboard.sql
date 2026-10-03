-- Slice 10 (Dashboard) fixtures, the 2031 rows among them. Seeds load in file-name order, after 00_base.sql.
--
-- Enrollment year 2031 is the dashboard's own: no other slice's fixtures use
-- it, so the dashboard tests filter to 2031 and another slice's new fixture
-- never shifts a count. Names are invented; every name ends in "Takwimu" so a
-- name search for other slices' fixtures never finds these. Numbers run
-- +255 700 000 951 upwards and Admission Numbers ADMSN-31001 upwards.
--
-- Visits either side of each period boundary:
--   ADMSN-31001 Juma Takwimu     Visited 2026-09-20, a Sunday
--   ADMSN-31002 Asha Takwimu     Visited 2026-09-21, the Monday after
--   ADMSN-31003 Bakari Takwimu   Visited 2026-08-31, the last day of August
--   ADMSN-31004 Mwanaisha Takwimu Visited 2026-09-01, the first of September
--   ADMSN-31005 Shabani Takwimu  Visited 2025-12-31, the last day of 2025
--   ADMSN-31006 Zuhura Takwimu   Visited 2026-01-01, the first day of 2026
-- Counted whatever their status or closure mark now:
--   ADMSN-31007 Rashidi Takwimu  Declined, visited 2026-09-22
--   ADMSN-31008 Halima Takwimu   Visited, Inactive, visited 2026-09-23
--   ADMSN-31009 Omari Takwimu    Visited, Archived, visited 2026-09-24
-- Left out:
--   ADMSN-31010 Saida Takwimu    Applied, no visit
-- Moved by tests/integration/dashboard.test.ts, which corrects its Visit date
-- and puts it back:
--   ADMSN-31011 Hassani Takwimu  Visited 2026-03-10
--
-- Leads by enrollment class counts leads by the date they were created, in
-- Tanzania time, so every lead here sets created_at. The visited leads were
-- created at 09:00 on their Visit date, which puts them either side of the
-- same boundaries; the Applied leads below add the rest. Classes STD 7,
-- FORM 3 and FORM 4 have no 2031 lead.
--   ADMSN-31010 Saida Takwimu    Applied, created 2026-09-10
--   ADMSN-31012 Kassimu Takwimu  Applied, created 23:30 on Sunday 2026-09-27
--   ADMSN-31013 Neema Takwimu    Applied, created 00:30 on Monday 2026-09-28,
--                                which is 21:30 on the Sunday in UTC
--   ADMSN-31014 Tatu Takwimu     Applied, FORM 1, created 2026-07-15
-- No fixture is created in May 2026: the class-correction test in
-- tests/integration/dashboard-leads-by-class.test.ts puts a lead of its own
-- there for the length of the test.
--
-- Slice 8 (#97, #98) adds a reason that Declined leads and closure marks must
-- carry; whichever of it and this file lands second fills in the reasons here.

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c02031-0000-4000-8000-000000000001', 'Mwajuma Takwimu', 'Mother', null, '+255700000951', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000002', 'Abdallah Takwimu', 'Father', null, '+255700000952', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000003', 'Rukia Takwimu', 'Mother', null, '+255700000953', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000004', 'Selemani Takwimu', 'Father', null, '+255700000954', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000005', 'Fatuma Takwimu', 'Guardian', null, '+255700000955', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000006', 'Ramadhani Takwimu', 'Father', null, '+255700000956', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000007', 'Mariamu Takwimu', 'Mother', null, '+255700000957', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000008', 'Idrisa Takwimu', 'Father', null, '+255700000958', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000009', 'Zainabu Takwimu', 'Mother', null, '+255700000959', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000010', 'Hadija Takwimu', 'Mother', null, '+255700000960', null, 'admission_form'),
    ('c0c02031-0000-4000-8000-000000000011', 'Yusufu Takwimu', 'Father', null, '+255700000961', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000012', 'Amina Takwimu', 'Mother', null, '+255700000962', null, 'admission_form'),
    ('c0c02031-0000-4000-8000-000000000013', 'Musa Takwimu', 'Father', null, '+255700000963', null, 'admission_form'),
    ('c0c02031-0000-4000-8000-000000000014', 'Subira Takwimu', 'Mother', null, '+255700000964', null, 'admission_form');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, created_at
) values
    ('1ead2031-0000-4000-8000-000000000001', 'ADMSN-31001', 'Juma Takwimu', 'STD 1', 2031, 'Day',
        'Visited', null, date '2026-09-20', 'c0c02031-0000-4000-8000-000000000001', timestamptz '2026-09-20 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000002', 'ADMSN-31002', 'Asha Takwimu', 'KG 1', 2031, 'Day',
        'Visited', null, date '2026-09-21', 'c0c02031-0000-4000-8000-000000000002', timestamptz '2026-09-21 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000003', 'ADMSN-31003', 'Bakari Takwimu', 'STD 3', 2031, 'Boarding',
        'Visited', null, date '2026-08-31', 'c0c02031-0000-4000-8000-000000000003', timestamptz '2026-08-31 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000004', 'ADMSN-31004', 'Mwanaisha Takwimu', 'FORM 1', 2031, 'Boarding',
        'Visited', null, date '2026-09-01', 'c0c02031-0000-4000-8000-000000000004', timestamptz '2026-09-01 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000005', 'ADMSN-31005', 'Shabani Takwimu', 'DAY CARE', 2031, 'Day',
        'Visited', null, date '2025-12-31', 'c0c02031-0000-4000-8000-000000000005', timestamptz '2025-12-31 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000006', 'ADMSN-31006', 'Zuhura Takwimu', 'STD 5', 2031, 'Day',
        'Visited', null, date '2026-01-01', 'c0c02031-0000-4000-8000-000000000006', timestamptz '2026-01-01 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000007', 'ADMSN-31007', 'Rashidi Takwimu', 'STD 2', 2031, 'Day',
        'Declined', null, date '2026-09-22', 'c0c02031-0000-4000-8000-000000000007', timestamptz '2026-09-22 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000008', 'ADMSN-31008', 'Halima Takwimu', 'KG 2', 2031, 'Day',
        'Visited', 'Inactive', date '2026-09-23', 'c0c02031-0000-4000-8000-000000000008', timestamptz '2026-09-23 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000009', 'ADMSN-31009', 'Omari Takwimu', 'FORM 2', 2031, 'Boarding',
        'Visited', 'Archived', date '2026-09-24', 'c0c02031-0000-4000-8000-000000000009', timestamptz '2026-09-24 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000010', 'ADMSN-31010', 'Saida Takwimu', 'STD 4', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000010', timestamptz '2026-09-10 10:00+03'),
    ('1ead2031-0000-4000-8000-000000000011', 'ADMSN-31011', 'Hassani Takwimu', 'STD 6', 2031, 'Day',
        'Visited', null, date '2026-03-10', 'c0c02031-0000-4000-8000-000000000011', timestamptz '2026-03-10 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000012', 'ADMSN-31012', 'Kassimu Takwimu', 'STD 1', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000012', timestamptz '2026-09-27 23:30+03'),
    ('1ead2031-0000-4000-8000-000000000013', 'ADMSN-31013', 'Neema Takwimu', 'STD 1', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000013', timestamptz '2026-09-28 00:30+03'),
    ('1ead2031-0000-4000-8000-000000000014', 'ADMSN-31014', 'Tatu Takwimu', 'FORM 1', 2031, 'Boarding',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000014', timestamptz '2026-07-15 11:00+03');

commit;
