-- Slice 7 (Follow-ups and the queue) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- Follow-ups on slice 2's invented leads, dated from the day the seed runs in
-- Tanzania, so the queue always has something overdue, due today and due
-- next week:
--
--   ADMSN-90002 Baraka Fixture   due 4 days ago (overdue)
--   ADMSN-90003 Neema Fixture    due today
--   ADMSN-90004 Salma Fixture    due in 7 days, moved there from 3 days ahead
--   ADMSN-90005 Hamisi Fixture   Archived, with a follow-up planned before it
--                                closed and closed with the lead (#93)
--
-- And the contacts recorded on them (#91):
--
--   Baraka  a phone call 11 days ago that closed the follow-up due 12 days
--           ago and planned the overdue one; made by Deactivated Staff and
--           entered a day later
--   Neema   an unplanned WhatsApp from the family 5 days ago that planned
--           today's follow-up
--
-- And a lead reopened after a decline with no follow-up date yet (#95), so
-- Overdue shows it as Needs a follow-up date:
--
--   ADMSN-90070 Amani Rejea      declined from Visited for Family changed
--                                plans, then approved by Test Manager 3 days
--                                ago: Visited again, Initially declined
--
-- Slice 8's seed (80_closure.sql) loads after this file, so the lead and its
-- request are written here as rows, the way that file writes its own.

begin;

select public.set_audit_actor('system');

insert into public.follow_ups (id, lead_id, due_on, note, replaces_id, change_reason, created_at) values
    ('f0110000-0000-4000-8000-000000000002', '1ead0000-0000-4000-8000-000000000002',
        public.tanzania_today() - 4, 'Ask whether the family has chosen a boarding house.', null, null, now() - interval '10 days'),
    ('f0110000-0000-4000-8000-000000000003', '1ead0000-0000-4000-8000-000000000003',
        public.tanzania_today(), null, null, null, now() - interval '5 days'),
    ('f0110000-0000-4000-8000-000000000004', '1ead0000-0000-4000-8000-000000000004',
        public.tanzania_today() + 3, 'Confirm the Form 1 interview date.', null, null, now() - interval '3 days'),
    ('f0110000-0000-4000-8000-000000000005', '1ead0000-0000-4000-8000-000000000005',
        public.tanzania_today() - 20, 'Check whether the family is still interested.', null, null, now() - interval '30 days');

-- Salma's follow-up moved a week out. Inserted after the one it replaces.
insert into public.follow_ups (id, lead_id, due_on, note, replaces_id, change_reason, replaced_due_on, created_at) values
    ('f0110000-0000-4000-8000-000000000014', '1ead0000-0000-4000-8000-000000000004',
        public.tanzania_today() + 7, 'Confirm the Form 1 interview date.', 'f0110000-0000-4000-8000-000000000004',
        'The parent is travelling until next week.', public.tanzania_today() + 3, now() - interval '1 day');

-- Baraka's earlier follow-up, closed by the call below.
insert into public.follow_ups (id, lead_id, due_on, note, created_at) values
    ('f0110000-0000-4000-8000-000000000012', '1ead0000-0000-4000-8000-000000000002',
        public.tanzania_today() - 12, 'Introduce the boarding houses.', now() - interval '20 days');

insert into public.follow_up_records (
    id, lead_id, follow_up_id, kind, outcome, comment, method, contacted_by, contacted_at, entered_at, next_follow_up_id
) values
    ('f0120000-0000-4000-8000-000000000002', '1ead0000-0000-4000-8000-000000000002',
        'f0110000-0000-4000-8000-000000000012', 'contact', 'next_date',
        'Spoke with the mother. She will visit the boarding houses with her husband first.',
        'Phone call', 'a1a1a1a1-0000-4000-8000-000000000005', now() - interval '11 days', now() - interval '10 days',
        'f0110000-0000-4000-8000-000000000002'),
    ('f0120000-0000-4000-8000-000000000003', '1ead0000-0000-4000-8000-000000000003',
        null, 'contact', 'next_date',
        'The father messaged to ask about the interview fee. Told him the amount and the dates.',
        'WhatsApp', 'a1a1a1a1-0000-4000-8000-000000000003', now() - interval '5 days', now() - interval '5 days',
        'f0110000-0000-4000-8000-000000000003');

-- Hamisi's follow-up, closed when the lead was archived. 00_base.sql closes
-- the lead before this file plants the follow-up, so the trigger that closes
-- a follow-up with its lead never saw it: the record is planted too.
insert into public.follow_up_records (id, lead_id, follow_up_id, kind, cause, entered_at) values
    ('f0120000-0000-4000-8000-000000000005', '1ead0000-0000-4000-8000-000000000005',
        'f0110000-0000-4000-8000-000000000005', 'closed_with_lead', 'archived', now() - interval '25 days');

commit;

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000070', 'Zainabu Rejea', 'Mother', null, '+255700000170', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined, initially_declined
) values
    ('1ead0000-0000-4000-8000-000000000070', 'ADMSN-90070', 'Amani Rejea', 'STD 3', 2027, 'Day',
        'Visited', null, public.tanzania_today() - 30, 'c0c0c0c0-0000-4000-8000-000000000070', false, true);

-- Raised by Test Admissions, approved by Test Manager.
insert into public.reopening_requests (
    id, lead_id, source, reason, requested_by, requested_at,
    state, decided_by, decided_at, enrol_without_retake, lead_was_declined, restored_status
) values
    ('5e0e0000-0000-4000-8000-000000000070', '1ead0000-0000-4000-8000-000000000070', 'lead',
        'The family moved back to Dar and wants a place again.',
        'a1a1a1a1-0000-4000-8000-000000000003', now() - interval '4 days',
        'approved', 'a1a1a1a1-0000-4000-8000-000000000001', now() - interval '3 days',
        null, true, 'Visited');

commit;
