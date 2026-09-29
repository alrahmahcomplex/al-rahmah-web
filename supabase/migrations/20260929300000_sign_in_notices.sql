-- Sign-in notices (ADR 4): a staff member is told, on the staff home, when
-- someone else changed their role or their active state.
--
-- A notice is an audit_log update to the caller's own staff_members row that
-- changed role_id or active, made by any actor other than the caller, and
-- newer than the caller's notices_seen_at. Updating notices_seen_at changes
-- neither column, so dismissing never counts as a notice.

-- Audit rows take the time they are written, not the time their transaction
-- started. A write to a staff member holds that row's lock until it commits,
-- so the audit rows about one person are timed in the order they commit. A
-- notice timed before the newest one a person was shown was therefore already
-- committed and on screen, and dismissing through the newest one can't hide a
-- change that was still in flight.
alter table public.audit_log alter column created_at set default clock_timestamp();

-- Whether an audit row is a notice for this staff member, apart from being
-- newer than their notices_seen_at: an update to their row that changed their
-- role or active state, made by any actor but them.
create function public.is_notice_for(entry public.audit_log, staff_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select entry.table_name = 'staff_members'
        and entry.row_id = is_notice_for.staff_id
        and entry.action = 'update'
        and (entry.new_values ? 'role_id' or entry.new_values ? 'active')
        and entry.actor_staff_id is distinct from is_notice_for.staff_id;
$$;

revoke execute on function public.is_notice_for(public.audit_log, uuid) from public, anon, authenticated;

-- The caller's notices, oldest first. Names are looked up now, so a role
-- renamed since shows under its current name, and a deactivated actor still
-- shows by name. old_role and new_role are empty when the role didn't change;
-- active is empty when the active state didn't.
create function public.my_notices()
returns table (
    id bigint,
    created_at timestamptz,
    actor_kind text,
    actor_name text,
    old_role text,
    new_role text,
    active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        a.id,
        a.created_at,
        a.actor_kind,
        actor.full_name,
        old_role.name,
        new_role.name,
        (a.new_values ->> 'active')::boolean
    from public.staff_members me
    join public.audit_log a
        on public.is_notice_for(a, me.id)
        and a.created_at > me.notices_seen_at
    left join public.staff_members actor on actor.id = a.actor_staff_id
    left join public.roles old_role on old_role.id = (a.old_values ->> 'role_id')::uuid
    left join public.roles new_role on new_role.id = (a.new_values ->> 'role_id')::uuid
    where me.user_id = auth.uid()
      and me.active
    order by a.created_at, a.id;
$$;

revoke execute on function public.my_notices() from public, anon;
grant execute on function public.my_notices() to authenticated;

-- Dismisses the caller's notices up to and including the given one. It takes
-- the newest notice the person was shown, not "now", so a change that lands
-- between showing the notices and pressing Dismiss is still shown next time.
--
-- It changes one column, notices_seen_at, on one row, the caller's own, and
-- takes nothing that could name another row or column. Every other write to
-- staff_members goes through the guardrailed staff-admin functions.
create function public.dismiss_notices(through bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    me public.staff_members;
    seen_through timestamptz;
begin
    select * into me from public.staff_members s where s.user_id = auth.uid() and s.active for update;
    if not found then
        raise exception 'not_staff';
    end if;

    select a.created_at into seen_through
    from public.audit_log a
    where a.id = dismiss_notices.through
      and public.is_notice_for(a, me.id);
    if not found then
        raise exception 'not_found';
    end if;

    -- Never moves backwards, so dismissing an older notice from a stale page
    -- can't bring back notices already dismissed.
    if seen_through > me.notices_seen_at then
        update public.staff_members set notices_seen_at = seen_through where id = me.id;
    end if;
end;
$$;

revoke execute on function public.dismiss_notices(bigint) from public, anon;
grant execute on function public.dismiss_notices(bigint) to authenticated;
