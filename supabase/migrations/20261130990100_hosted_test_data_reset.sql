-- Resets the hosted database once before launch (#197; owner decision 42 of
-- 2026-11-06: "Don't keep anything. Wipe everything out: all the staff
-- accounts, student data, and everything that is user created."). Every row
-- a person made goes: test leads, families, interviews, payments, Marketing
-- Agents, staff members and every Supabase Auth login. Only what migrations
-- themselves create stays: the schema, permissions, roles, the audit scope and
-- action-kind lists, and the agent access switch row, set off. The one
-- reviewed exception to ADR 4's append-only history.
--
-- A fresh, local or CI database is untouched: migrations run before seeds, so
-- it finds no leads, agents or staff members and does nothing. On a database
-- that holds data it:
--
-- 1. checks that every table in `public` is on its cleared or kept list, and
--    stops on one that is on neither;
-- 2. does nothing when the hosted reset record already exists, or when there
--    are no leads, no agents and no staff members;
-- 3. stops, with the counts, when any lead, agent or staff member is newer
--    than the cutoff below;
-- 4. switches agent access off as `system`, which also frees the switch row's
--    reference to the staff member who last changed it;
-- 5. disables each cleared table's delete refusal by name, then deletes the
--    rows, children before parents, never with truncate; the audit log goes
--    the same way, row by row;
-- 6. deletes every Supabase Auth identity and user;
-- 7. turns the refusals back on, then checks that every cleared table is
--    empty, every kept table's count is unchanged, auth.users and
--    auth.identities are empty, every trigger in `public` is enabled and the
--    switch is off; any failure raises and rolls everything back;
-- 8. writes the one surviving audit row: the hosted reset record, as
--    `system`, with the count cleared from each table.
--
-- Afterwards nobody can sign in. The owner bootstraps the first staff member
-- as docs/agents/hosted-services.md describes ("The first staff member").
--
-- Applying this to a seeded local database clears the fixtures; `npm run
-- db:reset` restores them. tests/integration/hosted-test-data-reset.test.ts
-- runs it in transactions that are rolled back.

-- agent_access_settings had the delete refusal but not the truncate refusal
-- every other audited table carries (ADR 4). The permanent trigger test,
-- tests/integration/refusal-triggers.test.ts, checks both, so it gets the
-- second one here. "or replace" lets the local test apply this file again
-- to a database that already ran it.
create or replace trigger refuse_truncate
    before truncate on public.agent_access_settings
    for each statement
    execute function public.refuse_delete();

do $$
declare
    -- SET AT MERGE (#197): cutoff. The owner or orchestrator replaces this
    -- with the moment hosted acceptance finished and hosted writes were
    -- frozen. A lead, agent or staff member newer than it stops the
    -- migration. As checked in it lies in the past, so any data stops it.
    cutoff constant timestamptz := '2020-01-01 00:00:00+00';

    -- The tables emptied, in deletion order: children before parents. The
    -- audit log goes first because it references leads and staff members;
    -- staff members go last because everything else references them.
    cleared constant text[] := array[
        'audit_log',
        'payment_adjustments', 'lead_fee_profiles', 'school_fee_payments', 'discount_requests',
        'follow_up_records', 'follow_ups', 're_applications', 'reopening_requests',
        'whatsapp_group_invitations', 'interviews', 'leads', 'admission_submissions', 'guardian_contacts',
        'agent_detached_logins', 'agent_email_claims', 'agent_events', 'agent_status_changes',
        'agent_invite_batches', 'agent_link_requests', 'marketing_agents', 'import_batches',
        'class_seats', 'fee_band_amounts', 'fee_schedules', 'whatsapp_group_links',
        'interview_serial_counters', 'staff_members'];

    -- The tables kept: rows only migrations write, plus roles, which ADR 3
    -- lets Managers edit and which stay as they are for the owner to review
    -- after bootstrap.
    kept constant text[] := array['agent_access_settings', 'audit_action_kinds', 'audit_scopes', 'permissions', 'roles'];

    unclassified text[];
    unknown text[];
    record_id bigint;
    newer_leads bigint;
    newer_agents bigint;
    newer_staff bigint;
    before_counts jsonb := '{}';
    kept_counts jsonb := '{}';
    cleared_counts jsonb := '{}';
    switch_audit_rows bigint;
    expected bigint;
    users_before bigint;
    identities_before bigint;
    disabled text[] := '{}';
    still_disabled text[];
    t text;
    n bigint;
begin
    -- 1. Every table is classified, and every listed table exists.
    select array_agg(c.relname order by c.relname) into unclassified
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname <> all (cleared)
      and c.relname <> all (kept);
    if unclassified is not null then
        raise exception 'hosted_reset_unclassified_table'
            using detail = format('not on the cleared or kept list: %s', array_to_string(unclassified, ', '));
    end if;

    select array_agg(name order by name) into unknown
    from unnest(cleared || kept) as name
    where to_regclass('public.' || name) is null;
    if unknown is not null then
        raise exception 'hosted_reset_unknown_table'
            using detail = format('listed but not in the database: %s', array_to_string(unknown, ', '));
    end if;

    -- 2. Nothing to do.
    select id into record_id from public.audit_log where action = 'hosted_reset' order by id limit 1;
    if record_id is not null then
        raise notice 'Hosted reset (#197): skipped, the reset record already exists (audit_log id %)', record_id;
        return;
    end if;

    if not exists (select 1 from public.leads)
       and not exists (select 1 from public.marketing_agents)
       and not exists (select 1 from public.staff_members) then
        raise notice 'Hosted reset (#197): skipped, no leads, agents or staff members to clear';
        return;
    end if;

    -- 3. Data newer than the cutoff stops it. Never skip silently.
    select count(*) into newer_leads from public.leads where created_at > cutoff;
    select count(*) into newer_agents from public.marketing_agents where registered_at > cutoff;
    select count(*) into newer_staff from public.staff_members where created_at > cutoff;
    if newer_leads + newer_agents + newer_staff > 0 then
        raise exception 'hosted_reset_newer_than_cutoff'
            using detail = format('%s leads, %s agents and %s staff members are newer than the cutoff %s',
                                  newer_leads, newer_agents, newer_staff, cutoff);
    end if;

    -- The counts before anything changes: what the owner's export shows, for
    -- the self-checks and the record.
    foreach t in array cleared loop
        execute format('select count(*) from public.%I', t) into n;
        before_counts := before_counts || jsonb_build_object(t, n);
    end loop;
    foreach t in array kept loop
        execute format('select count(*) from public.%I', t) into n;
        kept_counts := kept_counts || jsonb_build_object(t, n);
    end loop;
    select count(*) into users_before from auth.users;
    select count(*) into identities_before from auth.identities;

    -- 4. Agent access off, as system. The switch row then references no
    --    staff member, so the staff members can go. Its own audit row is
    --    written here and goes with the rest.
    perform public.set_audit_actor('system');
    perform public.set_agent_access(false);
    select count(*) - (before_counts ->> 'audit_log')::bigint into switch_audit_rows from public.audit_log;

    -- 5. Each cleared table's delete refusal off, by name, for the length of
    --    this transaction. The truncate refusals stay on: nothing here
    --    truncates. All of them first, because a table with trigger events
    --    still queued cannot be altered.
    foreach t in array cleared loop
        if t = 'audit_log' then
            alter table public.audit_log disable trigger refuse_audit_log_change;
            disabled := array_append(disabled, 'audit_log.refuse_audit_log_change');
        elsif exists (select 1 from pg_trigger
                      where tgrelid = format('public.%I', t)::regclass and tgname = 'refuse_delete') then
            execute format('alter table public.%I disable trigger refuse_delete', t);
            disabled := array_append(disabled, t || '.refuse_delete');
        end if;
    end loop;

    -- Delete, children first.
    foreach t in array cleared loop
        execute format('delete from public.%I', t);
        get diagnostics n = row_count;
        cleared_counts := cleared_counts || jsonb_build_object(t, n);
    end loop;

    -- 6. Every login. Sessions, refresh tokens and the other per-user auth
    --    rows cascade from auth.users.
    delete from auth.identities;
    delete from auth.users;

    -- 7. Refusals back on, then the self-checks. The deferred foreign key
    --    from agent_status_changes to marketing_agents queues its checks for
    --    commit; running them now frees the tables to be altered.
    set constraints all immediate;
    foreach t in array cleared loop
        if t = 'audit_log' then
            alter table public.audit_log enable trigger refuse_audit_log_change;
        elsif (t || '.refuse_delete') = any (disabled) then
            execute format('alter table public.%I enable trigger refuse_delete', t);
        end if;
    end loop;

    foreach t in array cleared loop
        execute format('select count(*) from public.%I', t) into n;
        if n <> 0 then
            raise exception 'hosted_reset_table_not_empty' using detail = format('%s still holds %s rows', t, n);
        end if;
        expected := (before_counts ->> t)::bigint + case when t = 'audit_log' then switch_audit_rows else 0 end;
        if (cleared_counts ->> t)::bigint <> expected then
            raise exception 'hosted_reset_count_mismatch'
                using detail = format('%s: %s rows deleted, %s expected', t, cleared_counts ->> t, expected);
        end if;
    end loop;

    foreach t in array kept loop
        execute format('select count(*) from public.%I', t) into n;
        if n <> (kept_counts ->> t)::bigint then
            raise exception 'hosted_reset_kept_table_changed'
                using detail = format('%s: %s rows now, %s before', t, n, kept_counts ->> t);
        end if;
    end loop;

    select count(*) into n from auth.users;
    if n <> 0 then
        raise exception 'hosted_reset_auth_users_remain' using detail = format('%s rows', n);
    end if;
    select count(*) into n from auth.identities;
    if n <> 0 then
        raise exception 'hosted_reset_auth_identities_remain' using detail = format('%s rows', n);
    end if;

    select array_agg(c.relname || '.' || tr.tgname order by c.relname, tr.tgname) into still_disabled
    from pg_trigger tr
    join pg_class c on c.oid = tr.tgrelid
    where c.relnamespace = 'public'::regnamespace
      and not tr.tgisinternal
      and tr.tgenabled not in ('O', 'A');
    if still_disabled is not null then
        raise exception 'hosted_reset_trigger_disabled' using detail = array_to_string(still_disabled, ', ');
    end if;

    if exists (select 1 from public.agent_access_settings where enabled) then
        raise exception 'hosted_reset_agent_access_on';
    end if;

    -- 8. The record: the one audit row that survives, which a rerun finds.
    insert into public.audit_log (action, new_values, scope, actor_kind)
    values (
        'hosted_reset',
        jsonb_build_object(
            'ticket', '#197',
            'decision', 42,
            'cutoff', cutoff,
            -- The rows each table held before the reset, as an export taken
            -- before the merge counts them.
            'cleared', before_counts,
            -- The switch's own audit row, written and deleted by this reset.
            'audit_rows_written_by_reset', switch_audit_rows,
            'auth_users', users_before,
            'auth_identities', identities_before,
            'agent_access', 'off'
        ),
        'staff_admin',
        'system'
    );

    select count(*) into n from public.audit_log;
    if n <> 1 then
        raise exception 'hosted_reset_record_not_alone' using detail = format('%s audit rows', n);
    end if;

    perform set_config('audit.actor_kind', '', true);

    raise notice 'Hosted reset (#197): cleared % tables, % auth users and % identities; agent access off',
        array_length(cleared, 1), users_before, identities_before;
end;
$$;
