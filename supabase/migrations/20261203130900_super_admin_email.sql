-- The Super Admin's email becomes marketing.alrahmah@gmail.com (owner
-- decision of 2026-11-09). The name stays Al-Rahmah Complex.
--
-- refuse_super_admin_holder_change freezes the holder's name and email for
-- every database role, so this lifts it by name for the one update and puts
-- it back, as 20261130990300_super_admin_role.sql says a change to the
-- holder needs. The staff_members audit trigger records the change with
-- `system` as the actor.
--
-- This changes the staff record only. A login already linked to the record
-- keeps the email it signed up with until that is changed under
-- Authentication > Users; a record with no login yet takes its first login
-- from the new address (link_staff_account matches by email).

select public.set_audit_actor('system');

alter table public.staff_members disable trigger refuse_super_admin_holder_change;

update public.staff_members
set email = 'marketing.alrahmah@gmail.com'
where id = '5a000000-0000-4000-8000-000000000002';

alter table public.staff_members enable trigger refuse_super_admin_holder_change;

select set_config('audit.actor_kind', '', true);
