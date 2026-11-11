-- "Sibling of" linking and the new Sibling fee rule (#301, spec #296, align
-- brief S1, S1b, S2, S5, R5, R16, R18, R31, R32, R35 to R39, R45, R48).
-- Fees, discounts, statuses and seat counts do not move on migration day:
-- every group member is still legacy, and legacy members keep today's rule.
--
-- 1. Membership basis. A member that is not legacy holds the outcome of its
--    father's-name check, in sibling_group_members.basis:
--      matched         the names are the same (S5 level 1), or the member is
--                      the first of a new group;
--      typo_confirmed  staff answered "typing mistake" to a close name (S5
--                      level 2), and the chosen spelling was written to
--                      every member holding the other one;
--      request_needed  the names differ, or staff answered "two different
--                      names": it needs a Sibling request (#302) to count.
--    A member counts when it is legacy or matched or typo_confirmed, is not
--    Declined and has no closure mark (sibling_basis_counts; #302 adds a
--    granted request). request_needed never turns into a match by itself: a
--    name edit that makes the names the same leaves it as it is (R36).
--
-- 2. link_sibling(lead, sibling_of, ...) links a lead as "Sibling of"
--    another, for staff with leads.edit. The lead joins the other's group (a
--    new group when it has none). Linking to a legacy member first takes
--    that member's father's name and ends its legacy status (R32). A close
--    name returns the typing-mistake question and saves nothing; the same
--    call with the answer saves. Moving a linked lead with its linked
--    siblings into another group is a merge; it needs the names to match.
--
-- 3. Father's-name edits. update_lead_details takes `father_full_name`. Any
--    change to a linked member's father's name, by that key or by a student
--    name correction that re-derives it (#299's note), runs the check
--    against the group: Same keeps the basis, Different makes the member
--    request_needed, and Close from a counting member raises the question
--    (`father_name_question`, nothing saved) until the call carries an
--    answer. A trigger applies the same rule on every other path, answering
--    Close as request_needed, so no path gets round the check.
--
-- 4. The rule (sibling_rule_result), for a lead not Enrolled, in a group:
--      legacy member      today's rule: 10% when another legacy or matched
--                         member is Enrolled (S1 rule 5).
--      not counting       none.
--      anchor             a counting member Enrolled without the 10%: 10%.
--      full payer         the group's stored full payer: full.
--      the others         10% at once while the full payer counts, is not
--                         legacy and is not Enrolled (legacy members give the
--                         10% only as Enrolled anchors, R37).
--    The full payer is chosen under the group lock (choose_full_payer) once
--    the group holds a member that is not legacy and 2 counting members:
--    the counting member not yet Enrolled with the highest School fee before
--    discount, skipping larger discounts and manual values, oldest lead on a
--    tie, among the members present when the group first had 2 counting
--    members (students saved in one transaction share that time, so they
--    are ranked together). It is chosen again only when it stops counting or
--    holds a manual value. A sibling who joins later gets the 10% (R48).
--    Locked, manual (#303) and the prior-sibling tick are as before; the
--    system never changes an Enrolled result by itself.
--
-- 5. Leaving legacy never raises a fee (R38). A link never raises one
--    either: a member of a group the link touches that holds an automatic
--    10% the new rule would take away keeps it, with source `legacy` and
--    cause `left_legacy`, for the Accountant's count. Such a result then
--    stays until enrolment locks it or the Accountant edits it (#303).
--
-- 6. Locks for groups that span contacts (#300's notes 3 and 4). Each group
--    stores the contacts its members sit on (sibling_groups.contact_ids,
--    with its legacy contact). lock_families reads, before any lock, every
--    contact the given contacts reach through their groups, takes all those
--    Family locks in key order, then the groups' locks in key order. A
--    contact that appears only once the locks are held (a link committed in
--    between) is taken with a lock that never waits; if it is busy the call
--    raises `unavailable` (40001) and the caller retries, so no wait can
--    close a cycle. contact_ids changes only under the Family locks of every
--    contact involved and the group lock. Order stays: Academic-year lock,
--    Family locks, group locks, rows. mark_lead now takes the Family lock
--    before its row, since a closure mark now reaches a recompute (#337).
--
-- 7. Events that recompute a group: a lead entering or leaving Enrolled (as
--    before), entering or leaving Declined or a closure mark in a group with
--    a member that is not legacy (new), moving contact (as before, now with
--    #300 note 1's stay check), a link, a merge and a basis change. The
--    cascade ends for the reason in 20261106901100: it recomputes only leads
--    not yet Enrolled, a 10% can only move a lead into Enrolled, and an
--    Enrolled lead is never recomputed. Choosing the full payer changes no
--    status.
--
-- Not here: the Sibling request kind (#302), the manual fee edit (#303),
-- the screens (#308 to #310) and the explanation sentences (#306, which
-- reads sibling_group_results' reason codes). family_sibling_groups (#300
-- note 2) is dropped; nothing calls it.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. It snapshots every fee first, checks that every
-- lead gets the answer the Family rule gave, and compares the snapshot at
-- the end. Any difference raises and nothing is applied.
--
-- Rollback: a new migration putting back sibling_rule_result, lock_families,
-- refresh_sibling_result and the triggers from 20261212100100. Until a
-- member is linked, nothing reads the new columns.

do $migration$
begin
    perform public.set_audit_actor('system');

    lock table public.leads, public.guardian_contacts, public.sibling_groups, public.sibling_group_members
        in share row exclusive mode;

    drop table if exists pg_temp.sibling_of_snapshot_before;
    create temp table sibling_of_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- Columns.
    -- -----------------------------------------------------------------------

    alter table public.sibling_group_members
        add column basis text check (basis in ('matched', 'typo_confirmed', 'request_needed')),
        add constraint sibling_group_members_basis_check2
            check ((group_id is not null and not legacy) = (basis is not null)),
        drop constraint sibling_group_members_cause_check,
        add constraint sibling_group_members_cause_check
            check (cause in ('migration', 'lead_created', 'family', 'sibling_link', 'merge', 'father_name'));

    comment on column public.sibling_group_members.basis is
        'For a member that is not legacy: matched, typo_confirmed or request_needed, the outcome of its father''s-name check (#301).';

    create index sibling_group_members_checked_idx on public.sibling_group_members (group_id)
        where group_id is not null and not legacy;

    alter table public.sibling_groups
        add column contact_ids uuid[] not null default '{}',
        drop constraint sibling_groups_cause_check,
        add constraint sibling_groups_cause_check
            check (cause in ('migration', 'lead_created', 'family', 'sibling_link'));

    comment on column public.sibling_groups.contact_ids is
        'Every guardian contact a member sits on, with the legacy contact, sorted. lock_families finds a contact''s groups through it (#301).';

    create index sibling_groups_contact_ids_idx on public.sibling_groups using gin (contact_ids);

    alter table public.lead_sibling_results
        drop constraint lead_sibling_results_cause_check,
        add constraint lead_sibling_results_cause_check check (cause in (
            'payment', 'payment_adjustment', 'discount', 'fee_schedule', 'lead_details', 'family',
            'academic_year_start', 'reopening', 'sibling', 'prior_sibling',
            'migration', 'lead_created', 'enrolled', 'grants_resumed', 'left_legacy'
        ));

    drop function public.family_sibling_groups(uuid[]);

    -- -----------------------------------------------------------------------
    -- Group contacts.
    -- -----------------------------------------------------------------------

    -- refresh_sibling_group_contacts(group_id): stores the contacts the
    -- group's members sit on, with its legacy contact. The caller holds the
    -- Family locks of every contact before and after, and the group lock.
    -- Internal.
    create function public.refresh_sibling_group_contacts(group_id uuid)
    returns void
    language sql
    security definer
    set search_path = ''
    as $fn$
        update public.sibling_groups g
        set contact_ids = x.ids,
            updated_at = now()
        from (
            select coalesce(array_agg(distinct c order by c), '{}') as ids
            from (
                select l.guardian_contact_id as c
                from public.sibling_group_members m
                join public.leads l on l.id = m.lead_id
                where m.group_id = refresh_sibling_group_contacts.group_id
                union
                select g2.legacy_contact_id
                from public.sibling_groups g2
                where g2.id = refresh_sibling_group_contacts.group_id
            ) s
            where c is not null
        ) x
        where g.id = refresh_sibling_group_contacts.group_id
          and g.contact_ids is distinct from x.ids;
    $fn$;

    revoke execute on function public.refresh_sibling_group_contacts(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Locks.
    -- -----------------------------------------------------------------------

    -- lock_families, as 20261212100100 made it, now taking every Family
    -- lock its contacts reach through their groups, then the groups' locks.
    -- Same signature.
    create or replace function public.lock_families(contact_ids uuid[])
    returns void
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        held uuid[];
        reach uuid[];
        extra uuid[];
        groups uuid[];
        one_key integer;
        one_contact uuid;
        one_group uuid;
    begin
        perform pg_advisory_xact_lock_shared(hashtext('sibling_grants_pause'));
        held := array(select distinct c from unnest(contact_ids) c where c is not null);
        if cardinality(held) = 0 then
            return;
        end if;

        -- Before any Family lock: every contact these reach through their
        -- groups, so all of them are taken in key order below. A legacy
        -- group reaches only its own contact, so this is one index read.
        loop
            select coalesce(array_agg(distinct c), '{}') into reach
            from public.sibling_groups g
            cross join lateral unnest(g.contact_ids) c
            where g.contact_ids && held;
            extra := array(select c from unnest(reach) c where c <> all (held));
            exit when cardinality(extra) = 0;
            held := held || extra;
        end loop;

        for one_key in
            select distinct hashtext(c::text) from unnest(held) c order by 1
        loop
            perform pg_advisory_xact_lock(hashtext('lead_family'), one_key);
        end loop;

        -- Under the locks. A contact that joined a group meanwhile is taken
        -- without waiting, so no wait can close a cycle; if another
        -- transaction holds it, this one stops and the caller retries.
        loop
            select coalesce(array_agg(distinct g.id), '{}'), coalesce(array_agg(distinct c), '{}')
            into groups, reach
            from public.sibling_groups g
            cross join lateral unnest(g.contact_ids) c
            where g.contact_ids && held;
            extra := array(select c from unnest(reach) c where c <> all (held) order by hashtext(c::text));
            exit when cardinality(extra) = 0;
            foreach one_contact in array extra loop
                if not pg_try_advisory_xact_lock(hashtext('lead_family'), hashtext(one_contact::text)) then
                    raise exception 'unavailable' using errcode = '40001', detail = 'sibling_family_busy';
                end if;
            end loop;
            held := held || extra;
        end loop;

        for one_group in
            select g from unnest(groups) g order by hashtext(g::text)
        loop
            perform pg_advisory_xact_lock(hashtext('sibling_group'), hashtext(one_group::text));
        end loop;
    end;
    $fn$;

    revoke execute on function public.lock_families(uuid[]) from public, anon, authenticated, service_role;

    -- lock_lead_families(lead_ids): lock_lead_family for several leads: the
    -- Family locks of all their contacts (and every contact those reach),
    -- read again under the locks until no lead has moved. Internal.
    create function public.lock_lead_families(lead_ids uuid[])
    returns void
    language plpgsql
    volatile
    set search_path = ''
    as $fn$
    declare
        contacts uuid[];
        read_again uuid[];
    begin
        contacts := array(
            select distinct l.guardian_contact_id from public.leads l where l.id = any (lead_ids) order by 1
        );
        loop
            begin
                perform public.lock_families(contacts);
                read_again := array(
                    select distinct l.guardian_contact_id from public.leads l where l.id = any (lead_ids) order by 1
                );
                if read_again = contacts then
                    return;
                end if;
                raise exception using errcode = 'P0113', message = 'family_moved';
            exception when sqlstate 'P0113' then
                contacts := read_again;
            end;
        end loop;
    end;
    $fn$;

    revoke execute on function public.lock_lead_families(uuid[]) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Counting and the name check.
    -- -----------------------------------------------------------------------

    -- Whether a basis makes a member that is not legacy count (#302 adds a
    -- granted request). Internal.
    create function public.sibling_basis_counts(basis text)
    returns boolean
    language sql
    immutable
    set search_path = ''
    as $fn$
        select coalesce(sibling_basis_counts.basis in ('matched', 'typo_confirmed'), false);
    $fn$;

    revoke execute on function public.sibling_basis_counts(text) from public, anon, authenticated, service_role;

    -- sibling_name_check(lead_id, father_name, group_id, extra_lead_id,
    -- extra_name): the S5 check of `father_name` against the group's members
    -- whose name is checked (matched or typo_confirmed), other than lead_id,
    -- plus one more (extra_lead_id with extra_name, for a member about to
    -- be written). The best answer wins: same, then close, then different,
    -- lowest lead id on a tie. No row when there is nobody to compare with.
    -- A missing father's name is different. Internal.
    create function public.sibling_name_check(
        lead_id uuid,
        father_name text,
        group_id uuid,
        extra_lead_id uuid default null,
        extra_name text default null,
        out verdict text,
        out other_lead_id uuid,
        out other_name text
    )
    returns setof record
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(public.father_name_match(sibling_name_check.father_name, o.name), 'different'), o.id, o.name
        from (
            select l.id, l.father_full_name as name
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            where sibling_name_check.group_id is not null
              and m.group_id = sibling_name_check.group_id
              and not m.legacy
              and public.sibling_basis_counts(m.basis)
              and m.lead_id <> sibling_name_check.lead_id
              and m.lead_id is distinct from sibling_name_check.extra_lead_id
              and l.father_full_name is not null
            union all
            select sibling_name_check.extra_lead_id, sibling_name_check.extra_name
            where sibling_name_check.extra_lead_id is not null and sibling_name_check.extra_name is not null
        ) o
        order by case coalesce(public.father_name_match(sibling_name_check.father_name, o.name), 'different')
                     when 'same' then 0 when 'close' then 1 else 2 end,
                 o.id
        limit 1;
    $fn$;

    revoke execute on function public.sibling_name_check(uuid, text, uuid, uuid, text) from public, anon, authenticated, service_role;

    -- A father's name as staff typed it: trimmed, inner whitespace one space,
    -- empty when nothing is left. Internal.
    create function public.clean_father_name(name text)
    returns text
    language sql
    immutable
    set search_path = ''
    as $fn$
        select nullif(regexp_replace(regexp_replace(coalesce(clean_father_name.name, ''), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'), '');
    $fn$;

    revoke execute on function public.clean_father_name(text) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The rule.
    -- -----------------------------------------------------------------------

    drop function public.sibling_rule_result(uuid);

    -- sibling_rule_result(lead_id): what the rule gives the lead now, and a
    -- reason code for the explanation (#306). Reads nothing it writes, and
    -- ignores the kill switch and the kept results (refresh applies them).
    -- Internal.
    create function public.sibling_rule_result(
        lead_id uuid,
        out result public.sibling_result,
        out source public.sibling_result_source,
        out reason text
    )
    language plpgsql
    stable
    set search_path = ''
    as $fn$
    #variable_conflict use_column
    declare
        lead record;
        own record;
    begin
        result := 'none';
        source := 'auto';

        select l.id, l.status, l.closure, g.id as contact_id, g.pending_family_match_id,
               coalesce(p.prior_sibling, false) as tick, r.locked_result
        into lead
        from public.leads l
        left join public.guardian_contacts g on g.id = l.guardian_contact_id
        left join public.lead_fee_profiles p on p.lead_id = l.id
        left join public.lead_sibling_results r on r.lead_id = l.id
        where l.id = sibling_rule_result.lead_id;

        if lead.id is null or lead.contact_id is null or lead.pending_family_match_id is not null then
            reason := 'no_family';
            return;
        end if;
        if lead.locked_result = 'ten' then
            result := 'ten'; source := 'locked'; reason := 'locked';
            return;
        end if;
        if lead.tick then
            result := 'ten'; source := 'prior_sibling'; reason := 'prior_sibling';
            return;
        end if;
        if lead.locked_result = 'full' then
            result := 'full'; source := 'locked'; reason := 'locked';
            return;
        end if;

        select m.group_id, m.legacy, m.basis, grp.legacy_contact_id, grp.full_payer_lead_id
        into own
        from public.sibling_group_members m
        join public.sibling_groups grp on grp.id = m.group_id
        where m.lead_id = sibling_rule_result.lead_id;

        if own.group_id is null then
            reason := 'no_group';
            return;
        end if;
        if lead.status = 'Enrolled' then
            reason := 'enrolled';
            return;
        end if;

        if own.legacy then
            -- Today's rule. While every member is legacy they all sit on the
            -- group's contact (a legacy member that moves contact leaves),
            -- so the probe goes through the contact and status index, as
            -- 20261212100100 did.
            if not exists (
                select 1 from public.sibling_group_members c
                where c.group_id = own.group_id and c.group_id is not null and not c.legacy
            ) then
                if exists (
                    select 1
                    from public.leads s
                    where s.guardian_contact_id = own.legacy_contact_id
                      and s.status = 'Enrolled'
                      and s.id <> sibling_rule_result.lead_id
                      and exists (
                          select 1 from public.sibling_group_members o
                          where o.lead_id = s.id and o.group_id = own.group_id and o.legacy
                      )
                ) then
                    result := 'ten'; reason := 'legacy_enrolled_sibling';
                else
                    reason := 'legacy_no_enrolled_sibling';
                end if;
                return;
            end if;
            if exists (
                select 1
                from public.sibling_group_members o
                join public.leads s on s.id = o.lead_id
                where o.group_id = own.group_id
                  and o.lead_id <> sibling_rule_result.lead_id
                  and s.status = 'Enrolled'
                  and (o.legacy or public.sibling_basis_counts(o.basis))
            ) then
                result := 'ten'; reason := 'legacy_enrolled_sibling';
            else
                reason := 'legacy_no_enrolled_sibling';
            end if;
            return;
        end if;

        if not public.sibling_basis_counts(own.basis) then
            reason := 'basis_' || own.basis;
            return;
        end if;
        if lead.status = 'Declined' then
            reason := 'declined';
            return;
        end if;
        if lead.closure is not null then
            reason := 'closed';
            return;
        end if;

        -- An anchor: a counting member Enrolled without the 10%. A larger
        -- discount replaces the 10%, so a member holding one is an anchor.
        if exists (
            select 1
            from public.sibling_group_members o
            join public.leads s on s.id = o.lead_id
            where o.group_id = own.group_id
              and o.lead_id <> sibling_rule_result.lead_id
              and s.status = 'Enrolled'
              and s.closure is null
              and (o.legacy or public.sibling_basis_counts(o.basis))
              and (
                  not exists (
                      select 1 from public.lead_sibling_results rr where rr.lead_id = s.id and rr.result = 'ten'
                  )
                  or exists (
                      select 1 from public.discount_requests d
                      where d.lead_id = s.id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
                  )
              )
        ) then
            result := 'ten'; reason := 'anchor';
            return;
        end if;

        if own.full_payer_lead_id = sibling_rule_result.lead_id then
            result := 'full'; reason := 'full_payer';
            return;
        end if;

        if exists (
            select 1
            from public.sibling_group_members o
            join public.leads s on s.id = o.lead_id
            where o.group_id = own.group_id
              and o.lead_id = own.full_payer_lead_id
              and not o.legacy
              and public.sibling_basis_counts(o.basis)
              and s.status not in ('Enrolled', 'Declined')
              and s.closure is null
              -- Out of Enrolled with a result fixed at enrolment, it gives
              -- no sibling the 10%.
              and not exists (
                  select 1 from public.lead_sibling_results rp where rp.lead_id = s.id and rp.locked_result is not null
              )
        ) then
            result := 'ten'; reason := 'full_payer_sibling';
            return;
        end if;

        reason := 'no_full_payer';
    end;
    $fn$;

    revoke execute on function public.sibling_rule_result(uuid) from public, anon, authenticated, service_role;

    -- refresh_sibling_result, as 20261211100100 made it, now keeping a
    -- manual (#303) or kept (`legacy`) result, and keeping an automatic 10%
    -- that a link would take away (app.sibling_keep_ten, set by
    -- link_sibling for the members of the groups it touches). Same
    -- signature.
    create or replace function public.refresh_sibling_result(lead_id uuid, cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        stored public.lead_sibling_results;
        answer record;
        next_result public.sibling_result;
        next_source public.sibling_result_source;
        next_cause text := refresh_sibling_result.cause;
        kept text := coalesce(current_setting('app.sibling_keep_ten', true), '');
    begin
        perform public.lock_lead_family(refresh_sibling_result.lead_id);

        select * into stored from public.lead_sibling_results r where r.lead_id = refresh_sibling_result.lead_id for update;
        if stored.id is not null and stored.source in ('manual', 'legacy') then
            return;
        end if;

        select * into answer from public.sibling_rule_result(refresh_sibling_result.lead_id);
        next_result := answer.result;
        next_source := answer.source;

        if next_result = 'ten' and next_source = 'auto' and public.sibling_grants_paused()
           and not (stored.id is not null and stored.result = 'ten' and stored.source = 'auto') then
            next_result := 'none';
        end if;

        -- A link never raises a fee by itself (R38).
        if kept <> '' and stored.id is not null and stored.result = 'ten' and stored.source = 'auto'
           and next_result <> 'ten'
           and refresh_sibling_result.lead_id::text = any (string_to_array(kept, ',')) then
            next_result := 'ten';
            next_source := 'legacy';
            next_cause := 'left_legacy';
        end if;

        if stored.id is null then
            if next_result = 'none' and next_source = 'auto' then
                return;
            end if;
            insert into public.lead_sibling_results (lead_id, result, source, cause)
            values (refresh_sibling_result.lead_id, next_result, next_source, next_cause);
        elsif (stored.result, stored.source) is distinct from (next_result, next_source) then
            update public.lead_sibling_results r
            set result = next_result,
                source = next_source,
                cause = next_cause,
                updated_at = now()
            where r.id = stored.id;
        end if;
    end;
    $fn$;

    revoke execute on function public.refresh_sibling_result(uuid, text) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The full payer.
    -- -----------------------------------------------------------------------

    -- choose_full_payer(group_id): keeps the stored full payer while it
    -- counts and holds no manual value; otherwise chooses one (S1 rule 2),
    -- or none when fewer than 2 members count. Only for a group with a
    -- member that is not legacy; nothing reads a legacy group's full payer.
    -- The caller holds the group's locks. Internal.
    create function public.choose_full_payer(group_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        grp public.sibling_groups;
        still_counts boolean;
        counting integer;
        first_two timestamptz;
        chosen uuid;
    begin
        select * into grp from public.sibling_groups g where g.id = choose_full_payer.group_id for update;
        if grp.id is null or not exists (
            select 1 from public.sibling_group_members m
            where m.group_id = choose_full_payer.group_id and m.group_id is not null and not m.legacy
        ) then
            return;
        end if;

        if grp.full_payer_lead_id is not null then
            select (m.legacy or public.sibling_basis_counts(m.basis))
                   and l.status <> 'Declined' and l.closure is null
                   and coalesce(r.source::text, 'auto') <> 'manual'
            into still_counts
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            left join public.lead_sibling_results r on r.lead_id = l.id
            where m.lead_id = grp.full_payer_lead_id and m.group_id = choose_full_payer.group_id;
            if coalesce(still_counts, false) then
                return;
            end if;
        end if;

        select count(*)::integer into counting
        from public.sibling_group_members m
        join public.leads l on l.id = m.lead_id
        where m.group_id = choose_full_payer.group_id
          and (m.legacy or public.sibling_basis_counts(m.basis))
          and l.status <> 'Declined' and l.closure is null;

        if counting >= 2 then
            -- The first choice is among the members present when the group
            -- first had 2 counting members, so a sibling who joined later
            -- does not take the place (R48).
            if grp.full_payer_lead_id is null then
                select m.joined_at into first_two
                from public.sibling_group_members m
                join public.leads l on l.id = m.lead_id
                where m.group_id = choose_full_payer.group_id
                  and (m.legacy or public.sibling_basis_counts(m.basis))
                  and l.status <> 'Declined' and l.closure is null
                order by m.joined_at
                offset 1 limit 1;
            end if;

            select l.id into chosen
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            cross join lateral public.lead_fee_amounts(l.id) fee
            left join public.lead_sibling_results r on r.lead_id = l.id
            where m.group_id = choose_full_payer.group_id
              and (m.legacy or public.sibling_basis_counts(m.basis))
              and l.status not in ('Enrolled', 'Declined') and l.closure is null
              and coalesce(r.source::text, 'auto') <> 'manual'
              -- Fixed at an earlier enrolment: not ranked while out of Enrolled.
              and r.locked_result is null
              and not exists (
                  select 1 from public.discount_requests d
                  where d.lead_id = l.id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
              )
              and (first_two is null or m.joined_at <= first_two)
            order by fee.band_fee desc nulls last, l.created_at, l.id
            limit 1;
        end if;

        if chosen is distinct from grp.full_payer_lead_id then
            update public.sibling_groups g
            set full_payer_lead_id = chosen,
                full_payer_chosen_at = case when chosen is null then null else now() end,
                updated_at = now()
            where g.id = grp.id;
        end if;
    end;
    $fn$;

    revoke execute on function public.choose_full_payer(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The cascade.
    -- -----------------------------------------------------------------------

    -- recompute_sibling_group, as 20261212100100 made it, now choosing the
    -- full payer under the locks first. lock_families takes every contact
    -- the group reaches up front; the second pass is only for a member
    -- whose contact the group did not list yet. Same signature.
    create or replace function public.recompute_sibling_group(group_id uuid, cause text)
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
        loop
            perform public.lock_families(contacts);
            perform public.lock_sibling_groups(array[group_id]);
            select coalesce(array_agg(distinct l.guardian_contact_id), '{}') into read_again
            from public.sibling_group_members m join public.leads l on l.id = m.lead_id
            where m.group_id = recompute_sibling_group.group_id;
            exit when read_again <@ contacts;
            contacts := contacts || read_again;
        end loop;

        perform public.choose_full_payer(group_id);

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

    -- A lead entering or leaving Declined or a closure mark, in a group with
    -- a member that is not legacy: whether it counts changed, so the group
    -- is recomputed (the full payer may be chosen again). Legacy members
    -- follow today's rule, which reads only Enrolled.
    create function public.recompute_siblings_on_counting_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        own_group uuid := public.lead_sibling_group(new.id);
    begin
        if own_group is not null and exists (
            select 1 from public.sibling_group_members m
            where m.group_id = own_group and m.group_id is not null and not m.legacy
        ) then
            perform public.recompute_sibling_group(own_group, 'sibling');
        end if;
        return null;
    end;
    $fn$;

    revoke execute on function public.recompute_siblings_on_counting_change() from public, anon, authenticated, service_role;

    create trigger recompute_siblings_on_counting_change
        after update of status, closure on public.leads
        for each row
        when (
            (old.status = 'Declined') is distinct from (new.status = 'Declined')
            or old.closure is distinct from new.closure
        )
        execute function public.recompute_siblings_on_counting_change();

    -- The contact-move trigger, as 20261212100100 made it, now leaving the
    -- legacy group whenever it is not the new contact's (#300 note 1), and
    -- keeping each group's contacts. Same trigger.
    create or replace function public.recompute_lead_fee_on_lead_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        old_group uuid;
        new_group uuid;
    begin
        if old.guardian_contact_id is distinct from new.guardian_contact_id then
            perform public.lock_families(array[old.guardian_contact_id, new.guardian_contact_id]);
            old_group := public.lead_sibling_group(new.id);
            if (select g.legacy_contact_id from public.sibling_groups g where g.id = old_group)
               is distinct from new.guardian_contact_id then
                perform public.leave_legacy_sibling_group(new.id, 'family');
            end if;
            perform public.sync_family_sibling_group(new.guardian_contact_id, 'family', new.id);
            new_group := public.lead_sibling_group(new.id);
            perform public.refresh_sibling_group_contacts(old_group);
            if new_group is distinct from old_group then
                perform public.refresh_sibling_group_contacts(new_group);
            end if;
            perform public.recompute_lead_fee(new.id, 'family');
            perform public.recompute_sibling_group(old_group, 'family');
            if new_group is distinct from old_group then
                perform public.recompute_sibling_group(new_group, 'family');
            end if;
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

    -- sync_family_sibling_group, as 20261212100100 made it, now storing a new
    -- group's contact. Same signature.
    create or replace function public.sync_family_sibling_group(contact_id uuid, cause text, lead_id uuid default null)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        target uuid;
        only_lead uuid := sync_family_sibling_group.lead_id;
        confirmed boolean;
    begin
        select c.pending_family_match_id is null into confirmed
        from public.guardian_contacts c where c.id = sync_family_sibling_group.contact_id;
        if not coalesce(confirmed, false) then
            return;
        end if;
        perform public.lock_families(array[contact_id]);

        select g.id into target from public.sibling_groups g where g.legacy_contact_id = sync_family_sibling_group.contact_id;
        if target is not null and only_lead is not null then
            insert into public.sibling_group_members as m (lead_id, group_id, legacy, cause, joined_at)
            select l.id, target, true, sync_family_sibling_group.cause, now()
            from public.leads l
            where l.id = only_lead and l.guardian_contact_id = sync_family_sibling_group.contact_id
            on conflict on constraint sibling_group_members_lead_id_key do update
            set group_id = excluded.group_id,
                legacy = true,
                basis = null,
                sibling_of_lead_id = null,
                cause = excluded.cause,
                joined_at = excluded.joined_at,
                updated_at = now()
            where m.group_id is null;
            return;
        end if;
        if target is null then
            if (select count(*) from (
                    select 1 from public.leads l where l.guardian_contact_id = sync_family_sibling_group.contact_id limit 2
                ) two) < 2 then
                return;
            end if;
            insert into public.sibling_groups (legacy_contact_id, cause, contact_ids)
            values (sync_family_sibling_group.contact_id, sync_family_sibling_group.cause, array[sync_family_sibling_group.contact_id])
            returning id into target;
            perform public.lock_sibling_groups(array[target]);
        end if;

        insert into public.sibling_group_members as m (lead_id, group_id, legacy, cause, joined_at)
        select l.id, target, true, sync_family_sibling_group.cause, now()
        from public.leads l
        where l.guardian_contact_id = sync_family_sibling_group.contact_id
        order by l.id
        on conflict on constraint sibling_group_members_lead_id_key do update
        set group_id = excluded.group_id,
            legacy = true,
            basis = null,
            sibling_of_lead_id = null,
            cause = excluded.cause,
            joined_at = excluded.joined_at,
            updated_at = now()
        where m.group_id is null;
    end;
    $fn$;

    revoke execute on function public.sync_family_sibling_group(uuid, text, uuid) from public, anon, authenticated, service_role;

    -- backfill_sibling_groups, as 20261212100100 made it, now storing each
    -- group's contact. Same signature; for the tests.
    create or replace function public.backfill_sibling_groups()
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
            insert into public.sibling_groups (id, legacy_contact_id, cause, contact_ids)
            select f.group_id, f.contact_id, 'migration', array[f.contact_id] from families f
            returning id
        ),
        joined as (
            insert into public.sibling_group_members (lead_id, group_id, legacy, cause, joined_at)
            select l.id, f.group_id, true, 'migration', now()
            from families f
            join public.leads l on l.guardian_contact_id = f.contact_id
            returning id
        )
        select count(*)::integer from made;
    $fn$;

    revoke execute on function public.backfill_sibling_groups() from public, anon, authenticated, service_role;

    -- set_sibling_grants_paused, as 20261212100100 made it, now also
    -- resuming every group with a member that is not legacy and one not yet
    -- Enrolled, since the 10% can now come at once. Same signature.
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
          and (
              exists (
                  select 1 from public.sibling_group_members s join public.leads sl on sl.id = s.lead_id
                  where s.group_id = w.group_id and s.lead_id <> w.lead_id and sl.status = 'Enrolled'
              )
              or exists (
                  select 1 from public.sibling_group_members c
                  where c.group_id = w.group_id and not c.legacy
              )
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
    -- Father's-name changes.
    -- -----------------------------------------------------------------------

    -- refuse_closed_lead_change, as 20261211200100 made it, plus the
    -- `father_name_typo` override, which lets a typo answer write only the
    -- father's name and its source on a closed group member. Same trigger.
    create or replace function public.refuse_closed_lead_change()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        privileged boolean := current_user not in ('authenticated', 'anon');
        override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
    begin
        if (old.status = 'Declined' or old.closure is not null)
           and not (privileged and override in ('close', 'reopen', 'payment_recompute'))
           and not (
               privileged
               and override = 're_application'
               and new.returning_family_reapplied
               and (to_jsonb(new) - 'returning_family_reapplied' - 'student_name_key')
                   = (to_jsonb(old) - 'returning_family_reapplied' - 'student_name_key')
           )
           and not (
               privileged
               and override = 'custodian_sync'
               and (to_jsonb(new) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
                   = (to_jsonb(old) - 'custodian_relationship' - 'custodian_relationship_description' - 'student_name_key')
           )
           and not (
               privileged
               and override = 'father_name_typo'
               and new.father_full_name_source = 'typo_confirmed'
               and (to_jsonb(new) - 'father_full_name' - 'father_full_name_source' - 'student_name_key')
                   = (to_jsonb(old) - 'father_full_name' - 'father_full_name_source' - 'student_name_key')
           ) then
            raise exception 'lead_closed';
        end if;
        return new;
    end;
    $fn$;

    revoke execute on function public.refuse_closed_lead_change() from public, anon, authenticated;

    -- write_typo_spelling(group_id, spelling, replaced): the typo answer
    -- (S5, R39). Every member of the group whose father's name is the
    -- replaced spelling, once normalized, gets `spelling` with the source
    -- typo_confirmed, closed members included, in this one step; the audit
    -- trigger records each row with the staff member and the old value. The
    -- members' bases do not change. The caller holds the group's locks.
    -- Internal.
    create function public.write_typo_spelling(group_id uuid, spelling text, replaced text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        earlier_override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        each_lead uuid;
    begin
        perform set_config('app.sibling_typo_group', write_typo_spelling.group_id::text, true);
        perform set_config('app.lead_lifecycle_override', 'father_name_typo', true);
        for each_lead in
            select l.id
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            where m.group_id = write_typo_spelling.group_id
              and public.normalize_father_name(l.father_full_name) = public.normalize_father_name(write_typo_spelling.replaced)
            order by l.id
            for update of l
        loop
            update public.leads l
            set father_full_name = write_typo_spelling.spelling,
                father_full_name_source = 'typo_confirmed'
            where l.id = each_lead;
        end loop;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
        perform set_config('app.sibling_typo_group', '', true);
    end;
    $fn$;

    revoke execute on function public.write_typo_spelling(uuid, text, text) from public, anon, authenticated, service_role;

    -- A linked member's father's name changed, on any path (a correction, a
    -- student-name correction that re-derives it, anything else): the S5
    -- check against the group's other checked members. Same keeps the
    -- basis; anything else makes the member request_needed (a Close answer
    -- the staff member gave as "typing mistake" comes through
    -- write_typo_spelling instead, and update_lead_details asks the
    -- question before saving). A change of case, spacing or punctuation
    -- only is no change. The writer holds the group's locks (Family lock
    -- first, #297). Internal.
    create function public.sibling_check_on_father_name_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        member public.sibling_group_members;
        checked record;
        next_basis text;
    begin
        if public.father_name_match(old.father_full_name, new.father_full_name) = 'same' then
            return null;
        end if;
        select * into member from public.sibling_group_members m where m.lead_id = new.id;
        if member.group_id is null or member.legacy then
            return null;
        end if;
        if coalesce(current_setting('app.sibling_typo_group', true), '') = member.group_id::text then
            return null;
        end if;

        select * into checked from public.sibling_name_check(new.id, new.father_full_name, member.group_id);
        if checked.verdict is null then
            return null;
        end if;
        next_basis := case when checked.verdict = 'same' then member.basis else 'request_needed' end;
        if next_basis is distinct from member.basis then
            update public.sibling_group_members m
            set basis = next_basis, cause = 'father_name', updated_at = now()
            where m.id = member.id;
            perform public.recompute_sibling_group(member.group_id, 'sibling');
        end if;
        return null;
    end;
    $fn$;

    revoke execute on function public.sibling_check_on_father_name_change() from public, anon, authenticated, service_role;

    create trigger sibling_check_on_father_name_change
        after update of father_full_name on public.leads
        for each row
        when (old.father_full_name is distinct from new.father_full_name)
        execute function public.sibling_check_on_father_name_change();

    -- -----------------------------------------------------------------------
    -- link_sibling.
    -- -----------------------------------------------------------------------

    -- link_sibling(lead_id, sibling_of_lead_id, father_full_name,
    -- sibling_father_full_name, answer, spelling): links an open lead as
    -- "Sibling of" another open lead. Needs leads.edit. Returns one of:
    --   {"result": "father_name_needed", "lead_id"}          the lead has
    --       no father's name, or only a backfilled one: pass father_full_name.
    --   {"result": "sibling_father_name_needed", "lead_id"}  the other lead
    --       is legacy, or alone with no checked name: pass
    --       sibling_father_full_name; it ends that lead's legacy status (R32).
    --   {"result": "name_question", "father_full_name", "sibling_lead_id",
    --    "sibling_father_full_name"}                         the names are
    --       close: call again with answer `typo` and the right spelling, or
    --       `different`. Nothing is saved.
    --   {"result": "linked", "basis", "group_id"}            saved; basis is
    --       matched, typo_confirmed or request_needed (a Sibling request is
    --       needed, #302).
    -- A lead already linked into that group is returned as it is, unchecked
    -- again. A lead linked into another group with siblings of its own is
    -- merged into this one with them; that needs the names to match (or a
    -- typo answer), and is refused as invalid `sibling_of` otherwise.
    create function public.link_sibling(
        lead_id uuid,
        sibling_of_lead_id uuid,
        father_full_name text default null,
        sibling_father_full_name text default null,
        answer text default null,
        spelling text default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        x public.leads;
        t public.leads;
        mx public.sibling_group_members;
        mt public.sibling_group_members;
        gx uuid;
        gt uuid;
        x_name text;
        t_name text;
        x_name_given boolean := false;
        t_name_given boolean := false;
        t_needs_name boolean;
        t_basis text;
        x_basis text;
        checked record;
        merging boolean := false;
        moving_out uuid;
        clean_spelling text;
        replaced text;
        kept uuid[];
        px uuid;
        pt uuid;
        pt_ok boolean;
        px_ok boolean;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;
        if link_sibling.lead_id is null or link_sibling.sibling_of_lead_id is null
           or link_sibling.lead_id = link_sibling.sibling_of_lead_id then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of')::text;
        end if;
        if link_sibling.answer is not null and link_sibling.answer not in ('typo', 'different') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'answer')::text;
        end if;

        -- Every lock up front: both leads' Family locks and every contact
        -- their groups reach, then those groups, then the rows (R18, R45).
        perform public.lock_lead_families(array[link_sibling.lead_id, link_sibling.sibling_of_lead_id]);
        perform 1 from public.leads l
        where l.id in (link_sibling.lead_id, link_sibling.sibling_of_lead_id)
        order by l.id
        for update;
        select * into x from public.leads l where l.id = link_sibling.lead_id;
        select * into t from public.leads l where l.id = link_sibling.sibling_of_lead_id;
        if x.id is null or t.id is null then
            raise exception 'not_found';
        end if;
        perform public.assert_lead_open(x.id);
        perform public.assert_lead_open(t.id);
        if exists (
            select 1 from public.guardian_contacts g
            where g.id in (x.guardian_contact_id, t.guardian_contact_id) and g.pending_family_match_id is not null
        ) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'family_match')::text;
        end if;

        select * into mx from public.sibling_group_members m where m.lead_id = x.id for update;
        select * into mt from public.sibling_group_members m where m.lead_id = t.id for update;
        gx := mx.group_id;
        gt := mt.group_id;

        -- Already linked into that group: nothing to do, nothing re-checked.
        if gx is not null and gx = gt and not mx.legacy then
            return jsonb_build_object('result', 'linked', 'basis', mx.basis, 'group_id', gx);
        end if;

        -- The lead's own father's name.
        if link_sibling.father_full_name is not null then
            if gx is not null and not mx.legacy then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            x_name := public.clean_father_name(link_sibling.father_full_name);
            if x_name is null or char_length(x_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            x_name_given := true;
        elsif x.father_full_name is null or x.father_full_name_source = 'backfilled' then
            return jsonb_build_object('result', 'father_name_needed', 'lead_id', x.id);
        else
            x_name := x.father_full_name;
        end if;

        -- The other lead's: confirmed by staff when it is legacy or starts a
        -- group with a name nobody checked.
        t_needs_name := (gt is not null and mt.legacy)
            or (gt is null and (t.father_full_name is null or t.father_full_name_source = 'backfilled'));
        if link_sibling.sibling_father_full_name is not null then
            if not t_needs_name then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_father_full_name')::text;
            end if;
            t_name := public.clean_father_name(link_sibling.sibling_father_full_name);
            if t_name is null or char_length(t_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_father_full_name')::text;
            end if;
            t_name_given := true;
        elsif t_needs_name then
            return jsonb_build_object('result', 'sibling_father_name_needed', 'lead_id', t.id);
        else
            t_name := t.father_full_name;
        end if;

        -- The other lead's place: the first of a new group, a legacy member
        -- checked against the group's checked members (Same, or a request;
        -- no question for it), or a member as it stands.
        if gt is null then
            t_basis := 'matched';
        elsif mt.legacy then
            select * into checked from public.sibling_name_check(t.id, t_name, gt, x.id, null);
            t_basis := case when checked.verdict is null or checked.verdict = 'same' then 'matched' else 'request_needed' end;
        else
            t_basis := mt.basis;
        end if;

        -- The lead against the group it joins: its checked members, and the
        -- other lead when it counts.
        select * into checked
        from public.sibling_name_check(
            x.id, x_name, gt,
            case when public.sibling_basis_counts(t_basis) then t.id end,
            case when public.sibling_basis_counts(t_basis) then t_name end
        );

        if gx is not null and not mx.legacy and not public.sibling_basis_counts(mx.basis) then
            -- A linked lead that waits on a request (or was refused) keeps
            -- that state wherever it is linked next: only a granted request
            -- makes it count (S2, R36). No question, no new check.
            x_basis := mx.basis;
        elsif checked.verdict = 'same' then
            x_basis := 'matched';
        elsif checked.verdict = 'close' then
            if link_sibling.answer is null then
                return jsonb_build_object(
                    'result', 'name_question',
                    'father_full_name', x_name,
                    'sibling_lead_id', checked.other_lead_id,
                    'sibling_father_full_name', checked.other_name
                );
            elsif link_sibling.answer = 'typo' then
                clean_spelling := public.clean_father_name(link_sibling.spelling);
                if clean_spelling is null
                   or not (public.father_name_match(clean_spelling, x_name) = 'same'
                           or public.father_name_match(clean_spelling, checked.other_name) = 'same') then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'spelling')::text;
                end if;
                replaced := case when public.father_name_match(clean_spelling, x_name) = 'same'
                                 then checked.other_name else x_name end;
                x_basis := 'typo_confirmed';
            else
                x_basis := 'request_needed';
            end if;
        else
            if link_sibling.answer = 'typo' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'answer')::text;
            end if;
            x_basis := 'request_needed';
        end if;

        -- A linked lead with linked siblings of its own brings them along.
        merging := gx is not null and gx is distinct from gt and not mx.legacy and exists (
            select 1 from public.sibling_group_members o
            where o.group_id = gx and o.lead_id <> x.id and not o.legacy
        );
        if merging and not public.sibling_basis_counts(x_basis) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'merge_needs_match')::text;
        end if;

        -- Writes. First, which automatic 10% a link must not take away.
        kept := array(
            select m.lead_id
            from public.sibling_group_members m
            join public.lead_sibling_results r on r.lead_id = m.lead_id
            where m.group_id in (gx, gt) and r.result = 'ten' and r.source = 'auto'
        );
        perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

        -- Staff-confirmed names. Neither lead is a linked member yet, so the
        -- check trigger leaves these alone.
        if x_name_given and x_name is distinct from x.father_full_name then
            update public.leads l set father_full_name = x_name, father_full_name_source = 'edited' where l.id = x.id;
        elsif x_name_given and x.father_full_name_source = 'backfilled' then
            update public.leads l set father_full_name_source = 'edited' where l.id = x.id;
        end if;
        if t_name_given and t_name is distinct from t.father_full_name then
            update public.leads l set father_full_name = t_name, father_full_name_source = 'edited' where l.id = t.id;
        elsif t_name_given and t.father_full_name_source = 'backfilled' then
            update public.leads l set father_full_name_source = 'edited' where l.id = t.id;
        end if;

        -- The other lead's group.
        if gt is null then
            insert into public.sibling_groups (cause, contact_ids)
            values ('sibling_link', array[t.guardian_contact_id])
            returning id into gt;
            perform public.lock_sibling_groups(array[gt]);
            insert into public.sibling_group_members as m (lead_id, group_id, legacy, basis, cause, joined_at)
            values (t.id, gt, false, 'matched', 'sibling_link', now())
            on conflict on constraint sibling_group_members_lead_id_key do update
            set group_id = excluded.group_id,
                legacy = false,
                basis = excluded.basis,
                sibling_of_lead_id = null,
                cause = excluded.cause,
                joined_at = excluded.joined_at,
                updated_at = now();
        elsif mt.legacy then
            update public.sibling_group_members m
            set legacy = false, basis = t_basis, cause = 'sibling_link', updated_at = now()
            where m.id = mt.id;
        end if;

        if merging then
            -- The full payer of the merged group: the one with the higher fee
            -- when both still stand, oldest lead on a tie. The other one
            -- becomes a later sibling, which can only lower its fee.
            select g.full_payer_lead_id into pt from public.sibling_groups g where g.id = gt;
            select g.full_payer_lead_id into px from public.sibling_groups g where g.id = gx;
            select exists (select 1 from public.sibling_group_members m where m.lead_id = px and m.group_id = gx and not m.legacy)
            into px_ok;
            if px is not null and px_ok then
                select exists (select 1 from public.sibling_group_members m where m.lead_id = pt and m.group_id = gt)
                into pt_ok;
                if pt is null or not pt_ok or (
                    select (fx.band_fee, -extract(epoch from lx.created_at)) > (ft.band_fee, -extract(epoch from lt.created_at))
                    from public.leads lx cross join lateral public.lead_fee_amounts(lx.id) fx,
                         public.leads lt cross join lateral public.lead_fee_amounts(lt.id) ft
                    where lx.id = px and lt.id = pt
                ) then
                    update public.sibling_groups g
                    set full_payer_lead_id = px, full_payer_chosen_at = now(), updated_at = now()
                    where g.id = gt;
                end if;
                update public.sibling_groups g
                set full_payer_lead_id = null, full_payer_chosen_at = null, updated_at = now()
                where g.id = gx;
            end if;

            update public.sibling_group_members m
            set group_id = gt, cause = 'merge', joined_at = now(), updated_at = now()
            where m.group_id = gx and not m.legacy and m.lead_id <> x.id;
        end if;

        if gx is not null and gx is distinct from gt then
            moving_out := gx;
        end if;
        insert into public.sibling_group_members as m (lead_id, group_id, legacy, basis, sibling_of_lead_id, cause, joined_at)
        values (x.id, gt, false, x_basis, t.id, 'sibling_link', now())
        on conflict on constraint sibling_group_members_lead_id_key do update
        set group_id = excluded.group_id,
            legacy = false,
            basis = excluded.basis,
            sibling_of_lead_id = excluded.sibling_of_lead_id,
            cause = excluded.cause,
            -- Staying in its own group, it keeps the time it joined.
            joined_at = case when m.group_id = excluded.group_id then m.joined_at else excluded.joined_at end,
            updated_at = now();

        if x_basis = 'typo_confirmed' then
            perform public.write_typo_spelling(gt, clean_spelling, replaced);
        end if;

        perform public.refresh_sibling_group_contacts(gt);
        perform public.refresh_sibling_group_contacts(moving_out);

        perform public.recompute_sibling_group(gt, 'sibling');
        perform public.recompute_sibling_group(moving_out, 'sibling');

        perform set_config('app.sibling_keep_ten', '', true);
        return jsonb_build_object('result', 'linked', 'basis', x_basis, 'group_id', gt);
    end;
    $fn$;

    revoke execute on function public.link_sibling(uuid, uuid, text, text, text, text) from public, anon;
    grant execute on function public.link_sibling(uuid, uuid, text, text, text, text) to authenticated;

    -- sibling_group_results(group_id): each member, its stored result and
    -- source, and the rule's reason code, for the explanation (#306).
    -- Internal.
    create function public.sibling_group_results(group_id uuid)
    returns table (
        lead_id uuid,
        legacy boolean,
        basis text,
        full_payer boolean,
        result public.sibling_result,
        source public.sibling_result_source,
        reason text
    )
    language sql
    stable
    set search_path = ''
    as $fn$
        select m.lead_id, m.legacy, m.basis, g.full_payer_lead_id is not distinct from m.lead_id,
               coalesce(r.result, 'none'), coalesce(r.source, 'auto'),
               case
                   when r.source = 'manual' then 'manual'
                   when r.source = 'legacy' then 'kept_when_leaving_legacy'
                   else answer.reason
               end
        from public.sibling_group_members m
        join public.sibling_groups g on g.id = m.group_id
        left join public.lead_sibling_results r on r.lead_id = m.lead_id
        cross join lateral public.sibling_rule_result(m.lead_id) answer
        where m.group_id = sibling_group_results.group_id
        order by m.lead_id;
    $fn$;

    revoke execute on function public.sibling_group_results(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- update_lead_details, as 20261211200100 made it, now also correcting
    -- the father's full name (`father_full_name`, source `edited`). When a
    -- linked member that counts would get a father's name close to its
    -- group's (by that key, or by a student-name correction that re-derives
    -- it), nothing is saved and it raises `father_name_question` with the
    -- two names, until the call carries `father_name_answer`: `different`
    -- saves it and the member needs a Sibling request; `typo` with
    -- `father_name_spelling` (one of the two names) saves that spelling on
    -- every group member holding the other one (R39). Every other father's
    -- name change of a linked member goes through the check trigger.
    -- -----------------------------------------------------------------------

    create or replace function public.update_lead_details(lead_id uuid, changes jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        lead public.leads;
        contact public.guardian_contacts;
        pupil_name text;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        this_year integer := extract(year from public.tanzania_today());
        phones text[];
        match public.leads;
        brought_name text;
        brought_phone text;
        brought_relationship text;
        school_name text;
        school_type public.previous_school_type;
        school_region text;
        school_not_known boolean;
        father_name text;
        father_source public.father_name_source;
        effective_father text;
        father_answer text;
        father_spelling text;
        member public.sibling_group_members;
        check_verdict text;
        check_other_lead uuid;
        check_other_name text;
        typo_replaced text;
        typo_mode boolean := false;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;

        perform public.lock_lead_family(update_lead_details.lead_id);
        select * into lead from public.leads l where l.id = update_lead_details.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        perform public.assert_lead_open(lead.id);

        pupil_name := lead.student_name;
        if changes ? 'full_name' then
            pupil_name := btrim(coalesce(changes ->> 'full_name', ''));
            if pupil_name = '' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
            end if;
        end if;

        student_class := lead.class_name;
        if changes ? 'class_name' then
            begin
                student_class := (changes ->> 'class_name')::public.lead_class;
            exception when invalid_text_representation then
                student_class := null;
            end;
            if student_class is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
            end if;
        end if;

        student_year := lead.enrollment_year;
        if changes ? 'enrollment_year' then
            begin
                student_year := (changes ->> 'enrollment_year')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                student_year := null;
            end;
            if student_year is null
               or (student_year <> lead.enrollment_year and student_year not between this_year and this_year + 2) then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
            end if;
        end if;

        student_boarding := lead.day_or_boarding;
        if changes ? 'day_or_boarding' then
            begin
                student_boarding := (changes ->> 'day_or_boarding')::public.day_or_boarding;
            exception when invalid_text_representation then
                student_boarding := null;
            end;
            if student_boarding is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
            end if;
        end if;

        brought_name := lead.brought_by_name;
        if changes ? 'brought_by_name' then
            brought_name := nullif(btrim(coalesce(changes ->> 'brought_by_name', '')), '');
            if char_length(brought_name) > 120 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_name')::text;
            end if;
        end if;

        brought_phone := lead.brought_by_phone;
        if changes ? 'brought_by_phone' then
            brought_phone := nullif(btrim(coalesce(changes ->> 'brought_by_phone', '')), '');
            if brought_phone is not null then
                brought_phone := public.normalize_phone(brought_phone);
                if brought_phone is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_phone')::text;
                end if;
            end if;
        end if;

        brought_relationship := lead.brought_by_relationship;
        if changes ? 'brought_by_relationship' then
            brought_relationship := nullif(btrim(coalesce(changes ->> 'brought_by_relationship', '')), '');
            if char_length(brought_relationship) > 60 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_relationship')::text;
            end if;
        end if;

        if brought_name is null and (brought_phone is not null or brought_relationship is not null) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'brought_by_name')::text;
        end if;

        school_name := lead.previous_school_name;
        if changes ? 'previous_school_name' then
            school_name := nullif(btrim(coalesce(changes ->> 'previous_school_name', '')), '');
            if char_length(school_name) not between 2 and 120 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_name')::text;
            end if;
        end if;

        school_type := lead.previous_school_type;
        if changes ? 'previous_school_type' then
            if nullif(btrim(coalesce(changes ->> 'previous_school_type', '')), '') is null then
                school_type := null;
            else
                begin
                    school_type := (changes ->> 'previous_school_type')::public.previous_school_type;
                exception when invalid_text_representation then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_type')::text;
                end;
            end if;
        end if;

        school_region := lead.previous_school_region;
        if changes ? 'previous_school_region' then
            if nullif(btrim(coalesce(changes ->> 'previous_school_region', '')), '') is null then
                school_region := null;
            else
                school_region := public.previous_school_region(changes ->> 'previous_school_region');
                if school_region is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_region')::text;
                end if;
            end if;
        end if;

        school_not_known := lead.previous_school_not_known;
        if changes ? 'previous_school_not_known' then
            if jsonb_typeof(changes -> 'previous_school_not_known') is distinct from 'boolean' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_not_known')::text;
            end if;
            school_not_known := (changes ->> 'previous_school_not_known')::boolean;
        end if;

        if school_not_known and (school_name is not null or school_type is not null or school_region is not null) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_not_known')::text;
        end if;
        if school_name is not null or school_type is not null or school_region is not null then
            if school_name is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_name')::text;
            elsif school_type is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_type')::text;
            elsif school_region is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'previous_school_region')::text;
            end if;
        end if;

        -- The father's full name (#301). Left out, it stays, or follows a
        -- corrected student name while it was derived or backfilled (the
        -- derive trigger does that on the update below).
        father_name := lead.father_full_name;
        father_source := lead.father_full_name_source;
        if changes ? 'father_full_name' then
            father_name := public.clean_father_name(changes ->> 'father_full_name');
            if father_name is null or char_length(father_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            father_source := case
                when father_name is not distinct from lead.father_full_name
                     and lead.father_full_name_source in ('edited', 'typo_confirmed')
                    then lead.father_full_name_source
                else 'edited'
            end;
            effective_father := father_name;
        elsif pupil_name is distinct from lead.student_name and lead.father_full_name_source in ('derived', 'backfilled') then
            effective_father := public.derive_father_full_name(pupil_name);
        else
            effective_father := lead.father_full_name;
        end if;

        father_answer := nullif(btrim(coalesce(changes ->> 'father_name_answer', '')), '');
        if father_answer is not null and father_answer not in ('typo', 'different') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_answer')::text;
        end if;

        -- A new name must not make this child a duplicate of another lead, a
        -- brother or sister on the same contact included.
        if public.normalize_student_name(pupil_name) <> lead.student_name_key then
            select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;
            phones := array[contact.phone, contact.whatsapp];
            perform public.lock_lead_phones(phones);
            match := public.find_duplicate_lead(public.normalize_student_name(pupil_name), phones, lead.id);
            if match.id is not null then
                return public.duplicate_result(match);
            end if;
        end if;

        -- A linked member that counts, about to get a name close to its
        -- group's: the typing-mistake question first (S5, R36).
        select * into member from public.sibling_group_members m where m.lead_id = lead.id;
        if member.group_id is not null and not member.legacy and public.sibling_basis_counts(member.basis)
           and public.father_name_match(lead.father_full_name, effective_father) is distinct from 'same' then
            select c.verdict, c.other_lead_id, c.other_name into check_verdict, check_other_lead, check_other_name
            from public.sibling_name_check(lead.id, effective_father, member.group_id) c;
        end if;
        if check_verdict = 'close' then
            if father_answer is null then
                raise exception 'father_name_question' using detail = jsonb_build_object(
                    'father_full_name', effective_father,
                    'sibling_lead_id', check_other_lead,
                    'sibling_father_full_name', check_other_name
                )::text;
            elsif father_answer = 'typo' then
                father_spelling := public.clean_father_name(changes ->> 'father_name_spelling');
                if father_spelling is null
                   or not (public.father_name_match(father_spelling, effective_father) = 'same'
                           or public.father_name_match(father_spelling, check_other_name) = 'same') then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_spelling')::text;
                end if;
                typo_replaced := case when public.father_name_match(father_spelling, effective_father) = 'same'
                                      then check_other_name else effective_father end;
                father_name := father_spelling;
                father_source := 'typo_confirmed';
                typo_mode := true;
            end if;
        elsif father_answer is not null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_name_answer')::text;
        end if;

        if typo_mode then
            perform set_config('app.sibling_typo_group', member.group_id::text, true);
        end if;

        update public.leads l
        set student_name = pupil_name,
            class_name = student_class,
            enrollment_year = student_year,
            day_or_boarding = student_boarding,
            brought_by_name = brought_name,
            brought_by_phone = brought_phone,
            brought_by_relationship = brought_relationship,
            previous_school_name = school_name,
            previous_school_type = school_type,
            previous_school_region = school_region,
            previous_school_not_known = school_not_known,
            father_full_name = father_name,
            father_full_name_source = father_source
        where l.id = lead.id;

        if typo_mode then
            perform public.write_typo_spelling(member.group_id, father_spelling, typo_replaced);
            update public.sibling_group_members m
            set basis = 'typo_confirmed', cause = 'father_name', updated_at = now()
            where m.id = member.id and m.basis is distinct from 'typo_confirmed';
        end if;

        return jsonb_build_object('result', 'updated');
    end;
    $fn$;

    revoke execute on function public.update_lead_details(uuid, jsonb) from public, anon;
    grant execute on function public.update_lead_details(uuid, jsonb) to authenticated;

    -- -----------------------------------------------------------------------
    -- mark_lead, as 20261018800200_mark_lead.sql made it, now taking the
    -- lead's Family lock before its row: a closure mark now recomputes a
    -- group with a member that is not legacy (#337). Nothing else changes.
    -- -----------------------------------------------------------------------

    create or replace function public.mark_lead(lead_id uuid, mark text, reason text, note text default null)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        target public.leads;
        chosen_mark public.lead_closure;
        chosen_reason public.closure_reason;
        clean_note text := nullif(btrim(coalesce(mark_lead.note, '')), '');
        staff_id uuid;
        earlier_override text;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.close') then
            raise exception 'not_permitted';
        end if;

        begin
            chosen_mark := mark_lead.mark::public.lead_closure;
        exception when invalid_text_representation then
            chosen_mark := null;
        end;
        if chosen_mark is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'mark')::text;
        end if;

        begin
            chosen_reason := mark_lead.reason::public.closure_reason;
        exception when invalid_text_representation then
            chosen_reason := null;
        end;
        if chosen_reason is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
        end if;
        if char_length(clean_note) > 1000 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
        end if;

        perform public.lock_lead_family(mark_lead.lead_id);
        select * into target from public.leads l where l.id = mark_lead.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        if not (target.closure is null or (target.closure = 'Inactive' and chosen_mark = 'Archived')) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'mark')::text;
        end if;

        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('close');

        update public.leads l
        set closure = chosen_mark,
            closure_reason = chosen_reason,
            closure_note = clean_note,
            closed_at = now(),
            closed_by = staff_id
        where l.id = target.id;

        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end;
    $fn$;

    revoke execute on function public.mark_lead(uuid, text, text, text) from public, anon;
    grant execute on function public.mark_lead(uuid, text, text, text) to authenticated;

    -- -----------------------------------------------------------------------
    -- Backfill: every group's contacts. Writes before nothing reads them
    -- for a fee; adds a history entry to no lead (sibling_groups rows have
    -- no lead).
    -- -----------------------------------------------------------------------

    update public.sibling_groups g
    set contact_ids = x.ids
    from (
        select g2.id,
               (select coalesce(array_agg(distinct c order by c), '{}')
                from (
                    select l.guardian_contact_id as c
                    from public.sibling_group_members m join public.leads l on l.id = m.lead_id
                    where m.group_id = g2.id
                    union
                    select g2.legacy_contact_id
                ) s
                where c is not null) as ids
        from public.sibling_groups g2
    ) x
    where g.id = x.id and g.contact_ids is distinct from x.ids;

    -- Every member is legacy, and every legacy group sits on its contact.
    if exists (select 1 from public.sibling_group_members m where m.group_id is not null and not m.legacy) then
        raise exception 'sibling_of_unexpected_checked_member';
    end if;
    if exists (select 1 from public.sibling_groups g where cardinality(g.contact_ids) > 1) then
        raise exception 'sibling_of_group_spans_contacts';
    end if;

    -- Parity: the new rule gives every lead what the Family rule gave.
    if exists (
        select 1 from public.leads l
        where (select (r.result, r.source) from public.sibling_rule_result(l.id) r)
              is distinct from (select (f.result, f.source) from public.sibling_rule_result_by_family(l.id) f)
    ) then
        raise exception 'sibling_rule_parity_mismatch';
    end if;

    perform public.assert_fee_snapshot_unchanged('pg_temp.sibling_of_snapshot_before');
    drop table pg_temp.sibling_of_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
