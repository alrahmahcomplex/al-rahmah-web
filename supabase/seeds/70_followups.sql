-- Slice 7 (Follow-ups and the queue) fixtures. Seeds load in file-name order, after 00_base.sql.
--
-- Follow-ups on slice 2's invented leads, dated from the day the seed runs in
-- Tanzania, so the queue always has something overdue, due today and due
-- next week:
--
--   ADMSN-90002 Baraka Fixture   due 4 days ago (overdue)
--   ADMSN-90003 Neema Fixture    due today
--   ADMSN-90004 Salma Fixture    due in 7 days, moved there from 3 days ahead
--   ADMSN-90005 Hamisi Fixture   Archived, with a follow-up planned before it closed

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
insert into public.follow_ups (id, lead_id, due_on, note, replaces_id, change_reason, created_at) values
    ('f0110000-0000-4000-8000-000000000014', '1ead0000-0000-4000-8000-000000000004',
        public.tanzania_today() + 7, 'Confirm the Form 1 interview date.', 'f0110000-0000-4000-8000-000000000004',
        'The parent is travelling until next week.', now() - interval '1 day');

commit;
