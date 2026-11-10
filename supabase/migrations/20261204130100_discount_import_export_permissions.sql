-- Three permissions for discount amounts, Promo codes, and the student import
-- and export (owner decisions of 2026-11-09).
--
--   discount_codes.manage  Set discount amounts and Promo codes: the standard
--                          interview discount, each agent's own amount, and
--                          every Promo code write. One permission for all
--                          three (owner decision 2).
--   leads.import           Import students from CSV.
--   leads.export           Export students: the contact columns. The view
--                          columns need only leads.view; the full columns
--                          only the Super Admin, by is_super_admin(), never
--                          by a permission.
--
-- No role receives them here. The Super Admin creates roles from the app's
-- templates (lib/role-templates.ts), where the Admissions Manager carries all
-- three, and holds every permission through has_permission.
--
-- Each one is useless without another, as reports.view is without leads.view
-- (20261130990700_reports_imply_leads.sql). imply_role_permissions now keeps
-- every pair in PERMISSION_NEEDS (lib/permissions.ts) together:
--
--   reports.view          needs leads.view
--   discount_codes.manage needs leads.view
--   leads.export          needs leads.view
--   leads.import          needs leads.create
--
-- Gaining a dependent without what it needs also gains what it needs; losing
-- what it needs also loses the dependent. A check constraint per pair backs
-- the trigger. audit.view stays the only reserved permission.

select public.set_audit_actor('system');

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'discount_codes.manage', 'Set discount amounts and Promo codes'
from public.permissions;

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'leads.import', 'Import students from CSV'
from public.permissions;

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'leads.export', 'Export students'
from public.permissions;

-- ---------------------------------------------------------------------------
-- imply_role_permissions, re-created with its trigger unchanged, for every
-- pair. None of the needed permissions needs another, so one pass settles
-- the set.
-- ---------------------------------------------------------------------------

create or replace function public.imply_role_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    pair record;
begin
    for pair in
        select * from (values
            ('reports.view', 'leads.view'),
            ('discount_codes.manage', 'leads.view'),
            ('leads.export', 'leads.view'),
            ('leads.import', 'leads.create')
        ) as needs (dependent, needed)
    loop
        if pair.dependent = any (new.permissions) and not (pair.needed = any (new.permissions)) then
            if tg_op = 'UPDATE' and pair.needed = any (old.permissions) then
                -- What it needs is being taken away: the dependent goes with it.
                new.permissions := array_remove(new.permissions, pair.dependent);
            else
                new.permissions := array_append(new.permissions, pair.needed);
            end if;
        end if;
    end loop;
    return new;
end;
$$;

revoke execute on function public.imply_role_permissions() from public, anon, authenticated;

-- No role holds the new names yet, so nothing needs repair.
alter table public.roles
    add constraint roles_discount_codes_manage_needs_leads_view
        check (not ('discount_codes.manage' = any (permissions)) or 'leads.view' = any (permissions)),
    add constraint roles_leads_export_needs_leads_view
        check (not ('leads.export' = any (permissions)) or 'leads.view' = any (permissions)),
    add constraint roles_leads_import_needs_leads_create
        check (not ('leads.import' = any (permissions)) or 'leads.create' = any (permissions));

select set_config('audit.actor_kind', '', true);
