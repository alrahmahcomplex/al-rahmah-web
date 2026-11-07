-- The Reports permission (#241, owner decision of 2026-11-07). Reports, the
-- statistics page that was the staff home until #226, was shown to holders
-- of staff.administer who could also view leads. Roles v2 retired
-- staff.administer (20261130990500_roles_from_templates.sql), so Reports
-- gets its own permission, granted like any ordinary one.
--
-- No role receives it here: on hosted no role exists after the reset, and
-- the Super Admin creates roles from the app's templates
-- (lib/role-templates.ts), which carry it for the Admissions Manager, Head
-- Accountant and Administrator. The Super Admin holds it through
-- has_permission, like every permission. Row security is unchanged.

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'reports.view', 'View reports'
from public.permissions;
