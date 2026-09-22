-- Local fixture data. Applied by `npx supabase db reset` only; hosted
-- databases never run this file. Every address uses the reserved .test
-- domain so no real person's details appear here.
--
--   staff@example.test         / fixture-password  on the allowlist
--   former-staff@example.test  / fixture-password  removed from the allowlist

insert into public.allowed_admin_emails (email) values
    ('staff@example.test'),
    ('former-staff@example.test');

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
    ('11111111-1111-4111-8111-111111111111'::uuid, 'staff@example.test'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'former-staff@example.test')
) as u(id, email);

insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
    u.id::text, u.id,
    jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
    'email', now(), now(), now()
from auth.users u
where u.email in ('staff@example.test', 'former-staff@example.test');

-- The former staff member keeps a working password but loses access.
delete from public.allowed_admin_emails where email = 'former-staff@example.test';
