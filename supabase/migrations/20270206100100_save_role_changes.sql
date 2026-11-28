-- The Roles page saves once (owner request of 2026-11-27, prototype
-- VthmqWypofP6y4c9ZpY2uL v3). Selecting a box changes only the screen; Save
-- changes sends every change to the role in one call, here.
--
--   * Only what changed is sent: the permissions and managed roles added and
--     taken away. Another Super Admin's save of other boxes on the same role
--     is kept; on the same box, the later save wins.
--   * All or nothing: one refusal and nothing is saved.
--   * One History entry per save. Each audit row now records its
--     transaction, so the History groups the rows one save wrote.
--
-- set_role_permission and set_role_manages stay as they are for the
-- database's own tests; the app no longer calls them.

-- ---------------------------------------------------------------------------
-- 1. Which transaction wrote each audit row. Rows written before this
--    migration have none and read as one entry each, as before. The default
--    is set after the column is added, so no existing row is rewritten.
-- ---------------------------------------------------------------------------

alter table public.audit_log add column transaction_id bigint;
alter table public.audit_log alter column transaction_id set default txid_current();

comment on column public.audit_log.transaction_id is
    'The transaction that wrote the row (txid_current()). Rows one Roles save wrote share it, so the History shows them as one entry.';

-- ---------------------------------------------------------------------------
-- 2. One save of a role's permissions and managed set.
-- ---------------------------------------------------------------------------

create function public.save_role_changes(
    role_id uuid,
    add_permissions text[],
    remove_permissions text[],
    add_managed_role_ids uuid[],
    remove_managed_role_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    adds text[] := coalesce(save_role_changes.add_permissions, '{}');
    removes text[] := coalesce(save_role_changes.remove_permissions, '{}');
    manage_adds uuid[] := coalesce(save_role_changes.add_managed_role_ids, '{}');
    manage_removes uuid[] := coalesce(save_role_changes.remove_managed_role_ids, '{}');
    target public.roles;
    saved text[];
    managed_id uuid;
begin
    perform public.require_super_admin();

    -- A box can't be both added and taken away in one save.
    if adds && removes or manage_adds && manage_removes then
        raise exception 'conflicting_changes';
    end if;
    if exists (
        select 1 from unnest(adds || removes) as p (name)
        where p.name is null
           or p.name = 'audit.view'
           or not exists (select 1 from public.permissions x where x.name = p.name)
    ) then
        raise exception 'unknown_permission';
    end if;
    if array_position(manage_adds || manage_removes, null) is not null then
        raise exception 'not_found';
    end if;

    if cardinality(adds) + cardinality(removes) > 0 then
        -- Locks the role until commit, so two saves of one role run one after
        -- the other and each applies its changes to the other's result.
        target := public.editable_role(save_role_changes.role_id);
        saved := array(
            select distinct p from unnest(target.permissions || adds) as p
            where not (p = any (removes))
        );
        -- imply_role_permissions and normalize_role_permissions run on the
        -- update, so a pair stays together and the one audit row shows the
        -- final set.
        if not (saved @> target.permissions and target.permissions @> saved) then
            update public.roles set permissions = saved where id = target.id;
        end if;
    end if;

    -- As set_role_manages: switching a pair on needs both roles current;
    -- switching one off works on a retired role too.
    foreach managed_id in array manage_adds loop
        perform public.write_managed_pair(save_role_changes.role_id, managed_id, true);
    end loop;
    foreach managed_id in array manage_removes loop
        perform public.write_managed_pair(save_role_changes.role_id, managed_id, false);
    end loop;

    return public.role_names(save_role_changes.role_id);
end;
$$;

revoke execute on function public.save_role_changes(uuid, text[], text[], uuid[], uuid[]) from public, anon;
grant execute on function public.save_role_changes(uuid, text[], text[], uuid[], uuid[]) to authenticated;
