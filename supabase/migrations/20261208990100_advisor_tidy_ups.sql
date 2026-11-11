-- Tidy-ups from Supabase's Performance and Security Advisors (#287).
--
-- 1. Indexes for seven foreign keys on tables that grow. Four stay without
--    one, as accepted advisor notices: agent_access_settings.changed_by and
--    interview_discount_setting.updated_by (single-row tables),
--    audit_action_kinds.permission (three rows, written by migrations only),
--    and agent_status_changes.old_agent_id (a check keeps it empty or equal
--    to agent_id, which already leads an index).
-- 2. A primary key for agent_link_requests, the one public table without one.
-- 3. One read policy on import_batches in place of one per kind.
-- 4. On hosted only: the Supabase-made event-trigger helper
--    public.rls_auto_enable() loses its execute grant to public, anon and
--    authenticated. No migration creates it, so locally and on CI the step
--    does nothing.

-- ---------------------------------------------------------------------------
-- 1. Foreign-key indexes
-- ---------------------------------------------------------------------------

-- The Super Admin's history screen filters by actor and orders newest first
-- (audit_entries), so the index carries that order.
create index audit_log_actor_staff_id_idx
    on public.audit_log (actor_staff_id, created_at desc, id desc)
    where actor_staff_id is not null;

create index leads_closed_by_idx on public.leads (closed_by) where closed_by is not null;
create index leads_declined_by_idx on public.leads (declined_by) where declined_by is not null;
create index interviews_registered_by_idx on public.interviews (registered_by);
create index reopening_requests_requested_by_idx on public.reopening_requests (requested_by);
create index reopening_requests_decided_by_idx on public.reopening_requests (decided_by) where decided_by is not null;
-- Deleting an auth user checks this table.
create index agent_detached_logins_user_id_idx on public.agent_detached_logins (user_id);

-- ---------------------------------------------------------------------------
-- 2. agent_link_requests: a primary key
-- ---------------------------------------------------------------------------

-- Two identical rows would stop the key; keep one of each.
delete from public.agent_link_requests a
using public.agent_link_requests b
where a.email_hash = b.email_hash
  and a.requested_at = b.requested_at
  and a.ctid > b.ctid;

alter table public.agent_link_requests
    add constraint agent_link_requests_pkey primary key (email_hash, requested_at);

-- The key's index covers the same two columns.
drop index public.agent_link_requests_email_idx;

-- ---------------------------------------------------------------------------
-- 3. import_batches: one read policy
-- ---------------------------------------------------------------------------

-- The kind list stays, so a future kind is not readable by default.
drop policy "Staff who may view leads read agent imports" on public.import_batches;
drop policy "Staff who may view leads read student imports" on public.import_batches;

create policy "Staff who may view leads read imports"
    on public.import_batches for select
    to authenticated
    using (kind in ('agents', 'students') and (select public.has_permission('leads.view')));

-- ---------------------------------------------------------------------------
-- 4. rls_auto_enable(): no execute for public, anon or authenticated
-- ---------------------------------------------------------------------------

-- Supabase's helper behind "enable RLS automatically on new tables" on hosted:
-- it returns event_trigger and the ensure_rls event trigger fires it, so a
-- direct call already fails. The function is left as it is apart from the
-- grant. It may belong to a role this migration can't act for: then the
-- revoke raises or changes nothing, and the migration still succeeds.
do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        begin
            revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
        exception when insufficient_privilege then
            raise warning 'rls_auto_enable(): could not revoke execute (%), left as it is', sqlerrm;
        end;
    end if;
end;
$$;
