-- Sibling groups, with every confirmed Family backfilled as a legacy group
-- (#300, spec #296, align brief S1 rule 5, S9, R3, R4, R12, R15, R18, R19,
-- R31, R45). Fees, discounts, statuses and seat counts do not move.
--
-- Two new tables:
--   sibling_groups         one row per group, with its stored full payer
--                          (empty until #301 chooses one; nothing reads it yet).
--   sibling_group_members  one row per lead that has ever been in a group:
--                          its group, its "Sibling of" target (#301) and the
--                          legacy flag. A lead that leaves its group keeps
--                          its row with no group, so its history says when.
--
-- What changes, and what doesn't:
--   - Every confirmed Family (a guardian contact with no pending match) with
--     2 or more leads becomes one group, every lead on it a legacy member.
--     A contact with a pending match gets no group until staff settle it.
--   - Today's Sibling rule now reads the group: a lead not yet Enrolled gets
--     10% when another member of its group is Enrolled. Until #301 links
--     siblings, every group holds exactly the leads of one confirmed Family,
--     so the answer is the same as reading the Family, lead for lead.
--   - Groups follow the Family the old way, as legacy members, so today's
--     screens keep today's fees until the new forms ship:
--       - a new lead on a confirmed contact joins the contact's group, and
--         the second lead on a contact makes one;
--       - confirming a match moves the children onto the known Family, where
--         they join its group;
--       - rejecting a match makes the contact's children a group of their own;
--       - separating a lead from its Family takes it out of its legacy group.
--   - The cascade that recomputes siblings when a lead enters or leaves
--     Enrolled, or moves contact, now recomputes the lead's group. Resuming
--     paused grants recomputes every group with an Enrolled member and one
--     not yet Enrolled.
--
-- Lock order: the Academic-year lock, then Family locks, then group locks,
-- then rows, each set sorted by key. lock_families now takes the group
-- locks of the contacts' groups (each legacy group names its contact),
-- right after the Family locks, reading the groups again under the locks
-- and locking any that appeared. Every function that locks a lead row already takes the
-- Family lock first through lock_families or lock_lead_family, or takes no
-- Family lock at all (the rest of #337), so each one now takes the group
-- lock before the row. Until #301, a group's members all sit on one
-- contact and change only under that contact's Family lock, so a group lock
-- is never waited on by anyone not already holding that Family lock.
--
-- The cascade still ends for the reason in 20261106901100: it recomputes
-- only leads not yet Enrolled, and the one status change it makes is into
-- Enrolled.
--
-- Migration-day safety (R12). The whole migration is one `do` block, so it
-- applies as a whole or not at all: the Supabase CLI runs a file's
-- statements one by one, outside a transaction. It locks leads and contacts
-- against writes while it runs, snapshots every lead's fee, discount,
-- status and Seat priority and every year's seat counts, backfills, checks
-- that every group holds exactly one confirmed Family's leads and that the
-- rule gives every lead the answer it gave before, and compares the
-- snapshot. Any difference raises and nothing is applied. The backfill
-- writes before the audit triggers exist, so it adds no history entry.
--
-- Rollback: a new migration that puts back sibling_rule_result,
-- lock_families and the five trigger functions from 20261211100100. The
-- tables can stay; nothing else reads them.

do $migration$
begin
    perform public.set_audit_actor('system');

    -- Nobody adds, moves or settles a lead while the groups are built.
    lock table public.leads, public.guardian_contacts in share row exclusive mode;

    drop table if exists pg_temp.sibling_groups_snapshot_before;
    create temp table sibling_groups_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- The tables.
    -- -----------------------------------------------------------------------

    create table public.sibling_groups (
        id uuid primary key default gen_random_uuid(),
        -- The member that pays full while no member is an Enrolled anchor
        -- (S1 rule 2). Chosen by #301; empty until then.
        full_payer_lead_id uuid references public.leads (id),
        full_payer_chosen_at timestamptz,
        -- The confirmed Family (guardian contact) a legacy group stands for.
        -- Until #301, every group is one and its members are exactly that
        -- contact's leads, so finding a contact's group is one index read.
        legacy_contact_id uuid unique references public.guardian_contacts (id),
        cause text not null check (cause in ('migration', 'lead_created', 'family')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check ((full_payer_lead_id is null) = (full_payer_chosen_at is null))
    );

    create index sibling_groups_full_payer_lead_id_idx on public.sibling_groups (full_payer_lead_id);

    create table public.sibling_group_members (
        id uuid primary key default gen_random_uuid(),
        lead_id uuid not null unique references public.leads (id),
        -- Empty once the lead has left its group.
        group_id uuid references public.sibling_groups (id),
        -- The lead staff chose as "Sibling of" (#301). Empty for legacy members.
        sibling_of_lead_id uuid references public.leads (id) check (sibling_of_lead_id <> lead_id),
        -- In the group because its Family was confirmed before the father's
        -- name was checked; keeps today's rule (S1 rule 5).
        legacy boolean not null default false,
        cause text not null check (cause in ('migration', 'lead_created', 'family')),
        joined_at timestamptz,
        updated_at timestamptz not null default now(),
        check ((group_id is null) = (joined_at is null)),
        check (group_id is not null or (not legacy and sibling_of_lead_id is null))
    );

    create index sibling_group_members_group_id_idx on public.sibling_group_members (group_id);
    create index sibling_group_members_sibling_of_lead_id_idx on public.sibling_group_members (sibling_of_lead_id);

    -- Reads only, for staff who may view leads. Every write is a function below.
    alter table public.sibling_groups enable row level security;
    alter table public.sibling_group_members enable row level security;

    create policy "Staff who may view leads read sibling groups"
        on public.sibling_groups for select
        to authenticated
        using ((select public.has_permission('leads.view')));

    create policy "Staff who may view leads read sibling group members"
        on public.sibling_group_members for select
        to authenticated
        using ((select public.has_permission('leads.view')));

    revoke insert, update, delete, truncate on public.sibling_groups from anon, authenticated, service_role;
    revoke insert, update, delete, truncate on public.sibling_group_members from anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Group locks.
    -- -----------------------------------------------------------------------

    -- lock_sibling_groups(group_ids): one transaction advisory lock per
    -- group, in ascending key order. Internal.
    create function public.lock_sibling_groups(group_ids uuid[])
    returns void
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        group_key integer;
    begin
        for group_key in
            select distinct hashtext(g::text)
            from unnest(group_ids) g
            where g is not null
            order by 1
        loop
            perform pg_advisory_xact_lock(hashtext('sibling_group'), group_key);
        end loop;
    end;
    $fn$;

    revoke execute on function public.lock_sibling_groups(uuid[]) from public, anon, authenticated, service_role;

    -- family_sibling_groups(contact_ids): the legacy groups of these
    -- contacts, sorted. While every group is a legacy Family group, these are
    -- the groups of every lead on the contacts. #301, whose groups span
    -- contacts, adds the rest. Internal.
    create function public.family_sibling_groups(contact_ids uuid[])
    returns uuid[]
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(array_agg(g.id order by g.id), '{}')
        from public.sibling_groups g
        where g.legacy_contact_id = any (contact_ids);
    $fn$;

    revoke execute on function public.family_sibling_groups(uuid[]) from public, anon, authenticated, service_role;

    -- lock_families, as 20261211100100_sibling_result.sql made it, now
    -- taking the group locks of the contacts' groups after the Family locks.
    -- The groups are read again under their locks.
    -- Same signature.
    create or replace function public.lock_families(contact_ids uuid[])
    returns void
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        family_key integer;
        groups uuid[];
        read_again uuid[];
    begin
        perform pg_advisory_xact_lock_shared(hashtext('sibling_grants_pause'));
        for family_key in
            select distinct hashtext(c::text)
            from unnest(contact_ids) c
            where c is not null
            order by 1
        loop
            perform pg_advisory_xact_lock(hashtext('lead_family'), family_key);
        end loop;

        -- No subtransaction here: this runs several times for every lead
        -- written, and thousands of subtransactions in one transaction (a
        -- bulk insert) make every later read slow. A legacy group is made
        -- only under its contact's Family lock, held from here on, so the
        -- re-read finds the same groups; any it adds are locked in turn.
        groups := public.family_sibling_groups(contact_ids);
        loop
            exit when groups = '{}';
            perform public.lock_sibling_groups(groups);
            read_again := public.family_sibling_groups(contact_ids);
            exit when read_again <@ groups;
            groups := groups || read_again;
        end loop;
    end;
    $fn$;

    revoke execute on function public.lock_families(uuid[]) from public, anon, authenticated, service_role;

    -- lead_sibling_group(lead_id): the lead's group, or null. Internal.
    create function public.lead_sibling_group(lead_id uuid)
    returns uuid
    language sql
    stable
    set search_path = ''
    as $fn$
        select m.group_id from public.sibling_group_members m where m.lead_id = lead_sibling_group.lead_id;
    $fn$;

    revoke execute on function public.lead_sibling_group(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Groups follow the Family, as legacy members.
    -- -----------------------------------------------------------------------

    -- sync_family_sibling_group(contact_id, cause, lead_id): on a confirmed
    -- contact, the contact's legacy group takes in its leads. With a lead,
    -- only that lead joins, when the group exists; it is made, with every
    -- lead on the contact, when the contact has 2 or more leads and no group
    -- yet. Without a lead (a rejected match), every lead in no group joins.
    -- A contact with a pending match is left alone. Takes the Family lock.
    -- Internal.
    create function public.sync_family_sibling_group(contact_id uuid, cause text, lead_id uuid default null)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        target uuid;
        only_lead uuid := sync_family_sibling_group.lead_id;
    begin
        if contact_id is null or not exists (
            select 1 from public.guardian_contacts g
            where g.id = sync_family_sibling_group.contact_id and g.pending_family_match_id is null
        ) then
            return;
        end if;
        perform public.lock_families(array[contact_id]);

        select g.id into target from public.sibling_groups g where g.legacy_contact_id = sync_family_sibling_group.contact_id;
        if target is null then
            if (select count(*) from (
                    select 1 from public.leads l where l.guardian_contact_id = sync_family_sibling_group.contact_id limit 2
                ) two) < 2 then
                return;
            end if;
            insert into public.sibling_groups (legacy_contact_id, cause)
            values (sync_family_sibling_group.contact_id, sync_family_sibling_group.cause)
            returning id into target;
            perform public.lock_sibling_groups(array[target]);
            only_lead := null;
        end if;

        insert into public.sibling_group_members as m (lead_id, group_id, legacy, cause, joined_at)
        select l.id, target, true, sync_family_sibling_group.cause, now()
        from public.leads l
        where l.guardian_contact_id = sync_family_sibling_group.contact_id
          and (only_lead is null or l.id = only_lead)
        order by l.id
        on conflict on constraint sibling_group_members_lead_id_key do update
        set group_id = excluded.group_id,
            legacy = true,
            sibling_of_lead_id = null,
            cause = excluded.cause,
            joined_at = excluded.joined_at,
            updated_at = now()
        where m.group_id is null;
    end;
    $fn$;

    revoke execute on function public.sync_family_sibling_group(uuid, text, uuid) from public, anon, authenticated, service_role;

    -- leave_legacy_sibling_group(lead_id, cause): a lead that left its
    -- Family's contact leaves its legacy group. A member that isn't legacy
    -- stays (#301: siblings by father, whoever their custodian). The caller
    -- holds the Family locks. Internal.
    create function public.leave_legacy_sibling_group(lead_id uuid, cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        update public.sibling_group_members m
        set group_id = null,
            legacy = false,
            sibling_of_lead_id = null,
            cause = leave_legacy_sibling_group.cause,
            joined_at = null,
            updated_at = now()
        where m.lead_id = leave_legacy_sibling_group.lead_id and m.legacy and m.group_id is not null;
    end;
    $fn$;

    revoke execute on function public.leave_legacy_sibling_group(uuid, text) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The rule, now over groups.
    -- -----------------------------------------------------------------------

    -- The rule as 20261211100100 wrote it, over the Family, kept under its
    -- own name for the parity check below and in the tests. Internal.
    create function public.sibling_rule_result_by_family(
        lead_id uuid,
        out result public.sibling_result,
        out source public.sibling_result_source
    )
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(answer.result, 'none'), coalesce(answer.source, 'auto')
        from (select 1) one
        left join lateral (
            select case
                       when g.id is null or g.pending_family_match_id is not null then 'none'
                       when r.locked_result = 'ten' then 'ten'
                       when coalesce(p.prior_sibling, false) then 'ten'
                       when r.locked_result = 'full' then 'full'
                       when l.status <> 'Enrolled' and exists (
                           select 1 from public.leads s
                           where s.guardian_contact_id = l.guardian_contact_id
                             and s.id <> l.id
                             and s.status = 'Enrolled'
                       ) then 'ten'
                       else 'none'
                   end::public.sibling_result as result,
                   case
                       when g.id is null or g.pending_family_match_id is not null then 'auto'
                       when r.locked_result = 'ten' then 'locked'
                       when coalesce(p.prior_sibling, false) then 'prior_sibling'
                       when r.locked_result = 'full' then 'locked'
                       else 'auto'
                   end::public.sibling_result_source as source
            from public.leads l
            left join public.guardian_contacts g on g.id = l.guardian_contact_id
            left join public.lead_fee_profiles p on p.lead_id = l.id
            left join public.lead_sibling_results r on r.lead_id = l.id
            where l.id = sibling_rule_result_by_family.lead_id
        ) answer on true;
    $fn$;

    revoke execute on function public.sibling_rule_result_by_family(uuid) from public, anon, authenticated, service_role;

    -- sibling_rule_result, as 20261211100100 made it, with "another lead on
    -- the contact is Enrolled" read as "another member of the lead's group is
    -- Enrolled". Same signature.
    create or replace function public.sibling_rule_result(
        lead_id uuid,
        out result public.sibling_result,
        out source public.sibling_result_source
    )
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(answer.result, 'none'), coalesce(answer.source, 'auto')
        from (select 1) one
        left join lateral (
            select case
                       when g.id is null or g.pending_family_match_id is not null then 'none'
                       when r.locked_result = 'ten' then 'ten'
                       when coalesce(p.prior_sibling, false) then 'ten'
                       when r.locked_result = 'full' then 'full'
                       when l.status <> 'Enrolled' and exists (
                           -- Another member of the lead's group that is
                           -- Enrolled. A legacy group's members are its
                           -- contact's leads, so they are found through the
                           -- contact and status index; #301 replaces this
                           -- for groups that span contacts.
                           select 1
                           from public.sibling_group_members own
                           join public.sibling_groups grp on grp.id = own.group_id
                           join public.leads s
                               on s.guardian_contact_id = grp.legacy_contact_id and s.status = 'Enrolled' and s.id <> own.lead_id
                           join public.sibling_group_members other
                               on other.lead_id = s.id and other.group_id = own.group_id
                           where own.lead_id = l.id
                       ) then 'ten'
                       else 'none'
                   end::public.sibling_result as result,
                   case
                       when g.id is null or g.pending_family_match_id is not null then 'auto'
                       when r.locked_result = 'ten' then 'locked'
                       when coalesce(p.prior_sibling, false) then 'prior_sibling'
                       when r.locked_result = 'full' then 'locked'
                       else 'auto'
                   end::public.sibling_result_source as source
            from public.leads l
            left join public.guardian_contacts g on g.id = l.guardian_contact_id
            left join public.lead_fee_profiles p on p.lead_id = l.id
            left join public.lead_sibling_results r on r.lead_id = l.id
            where l.id = sibling_rule_result.lead_id
        ) answer on true;
    $fn$;

    revoke execute on function public.sibling_rule_result(uuid) from public, anon, authenticated, service_role;

    -- sibling_groups_mirror_families(): every lead whose group-mates differ
    -- from the other leads of its confirmed Family (none on a contact with a
    -- pending match). Empty while every group is a legacy Family group, which
    -- holds until #301 links siblings. Internal; for this migration and the
    -- tests.
    create function public.sibling_groups_mirror_families()
    returns table (lead_id uuid, family_mates uuid[], group_mates uuid[])
    language sql
    stable
    set search_path = ''
    as $fn$
        select x.lead_id, x.family_mates, x.group_mates
        from (
            select l.id as lead_id,
                   coalesce((
                       select array_agg(s.id order by s.id)
                       from public.leads s
                       where s.guardian_contact_id = l.guardian_contact_id and s.id <> l.id
                         and g.pending_family_match_id is null
                   ), '{}') as family_mates,
                   coalesce((
                       select array_agg(o.lead_id order by o.lead_id)
                       from public.sibling_group_members own
                       join public.sibling_group_members o on o.group_id = own.group_id and o.lead_id <> own.lead_id
                       where own.lead_id = l.id and own.group_id is not null
                   ), '{}') as group_mates
            from public.leads l
            join public.guardian_contacts g on g.id = l.guardian_contact_id
        ) x
        where x.family_mates <> x.group_mates;
    $fn$;

    revoke execute on function public.sibling_groups_mirror_families() from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The cascade, now over groups.
    -- -----------------------------------------------------------------------

    -- recompute_sibling_group(group_id, cause): recomputes the group's
    -- members that are neither Enrolled nor Declined, in id order, and
    -- refreshes the Declined ones, whose fee still reads the rule. Takes the
    -- members' Family locks, then the group lock. Internal.
    create function public.recompute_sibling_group(group_id uuid, cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        contacts uuid[];
        read_again uuid[];
        each_lead uuid;
    begin
        if group_id is null then
            return;
        end if;
        select coalesce(array_agg(distinct l.guardian_contact_id), '{}') into contacts
        from public.sibling_group_members m join public.leads l on l.id = m.lead_id
        where m.group_id = recompute_sibling_group.group_id;
        -- A second pass, for contacts that joined the group meanwhile, takes
        -- Family locks after the group lock. It cannot happen while a group's
        -- members all sit on one contact; #301, whose groups span contacts,
        -- takes every lock up front instead.
        loop
            perform public.lock_families(contacts);
            perform public.lock_sibling_groups(array[group_id]);
            select coalesce(array_agg(distinct l.guardian_contact_id), '{}') into read_again
            from public.sibling_group_members m join public.leads l on l.id = m.lead_id
            where m.group_id = recompute_sibling_group.group_id;
            exit when read_again <@ contacts;
            contacts := contacts || read_again;
        end loop;

        for each_lead in
            select m.lead_id
            from public.sibling_group_members m join public.leads l on l.id = m.lead_id
            where m.group_id = recompute_sibling_group.group_id and l.status not in ('Enrolled', 'Declined')
            order by m.lead_id
        loop
            perform public.recompute_lead_fee(each_lead, recompute_sibling_group.cause);
        end loop;

        for each_lead in
            select m.lead_id
            from public.sibling_group_members m join public.leads l on l.id = m.lead_id
            where m.group_id = recompute_sibling_group.group_id and l.status = 'Declined'
            order by m.lead_id
        loop
            perform public.refresh_sibling_result(each_lead, recompute_sibling_group.cause);
        end loop;
    end;
    $fn$;

    revoke execute on function public.recompute_sibling_group(uuid, text) from public, anon, authenticated, service_role;

    -- recompute_lead_siblings(lead_id, cause): what recompute_family did for
    -- the lead's contact, for the lead's group: its group's members, or the
    -- lead alone when it is in no group. Nothing for a lead on a contact with
    -- a pending match, as before. Internal.
    create function public.recompute_lead_siblings(lead_id uuid, cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        lead public.leads;
        own_group uuid;
    begin
        perform public.lock_lead_family(recompute_lead_siblings.lead_id);
        select * into lead from public.leads l where l.id = recompute_lead_siblings.lead_id;
        if not found or exists (
            select 1 from public.guardian_contacts g
            where g.id = lead.guardian_contact_id and g.pending_family_match_id is not null
        ) then
            return;
        end if;

        own_group := public.lead_sibling_group(lead.id);
        if own_group is not null then
            perform public.recompute_sibling_group(own_group, recompute_lead_siblings.cause);
        elsif lead.status = 'Declined' then
            perform public.refresh_sibling_result(lead.id, recompute_lead_siblings.cause);
        elsif lead.status <> 'Enrolled' then
            perform public.recompute_lead_fee(lead.id, recompute_lead_siblings.cause);
        end if;
    end;
    $fn$;

    revoke execute on function public.recompute_lead_siblings(uuid, text) from public, anon, authenticated, service_role;

    -- When a lead's status enters or leaves Enrolled, its group follows.
    create or replace function public.recompute_siblings_on_enrolled_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        perform public.recompute_lead_siblings(new.id, 'sibling');
        return null;
    end;
    $fn$;

    revoke execute on function public.recompute_siblings_on_enrolled_change() from public, anon, authenticated, service_role;

    -- The lead-details trigger, as 20261106901100 made it. A lead moving to
    -- another contact (confirming or separating) leaves its legacy group,
    -- joins the new contact's, and is recomputed with both groups.
    create or replace function public.recompute_lead_fee_on_lead_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        old_group uuid;
    begin
        if old.guardian_contact_id is distinct from new.guardian_contact_id then
            perform public.lock_families(array[old.guardian_contact_id, new.guardian_contact_id]);
            old_group := public.lead_sibling_group(new.id);
            -- Confirming moves every child in one update. An earlier child's sync
            -- may already have put this one in the new contact's group: it stays.
            if old_group is null or not exists (
                select 1 from public.sibling_group_members m join public.leads l on l.id = m.lead_id
                where m.group_id = old_group and m.lead_id <> new.id
                  and l.guardian_contact_id = new.guardian_contact_id
            ) then
                perform public.leave_legacy_sibling_group(new.id, 'family');
            end if;
            perform public.sync_family_sibling_group(new.guardian_contact_id, 'family', new.id);
            perform public.recompute_lead_fee(new.id, 'family');
            perform public.recompute_sibling_group(old_group, 'family');
            perform public.recompute_sibling_group(public.lead_sibling_group(new.id), 'family');
            return null;
        end if;
        perform public.recompute_lead_fee(
            new.id,
            case when old.status = 'Declined' and new.status <> 'Declined' then 'reopening' else 'lead_details' end
        );
        return null;
    end;
    $fn$;

    revoke execute on function public.recompute_lead_fee_on_lead_change() from public, anon, authenticated, service_role;

    -- The pending-match trigger, as 20261211100100 made it: rejecting a match
    -- first makes the contact's children a group, then recomputes them.
    create or replace function public.recompute_family_on_match_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        each_lead uuid;
    begin
        perform public.lock_families(array[new.id]);
        perform public.sync_family_sibling_group(new.id, 'family');
        for each_lead in
            select l.id
            from public.leads l
            where l.guardian_contact_id = new.id and l.status <> 'Declined'
            order by l.id
        loop
            perform public.recompute_lead_fee(each_lead, 'family');
        end loop;
        for each_lead in
            select l.id
            from public.leads l
            where l.guardian_contact_id = new.id and l.status = 'Declined'
            order by l.id
        loop
            perform public.refresh_sibling_result(each_lead, 'family');
        end loop;
        return null;
    end;
    $fn$;

    revoke execute on function public.recompute_family_on_match_change() from public, anon, authenticated, service_role;

    -- A new lead, as 20261211100100 made it: it first joins its contact's
    -- group (or makes one with the contact's first lead), then stores its
    -- result.
    create or replace function public.sibling_result_on_lead_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        perform public.sync_family_sibling_group(new.guardian_contact_id, 'lead_created', new.id);
        if new.status = 'Enrolled' then
            perform public.lock_sibling_result(new.id, 'lead_created', true);
        else
            perform public.refresh_sibling_result(new.id, 'lead_created');
        end if;
        return null;
    end;
    $fn$;

    revoke execute on function public.sibling_result_on_lead_insert() from public, anon, authenticated, service_role;

    -- set_sibling_grants_paused, as 20261211100100 made it, now resuming by
    -- group: every group with an Enrolled member and a member not yet
    -- Enrolled, under the members' Family locks and the group locks, in key
    -- order. Same signature.
    create or replace function public.set_sibling_grants_paused(paused boolean)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        actor record;
        was_paused boolean;
        groups uuid[];
        each_group uuid;
    begin
        if set_sibling_grants_paused.paused is null then
            raise exception 'invalid';
        end if;
        select * into actor from public.audit_actor();
        if actor.kind is null or actor.kind not in ('staff', 'system') then
            raise exception 'not_permitted';
        end if;

        -- Before any other lock: waits for every transaction holding a Family
        -- lock, so a payment enrolling a child while new grants were paused
        -- has committed, and the groups read below include it.
        perform pg_advisory_xact_lock(hashtext('sibling_grants_pause'));

        select s.new_grants_paused into was_paused from public.sibling_rule_settings s for update;
        if was_paused is not distinct from set_sibling_grants_paused.paused then
            return;
        end if;

        update public.sibling_rule_settings
        set new_grants_paused = set_sibling_grants_paused.paused,
            changed_at = now(),
            changed_by_kind = actor.kind,
            changed_by = actor.staff_id;

        if set_sibling_grants_paused.paused then
            return;
        end if;

        select coalesce(array_agg(distinct w.group_id order by w.group_id), '{}')
        into groups
        from public.sibling_group_members w
        join public.leads wl on wl.id = w.lead_id
        where w.group_id is not null
          and wl.status <> 'Enrolled'
          and exists (
              select 1 from public.sibling_group_members s join public.leads sl on sl.id = s.lead_id
              where s.group_id = w.group_id and s.lead_id <> w.lead_id and sl.status = 'Enrolled'
          );

        perform public.lock_families(array(
            select distinct l.guardian_contact_id
            from public.sibling_group_members m join public.leads l on l.id = m.lead_id
            where m.group_id = any (groups)
        ));
        perform public.lock_sibling_groups(groups);
        foreach each_group in array groups loop
            perform public.recompute_sibling_group(each_group, 'sibling');
        end loop;
    end;
    $fn$;

    revoke execute on function public.set_sibling_grants_paused(boolean) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The backfill (R15): one legacy group per confirmed Family with 2 or
    -- more leads. A contact with a pending match gets none. Declined,
    -- Inactive and Archived leads join like the rest; the rule treats them as
    -- today. Kept as a function for the tests: it fills only contacts none of
    -- whose leads is in a group yet. Internal.
    -- -----------------------------------------------------------------------

    create function public.backfill_sibling_groups()
    returns integer
    language sql
    security definer
    set search_path = ''
    as $fn$
        with families as materialized (
            select g.id as contact_id, gen_random_uuid() as group_id
            from public.guardian_contacts g
            where g.pending_family_match_id is null
              and (select count(*) from public.leads l where l.guardian_contact_id = g.id) >= 2
              and not exists (select 1 from public.sibling_groups x where x.legacy_contact_id = g.id)
              and not exists (
                  select 1 from public.leads l join public.sibling_group_members m on m.lead_id = l.id
                  where l.guardian_contact_id = g.id
              )
        ),
        made as (
            insert into public.sibling_groups (id, legacy_contact_id, cause)
            select f.group_id, f.contact_id, 'migration' from families f
            returning id
        ),
        joined as (
            insert into public.sibling_group_members (lead_id, group_id, legacy, cause, joined_at)
            select l.id, f.group_id, true, 'migration', now()
            from families f
            join public.leads l on l.guardian_contact_id = f.contact_id
            returning id
        )
        -- A data-modifying CTE runs whether or not it is read.
        select count(*)::integer from made;
    $fn$;

    revoke execute on function public.backfill_sibling_groups() from public, anon, authenticated, service_role;

    perform public.backfill_sibling_groups();

    -- Every group holds exactly one confirmed Family's leads.
    if exists (select 1 from public.sibling_groups_mirror_families()) then
        raise exception 'sibling_groups_mismatch'
            using detail = (select jsonb_agg(to_jsonb(m)) from (select * from public.sibling_groups_mirror_families() limit 20) m)::text;
    end if;

    -- Parity: the rule over groups gives every lead what it gave over the Family.
    if exists (
        select 1 from public.leads l
        where (select (r.result, r.source) from public.sibling_rule_result(l.id) r)
              is distinct from (select (f.result, f.source) from public.sibling_rule_result_by_family(l.id) f)
    ) then
        raise exception 'sibling_rule_parity_mismatch';
    end if;

    -- -----------------------------------------------------------------------
    -- Audit (ADR 4), from here on: a member's rows in its lead's history.
    -- -----------------------------------------------------------------------

    insert into public.audit_scopes (table_name, scope, lead_id_column) values
        ('public.sibling_group_members', 'lead', 'lead_id'),
        ('public.sibling_groups', 'lead', null);

    create trigger audit_row_change after insert or update on public.sibling_groups
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.sibling_groups
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.sibling_groups
        for each statement execute function public.refuse_delete();

    create trigger audit_row_change after insert or update on public.sibling_group_members
        for each row execute function public.audit_row_change();
    create trigger refuse_delete before delete on public.sibling_group_members
        for each row execute function public.refuse_delete();
    create trigger refuse_truncate before truncate on public.sibling_group_members
        for each statement execute function public.refuse_delete();

    -- Nothing moved.
    perform public.assert_fee_snapshot_unchanged('pg_temp.sibling_groups_snapshot_before');
    drop table pg_temp.sibling_groups_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
