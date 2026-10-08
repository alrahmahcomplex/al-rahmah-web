-- Slice 6 (Result release) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- Every parent and child is made up, and every number is +255 700 000 6xx.
-- Enrollment year 2028, so the 2027 interview list and the dashboard's 2031
-- stay as their tests expect. Nothing here has been released: tests that
-- release a result use leads of their own.
--
--   ADMSN-90601 Imani Matokeo     Passed with 82% on 2026-09-24, fee Paid. The parent has a
--                                 separate WhatsApp number, which the link uses.
--   ADMSN-90602 Faraji Matokeo    Failed with 45% on 2026-09-24, fee Paid. Direct phone only.
--   ADMSN-90603 Upendo Matokeo    Passed with 70.5% on 2026-09-24, fee Not Paid.
--   ADMSN-90604 Tumaini Matokeo   Reopened after a decline and interviewed again: the earlier
--                                 interview Failed with 38% (fee Paid), the current one Passed
--                                 with 74% (fee Paid). Only the current result may be sent.

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000601', 'Mwanaisha Matokeo', 'Mother', null, '+255700000601', '+255700000602', 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000602', 'Bakari Matokeo', 'Father', null, '+255700000603', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000603', 'Pendo Matokeo', 'Mother', null, '+255700000604', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000604', 'Selemani Matokeo', 'Guardian', null, '+255700000605', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined, initially_declined
) values
    ('1ead0000-0000-4000-8000-000000000601', 'ADMSN-90601', 'Imani Matokeo', 'FORM 1', 2028, 'Boarding',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000601', false, false),
    ('1ead0000-0000-4000-8000-000000000602', 'ADMSN-90602', 'Faraji Matokeo', 'STD 3', 2028, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000602', false, false),
    ('1ead0000-0000-4000-8000-000000000603', 'ADMSN-90603', 'Upendo Matokeo', 'KG 2', 2028, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000603', false, false),
    ('1ead0000-0000-4000-8000-000000000604', 'ADMSN-90604', 'Tumaini Matokeo', 'STD 6', 2028, 'Day',
        'Interviewed', null, date '2026-09-08', 'c0c0c0c0-0000-4000-8000-000000000604', false, true);

-- Registered by Test Admissions, as the lead screen would have done it, with
-- each result recorded after its interview.
insert into public.interview_serial_counters (enrollment_year, last_number) values (2028, 5);

insert into public.interviews (
    id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score
)
values
    ('1e7e0000-0000-4000-8000-000000000601', '1ead0000-0000-4000-8000-000000000601', 2, 2028,
        timestamptz '2026-09-15 09:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-24', 'Passed', 82),
    ('1e7e0000-0000-4000-8000-000000000602', '1ead0000-0000-4000-8000-000000000602', 3, 2028,
        timestamptz '2026-09-15 09:15:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-24', 'Failed', 45),
    ('1e7e0000-0000-4000-8000-000000000603', '1ead0000-0000-4000-8000-000000000603', 4, 2028,
        timestamptz '2026-09-15 09:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-24', 'Passed', 70.5),
    -- Tumaini's first interview, before the decline and the reopening.
    ('1e7e0000-0000-4000-8000-000000000604', '1ead0000-0000-4000-8000-000000000604', 1, 2028,
        timestamptz '2026-09-09 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-10', 'Failed', 38),
    -- The retaken interview after the reopening: the current one.
    ('1e7e0000-0000-4000-8000-000000000605', '1ead0000-0000-4000-8000-000000000604', 5, 2028,
        timestamptz '2026-09-28 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-30', 'Passed', 74);

commit;

-- The fees marked Paid by Test Accountant, locking the full TZS 50,000, so the
-- leads' histories show the Accountant's payment changes. Upendo's stays
-- Not Paid.
begin;

select public.set_audit_actor('staff', 'a1a1a1a1-0000-4000-8000-000000000004');

update public.interviews
set fee_status = 'Paid', locked_amount = 50000, locked_discount_applied = false
where id in (
    '1e7e0000-0000-4000-8000-000000000601',
    '1e7e0000-0000-4000-8000-000000000602',
    '1e7e0000-0000-4000-8000-000000000604',
    '1e7e0000-0000-4000-8000-000000000605'
);

commit;
