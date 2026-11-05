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

-- Three open leads carrying a Referral code (#80), one per state the lead
-- screen shows: the Approved agent's code, the Pending agent's, and a code no
-- agent holds, as the Admission form keeps a mistyped one. Invented families
-- with +255 700 000 43x numbers. Tests read them and leave them as they are.
--
--   ADMSN-90431 Asha Referral    BJN-402, Approved: TZS 40,000 (TZS 10,000 off)
--   ADMSN-90432 Juma Referral    ZNM-401, Pending: TZS 50,000
--   ADMSN-90433 Tatu Referral    XYZ-999, Unrecognised: TZS 50,000
begin;

select public.set_audit_actor('system');

insert into public.guardian_contacts (id, full_name, relationship, relationship_description, phone, whatsapp, origin)
values
    ('c0c0c0c0-0000-4000-8000-000000000431', 'Mwanaidi Referral', 'Mother', null, '+255700000431', null, 'admission_form'),
    ('c0c0c0c0-0000-4000-8000-000000000432', 'Hassani Referral', 'Father', null, '+255700000432', null, 'front_desk'),
    ('c0c0c0c0-0000-4000-8000-000000000433', 'Subira Referral', 'Mother', null, '+255700000433', null, 'admission_form');

insert into public.leads (
    id, admission_number, student_name, class_name, enrollment_year, day_or_boarding,
    status, closure, visit_date, guardian_contact_id, returning_family_joined, referral_code
) values
    ('1ead0000-0000-4000-8000-000000000431', 'ADMSN-90431', 'Asha Referral', 'STD 2', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000431', false, 'BJN-402'),
    ('1ead0000-0000-4000-8000-000000000432', 'ADMSN-90432', 'Juma Referral', 'STD 6', 2027, 'Boarding',
        'Visited', null, date '2026-09-18', 'c0c0c0c0-0000-4000-8000-000000000432', false, 'ZNM-401'),
    ('1ead0000-0000-4000-8000-000000000433', 'ADMSN-90433', 'Tatu Referral', 'KG 1', 2027, 'Day',
        'Applied', null, null, 'c0c0c0c0-0000-4000-8000-000000000433', false, 'XYZ-999');

commit;

-- Slice 12 (Marketing Agent accounts, #188). The seeded agent with a login,
-- for the security tests: Approved, switched on, with a confirmed email and
-- the shared fixture password. The record comes first, then the auth user
-- (whose sign-up trigger links it to the record), then its identity. Agent
-- paths need agent access on, so the seeds turn it on as `system`.
begin;

select public.set_audit_actor('system');
select public.set_agent_access(true);

insert into public.marketing_agents (
    id, full_name, phone, whatsapp, email, code, status, registered_at, approved_at, approved_by
) values (
    'a4a4a4a4-0000-4000-8000-000000000003', 'Saida Amina Mtei', '+255700000403', null, 'agent@example.test', 'SAM-403',
    'Approved', '2026-01-03 09:00+03', '2026-01-06 11:00+03', 'a1a1a1a1-0000-4000-8000-000000000001'
);

insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) values (
    '00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated',
    'agent@example.test', extensions.crypt('fixture-password', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}',
    now(), now(),
    '', '', '', ''
);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
    '77777777-7777-4777-8777-777777777777', '77777777-7777-4777-8777-777777777777',
    jsonb_build_object('sub', '77777777-7777-4777-8777-777777777777', 'email', 'agent@example.test', 'email_verified', true),
    'email', now(), now(), now()
);

commit;
