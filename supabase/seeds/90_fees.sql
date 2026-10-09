-- Slice 9 (Fee schedule, payments and Enrolled) fixtures. Seeds load in file-name order, after 00_base.sql.

-- The 2027 Fee schedule: the school's published band structure and amounts
-- from #20's resolution. #20 gives the instalments' months (November 2026,
-- April 2027, June 2027) but not their days, nor the minimum Initial deposit,
-- so the first of each month and TZS 300,000 stand in for them here. The
-- Academic-year start, 11 January 2027, is invented too.
begin;

select public.set_audit_actor('system');

insert into public.fee_schedules (
    enrollment_year, first_share, second_share, third_share, first_due, second_due, third_due,
    minimum_deposit, pre_form_one_day_fee, pre_form_one_boarding_fee, academic_year_start
) values (2027, 40, 40, 20, '2026-11-01', '2027-04-01', '2027-06-01', 300000, 450000, 580000, '2027-01-11');

insert into public.fee_band_amounts (enrollment_year, band, day_fee, boarding_fee) values
    (2027, 'nursery', 1100000, 3000000),
    (2027, 'primary_lower', 2000000, 3000000),
    (2027, 'primary_upper', 2100000, 3300000),
    (2027, 'secondary', 2800000, 4300000);

-- The Admissions Manager's 2027 seats, for a few classes only, so the rest
-- show Seats not set. KG 2 Boarding has 2 seats: the small class seat
-- counting tests fill with two leads (#111). Keep it at 2.
insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values
    (2027, 'KG 1', 'Day', 25),
    (2027, 'KG 2', 'Boarding', 2),
    (2027, 'STD 1', 'Day', 30),
    (2027, 'STD 1', 'Boarding', 15),
    (2027, 'FORM 1', 'Day', 40),
    (2027, 'FORM 1', 'Boarding', 30);

commit;

-- School-fee payments (#107): Passed leads in 2027 at each Seat priority.
-- Every parent and child is made up, and every number is +255 700 000 xxx.
-- Test Accountant recorded the payments. Each lead was interviewed and
-- Passed on 2026-09-22, with S/Ns after the earlier seeds' ones.
--
--   ADMSN-90901 Halima Malipo   STD 2 Day, TZS 2,000,000: no payment, no priority
--   ADMSN-90902 Juma Malipo     STD 2 Day, TZS 2,000,000: Initial deposit 300,000, Deposit
--   ADMSN-90903 Rehema Malipo   KG 1 Day, TZS 1,100,000: Initial deposit 500,000, past 40%, so First instalment
--   ADMSN-90904 Omari Malipo    STD 1 Day, TZS 2,000,000: Full payment 2,000,000, Full, so Enrolled
begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000901', 'Mwanaidi Malipo', 'Mother', null, '+255700000901', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000902', 'Bakari Malipo', 'Father', null, '+255700000902', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000903', 'Tatu Malipo', 'Mother', null, '+255700000903', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000904', 'Shabani Malipo', 'Father', null, '+255700000904', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000901', 'ADMSN-90901', 'Halima Malipo', 'STD 2', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000901', false),
    ('1ead0000-0000-4000-8000-000000000902', 'ADMSN-90902', 'Juma Malipo', 'STD 2', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000902', false),
    ('1ead0000-0000-4000-8000-000000000903', 'ADMSN-90903', 'Rehema Malipo', 'KG 1', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000903', false),
    ('1ead0000-0000-4000-8000-000000000904', 'ADMSN-90904', 'Omari Malipo', 'STD 1', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000904', false);

-- The next four 2027 S/Ns, after whatever the earlier seeds issued.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000901'::uuid, '1ead0000-0000-4000-8000-000000000901'::uuid, 71.0),
    (2, '1e7e0000-0000-4000-8000-000000000902'::uuid, '1ead0000-0000-4000-8000-000000000902'::uuid, 68.5),
    (3, '1e7e0000-0000-4000-8000-000000000903'::uuid, '1ead0000-0000-4000-8000-000000000903'::uuid, 82.0),
    (4, '1e7e0000-0000-4000-8000-000000000904'::uuid, '1ead0000-0000-4000-8000-000000000904'::uuid, 90.5)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 4 where enrollment_year = 2027;

insert into public.school_fee_payments (id, lead_id, payment_type, amount, paid_on, recorded_by, recorded_at) values
    ('fee00000-0000-4000-8000-000000000902', '1ead0000-0000-4000-8000-000000000902', 'initial_deposit', 300000,
        date '2026-09-25', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-25 10:00:00+03'),
    ('fee00000-0000-4000-8000-000000000903', '1ead0000-0000-4000-8000-000000000903', 'initial_deposit', 500000,
        date '2026-09-24', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-24 11:30:00+03'),
    ('fee00000-0000-4000-8000-000000000904', '1ead0000-0000-4000-8000-000000000904', 'full_payment', 2000000,
        date '2026-09-26', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-26 09:15:00+03');

-- Enrolled from the payments (#108), as recording them would have done:
-- Omari's Full payment enrols him on 2026-09-26. Rehema's First instalment
-- waits for the 2027 Academic-year start, and Juma's Deposit never enrols.
select public.recompute_lead_fee(l.id, 'payment')
from public.leads l
where l.id in (
    '1ead0000-0000-4000-8000-000000000902',
    '1ead0000-0000-4000-8000-000000000903',
    '1ead0000-0000-4000-8000-000000000904'
)
order by l.id;

commit;

-- Payment adjustments (#110) work on closed leads, so two closed 2027 leads
-- hold a payment each. Both Passed on 2026-09-22 and paid before closing.
--
--   ADMSN-90905 Zawadi Malipo   STD 3 Day: Initial deposit 400,000, then
--                               Declined from Interviewed (Family changed plans)
--   ADMSN-90906 Saidi Malipo    STD 4 Day: Initial deposit 300,000, then
--                               Archived (Admission cycle ended), still Interviewed
begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000905', 'Mwajuma Malipo', 'Mother', null, '+255700000905', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000906', 'Hassani Malipo', 'Father', null, '+255700000906', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined,
    declined_reason, declined_explanation, declined_at, declined_by, status_before_decline,
    closure_reason, closure_note, closed_at, closed_by
) values
    ('1ead0000-0000-4000-8000-000000000905', 'ADMSN-90905', 'Zawadi Malipo', 'STD 3', 2027, 'Day',
        'Declined', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000905', false,
        'Family changed plans', null, timestamptz '2026-09-29 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000001',
        'Interviewed',
        null, null, null, null),
    ('1ead0000-0000-4000-8000-000000000906', 'ADMSN-90906', 'Saidi Malipo', 'STD 4', 2027, 'Day',
        'Interviewed', 'Archived', date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000906', false,
        null, null, null, null, null,
        'Admission cycle ended', null, timestamptz '2026-09-30 15:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000001');

-- The next two 2027 S/Ns.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000905'::uuid, '1ead0000-0000-4000-8000-000000000905'::uuid, 74.0),
    (2, '1e7e0000-0000-4000-8000-000000000906'::uuid, '1ead0000-0000-4000-8000-000000000906'::uuid, 77.5)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 2 where enrollment_year = 2027;

insert into public.school_fee_payments (id, lead_id, payment_type, amount, paid_on, recorded_by, recorded_at) values
    ('fee00000-0000-4000-8000-000000000905', '1ead0000-0000-4000-8000-000000000905', 'initial_deposit', 400000,
        date '2026-09-23', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-23 10:00:00+03'),
    ('fee00000-0000-4000-8000-000000000906', '1ead0000-0000-4000-8000-000000000906', 'initial_deposit', 300000,
        date '2026-09-24', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-24 10:00:00+03');

commit;
