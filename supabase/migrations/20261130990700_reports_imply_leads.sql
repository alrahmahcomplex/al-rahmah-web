-- reports.view implies leads.view (#244, owner decision of 2026-11-07).
-- Every Reports count is answered only under leads.view, so a role holding
-- reports.view without leads.view would open Reports and see nothing. No
-- role may hold one without the other.
--
-- A trigger on public.roles keeps the pair together on every write:
-- create_role, set_role_permission and any direct insert or update. It runs
-- before the write, so the one audit row the change already makes
-- (audit_row_change) shows the final set, implied permission included.
--
--   * A role that gains reports.view without leads.view also gains
--     leads.view.
--   * A role that loses leads.view while it holds reports.view also loses
--     reports.view. The change is not refused: unticking View leads unticks
--     View reports.
--
-- A check constraint backs the trigger, so a write that skips it (a
-- disabled trigger, a future migration) still cannot leave a role holding
-- reports.view alone.

select public.set_audit_actor('system');

-- Named to fire before normalize_role_permissions (triggers of the same
-- event fire in name order), so the implied name is checked, deduplicated
-- and sorted with the rest.
create function public.imply_role_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if 'reports.view' = any (new.permissions) and not ('leads.view' = any (new.permissions)) then
        if tg_op = 'UPDATE' and 'leads.view' = any (old.permissions) then
            -- leads.view is being taken away: reports.view goes with it.
            new.permissions := array_remove(new.permissions, 'reports.view');
        else
            new.permissions := array_append(new.permissions, 'leads.view');
        end if;
    end if;
    return new;
end;
$$;

revoke execute on function public.imply_role_permissions() from public, anon, authenticated;

create trigger imply_role_permissions
    before insert or update of permissions on public.roles
    for each row
    execute function public.imply_role_permissions();

-- The repair. Hosted has no such role today, so this is a safeguard. A role
-- found holding reports.view alone loses reports.view rather than gaining
-- leads.view: a migration does not widen anyone's access to family data
-- without the Super Admin, and the permission it removes showed nothing.
-- Each repaired role gets its own system audit row through
-- audit_row_change. The trigger above leaves this update alone, since the
-- new set holds neither name.
update public.roles
set permissions = array_remove(permissions, 'reports.view')
where 'reports.view' = any (permissions)
  and not ('leads.view' = any (permissions));

alter table public.roles
    add constraint roles_reports_view_needs_leads_view
    check (not ('reports.view' = any (permissions)) or 'leads.view' = any (permissions));

select set_config('audit.actor_kind', '', true);
