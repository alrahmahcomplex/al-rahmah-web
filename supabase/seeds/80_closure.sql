-- Slice 8 (Decline, Inactive/Archive and reopening) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- 00_base.sql already holds the closed leads slice 8 reads: ADMSN-90005
-- Hamisi Fixture (Visited, Archived) and ADMSN-90006 Rehema Fixture
-- (Declined from Visited, Family changed plans); #98 gave ADMSN-90005 its
-- closure reason there. Below, a Family with one closed child and one open
-- one, whose shared parent stays editable from the open child's screen (#96),
-- a lead declined after its interview (#97), an Inactive lead, and a lead both
-- Declined and Archived (#98).
-- Their names leave out "Fixture", so a name search for the base leads still
-- finds those six only.
--
--   ADMSN-90080 Asha Kibwana         Declined from Visited: Unreachable after follow-up
--   ADMSN-90081 Daudi Kibwana        Visited, the open sibling
--   ADMSN-90082 Kheri Mwinyi         Declined from Interviewed: Did not pass interview,
--                                    by Test Admissions, with an explanation
--   ADMSN-90083 Pendo Lyimo          Visited, Inactive: No longer pursuing admission,
--                                    by Test Admissions, with a note
--   ADMSN-90084 Jabiri Lyimo         Declined from Visited: Enrolled elsewhere, then
--                                    Archived: Admission cycle ended, by Test Manager

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000080', 'Mariamu Kibwana', 'Mother', null, '+255700000180', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000082', 'Saidi Mwinyi', 'Father', null, '+255700000182', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000083', 'Neema Lyimo', 'Mother', null, '+255700000183', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000084', 'Yohana Lyimo', 'Father', null, '+255700000184', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined,
    declined_reason, declined_explanation, declined_at, declined_by, status_before_decline,
    closure_reason, closure_note, closed_at, closed_by
) values
    ('1ead0000-0000-4000-8000-000000000080', 'ADMSN-90080', 'Asha Kibwana', 'STD 6', 2027, 'Day',
        'Declined', null, date '2026-08-24', 'c0c0c0c0-0000-4000-8000-000000000080', false,
        'Unreachable after follow-up', null, null, null, 'Visited',
        null, null, null, null),
    ('1ead0000-0000-4000-8000-000000000081', 'ADMSN-90081', 'Daudi Kibwana', 'STD 2', 2027, 'Day',
        'Visited', null, date '2026-08-24', 'c0c0c0c0-0000-4000-8000-000000000080', true,
        null, null, null, null, null,
        null, null, null, null),
    ('1ead0000-0000-4000-8000-000000000082', 'ADMSN-90082', 'Kheri Mwinyi', 'FORM 1', 2027, 'Day',
        'Declined', null, date '2026-08-25', 'c0c0c0c0-0000-4000-8000-000000000082', false,
        'Did not pass interview', 'Scored below the pass mark; the family will try again next year.',
        timestamptz '2026-09-15 10:30:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', 'Interviewed',
        null, null, null, null),
    ('1ead0000-0000-4000-8000-000000000083', 'ADMSN-90083', 'Pendo Lyimo', 'STD 3', 2027, 'Day',
        'Visited', 'Inactive', date '2026-08-26', 'c0c0c0c0-0000-4000-8000-000000000083', false,
        null, null, null, null, null,
        'No longer pursuing admission', 'The family is waiting to hear about a job transfer.',
        timestamptz '2026-09-18 11:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003'),
    ('1ead0000-0000-4000-8000-000000000084', 'ADMSN-90084', 'Jabiri Lyimo', 'STD 7', 2027, 'Day',
        'Declined', 'Archived', date '2026-08-27', 'c0c0c0c0-0000-4000-8000-000000000084', false,
        'Enrolled elsewhere', null, timestamptz '2026-09-10 09:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000003', 'Visited',
        'Admission cycle ended', null,
        timestamptz '2026-09-30 14:00:00+03', 'a1a1a1a1-0000-4000-8000-000000000001');

commit;

-- A Pending Reopening request (#99) on ADMSN-90080 Asha Kibwana, raised from
-- the lead screen by Test Admissions. Other staff see "Reopening already
-- requested" on her reopen page, and Test Admissions sees Withdraw.

begin;

select public.set_audit_actor('system');

insert into public.reopening_requests (id, lead_id, source, reason, requested_by, requested_at)
values
    ('5e0e0000-0000-4000-8000-000000000080', '1ead0000-0000-4000-8000-000000000080', 'lead',
        'The family has a new phone number and wants Asha to start in January.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-28 09:15:00+03');

commit;

-- Decided Reopening requests (#101), both raised by Test Admissions and
-- decided by Test Manager.
--
--   ADMSN-90082 Kheri Mwinyi         rejected with a reason; still Declined
--   ADMSN-90085 Zuhura Mfinanga      Declined from Visited, then approved: Visited
--                                    again, Initially declined, Reopened after decline

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000085', 'Rukia Mfinanga', 'Mother', null, '+255700000185', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined, initially_declined
) values
    ('1ead0000-0000-4000-8000-000000000085', 'ADMSN-90085', 'Zuhura Mfinanga', 'STD 4', 2027, 'Day',
        'Visited', null, date '2026-08-28', 'c0c0c0c0-0000-4000-8000-000000000085', false, true);

insert into public.reopening_requests (
    id, lead_id, source, reason, requested_by, requested_at,
    state, decided_by, decided_at, rejection_reason, enrol_without_retake, lead_was_declined, restored_status
) values
    ('5e0e0000-0000-4000-8000-000000000082', '1ead0000-0000-4000-8000-000000000082', 'lead',
        'The family says Kheri has been tutored over the holidays.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-20 10:00:00+03',
        'rejected', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-22 15:30:00+03',
        'He can sit the interview again next year; this year''s places are filled.', null, null, null),
    ('5e0e0000-0000-4000-8000-000000000085', '1ead0000-0000-4000-8000-000000000085', 'duplicate_match',
        'The family came back to the front desk after their move fell through.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-24 09:00:00+03',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-25 11:45:00+03',
        null, null, true, 'Visited');

commit;

-- Reopened after an interview that was not Passed (#115). Each was declined
-- from Interviewed for Did not pass interview, then approved by Test Manager
-- with a retake choice. Both Failed on 2026-09-22, in STD 5 Day 2027, and
-- hold no payment yet.
--
--   ADMSN-90086 Salma Kisanga    Enrol without a retaken interview: the
--                                Accountant may record school-fee payments
--   ADMSN-90087 Musa Kisanga     Retake the interview: payments are refused
--                                until a retaken interview is Passed

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000086', 'Amina Kisanga', 'Mother', null, '+255700000186', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000087', 'Ali Kisanga', 'Father', null, '+255700000187', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined, initially_declined
) values
    ('1ead0000-0000-4000-8000-000000000086', 'ADMSN-90086', 'Salma Kisanga', 'STD 5', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000086', false, true),
    ('1ead0000-0000-4000-8000-000000000087', 'ADMSN-90087', 'Musa Kisanga', 'STD 5', 2027, 'Day',
        'Interviewed', null, date '2026-09-14', 'c0c0c0c0-0000-4000-8000-000000000087', false, true);

-- The next two 2027 S/Ns, after whatever the earlier seeds issued.
insert into public.interviews (id, lead, serial_number, serial_year, registered_at, registered_by, interview_date, result, score)
select i.id, i.lead, c.last_number + i.n, 2027, timestamptz '2026-09-15 11:00:00+03',
    'a1a1a1a1-0000-4000-8000-000000000003', date '2026-09-22', 'Failed', i.score
from public.interview_serial_counters c
cross join (values
    (1, '1e7e0000-0000-4000-8000-000000000086'::uuid, '1ead0000-0000-4000-8000-000000000086'::uuid, 47.5),
    (2, '1e7e0000-0000-4000-8000-000000000087'::uuid, '1ead0000-0000-4000-8000-000000000087'::uuid, 39.0)
) as i(n, id, lead, score)
where c.enrollment_year = 2027;

update public.interview_serial_counters set last_number = last_number + 2 where enrollment_year = 2027;

insert into public.reopening_requests (
    id, lead_id, source, reason, requested_by, requested_at,
    state, decided_by, decided_at, rejection_reason, enrol_without_retake, lead_was_declined, restored_status
) values
    ('5e0e0000-0000-4000-8000-000000000086', '1ead0000-0000-4000-8000-000000000086', 'lead',
        'Salma missed the pass mark by a few points and her term report is strong.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-29 09:00:00+03',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-30 10:00:00+03',
        null, true, true, 'Interviewed'),
    ('5e0e0000-0000-4000-8000-000000000087', '1ead0000-0000-4000-8000-000000000087', 'lead',
        'Musa was unwell on the interview day and the family asks for another sitting.',
        'a1a1a1a1-0000-4000-8000-000000000003', timestamptz '2026-09-29 09:30:00+03',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', timestamptz '2026-09-30 10:15:00+03',
        null, false, true, 'Interviewed');

commit;
