-- Local fixture data. Applied by `npm run db:reset` only; hosted databases
-- never run this file. Every address uses the reserved .test domain and every
-- name is made up, so no real person's details appear here. tests/support/fixtures.ts
-- names the same people. Every account's password is fixture-password.
--
--   manager@example.test        Admissions Manager
--   second-manager@example.test Admissions Manager
--   admissions@example.test     Admissions Staff
--   accountant@example.test     Accountant
--   deactivated@example.test    Admissions Staff, deactivated
--   retired-role@example.test   Receptionist (a retired role), deactivated
--   invited@example.test        Admissions Staff, invited, with no account yet

begin;

-- Staff and roles are audited, and an audited write needs an actor.
select public.set_audit_actor('system');

insert into public.roles (name, permissions) values
    ('Receptionist', array['leads.view', 'leads.create']);

insert into public.staff_members (id, full_name, email, role_id)
select s.id, s.full_name, s.email, r.id
from (values
    ('a1a1a1a1-0000-4000-8000-000000000001'::uuid, 'Test Manager', 'manager@example.test', 'Admissions Manager'),
    ('a1a1a1a1-0000-4000-8000-000000000002'::uuid, 'Second Manager', 'second-manager@example.test', 'Admissions Manager'),
    ('a1a1a1a1-0000-4000-8000-000000000003'::uuid, 'Test Admissions', 'admissions@example.test', 'Admissions Staff'),
    ('a1a1a1a1-0000-4000-8000-000000000004'::uuid, 'Test Accountant', 'accountant@example.test', 'Accountant'),
    ('a1a1a1a1-0000-4000-8000-000000000005'::uuid, 'Deactivated Staff', 'deactivated@example.test', 'Admissions Staff'),
    ('a1a1a1a1-0000-4000-8000-000000000006'::uuid, 'Retired Role Staff', 'retired-role@example.test', 'Receptionist'),
    ('a1a1a1a1-0000-4000-8000-000000000007'::uuid, 'Invited Staff', 'invited@example.test', 'Admissions Staff')
) as s(id, full_name, email, role_name)
join public.roles r on r.name = s.role_name;

-- Creating each account links it to the staff record with the same email.
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
)
select
    '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
    extensions.crypt('fixture-password', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(),
    '', '', '', ''
from (values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'manager@example.test'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'second-manager@example.test'),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'admissions@example.test'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'accountant@example.test'),
    ('55555555-5555-4555-8555-555555555555'::uuid, 'deactivated@example.test'),
    ('66666666-6666-4666-8666-666666666666'::uuid, 'retired-role@example.test')
) as u(id, email);

insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
    u.id::text, u.id,
    jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
    'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test';

-- They keep working passwords but have left: deactivated, and the
-- Receptionist role retired once nobody active held it.
update public.staff_members
set active = false
where email in ('deactivated@example.test', 'retired-role@example.test');

update public.roles set retired = true where name = 'Receptionist';

-- Leads, for the front desk and lead screens. Every parent and child is made
-- up, and every number is +255 700 000 xxx, so nothing here is a real family.
-- Admission Numbers are fixed so tests can name them.
--
--   ADMSN-90001 Zawadi Fixture       Applied, no visit yet
--   ADMSN-90002 Baraka Fixture       Visited, first of a two-child Family
--   ADMSN-90003 Neema Fixture        Visited, her brother's Family (Returning family)
--   ADMSN-90004 Salma Fixture        Visited, WhatsApp differs from the direct phone
--   ADMSN-90005 Hamisi Fixture       Visited, Archived
--   ADMSN-90006 Rehema Fixture       Declined from Visited: Family changed plans

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000001', 'Amani Fixture', 'Mother', null, '+255700000101', null, 'admission_form'),
    ('c0c0c0c0-0000-4000-8000-000000000002', 'Juma Fixture', 'Father', null, '+255700000102', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000003', 'Fatuma Fixture', 'Other', 'Aunt', '+255700000103', '+255700000113', 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000004', 'Omari Fixture', 'Guardian', null, '+255700000104', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000005', 'Halima Fixture', 'Mother', null, '+255700000105', null, 'front_desk');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined,
    declined_reason, status_before_decline
) values
    ('1ead0000-0000-4000-8000-000000000001', 'ADMSN-90001', 'Zawadi Fixture', 'STD 1', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000001', false, null, null),
    ('1ead0000-0000-4000-8000-000000000002', 'ADMSN-90002', 'Baraka Fixture', 'STD 3', 2027, 'Boarding',
        'Visited', null, date '2026-09-01', 'c0c0c0c0-0000-4000-8000-000000000002', false, null, null),
    ('1ead0000-0000-4000-8000-000000000003', 'ADMSN-90003', 'Neema Fixture', 'KG 2', 2027, 'Day',
        'Visited', null, date '2026-09-02', 'c0c0c0c0-0000-4000-8000-000000000002', true, null, null),
    ('1ead0000-0000-4000-8000-000000000004', 'ADMSN-90004', 'Salma Fixture', 'FORM 1', 2027, 'Boarding',
        'Visited', null, date '2026-09-03', 'c0c0c0c0-0000-4000-8000-000000000003', false, null, null),
    ('1ead0000-0000-4000-8000-000000000005', 'ADMSN-90005', 'Hamisi Fixture', 'STD 5', 2027, 'Day',
        'Visited', 'Archived', date '2026-08-20', 'c0c0c0c0-0000-4000-8000-000000000004', false, null, null),
    ('1ead0000-0000-4000-8000-000000000006', 'ADMSN-90006', 'Rehema Fixture', 'STD 2', 2027, 'Day',
        'Declined', null, date '2026-08-21', 'c0c0c0c0-0000-4000-8000-000000000005', false,
        'Family changed plans', 'Visited');

commit;

-- Recording a visit: an Applied lead of its own, which the lead screen test
-- moves to Visited and puts back, so ADMSN-90001 stays Applied for every
-- other test. Its name leaves out "Fixture", so a name search for the leads
-- above still finds those six only.
--
--   ADMSN-90047 Imani Arrival        Applied, recorded as visited by e2e/record-visit.spec.ts

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000047', 'Mwajuma Arrival', 'Mother', null, '+255700000147', null, 'admission_form');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000047', 'ADMSN-90047', 'Imani Arrival', 'STD 2', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000047', false);

commit;

-- An unconfirmed Family match: two children the Admission form sent on one
-- contact, whose phone matched a parent already on file with one child. The
-- lead screen test confirms it and puts it back.
--
--   ADMSN-90048 Tumaini Kinship      Visited, the known Family
--   ADMSN-90049 Upendo Kinship       Applied, unconfirmed (Returning family)
--   ADMSN-90050 Furaha Kinship       Applied, unconfirmed, same form (Returning family)

begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (
    id, full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
) values
    ('c0c0c0c0-0000-4000-8000-000000000048', 'Khadija Kinship', 'Mother', null, '+255700000148', null,
        'front_desk', null),
    ('c0c0c0c0-0000-4000-8000-000000000049', 'Khadija A. Kinship', 'Mother', null, '+255700000148', null,
        'admission_form', 'c0c0c0c0-0000-4000-8000-000000000048');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined
) values
    ('1ead0000-0000-4000-8000-000000000048', 'ADMSN-90048', 'Tumaini Kinship', 'STD 4', 2027, 'Day',
        'Visited', null, date '2026-09-10', 'c0c0c0c0-0000-4000-8000-000000000048', false),
    ('1ead0000-0000-4000-8000-000000000049', 'ADMSN-90049', 'Upendo Kinship', 'STD 1', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000049', true),
    ('1ead0000-0000-4000-8000-000000000050', 'ADMSN-90050', 'Furaha Kinship', 'KG 2', 2027, 'Boarding',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000049', true);

commit;
