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
-- ADMSN-31015's retake follows an approved Retake reopening, and a second
-- retaken lead, ADMSN-31027, sits its two interviews in different months
-- (S/Ns 24 and 25); both are written out at the end of this file.
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
        'Interviewed', null, date '2026-09-22', 'c0c02031-0000-4000-8000-000000000007', timestamptz '2026-09-22 09:00+03'),
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

-- Enrolled students (#120) counts leads that are Enrolled now by the date
-- slice 9 says Enrolled was triggered. These ten 2031 leads are written the
-- way slice 9 and slice 8 write them, through their own functions, each
-- called in the signed-in session of the seeded staff member who would make
-- the change, so every rule those functions hold applies here too:
--
--   Test Accountant saves the 2031 Fee schedule (save_fee_schedule) with the
--   2027 amounts, so a STD 2 to STD 4 Day place is TZS 2,000,000 and First
--   instalment is 40% of it, TZS 800,000. Test Manager sets its Academic-year
--   start to Wednesday 8 January 2031 (set_academic_year). Test Accountant
--   records every payment (record_school_fee_payment) and the adjustment
--   (adjust_school_fee_payment); Test Admissions declines and archives
--   (decline_lead, mark_lead).
--
-- Every lead visited in November 2025 and Passed its interview on Wednesday
-- 19 November 2025, so they add to the 2025 visits, interviews and new leads
-- and leave every 2026 count alone. All are Day.
--
--   ADMSN-31017 Kheri Takwimu     STD 2  Full payment Wed 2025-12-31, the last day of 2025
--   ADMSN-31018 Pili Takwimu      STD 3  Full payment Thu 2026-01-01, the first day of 2026
--   ADMSN-31019 Faki Takwimu      STD 4  Full payment Sun 2026-05-31, the last day of May
--   ADMSN-31020 Mosi Takwimu      STD 2  Full payment Mon 2026-06-01, the first of June
--   ADMSN-31021 Tabu Takwimu      STD 3  Initial deposit 800,000 on 2026-07-06, First
--                                        instalment: enrolled on the Academic-year
--                                        start, 2031-01-08
--   ADMSN-31022 Sharifa Takwimu   STD 4  Initial deposit 800,000 on 2026-07-07, First
--                                        instalment, then the second and third
--                                        instalments on 2026-08-11: Full before the
--                                        start, so enrolled on 2026-08-11
--   ADMSN-31023 Zawadi Takwimu    STD 2  Full payment 2026-08-12, then adjusted (Wrong
--                                        amount) to an Initial deposit of 300,000:
--                                        back to Interviewed, not counted
--   ADMSN-31024 Kombo Takwimu     STD 3  Full payment 2026-08-13, then Declined (Family
--                                        changed plans): not counted
--   ADMSN-31025 Mwanahamisi Takwimu STD 4 Full payment 2026-08-14, then Archived
--                                        (Admission cycle ended): still counted
--   ADMSN-31026 Nasra Takwimu     STD 2  Initial deposit 800,000 on 2026-07-08, First
--                                        instalment, not yet Enrolled: the test
--                                        enrols it through
--                                        enrol_from_academic_year_start in a
--                                        rolled-back transaction
--
-- Seven count: one on each of 2025-12-31, 2026-01-01, 2026-05-31,
-- 2026-06-01, 2026-08-11, 2026-08-14 and 2031-01-08.
--
-- ADMSN-31021 is enrolled the way enrol_from_academic_year_start enrols each
-- lead (its lock, its date for the run, recompute_lead_fee with the cause
-- academic_year_start), but for this lead alone. The function itself sweeps
-- every year whose start has come by the date given, so calling it as of
-- January 2031 here would also enrol the 2027 fixtures' First instalment
-- leads. Since the start is still to come, a recompute dated today, such as
-- one a correction to this lead causes, would put it back to Interviewed;
-- no test does that.

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c02031-0000-4000-8000-000000000017', 'Khadija Takwimu', 'Mother', null, '+255700000967', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000018', 'Hamadi Takwimu', 'Father', null, '+255700000968', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000019', 'Mwanaidi Takwimu', 'Mother', null, '+255700000969', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000020', 'Said Takwimu', 'Father', null, '+255700000970', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000021', 'Tatu Mwinyi Takwimu', 'Guardian', null, '+255700000971', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000022', 'Bakari Hemedi Takwimu', 'Father', null, '+255700000972', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000023', 'Asha Juma Takwimu', 'Mother', null, '+255700000973', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000024', 'Rajabu Takwimu', 'Father', null, '+255700000974', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000025', 'Zuena Takwimu', 'Mother', null, '+255700000975', null, 'front_desk'),
    ('c0c02031-0000-4000-8000-000000000026', 'Hija Takwimu', 'Mother', null, '+255700000976', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, created_at
) values
    ('1ead2031-0000-4000-8000-000000000017', 'ADMSN-31017', 'Kheri Takwimu', 'STD 2', 2031, 'Day',
        'Interviewed', null, date '2025-11-03', 'c0c02031-0000-4000-8000-000000000017', timestamptz '2025-11-03 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000018', 'ADMSN-31018', 'Pili Takwimu', 'STD 3', 2031, 'Day',
        'Interviewed', null, date '2025-11-04', 'c0c02031-0000-4000-8000-000000000018', timestamptz '2025-11-04 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000019', 'ADMSN-31019', 'Faki Takwimu', 'STD 4', 2031, 'Day',
        'Interviewed', null, date '2025-11-05', 'c0c02031-0000-4000-8000-000000000019', timestamptz '2025-11-05 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000020', 'ADMSN-31020', 'Mosi Takwimu', 'STD 2', 2031, 'Day',
        'Interviewed', null, date '2025-11-06', 'c0c02031-0000-4000-8000-000000000020', timestamptz '2025-11-06 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000021', 'ADMSN-31021', 'Tabu Takwimu', 'STD 3', 2031, 'Day',
        'Interviewed', null, date '2025-11-07', 'c0c02031-0000-4000-8000-000000000021', timestamptz '2025-11-07 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000022', 'ADMSN-31022', 'Sharifa Takwimu', 'STD 4', 2031, 'Day',
        'Interviewed', null, date '2025-11-10', 'c0c02031-0000-4000-8000-000000000022', timestamptz '2025-11-10 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000023', 'ADMSN-31023', 'Zawadi Takwimu', 'STD 2', 2031, 'Day',
        'Interviewed', null, date '2025-11-11', 'c0c02031-0000-4000-8000-000000000023', timestamptz '2025-11-11 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000024', 'ADMSN-31024', 'Kombo Takwimu', 'STD 3', 2031, 'Day',
        'Interviewed', null, date '2025-11-12', 'c0c02031-0000-4000-8000-000000000024', timestamptz '2025-11-12 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000025', 'ADMSN-31025', 'Mwanahamisi Takwimu', 'STD 4', 2031, 'Day',
        'Interviewed', null, date '2025-11-13', 'c0c02031-0000-4000-8000-000000000025', timestamptz '2025-11-13 09:00+03'),
    ('1ead2031-0000-4000-8000-000000000026', 'ADMSN-31026', 'Nasra Takwimu', 'STD 2', 2031, 'Day',
        'Interviewed', null, date '2025-11-14', 'c0c02031-0000-4000-8000-000000000026', timestamptz '2025-11-14 09:00+03');

-- Registered by Test Admissions on the day of the visit and Passed on
-- 19 November 2025, S/Ns 14 to 23.
insert into public.interviews (
    id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score
)
select
    ('1e7e2031-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
    ('1ead2031-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
    n - 3, 2031, l.created_at + interval '1 hour', 'a1a1a1a1-0000-4000-8000-000000000003',
    date '2025-11-19', 'Passed', 60 + n
from generate_series(17, 26) as n
join public.leads l on l.id = ('1ead2031-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid;

update public.interview_serial_counters set last_number = 23 where enrollment_year = 2031;

commit;

-- The 2031 Fee schedule, saved by Test Accountant.
begin;

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select public.save_fee_schedule(2031, '{
    "bands": {
        "nursery": {"day_fee": 1100000, "boarding_fee": 3000000},
        "primary_lower": {"day_fee": 2000000, "boarding_fee": 3000000},
        "primary_upper": {"day_fee": 2100000, "boarding_fee": 3300000},
        "secondary": {"day_fee": 2800000, "boarding_fee": 4300000}
    },
    "first_share": 40, "second_share": 40, "third_share": 20,
    "first_due": "2030-11-01", "second_due": "2031-04-01", "third_due": "2031-06-01",
    "minimum_deposit": 300000, "pre_form_one_day_fee": 450000, "pre_form_one_boarding_fee": 580000
}'::jsonb);

commit;

-- Its Academic-year start, set by Test Manager. The start is still to come,
-- so setting it enrols nobody.
begin;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select public.set_academic_year(2031, '{"academic_year_start": "2031-01-08", "academic_year_start_was": null}'::jsonb);

commit;

-- The payments and the adjustment, recorded by Test Accountant in date
-- order. Each recording recomputes the lead, which enrols it on the date
-- Full is reached.
begin;

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);

select public.record_school_fee_payment(p.lead_id, p.payment_type, p.amount, p.paid_on, p.request_id)
from (values
    ('1ead2031-0000-4000-8000-000000000017'::uuid, 'full_payment', 2000000, date '2025-12-31', 'fee02031-0000-4000-8000-000000000017'::uuid),
    ('1ead2031-0000-4000-8000-000000000018'::uuid, 'full_payment', 2000000, date '2026-01-01', 'fee02031-0000-4000-8000-000000000018'::uuid),
    ('1ead2031-0000-4000-8000-000000000019'::uuid, 'full_payment', 2000000, date '2026-05-31', 'fee02031-0000-4000-8000-000000000019'::uuid),
    ('1ead2031-0000-4000-8000-000000000020'::uuid, 'full_payment', 2000000, date '2026-06-01', 'fee02031-0000-4000-8000-000000000020'::uuid),
    ('1ead2031-0000-4000-8000-000000000021'::uuid, 'initial_deposit', 800000, date '2026-07-06', 'fee02031-0000-4000-8000-000000000021'::uuid),
    ('1ead2031-0000-4000-8000-000000000022'::uuid, 'initial_deposit', 800000, date '2026-07-07', 'fee02031-0000-4000-8000-000000000022'::uuid),
    ('1ead2031-0000-4000-8000-000000000026'::uuid, 'initial_deposit', 800000, date '2026-07-08', 'fee02031-0000-4000-8000-000000000026'::uuid),
    ('1ead2031-0000-4000-8000-000000000022'::uuid, 'second_instalment', 800000, date '2026-08-11', 'fee02031-0000-4000-8000-000000000122'::uuid),
    ('1ead2031-0000-4000-8000-000000000022'::uuid, 'third_instalment', 400000, date '2026-08-11', 'fee02031-0000-4000-8000-000000000222'::uuid),
    ('1ead2031-0000-4000-8000-000000000023'::uuid, 'full_payment', 2000000, date '2026-08-12', 'fee02031-0000-4000-8000-000000000023'::uuid),
    ('1ead2031-0000-4000-8000-000000000024'::uuid, 'full_payment', 2000000, date '2026-08-13', 'fee02031-0000-4000-8000-000000000024'::uuid),
    ('1ead2031-0000-4000-8000-000000000025'::uuid, 'full_payment', 2000000, date '2026-08-14', 'fee02031-0000-4000-8000-000000000025'::uuid)
) as p(lead_id, payment_type, amount, paid_on, request_id)
order by p.paid_on, p.request_id;

-- ADMSN-31023's Full payment was really an Initial deposit of 300,000.
select public.adjust_school_fee_payment(
    p.id, 'Wrong amount', false, 'initial_deposit', 300000, date '2026-08-12',
    'The family paid the Initial deposit only.', 'ad1e2031-0000-4000-8000-000000000023'
)
from public.school_fee_payments p
where p.request_id = 'fee02031-0000-4000-8000-000000000023';

commit;

-- Declined and Archived by Test Admissions after they were Enrolled.
begin;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

select public.decline_lead('1ead2031-0000-4000-8000-000000000024', 'Family changed plans');
select public.mark_lead('1ead2031-0000-4000-8000-000000000025', 'Archived', 'Admission cycle ended');

commit;

-- ADMSN-31021 enrolled on the Academic-year start, as
-- enrol_from_academic_year_start('2031-01-08') would enrol it, by the system.
begin;

select public.set_audit_actor('system');
select pg_advisory_xact_lock(hashtext('enrol_from_academic_year_start'));
select set_config('app.recompute_as_of', '2031-01-08', true);
select public.recompute_lead_fee('1ead2031-0000-4000-8000-000000000021', 'academic_year_start', date '2031-01-08');
select set_config('app.recompute_as_of', '', true);

commit;

-- Seats by class (#121) reads slice 9's seat count for 2031. Test Manager
-- sets seats for a few classes (set_academic_year). The leads above hold
-- them, a lead taking a seat once it has a Seat priority:
--
--   Class           Seats    Taken  By priority
--   STD 2 Day       3        4      Full 2 (31017, 31020), First instalment 1
--                                   (31026), Deposit 1 (31023): over by 1
--   STD 2 Boarding  5        0      5 left
--   STD 3 Day       3        2      Full 1 (31018), First instalment 1 (31021):
--                                   1 left; the Declined 31024 paid in full
--                                   and takes none
--   STD 4 Day       not set  3      Full 3 (31019, 31022, and 31025, which
--                                   keeps its seat while Archived)
--
-- Every other 2031 class has its seats not set and none taken.

begin;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select public.set_academic_year(2031, '{"seats": [
    {"class_name": "STD 2", "day_or_boarding": "Day", "seats": 3, "was": null},
    {"class_name": "STD 2", "day_or_boarding": "Boarding", "seats": 5, "was": null},
    {"class_name": "STD 3", "day_or_boarding": "Day", "seats": 3, "was": null}
]}'::jsonb);

commit;

-- Retaken interviews (#119). Interviewed leads counts a child once in a
-- period; Passed and Failed interviews count each sitting by its own date.
-- Each lead below failed its first interview, was declined from Interviewed
-- for Did not pass interview, raised a Reopening request that Test Manager
-- approved with Retake the interview, and passed a retaken interview
-- registered after that approval, with its own S/N. Written the way
-- 50_interviews.sql and 80_closure.sql seed theirs, as rows with explicit
-- times: the functions stamp the time they run, so a retake registered
-- through register_for_interview could never hold a sitting in June.
-- Each lead stands as it is now, Interviewed and Initially declined, with
-- the approval on record, so #71's retake rule finds its retake used.
--
--   ADMSN-31015 Rehema Takwimu   STD 3 Day, both sittings in June 2026
--     S/N 3   Failed Wed 2026-06-10, Not Paid
--             Reopening raised Thu 2026-06-11, approved Mon 2026-06-15
--     S/N 4   registered Wed 2026-06-17, Passed Wed 2026-06-24, Paid
--   ADMSN-31027 Kibwana Takwimu  STD 5 Day, created and visited Mon
--                                2025-10-20, the sittings in different months
--     S/N 24  Failed Thu 2025-10-30, Not Paid
--             Reopening raised Fri 2025-10-31, approved Mon 2025-11-03
--     S/N 25  registered Mon 2025-11-03, Passed Wed 2025-11-05, Not Paid

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c02031-0000-4000-8000-000000000027', 'Hamida Takwimu', 'Mother', null, '+255700000977', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, created_at, initially_declined
) values
    ('1ead2031-0000-4000-8000-000000000027', 'ADMSN-31027', 'Kibwana Takwimu', 'STD 5', 2031, 'Day',
        'Interviewed', null, date '2025-10-20', 'c0c02031-0000-4000-8000-000000000027', timestamptz '2025-10-20 09:00+03', true);

-- ADMSN-31015 was inserted above as it stands, bar the mark its decline and
-- reopening left.
update public.leads set initially_declined = true where id = '1ead2031-0000-4000-8000-000000000015';

-- Registered by Test Admissions: the first interview on the day of the
-- visit, the retake after the approval. The interview ids end in 27 and 28,
-- since the Enrolled students fixtures' interviews above take 17 to 26.
insert into public.interviews (
    id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score
)
values
    ('1e7e2031-0000-4000-8000-000000000027', '1ead2031-0000-4000-8000-000000000027', 24, 2031,
        timestamptz '2025-10-20 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2025-10-30', 'Failed', 41),
    ('1e7e2031-0000-4000-8000-000000000028', '1ead2031-0000-4000-8000-000000000027', 25, 2031,
        timestamptz '2025-11-03 14:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2025-11-05', 'Passed', 68);

update public.interview_serial_counters set last_number = 25 where enrollment_year = 2031;

-- Raised by Test Admissions and approved by Test Manager with Retake the
-- interview, between the failed sitting and the retake's registration.
insert into public.reopening_requests (
    id, lead_id, source, reason, requested_by, requested_at,
    state, decided_by, decided_at, rejection_reason, enrol_without_retake, lead_was_declined, restored_status
) values
    ('5e0e2031-0000-4000-8000-000000000015', '1ead2031-0000-4000-8000-000000000015', 'lead',
        'Rehema had a fever on the interview day; the family asks for another sitting.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-06-11 10:00:00+03',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-06-15 11:00:00+03',
        null, false, true, 'Interviewed'),
    ('5e0e2031-0000-4000-8000-000000000027', '1ead2031-0000-4000-8000-000000000027', 'lead',
        'Kibwana joined from another school mid-year and missed the topics tested.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2025-10-31 10:00:00+03',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2025-11-03 11:00:00+03',
        null, false, true, 'Interviewed');

commit;
