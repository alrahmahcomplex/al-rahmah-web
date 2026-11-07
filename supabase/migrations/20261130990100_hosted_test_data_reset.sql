-- Resets the hosted database once before launch (#197; owner decision 42 of
-- 2026-11-06: "Don't keep anything. Wipe everything out: all the staff
-- accounts, student data, and everything that is user created."). Every row
-- a person made goes: test leads, families, interviews, payments, Marketing
-- Agents, staff members, every Supabase Auth login, and every role, whatever
-- a Manager named it. Only what migrations themselves create stays: the
-- schema, permissions, the audit scope and action-kind lists, the agent
-- access switch row, set off, and the three seeded roles, inserted fresh with
-- the permissions the migrations give them. The one reviewed exception to
-- ADR 4's append-only history.
--
-- A fresh, local or CI database is untouched: migrations run before seeds, so
-- it finds no leads, agents or staff members and does nothing. On a database
-- that holds data it:
--
-- 1. checks that every base table in the schemas the API exposes is on its
--    cleared, kept or restored list, and stops on one that is on none;
-- 2. does nothing when the hosted reset record already exists, or when there
--    are no leads, no agents and no staff members;
-- 3. stops when the cutoff below still holds the value checked in, and stops,
--    with the counts, when any lead, agent or staff member is newer than it;
-- 4. switches agent access off as `system`, which also frees the switch row's
--    reference to the staff member who last changed it;
-- 5. disables each cleared table's delete refusal by name, then deletes the
--    rows, children before parents, never with truncate; the audit log goes
--    the same way, row by row; then every role, after which the three seeded
--    roles are inserted fresh, Admissions Manager first, and the audit rows
--    the inserts write are deleted too;
-- 6. deletes every Supabase Auth identity and user;
-- 7. turns the refusals back on, then checks that every cleared table is
--    empty, every kept table's count is unchanged, exactly the three seeded
--    roles exist, as new rows with their expected permissions, auth.users
--    and auth.identities are empty, every trigger in the exposed schemas is
--    enabled and the switch is off; any failure raises and rolls everything
--    back;
-- 8. writes the one surviving audit row: the hosted reset record, as
--    `system`, with the count cleared from each table and the name of every
--    role removed.
--
-- It changes no schema: the only DDL is disabling and re-enabling the named
-- triggers inside its transaction.
--
-- Afterwards nobody can sign in. The owner bootstraps the first staff member
-- as docs/agents/hosted-services.md describes ("The first staff member").
--
-- Applying this to a seeded local database clears the fixtures; `npm run
-- db:reset` restores them. tests/integration/hosted-test-data-reset.test.ts
-- runs it in transactions that are rolled back.

do $$
declare
    -- The owner edits the next line at merge, replacing the literal with the
    -- moment hosted acceptance finished and hosted writes were frozen, and
    -- nothing else. tests/integration/hosted-test-data-reset.test.ts reads
    -- the value from the marked line.
    cutoff constant timestamptz := '2026-11-07 14:04:40+00'; -- SET AT MERGE (#197): cutoff
    -- The literal as checked in. A cutoff still equal to it was never set,
    -- and step 3 then stops before any delete: the placeholder is no guard
    -- on its own, since data dated before 2020 would pass it.
    cutoff_sentinel constant timestamptz := '2020-01-01 00:00:00+00';

    -- The schemas the API exposes (supabase/config.toml, `[api] schemas`).
    -- Every base table in them is classified below. Supabase keeps no base
    -- table of its own in either (its own live in auth, storage, realtime,
    -- supabase_migrations, vault, extensions and graphql), so nothing is
    -- excluded by name: a table here that this migration does not know stops
    -- it.
    exposed constant text[] := array['public', 'graphql_public'];

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

    -- The tables kept: rows only migrations write.
    kept constant text[] := array['agent_access_settings', 'audit_action_kinds', 'audit_scopes', 'permissions'];

    -- The table restored: roles. ADR 3 lets Managers create roles, rename
    -- them and tick permissions, so roles are user-created too. Every role
    -- goes, and the three seeded ones are inserted fresh with the permissions
    -- the migrations define as of this migration, unretired. No row is
    -- matched by name: a seeded role may carry whatever name rename_role
    -- gave it.
    restored constant text[] := array['roles'];

    unclassified text[];
    unknown text[];
    record_id bigint;
    newer_leads bigint;
    newer_agents bigint;
    newer_staff bigint;
    before_counts jsonb := '{}';
    kept_counts jsonb := '{}';
    cleared_counts jsonb := '{}';
    reset_audit_rows bigint;
    expected bigint;
    users_before bigint;
    identities_before bigint;
    roles_before bigint;
    roles_removed bigint;
    removed_role_names text[];
    removed_role_ids uuid[];
    wrong_roles text[];
    disabled text[] := '{}';
    still_disabled text[];
    t text;
    n bigint;
begin
    -- 1. Every base table in the exposed schemas is classified, and every
    --    listed table exists.
    select array_agg(ns.nspname || '.' || c.relname order by ns.nspname, c.relname) into unclassified
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = any (exposed)
      and c.relkind in ('r', 'p')
      and not (ns.nspname = 'public' and c.relname = any (cleared || kept || restored));
    if unclassified is not null then
        raise exception 'hosted_reset_unclassified_table'
            using detail = format('not on the cleared, kept or restored list: %s', array_to_string(unclassified, ', '));
    end if;

    select array_agg(name order by name) into unknown
    from unnest(cleared || kept || restored) as name
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

    -- 3. A cutoff never set stops it, and so does data newer than the cutoff.
    --    Never skip silently.
    if cutoff = cutoff_sentinel then
        raise exception 'hosted_reset_cutoff_not_configured'
            using detail = format('the cutoff still holds the value checked in, %s; set it on the line marked SET AT MERGE (#197)', cutoff_sentinel);
    end if;

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
    select count(*), array_agg(name order by lower(name)), array_agg(id)
    into roles_before, removed_role_names, removed_role_ids
    from public.roles;

    -- 4. Agent access off, as system. The switch row then references no
    --    staff member, so the staff members can go. The audit row this
    --    writes goes with the rest of the audit log below.
    perform public.set_audit_actor('system');
    perform public.set_agent_access(false);

    select count(*) - (before_counts ->> 'audit_log')::bigint into reset_audit_rows from public.audit_log;

    -- 5. Each cleared table's delete refusal off, by name, for the length of
    --    this transaction, and the roles table's. The
    --    truncate refusals stay on: nothing here truncates. All of them
    --    first, because a table with trigger events still queued cannot be
    --    altered.
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
    alter table public.roles disable trigger refuse_delete;
    disabled := array_append(disabled, 'roles.refuse_delete');

    -- Delete, children first.
    foreach t in array cleared loop
        execute format('delete from public.%I', t);
        get diagnostics n = row_count;
        cleared_counts := cleared_counts || jsonb_build_object(t, n);
    end loop;

    -- Then every role, now that no staff member references one, and the
    -- three seeded roles fresh: 20260928000000_staff_members_and_roles.sql
    -- seeds them, and 20261113110100_whatsapp_group_links.sql adds
    -- group_links.manage to every role holding leads.edit. Admissions
    -- Manager goes in first. Of the triggers on roles, only
    -- normalize_role_permissions (before insert) and audit_row_change (after
    -- insert) fire on these statements; the latter writes one audit row per
    -- role, deleted just below while the audit log's refusal is still off.
    -- refuse_no_administrator_left fires only on an update of a role's
    -- retired or permissions, or of a staff member's active or role_id, and
    -- this reset updates neither table, so that guard never fires, whatever
    -- hosted holds.
    delete from public.roles;
    get diagnostics roles_removed = row_count;

    insert into public.roles (name, permissions, retired) values
        ('Admissions Manager', array[
            'academic_years.manage', 'agents.approve', 'discounts.approve', 'follow_ups.record',
            'group_links.manage', 'interviews.record', 'leads.close', 'leads.create', 'leads.decline',
            'leads.edit', 'leads.view', 'lifecycle.intervene', 'payments.view', 'reopenings.approve',
            'results.send', 'staff.administer', 'visits.record']::text[], false),
        ('Admissions Staff', array[
            'follow_ups.record', 'group_links.manage', 'interviews.record', 'leads.close', 'leads.create',
            'leads.decline', 'leads.edit', 'leads.view', 'payments.view', 'results.send', 'visits.record']::text[], false),
        ('Accountant', array[
            'interview_payments.record', 'leads.view', 'payments.record', 'payments.view']::text[], false);

    delete from public.audit_log;
    get diagnostics n = row_count;
    if n <> 3 then
        raise exception 'hosted_reset_count_mismatch'
            using detail = format('audit_log: %s rows written by the three role inserts, 3 expected', n);
    end if;
    reset_audit_rows := reset_audit_rows + n;
    cleared_counts := cleared_counts || jsonb_build_object('audit_log', (cleared_counts ->> 'audit_log')::bigint + n);

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
    alter table public.roles enable trigger refuse_delete;

    foreach t in array cleared loop
        execute format('select count(*) from public.%I', t) into n;
        if n <> 0 then
            raise exception 'hosted_reset_table_not_empty' using detail = format('%s still holds %s rows', t, n);
        end if;
        expected := (before_counts ->> t)::bigint + case when t = 'audit_log' then reset_audit_rows else 0 end;
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

    -- Every role there was is gone, and exactly the three seeded roles
    -- exist, each a new row, unretired, with its expected set.
    select count(*) into n from public.roles;
    if n <> 3 or roles_removed <> roles_before then
        raise exception 'hosted_reset_roles_not_recreated'
            using detail = format('%s roles exist, %s removed, %s before', n, roles_removed, roles_before);
    end if;
    select array_agg(r.name order by r.name) into wrong_roles
    from public.roles r
    where r.id = any (removed_role_ids);
    if wrong_roles is not null then
        raise exception 'hosted_reset_roles_not_recreated'
            using detail = format('still the row from before the reset: %s', array_to_string(wrong_roles, ', '));
    end if;
    select array_agg(r.name order by r.name) into wrong_roles
    from public.roles r
    left join (values
        ('admissions manager', array[
            'academic_years.manage', 'agents.approve', 'discounts.approve', 'follow_ups.record',
            'group_links.manage', 'interviews.record', 'leads.close', 'leads.create', 'leads.decline',
            'leads.edit', 'leads.view', 'lifecycle.intervene', 'payments.view', 'reopenings.approve',
            'results.send', 'staff.administer', 'visits.record']::text[]),
        ('admissions staff', array[
            'follow_ups.record', 'group_links.manage', 'interviews.record', 'leads.close', 'leads.create',
            'leads.decline', 'leads.edit', 'leads.view', 'payments.view', 'results.send', 'visits.record']::text[]),
        ('accountant', array[
            'interview_payments.record', 'leads.view', 'payments.record', 'payments.view']::text[])
    ) as v(name, permissions) on v.name = lower(r.name)
    where v.name is null
       or r.retired
       or not (r.permissions @> v.permissions and r.permissions <@ v.permissions)
       or cardinality(r.permissions) <> cardinality(v.permissions);
    if wrong_roles is not null then
        raise exception 'hosted_reset_roles_not_recreated'
            using detail = format('not a seeded role, retired, or not its permissions: %s', array_to_string(wrong_roles, ', '));
    end if;

    select count(*) into n from auth.users;
    if n <> 0 then
        raise exception 'hosted_reset_auth_users_remain' using detail = format('%s rows', n);
    end if;
    select count(*) into n from auth.identities;
    if n <> 0 then
        raise exception 'hosted_reset_auth_identities_remain' using detail = format('%s rows', n);
    end if;

    select array_agg(ns.nspname || '.' || c.relname || '.' || tr.tgname order by ns.nspname, c.relname, tr.tgname) into still_disabled
    from pg_trigger tr
    join pg_class c on c.oid = tr.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = any (exposed)
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
            -- The switch's and the role inserts' own audit rows, written
            -- and deleted by this reset.
            'audit_rows_written_by_reset', reset_audit_rows,
            'auth_users', users_before,
            'auth_identities', identities_before,
            -- Every role there was went, so removed_names holds all of them.
            'roles', jsonb_build_object(
                'before', roles_before,
                'removed_names', coalesce(to_jsonb(removed_role_names), '[]'::jsonb),
                'recreated', 3
            ),
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

    raise notice 'Hosted reset (#197): cleared % tables, % auth users and % identities; removed % roles and recreated 3; agent access off',
        array_length(cleared, 1), users_before, identities_before, roles_removed;
end;
$$;
