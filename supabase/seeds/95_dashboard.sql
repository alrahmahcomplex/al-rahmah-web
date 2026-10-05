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
--   ADMSN-31015 Rehema Takwimu   Interviewed, STD 3, created and visited 2026-06-03
--   ADMSN-31016 Salum Takwimu    Interviewed, KG 1, created 2026-06-15 from the
--                                Admission form, visited 2026-10-01
-- No fixture is created in May 2026: the class-correction test in
-- tests/integration/dashboard-leads-by-class.test.ts puts a lead of its own
-- there for the length of the test.
--
-- Interviewed leads, Passed interviews and Failed interviews count interviews
-- by interview date, with the result recorded. Written the way
-- 50_interviews.sql seeds them: registered by Test Admissions with 2031 S/Ns
-- in the order they were registered, the result recorded after the
-- interview, and the Paid fees marked afterwards by Test Accountant with the
-- amount locked.
--   S/N  Lead         Interview date   Result  Fee
--   1    ADMSN-31005  Wed 2025-12-31   Failed  Not Paid  the last day of 2025
--   2    ADMSN-31006  Thu 2026-01-01   Passed  Paid      the first day of 2026
--   3    ADMSN-31015  Wed 2026-06-10   Failed  Not Paid  then a retake in the
--   4    ADMSN-31015  Wed 2026-06-24   Passed  Paid      same month
--   5    ADMSN-31001  Sun 2026-09-27   Passed  Not Paid  a Sunday
--   6    ADMSN-31003  Sun 2026-09-27   Failed  Paid
--   7    ADMSN-31002  Mon 2026-09-28   Passed  Paid      the Monday after
--   8    ADMSN-31004  Mon 2026-09-28   Failed  Not Paid
--   9    ADMSN-31007  Wed 2026-09-30   Failed  Not Paid  the last of September; Declined since
--   10   ADMSN-31008  Wed 2026-09-30   Passed  Not Paid  Inactive since
--   11   ADMSN-31009  Thu 2026-10-01   Passed  Not Paid  the first of October; Archived since
--   12   ADMSN-31010  registered 2026-09-29, no result yet: counted nowhere
--   13   ADMSN-31016  Thu 2026-10-01   Failed  Paid
-- No interview is dated 2026-09-29, the day ADMSN-31010 was registered.
--
-- Slice 8 (#97, #98) adds a reason that Declined leads and closure marks must
-- carry; whichever of it and this file lands second fills in the reasons here.
-- #97 gave ADMSN-31007 its Declined reason, and #98 gave ADMSN-31008 and
-- ADMSN-31009 their closure reasons, each in its own update below.

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
    ('c0c02031-0000-4000-8000-000000000014', 'Subira Takwimu', 'Mother', null, '+255700000964', null, 'admission_form'),
    ('c0c02031-0000-4000-8000-000000000015', 'Mwanahawa Takwimu', 'Mother', null, '+255700000965', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000016', 'Athumani Takwimu', 'Father', null, '+255700000966', null, 'admission_form');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, created_at
) values
    ('1ead2031-0000-4000-8000-000000000001', 'ADMSN-31001', 'Juma Takwimu', 'STD 1', 2031, 'Day',
        'Interviewed', null, date '2026-09-20', 'c0c02031-0000-4000-8000-000000000001', timestamptz '2026-09-20 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000002', 'ADMSN-31002', 'Asha Takwimu', 'KG 1', 2031, 'Day',
        'Interviewed', null, date '2026-09-21', 'c0c02031-0000-4000-8000-000000000002', timestamptz '2026-09-21 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000003', 'ADMSN-31003', 'Bakari Takwimu', 'STD 3', 2031, 'Boarding',
        'Interviewed', null, date '2026-08-31', 'c0c02031-0000-4000-8000-000000000003', timestamptz '2026-08-31 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000004', 'ADMSN-31004', 'Mwanaisha Takwimu', 'FORM 1', 2031, 'Boarding',
        'Interviewed', null, date '2026-09-01', 'c0c02031-0000-4000-8000-000000000004', timestamptz '2026-09-01 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000005', 'ADMSN-31005', 'Shabani Takwimu', 'DAY CARE', 2031, 'Day',
        'Interviewed', null, date '2025-12-31', 'c0c02031-0000-4000-8000-000000000005', timestamptz '2025-12-31 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000006', 'ADMSN-31006', 'Zuhura Takwimu', 'STD 5', 2031, 'Day',
        'Interviewed', null, date '2026-01-01', 'c0c02031-0000-4000-8000-000000000006', timestamptz '2026-01-01 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000007', 'ADMSN-31007', 'Rashidi Takwimu', 'STD 2', 2031, 'Day',
        'Visited', null, date '2026-09-22', 'c0c02031-0000-4000-8000-000000000007', timestamptz '2026-09-22 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000008', 'ADMSN-31008', 'Halima Takwimu', 'KG 2', 2031, 'Day',
        'Interviewed', null, date '2026-09-23', 'c0c02031-0000-4000-8000-000000000008', timestamptz '2026-09-23 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000009', 'ADMSN-31009', 'Omari Takwimu', 'FORM 2', 2031, 'Boarding',
        'Interviewed', null, date '2026-09-24', 'c0c02031-0000-4000-8000-000000000009', timestamptz '2026-09-24 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000010', 'ADMSN-31010', 'Saida Takwimu', 'STD 4', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000010', timestamptz '2026-09-10 10:00+03'),
    ('1ead2031-0000-4000-8000-000000000011', 'ADMSN-31011', 'Hassani Takwimu', 'STD 6', 2031, 'Day',
        'Visited', null, date '2026-03-10', 'c0c02031-0000-4000-8000-000000000011', timestamptz '2026-03-10 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000012', 'ADMSN-31012', 'Kassimu Takwimu', 'STD 1', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000012', timestamptz '2026-09-27 23:30+03'),
    ('1ead2031-0000-4000-8000-000000000013', 'ADMSN-31013', 'Neema Takwimu', 'STD 1', 2031, 'Day',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000013', timestamptz '2026-09-28 00:30+03'),
    ('1ead2031-0000-4000-8000-000000000014', 'ADMSN-31014', 'Tatu Takwimu', 'FORM 1', 2031, 'Boarding',
        'Applied', null, null, 'c0c02031-0000-4000-8000-000000000014', timestamptz '2026-07-15 11:00+03'),
    ('1ead2031-0000-4000-8000-000000000015', 'ADMSN-31015', 'Rehema Takwimu', 'STD 3', 2031, 'Day',
        'Interviewed', null, date '2026-06-03', 'c0c02031-0000-4000-8000-000000000015', timestamptz '2026-06-03 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000016', 'ADMSN-31016', 'Salum Takwimu', 'KG 1', 2031, 'Boarding',
        'Interviewed', null, date '2026-10-01', 'c0c02031-0000-4000-8000-000000000016', timestamptz '2026-06-15 20:00+03');

-- Registered by Test Admissions, as the lead screen would have done it, each
-- on or after the lead's visit (ADMSN-31010 while still Applied), and the
-- result recorded after the interview. ADMSN-31015 failed, was declined and
-- reopened, and sat a retake; its lead is shown as it stands now.
insert into public.interview_serial_counters (enrollment_year, last_number) values (2031, 13);

insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by)
values
    ('1e7e2031-0000-4000-8000-000000000012', '1ead2031-0000-4000-8000-000000000010', 12, 2031,
        timestamptz '2026-09-29 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003');

insert into public.interviews (
    id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score
)
values
    ('1e7e2031-0000-4000-8000-000000000001', '1ead2031-0000-4000-8000-000000000005', 1, 2031,
        timestamptz '2025-12-31 09:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2025-12-31', 'Failed', 38),
    ('1e7e2031-0000-4000-8000-000000000002', '1ead2031-0000-4000-8000-000000000006', 2, 2031,
        timestamptz '2026-01-01 09:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-01-01', 'Passed', 72),
    ('1e7e2031-0000-4000-8000-000000000003', '1ead2031-0000-4000-8000-000000000015', 3, 2031,
        timestamptz '2026-06-03 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-06-10', 'Failed', 44.5),
    ('1e7e2031-0000-4000-8000-000000000004', '1ead2031-0000-4000-8000-000000000015', 4, 2031,
        timestamptz '2026-06-17 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-06-24', 'Passed', 66),
    ('1e7e2031-0000-4000-8000-000000000005', '1ead2031-0000-4000-8000-000000000001', 5, 2031,
        timestamptz '2026-09-21 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-27', 'Passed', 81),
    ('1e7e2031-0000-4000-8000-000000000006', '1ead2031-0000-4000-8000-000000000003', 6, 2031,
        timestamptz '2026-09-21 10:15:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-27', 'Failed', 35),
    ('1e7e2031-0000-4000-8000-000000000007', '1ead2031-0000-4000-8000-000000000002', 7, 2031,
        timestamptz '2026-09-21 10:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-28', 'Passed', 90.5),
    ('1e7e2031-0000-4000-8000-000000000008', '1ead2031-0000-4000-8000-000000000004', 8, 2031,
        timestamptz '2026-09-21 10:45:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-28', 'Failed', 42),
    ('1e7e2031-0000-4000-8000-000000000009', '1ead2031-0000-4000-8000-000000000007', 9, 2031,
        timestamptz '2026-09-22 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-30', 'Failed', 29),
    ('1e7e2031-0000-4000-8000-000000000010', '1ead2031-0000-4000-8000-000000000008', 10, 2031,
        timestamptz '2026-09-23 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-30', 'Passed', 77),
    ('1e7e2031-0000-4000-8000-000000000011', '1ead2031-0000-4000-8000-000000000009', 11, 2031,
        timestamptz '2026-09-24 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-10-01', 'Passed', 63),
    ('1e7e2031-0000-4000-8000-000000000013', '1ead2031-0000-4000-8000-000000000016', 13, 2031,
        timestamptz '2026-10-01 11:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-10-01', 'Failed', 40);

commit;

-- The Paid fees, marked afterwards by Test Accountant with the full
-- TZS 50,000 locked, before the decline and closure marks below make those
-- leads read-only.
begin;

select public.set_audit_actor('staff', 'a1a1a1a1-0000-4000-8000-000000000004');

update public.interviews
set fee_status = 'Paid', locked_amount = 50000, locked_discount_applied = false
where id in (
    '1e7e2031-0000-4000-8000-000000000002',
    '1e7e2031-0000-4000-8000-000000000004',
    '1e7e2031-0000-4000-8000-000000000006',
    '1e7e2031-0000-4000-8000-000000000007',
    '1e7e2031-0000-4000-8000-000000000013'
);

commit;

begin;

select public.set_audit_actor('system');

-- Declined as decline_lead declines, with its reason, after the insert so the
-- row list above stays the same shape for every lead.
update public.leads
set status = 'Declined', declined_reason = 'Enrolled elsewhere', status_before_decline = 'Interviewed'
where id = '1ead2031-0000-4000-8000-000000000007';

-- Marked as mark_lead marks, with a reason. The mark and its reason go in one
-- update: once a lead is marked, it is read-only.
update public.leads
set closure = 'Inactive', closure_reason = 'No longer pursuing admission'
where id = '1ead2031-0000-4000-8000-000000000008';

update public.leads
set closure = 'Archived', closure_reason = 'Admission cycle ended'
where id = '1ead2031-0000-4000-8000-000000000009';

commit;
