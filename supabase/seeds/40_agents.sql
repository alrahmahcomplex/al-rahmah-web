-- Slice 4 (Marketing Agents) fixtures. Seeds load in file-name order, after 00_base.sql.

-- A Pending and an Approved Marketing Agent, with invented names and numbers.
-- Registered well in the past, so they head the Pending list, oldest first,
-- above any agent a test registers.
begin;

select public.set_audit_actor('system');

insert into public.marketing_agents (id, full_name, phone, whatsapp, code, registered_at) values
    ('a4a4a4a4-0000-4000-8000-000000000001', 'Zawadi Neema Mwakasege', '+255700000401', null, 'ZNM-401',
     '2026-01-05 09:00+03');

insert into public.marketing_agents (
    id, full_name, phone, whatsapp, code, status, registered_at, approved_at, approved_by
) values (
    'a4a4a4a4-0000-4000-8000-000000000002', 'Baraka Juma Njoroge', '+255700000402', '+255700000412', 'BJN-402',
    'Approved', '2026-01-04 09:00+03', '2026-01-06 10:30+03', 'a1a1a1a1-0000-4000-8000-000000000001'
);

commit;
