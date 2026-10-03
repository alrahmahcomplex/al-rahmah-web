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
    ('c0c02031-0000-4000-8000-000000000011', 'Yusufu Takwimu', 'Father', null, '+255700000961', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id
) values
    ('1ead2031-0000-4000-8000-000000000001', 'ADMSN-31001', 'Juma Takwimu', 'STD 1', 2031, 'Day',
        'Visited', null, date '2026-09-20', 'c0c02031-0000-4000-8000-000000000001'),
    ('1ead2031-0000-4000-8000-000000000002', 'ADMSN-31002', 'Asha Takwimu', 'KG 1', 2031, 'Day',
        'Visited', null, date '2026-09-21', 'c0c02031-0000-4000-8000-000000000002'),
    ('1ead2031-0000-4000-8000-000000000003', 'ADMSN-31003', 'Bakari Takwimu', 'STD 3', 2031, 'Boarding',
        'Visited', null, date '2026-08-31', 'c0c02031-0000-4000-8000-000000000003'),
    ('1ead2031-0000-4000-8000-000000000004', 'ADMSN-31004', 'Mwanaisha Takwimu', 'FORM 1', 2031, 'Boarding',
        'Visited', null, date '2026-09-01', 'c0c02031-0000-4000-8000-000000000004'),
    ('1ead2031-0000-4000-8000-000000000005', 'ADMSN-31005', 'Shabani Takwimu', 'DAY CARE', 2031, 'Day',
        'Visited', null, date '2025-12-31', 'c0c02031-0000-4000-8000-000000000005'),
    ('1ead2031-0000-4000-8000-000000000006', 'ADMSN-31006', 'Zuhura Takwimu', 'STD 5', 2031, 'Day',
        'Visited', null, date '2026-01-01', 'c0c02031-0000-4000-8000-000000000006'),
    ('1ead2031-0000-4000-8000-000000000007', 'ADMSN-31007', 'Rashidi Takwimu', 'STD 2', 2031, 'Day',
        'Declined', null, date '2026-09-22', 'c0c02031-0000-4000-8000-000000000007'),
    ('1ead2031-0000-4000-8000-000000000008', 'ADMSN-31008', 'Halima Takwimu', 'KG 2', 2031, 'Day',
        'Visited', 'Inactive', date '2026-09-23', 'c0c02031-0000-4000-8000-000000000008'),
    ('1ead2031-0000-4000-8000-000000000009', 'ADMSN-31009', 'Omari Takwimu', 'FORM 2', 2031, 'Boarding',
        'Visited', 'Archived', date '2026-09-24', 'c0c02031-0000-4000-8000-000000000009'),
    ('1ead2031-0000-4000-8000-000000000010', 'ADMSN-31010', 'Saida Takwimu', 'STD 4', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000010'),
    ('1ead2031-0000-4000-8000-000000000011', 'ADMSN-31011', 'Hassani Takwimu', 'STD 6', 2031, 'Day',
        'Visited', null, date '2026-03-10', 'c0c02031-0000-4000-8000-000000000011');

commit;
