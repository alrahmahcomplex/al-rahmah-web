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

-- Staff child and Qualified orphan discounts (#112): three Passed 2027 leads,
-- one for each state a request can be in. Test Admissions raised each
-- request and Test Manager decided the two decided ones.
--
--   ADMSN-90907 Neema Ruzuku    KG 1 Day: a Pending Staff child request
--   ADMSN-90908 Baraka Ruzuku   STD 1 Day: a granted Qualified orphan
--                               discount, so a School fee of 0 and no
--                               payment yet: the Accountant may record Fee
--                               waived
--   ADMSN-90909 Upendo Ruzuku   STD 2 Day: a refused Staff child request
begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000907', 'Zuhura Ruzuku', 'Mother', null, '+255700000907', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000908', 'Mariamu Ruzuku', 'Guardian', null, '+255700000908', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000909', 'Selemani Ruzuku', 'Father', null, '+255700000909', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000907', 'ADMSN-90907', 'Neema Ruzuku', 'KG 1', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000907', false),
    ('1ead0000-0000-4000-8000-000000000908', 'ADMSN-90908', 'Baraka Ruzuku', 'STD 1', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000908', false),
    ('1ead0000-0000-4000-8000-000000000909', 'ADMSN-90909', 'Upendo Ruzuku', 'STD 2', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000909', false);

-- The next three 2027 S/Ns.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000907'::uuid, '1ead0000-0000-4000-8000-000000000907'::uuid, 79.0),
    (2, '1e7e0000-0000-4000-8000-000000000908'::uuid, '1ead0000-0000-4000-8000-000000000908'::uuid, 85.5),
    (3, '1e7e0000-0000-4000-8000-000000000909'::uuid, '1ead0000-0000-4000-8000-000000000909'::uuid, 72.0)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 3 where enrollment_year = 2027;

insert into public.discount_requests (
    id, lead_id, kind, note, requested_by, requested_at, state, decided_by, decided_at, refusal_reason
) values
    ('d15c0000-0000-4000-8000-000000000907', '1ead0000-0000-4000-8000-000000000907', 'staff_child',
        'Mother teaches Year 3 at the primary school.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-28 09:00:00+03',
        'pending', null, null, null),
    ('d15c0000-0000-4000-8000-000000000908', '1ead0000-0000-4000-8000-000000000908', 'qualified_orphan',
        'Both parents have died; the aunt is the guardian. Letter from the ward office seen.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-23 10:00:00+03',
        'granted', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-24 14:00:00+03', null),
    ('d15c0000-0000-4000-8000-000000000909', '1ead0000-0000-4000-8000-000000000909', 'staff_child',
        'Father drives the school bus.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-23 11:00:00+03',
        'refused', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-24 14:10:00+03',
        'The bus is run by a contractor, so he is not school staff.');

commit;

-- The seat warning on approving a reopening (#103): two Declined 2027 leads
-- with a payment and a Pending Reopening request raised by Test Admissions,
-- one in a full class and one in a class with room, and the lead holding the
-- full class's one seat. Each Passed on 2026-09-22 and paid before any
-- decline. STD 6 Boarding has 1 seat for this.
--
--   ADMSN-90910 Amani Kiwelu    STD 6 Boarding: Initial deposit 300,000,
--                               Deposit, holding the class's one seat
--   ADMSN-90911 Faraji Kiwelu   STD 6 Boarding: Initial deposit 1,320,000,
--                               First instalment, then Declined from
--                               Interviewed (Fees or cost): approving warns
--                               that the class is full and ranks him first
--   ADMSN-90912 Imani Kiwelu    STD 1 Boarding (15 seats): Initial deposit
--                               300,000, then Declined from Interviewed (Fees
--                               or cost): approving shows no warning
begin;

select public.set_audit_actor('system');

insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values
    (2027, 'STD 6', 'Boarding', 1);

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000910', 'Zainabu Kiwelu', 'Mother', null, '+255700000910', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000911', 'Hamza Kiwelu', 'Father', null, '+255700000911', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000912', 'Subira Kiwelu', 'Mother', null, '+255700000912', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined,
    declined_reason, declined_explanation, declined_at, declined_by, status_before_decline
) values
    ('1ead0000-0000-4000-8000-000000000910', 'ADMSN-90910', 'Amani Kiwelu', 'STD 6', 2027, 'Boarding',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000910', false,
        null, null, null, null, null),
    ('1ead0000-0000-4000-8000-000000000911', 'ADMSN-90911', 'Faraji Kiwelu', 'STD 6', 2027, 'Boarding',
        'Declined', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000911', false,
        'Fees or cost', null, timestamptz '2026-09-30 10:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000001', 'Interviewed'),
    ('1ead0000-0000-4000-8000-000000000912', 'ADMSN-90912', 'Imani Kiwelu', 'STD 1', 2027, 'Boarding',
        'Declined', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000912', false,
        'Fees or cost', null, timestamptz '2026-09-30 10:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000001', 'Interviewed');

-- The next three 2027 S/Ns.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000910'::uuid, '1ead0000-0000-4000-8000-000000000910'::uuid, 76.0),
    (2, '1e7e0000-0000-4000-8000-000000000911'::uuid, '1ead0000-0000-4000-8000-000000000911'::uuid, 81.5),
    (3, '1e7e0000-0000-4000-8000-000000000912'::uuid, '1ead0000-0000-4000-8000-000000000912'::uuid, 73.0)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 3 where enrollment_year = 2027;

insert into public.school_fee_payments (id, lead_id, payment_type, amount, paid_on, recorded_by, recorded_at) values
    ('fee00000-0000-4000-8000-000000000910', '1ead0000-0000-4000-8000-000000000910', 'initial_deposit', 300000,
        date '2026-09-25', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-25 12:00:00+03'),
    ('fee00000-0000-4000-8000-000000000911', '1ead0000-0000-4000-8000-000000000911', 'initial_deposit', 1320000,
        date '2026-09-23', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-23 12:00:00+03'),
    ('fee00000-0000-4000-8000-000000000912', '1ead0000-0000-4000-8000-000000000912', 'initial_deposit', 300000,
        date '2026-09-24', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-24 12:00:00+03');

select public.recompute_lead_fee('1ead0000-0000-4000-8000-000000000910', 'payment');

insert into public.reopening_requests (id, lead_id, source, reason, requested_by, requested_at)
values
    ('5e0e0000-0000-4000-8000-000000000911', '1ead0000-0000-4000-8000-000000000911', 'lead',
        'An uncle has offered to pay the rest of the fee.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-10-01 09:00:00+03'),
    ('5e0e0000-0000-4000-8000-000000000912', '1ead0000-0000-4000-8000-000000000912', 'lead',
        'The family has sold land and can now pay the fee.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-10-01 09:30:00+03');

commit;

-- The Sibling discount (#113): a confirmed two-child Family and an
-- unconfirmed one, all Passed on 2026-09-22.
--
--   Confirmed Family, Mwanahawa Ndugu (+255 700 000 913):
--   ADMSN-90913 Bahati Ndugu    STD 5 Day: Full payment 2,100,000, Enrolled
--                               first, so she pays the full fee
--   ADMSN-90914 Furaha Ndugu    STD 3 Day: Initial deposit 300,000; her
--                               sister is Enrolled, so a School fee of
--                               2,000,000 less 10%: 1,800,000
--
--   Unconfirmed Family: the Admission form matched Rashidi Pendo's number,
--   and staff haven't confirmed the match yet.
--   ADMSN-90916 Tumaini Pendo   STD 4 Day: Full payment 2,000,000, Enrolled
--   ADMSN-90917 Zuberi Pendo    KG 2 Day: Initial deposit 300,000, on the
--                               Admission form's contact with a pending
--                               match to Tumaini's: no Sibling discount, a
--                               School fee of 1,100,000
begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000913', 'Mwanahawa Ndugu', 'Mother', null, '+255700000913', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000916', 'Rashidi Pendo', 'Father', null, '+255700000916', null, 'front_desk');

insert into public.guardian_contacts (
    id, full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
) values
    ('c0c0c0c0-0000-4000-8000-000000000917', 'Rashidi Pendo', 'Father', null, '+255700000916', null, 'admission_form',
        'c0c0c0c0-0000-4000-8000-000000000916');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000913', 'ADMSN-90913', 'Bahati Ndugu', 'STD 5', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000913', false),
    ('1ead0000-0000-4000-8000-000000000914', 'ADMSN-90914', 'Furaha Ndugu', 'STD 3', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000913', true),
    ('1ead0000-0000-4000-8000-000000000916', 'ADMSN-90916', 'Tumaini Pendo', 'STD 4', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000916', false),
    ('1ead0000-0000-4000-8000-000000000917', 'ADMSN-90917', 'Zuberi Pendo', 'KG 2', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000917', true);

-- The next four 2027 S/Ns.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Passed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000913'::uuid, '1ead0000-0000-4000-8000-000000000913'::uuid, 84.0),
    (2, '1e7e0000-0000-4000-8000-000000000914'::uuid, '1ead0000-0000-4000-8000-000000000914'::uuid, 78.5),
    (3, '1e7e0000-0000-4000-8000-000000000916'::uuid, '1ead0000-0000-4000-8000-000000000916'::uuid, 80.0),
    (4, '1e7e0000-0000-4000-8000-000000000917'::uuid, '1ead0000-0000-4000-8000-000000000917'::uuid, 75.5)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 4 where enrollment_year = 2027;

insert into public.school_fee_payments (id, lead_id, payment_type, amount, paid_on, recorded_by, recorded_at) values
    ('fee00000-0000-4000-8000-000000000913', '1ead0000-0000-4000-8000-000000000913', 'full_payment', 2100000,
        date '2026-09-25', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-25 14:00:00+03'),
    ('fee00000-0000-4000-8000-000000000914', '1ead0000-0000-4000-8000-000000000914', 'initial_deposit', 300000,
        date '2026-09-26', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-26 14:00:00+03'),
    ('fee00000-0000-4000-8000-000000000916', '1ead0000-0000-4000-8000-000000000916', 'full_payment', 2000000,
        date '2026-09-25', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-25 15:00:00+03'),
    ('fee00000-0000-4000-8000-000000000917', '1ead0000-0000-4000-8000-000000000917', 'initial_deposit', 300000,
        date '2026-09-26', 'a1a1a1a1-0000-4000-8000-000000000004', timestamptz '2026-09-26 15:00:00+03');

-- As recording the payments would have done: Bahati's and Tumaini's Full
-- payments enrol them, and Bahati's enrolment gives Furaha the discount.
select public.recompute_lead_fee(l.id, 'payment')
from public.leads l
where l.id in (
    '1ead0000-0000-4000-8000-000000000913',
    '1ead0000-0000-4000-8000-000000000916'
)
order by l.id;

commit;
