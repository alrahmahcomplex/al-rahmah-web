-- The Super Admin may record a follow-up as the one who made the contact
-- (#476, owner decision of 2026-11-18).
--
-- is_contact_staff, which record_follow_up asks about contacted_by and
-- list_contact_staff asks about each staff member, looked only at the role's
-- permission list. The Super Admin role keeps none: has_permission
-- recognises it by its id (20261130990300_super_admin_role.sql). So the
-- Super Admin could record a contact but not name themselves as the one who
-- made it.
--
-- It now also accepts the active Super Admin, but only when the Super Admin
-- is the one asking. No other staff member sees the Super Admin in the
-- "Made the contact" list or may record a contact in their name, as
-- hidden_staff_member keeps them out of other staff lists.
--
-- A contact the Super Admin records names them to everyone who reads the
-- lead's follow-ups (follow_up_record_staff), the way a school-fee payment
-- they record names them on Home and in the payment's history.
--
-- service_role joins the revoke: the helpers this now calls,
-- super_admin_role_id() and current_staff_id(), are revoked from it too.

create or replace function public.is_contact_staff(staff_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1
        from public.staff_members s
        join public.roles r on r.id = s.role_id
        where s.id = is_contact_staff.staff_id
          and s.active
          and not r.retired
          and (
              'follow_ups.record' = any (r.permissions)
              or (r.id = public.super_admin_role_id() and s.id = public.current_staff_id())
          )
    );
$$;

revoke execute on function public.is_contact_staff(uuid) from public, anon, authenticated, service_role;
