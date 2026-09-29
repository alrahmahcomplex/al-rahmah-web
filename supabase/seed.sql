-- Local fixture data. Applied by `npm run db:reset` only; hosted databases
-- never run this file. Every address uses the reserved .test domain and every
-- name is made up, so no real person's details appear here. e2e/fixtures.ts
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

commit;
