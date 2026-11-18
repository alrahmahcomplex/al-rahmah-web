-- visits.record implies payments.view (#460, owner decisions of 2026-11-17).
-- Whoever can register or check in a student also sees school-fee payments:
-- the Register students fee step reads the Fee schedule (#308), and check-in
-- (#309) needs only visits.record, so visits.record alone is enough.
--
-- imply_role_permissions gains the pair, with the same two rules as the
-- others (20261204130100_discount_import_export_permissions.sql):
--
--   * A role that gains visits.record without payments.view also gains
--     payments.view.
--   * A role that loses payments.view while it holds visits.record also
--     loses visits.record.
--
-- payments.view needs nothing and nothing needs visits.record, so one pass
-- still settles the set. A check constraint backs the trigger.

select public.set_audit_actor('system');

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
            ('leads.import', 'leads.create'),
            ('visits.record', 'payments.view')
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

-- The repair. Unlike 20261130990700, it widens access: the owner decided
-- that a role able to check in students sees school-fee payments, so a role
-- holding visits.record without payments.view gains payments.view rather
-- than losing check-in. Retired roles are repaired too, so the constraint
-- holds on every row. Each repaired role gets its own system audit row
-- through audit_row_change. The PR for #460 lists the hosted roles this
-- changes.
update public.roles
set permissions = array_append(permissions, 'payments.view')
where 'visits.record' = any (permissions)
  and not ('payments.view' = any (permissions));

alter table public.roles
    add constraint roles_visits_record_needs_payments_view
    check (not ('visits.record' = any (permissions)) or 'payments.view' = any (permissions));

select set_config('audit.actor_kind', '', true);
