-- The staff New Student form saves 1 to 8 students in one call, all or
-- nothing (#304, spec #296, align brief S1, S2, S5, S6, S9, R5, R7 to R10,
-- R18, R31, R32, R36, R45). Backend only: no screen calls it until #308.
-- Fees, discounts, statuses and seat counts do not move on migration day.
--
-- 1. register_students(visited_on, people, students). Needs leads.create
--    and visits.record, plus leads.edit when a student is "Sibling of"
--    someone. One transaction: every student is saved, or none is.
--    `people` are the adults on the form: a known person staff confirmed
--    ({"contact_id", "also_check_phones"}) or a new one ({"full_name",
--    "phone", "whatsapp"}). Each student names one of them as its custodian,
--    with its own relationship, so one person can be Mother to one child
--    and Aunt to another, stored once. "The father is the main custodian"
--    ({"father": true}) makes the relationship Father and, for a new person
--    with no name typed, gives the person the father's full name (S6).
--    Students and people are numbered from 1 in the order sent; every
--    refusal about one of them names its number (`student` or `person` in
--    the error detail). Answers:
--      {"result": "created", "students": [...]}    saved.
--      {"result": "duplicate", "duplicates": [...]} a student is on file
--          already (same name, same custodian phone); nothing saved.
--      {"result": "questions", "questions": [...]} staff must answer
--          first; nothing saved. Kinds: `same_father` (two fathers' names
--          are the same but the student has no sibling choice, R8; answer
--          with `sibling_of` or `not_a_sibling`), `name` (close names, S5:
--          answer `typo` with the right spelling, or `different`),
--          `sibling_father_name` (the on-file sibling's father's name was
--          never confirmed, R32), `request_note` (the names differ: a
--          Sibling request needs a note on the proof, or choose Not a
--          sibling).
--
-- 2. Students saved here never join a Family's legacy group. A child on a
--    known custodian is a sibling only by its "Sibling of" choice (S1, R5):
--    sibling_group_members.sibling_choice_made marks it, and
--    sync_family_sibling_group skips it, now and when today's one-student
--    form later adds a child to the same contact.
--
-- 3. Internal pieces the visit-completion ticket (#305) reuses for a lead
--    already on file: registration_name, registration_custodian,
--    registration_brought_by, registration_previous_school (parse and check
--    one student's answers), save_sibling_choice (one "Sibling of" choice
--    with its answers and request, written under the caller's locks, the
--    group recompute left to the caller), lock_registration (the lock
--    phase) and recompute_sibling_groups_once.
--
-- 4. link_sibling is split: link_sibling_locked holds its body, unchanged,
--    and can leave the group recompute and the stale-request withdrawal to
--    its caller. link_sibling takes the locks and calls it, so its answers
--    are the same as before.
--
-- 5. leads.custodian_relationship_own marks a child given its own
--    relationship here, different from the person's. The contact-to-lead
--    relationship copy (20261211200100) leaves those leads alone, however
--    often the person is corrected on today's screens; a lead moved to
--    another contact takes that contact's relationship and loses the mark.
--    Every lead on file today holds its contact's and no mark, so nothing
--    changes for them.
--
-- Locks, all taken before the first write, in the documented order: Family
-- locks of every known person and of every on-file sibling's contact, with
-- every group those reach (lock_families), then the on-file siblings'
-- groups, then the known people's rows, then the phone locks, then the
-- on-file siblings' rows. A contact or group found only once the locks are
-- held raises `unavailable` (40001) and the caller retries, so no wait can
-- close a cycle. No Academic-year lock: nothing here changes a fee
-- schedule or runs the enrolment sweep, and only those take it. New
-- contacts' Family locks are taken as they are inserted; no other
-- transaction knows their keys.
--
-- Each group the form touches is recomputed once, after every link. The
-- cascade ends for the reason in 20261106901100: it recomputes only leads
-- not yet Enrolled, a 10% can only move a lead into Enrolled, and an
-- Enrolled lead is never recomputed. An Enrolled sibling's result is never
-- written here: linking to it only lets it anchor (S1 rule 1, rule 3).
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. It snapshots every fee first and compares at the
-- end; any difference raises and nothing is applied.
--
-- Rollback: a new migration putting back link_sibling,
-- sync_family_sibling_group and sync_lead_custodian_relationship from
-- 20261214100200, 20261213100100 and 20261211200100, and dropping the new
-- functions. The column can stay.

do $migration$
begin
    perform public.set_audit_actor('system');

    lock table public.leads, public.guardian_contacts, public.sibling_groups, public.sibling_group_members,
        public.discount_requests
        in share row exclusive mode;

    drop table if exists pg_temp.register_students_snapshot_before;
    create temp table register_students_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- Columns.
    -- -----------------------------------------------------------------------

    alter table public.sibling_group_members
        add column sibling_choice_made boolean not null default false,
        drop constraint sibling_group_members_cause_check,
        add constraint sibling_group_members_cause_check
            check (cause in (
                'migration', 'lead_created', 'family', 'sibling_link', 'merge', 'father_name', 'sibling_request',
                'registration'
            ));

    comment on column public.sibling_group_members.sibling_choice_made is
        'Staff made this lead''s sibling choice ("Sibling of" or Not a sibling) when registering it (#304): it never joins a Family''s legacy group.';

    -- -----------------------------------------------------------------------
    -- Legacy groups leave registered students alone.
    -- -----------------------------------------------------------------------

    -- sync_family_sibling_group, as 20261213100100 made it, now leaving out
    -- every lead whose sibling choice staff made (sibling_choice_made), and
    -- doing nothing for a lead register_students is inserting (its member
    -- row comes right after the insert). Same signature.
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
        if sync_family_sibling_group.cause = 'lead_created'
           and coalesce(current_setting('app.sibling_registration', true), '') = 'on' then
            return;
        end if;
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
            where m.group_id is null and not m.sibling_choice_made;
            return;
        end if;
        if target is null then
            if (select count(*) from (
                    select 1 from public.leads l
                    where l.guardian_contact_id = sync_family_sibling_group.contact_id
                      and not exists (
                          select 1 from public.sibling_group_members x where x.lead_id = l.id and x.sibling_choice_made
                      )
                    limit 2
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
          and not exists (
              select 1 from public.sibling_group_members x where x.lead_id = l.id and x.sibling_choice_made
          )
        order by l.id
        on conflict on constraint sibling_group_members_lead_id_key do update
        set group_id = excluded.group_id,
            legacy = true,
            basis = null,
            sibling_of_lead_id = null,
            cause = excluded.cause,
            joined_at = excluded.joined_at,
            updated_at = now()
        where m.group_id is null and not m.sibling_choice_made;
    end;
    $fn$;

    revoke execute on function public.sync_family_sibling_group(uuid, text, uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The relationship copy keeps a lead's own relationship.
    -- -----------------------------------------------------------------------

    -- Until now every writer of a lead's relationship copied its contact's
    -- (20261211200100: the backfill, the insert and contact-move trigger,
    -- and the copy below), so every lead on file holds its contact's, gets
    -- no mark, and the copy keeps reaching it. Checked, not assumed: a
    -- lead that differs stops the migration.
    if exists (
        select 1
        from public.leads l
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where (l.custodian_relationship, l.custodian_relationship_description)
              is distinct from (g.relationship, g.relationship_description)
    ) then
        raise exception 'custodian_relationship_differs';
    end if;

    alter table public.leads
        add column custodian_relationship_own boolean not null default false;

    comment on column public.leads.custodian_relationship_own is
        'Staff gave this child its own relationship to the custodian, different from the person''s (#304). A correction of the person''s relationship leaves it alone.';

    -- set_lead_custodian_relationship, as 20261211200100 made it. A lead
    -- moved to another contact that takes the contact's relationship no
    -- longer holds its own. Same trigger.
    create or replace function public.set_lead_custodian_relationship()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        contact public.guardian_contacts;
    begin
        if tg_op = 'INSERT' then
            if new.custodian_relationship is not null then
                return new;
            end if;
        elsif new.guardian_contact_id is not distinct from old.guardian_contact_id
              or new.custodian_relationship is distinct from old.custodian_relationship
              or new.custodian_relationship_description is distinct from old.custodian_relationship_description then
            return new;
        end if;

        select * into contact from public.guardian_contacts g where g.id = new.guardian_contact_id for key share;
        if found then
            new.custodian_relationship := contact.relationship;
            new.custodian_relationship_description := contact.relationship_description;
            new.custodian_relationship_own := false;
        end if;
        return new;
    end;
    $fn$;

    revoke execute on function public.set_lead_custodian_relationship() from public, anon, authenticated, service_role;

    -- sync_lead_custodian_relationship, as 20261211200100 made it, now
    -- leaving out every lead that holds its own relationship. Same trigger.
    create or replace function public.sync_lead_custodian_relationship()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        earlier_override text := coalesce(current_setting('app.lead_lifecycle_override', true), '');
    begin
        perform set_config('app.lead_lifecycle_override', 'custodian_sync', true);
        update public.leads l
        set custodian_relationship = new.relationship,
            custodian_relationship_description = new.relationship_description
        where l.guardian_contact_id = new.id
          and not l.custodian_relationship_own
          and (l.custodian_relationship is distinct from new.relationship
               or l.custodian_relationship_description is distinct from new.relationship_description);
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
        return null;
    end;
    $fn$;

    revoke execute on function public.sync_lead_custodian_relationship() from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- link_sibling, split.
    -- -----------------------------------------------------------------------

    -- link_sibling_locked(...): link_sibling's body after its locks,
    -- unchanged. The caller holds the Family locks of both leads' contacts
    -- and every group they reach. With `deferred`, the caller recomputes
    -- the groups and withdraws stale requests itself, once, and sets
    -- app.sibling_keep_ten for every group it touches before the first
    -- link; the answer then also names the group the lead left
    -- (`left_group`). Internal.
    create function public.link_sibling_locked(
        lead_id uuid,
        sibling_of_lead_id uuid,
        father_full_name text,
        sibling_father_full_name text,
        answer text,
        spelling text,
        deferred boolean
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
        side_x uuid[];
        side_t uuid[];
    begin
        if link_sibling_locked.lead_id is null or link_sibling_locked.sibling_of_lead_id is null
           or link_sibling_locked.lead_id = link_sibling_locked.sibling_of_lead_id then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of')::text;
        end if;
        if link_sibling_locked.answer is not null and link_sibling_locked.answer not in ('typo', 'different') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'answer')::text;
        end if;

        perform 1 from public.leads l
        where l.id in (link_sibling_locked.lead_id, link_sibling_locked.sibling_of_lead_id)
        order by l.id
        for update;
        select * into x from public.leads l where l.id = link_sibling_locked.lead_id;
        select * into t from public.leads l where l.id = link_sibling_locked.sibling_of_lead_id;
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

        if gx is not null and gx = gt and not mx.legacy then
            return jsonb_build_object('result', 'linked', 'basis', mx.basis, 'group_id', gx, 'left_group', null);
        end if;

        if link_sibling_locked.father_full_name is not null then
            if gx is not null and not mx.legacy then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            x_name := public.clean_father_name(link_sibling_locked.father_full_name);
            if x_name is null or char_length(x_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
            end if;
            x_name_given := true;
        elsif x.father_full_name is null or x.father_full_name_source = 'backfilled' then
            return jsonb_build_object('result', 'father_name_needed', 'lead_id', x.id);
        else
            x_name := x.father_full_name;
        end if;

        t_needs_name := (gt is not null and mt.legacy)
            or (gt is null and (t.father_full_name is null or t.father_full_name_source = 'backfilled'));
        if link_sibling_locked.sibling_father_full_name is not null then
            if not t_needs_name then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_father_full_name')::text;
            end if;
            t_name := public.clean_father_name(link_sibling_locked.sibling_father_full_name);
            if t_name is null or char_length(t_name) > 200 then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_father_full_name')::text;
            end if;
            t_name_given := true;
        elsif t_needs_name then
            return jsonb_build_object('result', 'sibling_father_name_needed', 'lead_id', t.id);
        else
            t_name := t.father_full_name;
        end if;

        if gt is null then
            t_basis := 'matched';
        elsif mt.legacy then
            select * into checked from public.sibling_name_check(t.id, t_name, gt, x.id, null);
            t_basis := case when checked.verdict is null or checked.verdict = 'same' then 'matched' else 'request_needed' end;
        else
            t_basis := mt.basis;
        end if;

        select * into checked
        from public.sibling_name_check(
            x.id, x_name, gt,
            case when public.sibling_basis_counts(t_basis) then t.id end,
            case when public.sibling_basis_counts(t_basis) then t_name end
        );

        if gx is not null and not mx.legacy and mx.basis in ('request_needed', 'refused') then
            -- A linked lead that waits on a request, or was refused, keeps
            -- that state wherever it is linked next: only a granted request
            -- makes it count (S2, R36). No question, no new check. A granted
            -- member joining another group is checked like any lead: its
            -- grant was for the group it leaves.
            x_basis := mx.basis;
        elsif checked.verdict = 'same' then
            x_basis := 'matched';
        elsif checked.verdict = 'close' then
            if link_sibling_locked.answer is null then
                return jsonb_build_object(
                    'result', 'name_question',
                    'father_full_name', x_name,
                    'sibling_lead_id', checked.other_lead_id,
                    'sibling_father_full_name', checked.other_name
                );
            elsif link_sibling_locked.answer = 'typo' then
                clean_spelling := public.clean_father_name(link_sibling_locked.spelling);
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
            if link_sibling_locked.answer = 'typo' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'answer')::text;
            end if;
            x_basis := 'request_needed';
        end if;

        merging := gx is not null and gx is distinct from gt and not mx.legacy and exists (
            select 1 from public.sibling_group_members o
            where o.group_id = gx and o.lead_id <> x.id and not o.legacy
        );
        if merging and not public.sibling_basis_counts(x_basis) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'merge_needs_match')::text;
        end if;

        -- A refusal holds (S2, R36): no match, typo answer or name edit gets
        -- round it.
        side_x := case
            when merging then array(
                select m.lead_id from public.sibling_group_members m
                where m.group_id = gx and not m.legacy order by m.lead_id
            )
            else array[x.id]
        end;
        side_t := case when gt is null then array[t.id] else public.sibling_group_leads(gt) end;
        if public.sibling_refusal_between(side_x, case when gx is not null and not mx.legacy then gx end, side_t, gt) then
            if merging then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'refused_request')::text;
            end if;
            x_basis := 'refused';
            clean_spelling := null;
        end if;

        if not link_sibling_locked.deferred then
            kept := array(
                select m.lead_id
                from public.sibling_group_members m
                join public.lead_sibling_results r on r.lead_id = m.lead_id
                where m.group_id in (gx, gt) and r.result = 'ten' and r.source = 'auto'
            );
            perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);
        end if;

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
            perform public.merge_sibling_groups(gx, gt, x.id);
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
            joined_at = case when m.group_id = excluded.group_id then m.joined_at else excluded.joined_at end,
            updated_at = now();

        if x_basis = 'typo_confirmed' then
            perform public.write_typo_spelling(gt, clean_spelling, replaced);
        end if;

        perform public.refresh_sibling_group_contacts(gt);
        perform public.refresh_sibling_group_contacts(moving_out);

        if not link_sibling_locked.deferred then
            perform public.recompute_sibling_group(gt, 'sibling');
            perform public.recompute_sibling_group(moving_out, 'sibling');

            perform public.withdraw_stale_sibling_requests(
                public.sibling_group_leads(gt) || public.sibling_group_leads(moving_out) || array[x.id]
            );

            perform set_config('app.sibling_keep_ten', '', true);
        end if;
        return jsonb_build_object('result', 'linked', 'basis', x_basis, 'group_id', gt, 'left_group', moving_out);
    end;
    $fn$;

    revoke execute on function public.link_sibling_locked(uuid, uuid, text, text, text, text, boolean)
        from public, anon, authenticated, service_role;

    -- link_sibling, as 20261214100200 made it: the permission, the Family
    -- locks of both leads (and every group they reach), then
    -- link_sibling_locked. Same signature and answers.
    create or replace function public.link_sibling(
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

        perform public.lock_lead_families(array[link_sibling.lead_id, link_sibling.sibling_of_lead_id]);
        return public.link_sibling_locked(
            link_sibling.lead_id, link_sibling.sibling_of_lead_id, link_sibling.father_full_name,
            link_sibling.sibling_father_full_name, link_sibling.answer, link_sibling.spelling, false
        ) - 'left_group';
    end;
    $fn$;

    revoke execute on function public.link_sibling(uuid, uuid, text, text, text, text) from public, anon;
    grant execute on function public.link_sibling(uuid, uuid, text, text, text, text) to authenticated;

    -- -----------------------------------------------------------------------
    -- One student's answers, checked. Each raises `invalid` with the field,
    -- and the student's number when given. Internal; #305 calls them too.
    -- -----------------------------------------------------------------------

    -- A name part as staff typed it: trimmed, inner whitespace one space,
    -- empty when nothing is left. Internal.
    create function public.clean_name_part(part text)
    returns text
    language sql
    immutable
    set search_path = ''
    as $fn$
        select nullif(regexp_replace(regexp_replace(coalesce(clean_name_part.part, ''), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'), '');
    $fn$;

    revoke execute on function public.clean_name_part(text) from public, anon, authenticated, service_role;

    -- registration_name(details, student): the four name fields (S2).
    -- first_name, fathers_name and last_name are required, surname is
    -- optional. The student's name is the parts joined with single spaces;
    -- the father's full name is the parts after the first. Internal.
    create function public.registration_name(
        details jsonb,
        student integer,
        out student_name text,
        out father_full_name text
    )
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    declare
        first_part text := public.clean_name_part(registration_name.details ->> 'first_name');
        fathers_part text := public.clean_name_part(registration_name.details ->> 'fathers_name');
        last_part text := public.clean_name_part(registration_name.details ->> 'last_name');
        surname_part text := public.clean_name_part(registration_name.details ->> 'surname');
    begin
        if first_part is null then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_name.student, 'field', 'first_name')::text;
        end if;
        if fathers_part is null then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_name.student, 'field', 'fathers_name')::text;
        end if;
        if last_part is null then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_name.student, 'field', 'last_name')::text;
        end if;
        father_full_name := concat_ws(' ', fathers_part, last_part, surname_part);
        student_name := first_part || ' ' || father_full_name;
        if char_length(student_name) > 200 then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_name.student, 'field', 'student_name')::text;
        end if;
    end;
    $fn$;

    revoke execute on function public.registration_name(jsonb, integer) from public, anon, authenticated, service_role;

    -- registration_custodian(custodian, student): the custodian's
    -- relationship to this child. With {"father": true} it is Father (S6);
    -- otherwise `relationship` is Mother, Father, Guardian or Other, with
    -- `relationship_description` for Other. Internal.
    create function public.registration_custodian(
        custodian jsonb,
        student integer,
        out relationship public.guardian_relationship,
        out relationship_description text,
        out father boolean
    )
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    declare
        given text := nullif(btrim(coalesce(registration_custodian.custodian ->> 'relationship', '')), '');
    begin
        if registration_custodian.custodian is null or jsonb_typeof(registration_custodian.custodian) <> 'object' then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_custodian.student, 'field', 'custodian')::text;
        end if;
        father := coalesce(registration_custodian.custodian -> 'father' = 'true'::jsonb, false);
        if father then
            if given is not null and given <> 'Father' then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_custodian.student, 'field', 'relationship')::text;
            end if;
            relationship := 'Father';
            relationship_description := null;
            return;
        end if;

        begin
            relationship := given::public.guardian_relationship;
        exception when invalid_text_representation then
            relationship := null;
        end;
        if relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_custodian.student, 'field', 'relationship')::text;
        end if;
        relationship_description := public.clean_name_part(registration_custodian.custodian ->> 'relationship_description');
        if relationship = 'Other' and relationship_description is null then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', registration_custodian.student, 'field', 'relationship_description')::text;
        end if;
        if relationship <> 'Other' then
            relationship_description := null;
        end if;
    end;
    $fn$;

    revoke execute on function public.registration_custodian(jsonb, integer) from public, anon, authenticated, service_role;

    -- registration_brought_by(brought_by, student): who brought the student
    -- (R7), a record only. All empty when nothing is given. A phone or a
    -- relationship needs a name. Internal.
    create function public.registration_brought_by(
        brought_by jsonb,
        student integer,
        out name text,
        out phone text,
        out relationship text
    )
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    declare
        typed_phone text;
    begin
        if registration_brought_by.brought_by is null or jsonb_typeof(registration_brought_by.brought_by) = 'null' then
            return;
        end if;
        if jsonb_typeof(registration_brought_by.brought_by) <> 'object' then
            raise exception 'invalid' using detail = jsonb_build_object('student', registration_brought_by.student, 'field', 'brought_by')::text;
        end if;
        name := public.clean_name_part(registration_brought_by.brought_by ->> 'name');
        relationship := public.clean_name_part(registration_brought_by.brought_by ->> 'relationship');
        typed_phone := nullif(btrim(coalesce(registration_brought_by.brought_by ->> 'phone', '')), '');
        if typed_phone is not null then
            phone := public.normalize_phone(typed_phone);
            if phone is null then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_brought_by.student, 'field', 'brought_by_phone')::text;
            end if;
        end if;
        if name is null and (phone is not null or relationship is not null) or char_length(name) > 120 then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', registration_brought_by.student, 'field', 'brought_by_name')::text;
        end if;
        if char_length(relationship) > 60 then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', registration_brought_by.student, 'field', 'brought_by_relationship')::text;
        end if;
    end;
    $fn$;

    revoke execute on function public.registration_brought_by(jsonb, integer) from public, anon, authenticated, service_role;

    -- registration_previous_school(school, class_name, student): the
    -- previous school (S9): {"name", "type", "region"} or
    -- {"not_known": true}. From STD 2 up an answer is required, and "Not
    -- known yet" is one; below STD 2 nothing is asked, and details given
    -- anyway are kept. Internal.
    create function public.registration_previous_school(
        school jsonb,
        class_name public.lead_class,
        student integer,
        out name text,
        out school_type public.previous_school_type,
        out region text,
        out not_known boolean
    )
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    declare
        given boolean := registration_previous_school.school is not null
            and jsonb_typeof(registration_previous_school.school) <> 'null';
    begin
        not_known := false;
        if given and jsonb_typeof(registration_previous_school.school) <> 'object' then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school')::text;
        end if;
        if given and registration_previous_school.school -> 'not_known' = 'true'::jsonb then
            if registration_previous_school.school ?| array['name', 'type', 'region'] then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school')::text;
            end if;
            not_known := true;
            return;
        end if;
        if given then
            name := public.clean_name_part(registration_previous_school.school ->> 'name');
            if name is null or char_length(name) not between 2 and 120 then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school_name')::text;
            end if;
            begin
                school_type := (registration_previous_school.school ->> 'type')::public.previous_school_type;
            exception when invalid_text_representation then
                school_type := null;
            end;
            if school_type is null then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school_type')::text;
            end if;
            region := public.previous_school_region(registration_previous_school.school ->> 'region');
            if region is null then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school_region')::text;
            end if;
            return;
        end if;
        if public.previous_school_asked(registration_previous_school.class_name) then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', registration_previous_school.student, 'field', 'previous_school')::text;
        end if;
    end;
    $fn$;

    revoke execute on function public.registration_previous_school(jsonb, public.lead_class, integer)
        from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Locks and the recompute.
    -- -----------------------------------------------------------------------

    -- lock_registration(contact_ids, lead_ids): the Family locks of these
    -- contacts and of these leads' contacts, with every group they reach
    -- (lock_families, one call, so one key order), read again until no lead
    -- has moved; then the leads' groups. A try that finds a lead moved is
    -- rolled back, which releases its locks, and the next one takes them all
    -- again in order. Internal.
    create function public.lock_registration(contact_ids uuid[], lead_ids uuid[])
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
            select distinct c from (
                select unnest(lock_registration.contact_ids) as c
                union
                select l.guardian_contact_id from public.leads l where l.id = any (lock_registration.lead_ids)
            ) s where c is not null order by 1
        );
        loop
            begin
                perform public.lock_families(contacts);
                read_again := array(
                    select distinct c from (
                        select unnest(lock_registration.contact_ids) as c
                        union
                        select l.guardian_contact_id from public.leads l where l.id = any (lock_registration.lead_ids)
                    ) s where c is not null order by 1
                );
                if read_again <@ contacts then
                    exit;
                end if;
                raise exception using errcode = 'P0113', message = 'family_moved';
            exception when sqlstate 'P0113' then
                contacts := array(select distinct c from unnest(contacts || read_again) c order by 1);
            end;
        end loop;

        -- Held already through the contacts (a group lists every contact
        -- its members sit on); taken again for certain, after the Family
        -- locks as the order says.
        perform public.lock_sibling_groups(array(
            select m.group_id from public.sibling_group_members m
            where m.lead_id = any (lock_registration.lead_ids) and m.group_id is not null
        ));
    end;
    $fn$;

    revoke execute on function public.lock_registration(uuid[], uuid[]) from public, anon, authenticated, service_role;

    -- recompute_sibling_groups_once(group_ids, cause): each group once, in
    -- id order. The caller holds their locks. Internal.
    create function public.recompute_sibling_groups_once(group_ids uuid[], cause text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        each_group uuid;
    begin
        for each_group in
            select distinct g from unnest(recompute_sibling_groups_once.group_ids) g where g is not null order by 1
        loop
            perform public.recompute_sibling_group(each_group, recompute_sibling_groups_once.cause);
        end loop;
    end;
    $fn$;

    revoke execute on function public.recompute_sibling_groups_once(uuid[], text) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- One "Sibling of" choice.
    -- -----------------------------------------------------------------------

    -- save_sibling_choice(lead_id, sibling_of_lead_id, choice, student):
    -- links an open lead as "Sibling of" another with the staff member's
    -- answers in `choice`: father_full_name (the lead's own, when it was
    -- never confirmed; #305), sibling_father_full_name (the other lead's,
    -- R32), name_answer {"answer": "typo" | "different", "spelling"},
    -- request_note and request_id (a Sibling request when the names
    -- differ). The caller holds the locks (lock_registration), sets
    -- app.sibling_keep_ten for the groups it touches, and afterwards
    -- recomputes the groups once and withdraws stale requests. Answers:
    --   {"result": "linked", "basis", "group_id", "left_group", "request_id"}
    --   {"result": "question", "student", "question", ...}  nothing written.
    -- Refusals name the student. Internal.
    create function public.save_sibling_choice(
        lead_id uuid,
        sibling_of_lead_id uuid,
        choice jsonb,
        student integer
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        linked jsonb;
        question jsonb;
        note text;
        new_request uuid;
        given_request uuid;
        member public.sibling_group_members;
        earlier public.discount_requests;
        staff_id uuid;
        failed_message text;
        failed_state text;
        failed_detail text;
        failed_hint text;
        detail_json jsonb;
    begin
        begin
            linked := public.link_sibling_locked(
                save_sibling_choice.lead_id,
                save_sibling_choice.sibling_of_lead_id,
                save_sibling_choice.choice ->> 'father_full_name',
                save_sibling_choice.choice ->> 'sibling_father_full_name',
                save_sibling_choice.choice -> 'name_answer' ->> 'answer',
                save_sibling_choice.choice -> 'name_answer' ->> 'spelling',
                true
            );

            question := case linked ->> 'result'
                when 'name_question' then jsonb_build_object(
                    'question', 'name',
                    'father_full_name', linked ->> 'father_full_name',
                    'sibling_lead_id', linked ->> 'sibling_lead_id',
                    'sibling_father_full_name', linked ->> 'sibling_father_full_name'
                )
                when 'sibling_father_name_needed' then jsonb_build_object(
                    'question', 'sibling_father_name', 'sibling_lead_id', linked ->> 'lead_id'
                )
                when 'father_name_needed' then jsonb_build_object('question', 'father_name', 'lead_id', linked ->> 'lead_id')
            end;

            if question is null and linked ->> 'basis' in ('request_needed', 'refused') then
                note := btrim(coalesce(save_sibling_choice.choice ->> 'request_note', ''));
                if note = '' and linked ->> 'basis' = 'request_needed' then
                    question := jsonb_build_object(
                        'question', 'request_note', 'sibling_lead_id', save_sibling_choice.sibling_of_lead_id
                    );
                elsif note <> '' then
                    if char_length(note) > 1000 then
                        raise exception 'invalid' using detail = jsonb_build_object('field', 'request_note')::text;
                    end if;
                    begin
                        given_request := coalesce((save_sibling_choice.choice ->> 'request_id')::uuid, gen_random_uuid());
                    exception when invalid_text_representation then
                        raise exception 'invalid' using detail = jsonb_build_object('field', 'request_id')::text;
                    end;
                    select * into earlier from public.discount_requests r where r.request_id = given_request;
                    if found then
                        raise exception 'request_reused';
                    end if;
                    if exists (
                        select 1 from public.discount_requests r
                        where r.lead_id = save_sibling_choice.lead_id and r.kind = 'sibling' and r.state = 'pending'
                    ) then
                        raise exception 'already_pending';
                    end if;
                    select * into member from public.sibling_group_members m where m.lead_id = save_sibling_choice.lead_id;
                    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
                    insert into public.discount_requests (
                        lead_id, kind, note, requested_by, request_id, group_id, sibling_of_lead_id
                    )
                    values (
                        save_sibling_choice.lead_id, 'sibling', note, staff_id, given_request,
                        member.group_id, member.sibling_of_lead_id
                    )
                    returning id into new_request;
                end if;
            end if;

            if question is not null then
                raise exception using errcode = 'P0115', message = 'sibling_question', detail = question::text;
            end if;
        exception
            when sqlstate 'P0115' then
                get stacked diagnostics failed_detail = pg_exception_detail;
                return jsonb_build_object('result', 'question', 'student', save_sibling_choice.student)
                    || failed_detail::jsonb;
            when others then
                get stacked diagnostics
                    failed_message = message_text,
                    failed_state = returned_sqlstate,
                    failed_detail = pg_exception_detail,
                    failed_hint = pg_exception_hint;
                begin
                    detail_json := coalesce(nullif(failed_detail, '')::jsonb, '{}'::jsonb);
                    if jsonb_typeof(detail_json) <> 'object' then
                        detail_json := jsonb_build_object('reason', failed_detail);
                    end if;
                exception when others then
                    detail_json := jsonb_build_object('reason', failed_detail);
                end;
                if save_sibling_choice.student is not null then
                    detail_json := detail_json || jsonb_build_object('student', save_sibling_choice.student);
                end if;
                raise exception using
                    errcode = failed_state,
                    message = failed_message,
                    detail = detail_json::text,
                    hint = coalesce(failed_hint, '');
        end;

        return jsonb_build_object(
            'result', 'linked',
            'basis', linked ->> 'basis',
            'group_id', linked ->> 'group_id',
            'left_group', linked ->> 'left_group',
            'request_id', new_request
        );
    end;
    $fn$;

    revoke execute on function public.save_sibling_choice(uuid, uuid, jsonb, integer) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- register_students.
    -- -----------------------------------------------------------------------

    create function public.register_students(visited_on date, people jsonb, students jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        this_year integer := extract(year from public.tanzania_today());
        n integer;
        np integer;
        i integer;
        j integer;
        k integer;
        item jsonb;
        person jsonb;
        -- People, by number.
        p_contact uuid[] := '{}';
        p_name text[] := '{}';
        p_phone text[] := '{}';
        p_whatsapp text[] := '{}';
        p_extra jsonb[] := '{}';
        p_rel public.guardian_relationship[] := '{}';
        p_desc text[] := '{}';
        p_used boolean[] := '{}';
        p_father_name text[] := '{}';
        -- The relationship stored on each person once saved.
        p_stored_rel public.guardian_relationship[] := '{}';
        p_stored_desc text[] := '{}';
        one_phone text;
        extra text[];
        -- Students, by number.
        s_name text[] := '{}';
        s_father text[] := '{}';
        s_class public.lead_class[] := '{}';
        s_year integer[] := '{}';
        s_boarding public.day_or_boarding[] := '{}';
        s_person integer[] := '{}';
        s_rel public.guardian_relationship[] := '{}';
        s_desc text[] := '{}';
        s_by_name text[] := '{}';
        s_by_phone text[] := '{}';
        s_by_rel text[] := '{}';
        s_school text[] := '{}';
        s_school_type public.previous_school_type[] := '{}';
        s_school_region text[] := '{}';
        s_school_unknown boolean[] := '{}';
        s_sib_student integer[] := '{}';
        s_sib_lead uuid[] := '{}';
        s_not_sibling boolean[] := '{}';
        s_choice jsonb[] := '{}';
        s_lead uuid[] := '{}';
        s_number text[] := '{}';
        s_comp integer[] := '{}';
        s_sibling jsonb[] := '{}';
        parsed record;
        custodian record;
        target uuid;
        targets uuid[] := '{}';
        existing uuid[] := '{}';
        contact public.guardian_contacts;
        phones text[];
        student_phones text[];
        match public.leads;
        duplicates jsonb := '[]';
        questions jsonb := '[]';
        changed boolean;
        attempt integer;
        new_number text;
        new_id uuid;
        kept uuid[];
        touched uuid[] := '{}';
        pending integer[];
        blocked boolean[] := '{}';
        progressed boolean;
        saved jsonb;
        same_lead public.leads;
        result_rows jsonb := '[]';
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('leads.create')
           or not public.has_permission('visits.record') then
            raise exception 'not_permitted';
        end if;

        if register_students.visited_on is null or register_students.visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
        if register_students.students is null or jsonb_typeof(register_students.students) <> 'array'
           or jsonb_array_length(register_students.students) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students')::text;
        end if;
        n := jsonb_array_length(register_students.students);
        -- At most 8 students on one form (decision 1).
        if n > 8 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students', 'reason', 'too_many')::text;
        end if;
        if register_students.people is null or jsonb_typeof(register_students.people) <> 'array'
           or jsonb_array_length(register_students.people) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people')::text;
        end if;
        np := jsonb_array_length(register_students.people);
        if np > n then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people', 'reason', 'too_many')::text;
        end if;

        -- ------------------------------------------------------------------
        -- The people.
        -- ------------------------------------------------------------------
        for k in 1..np loop
            person := register_students.people -> (k - 1);
            if jsonb_typeof(person) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person')::text;
            end if;
            p_used[k] := false;
            p_rel[k] := null;
            p_desc[k] := null;
            p_father_name[k] := null;
            if nullif(person ->> 'contact_id', '') is not null then
                begin
                    p_contact[k] := (person ->> 'contact_id')::uuid;
                exception when invalid_text_representation then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end;
                if p_contact[k] = any (p_contact[1:k - 1]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact', 'reason', 'repeated_on_form')::text;
                end if;
                -- The stored person is kept (S6): nothing typed may replace it.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null
                   or nullif(btrim(coalesce(person ->> 'phone', '')), '') is not null
                   or nullif(btrim(coalesce(person ->> 'whatsapp', '')), '') is not null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                extra := '{}';
                if person -> 'also_check_phones' is not null and jsonb_typeof(person -> 'also_check_phones') <> 'null' then
                    if jsonb_typeof(person -> 'also_check_phones') <> 'array' then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'also_check_phones')::text;
                    end if;
                    extra := array(
                        select x from jsonb_array_elements_text(person -> 'also_check_phones') e, public.normalize_phone(e) x
                        where x is not null
                    );
                end if;
                p_extra[k] := to_jsonb(extra);
                p_name[k] := null;
                p_phone[k] := null;
                p_whatsapp[k] := null;
            else
                p_contact[k] := null;
                p_extra[k] := '[]';
                p_name[k] := public.clean_name_part(person ->> 'full_name');
                if char_length(p_name[k]) > 200 then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact_name')::text;
                end if;
                p_phone[k] := public.normalize_phone(coalesce(person ->> 'phone', ''));
                if p_phone[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'phone')::text;
                end if;
                p_whatsapp[k] := nullif(btrim(coalesce(person ->> 'whatsapp', '')), '');
                if p_whatsapp[k] is not null then
                    p_whatsapp[k] := public.normalize_phone(p_whatsapp[k]);
                    if p_whatsapp[k] is null then
                        raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'whatsapp')::text;
                    end if;
                    if p_whatsapp[k] = p_phone[k] then
                        p_whatsapp[k] := null;
                    end if;
                end if;
                -- A person is stored once per phone: two new people on one
                -- form never share a number.
                for j in 1..k - 1 loop
                    if p_contact[j] is null
                       and array[p_phone[k], p_whatsapp[k]] && array_remove(array[p_phone[j], p_whatsapp[j]], null) then
                        raise exception 'invalid'
                            using detail = jsonb_build_object('person', k, 'field', 'phone', 'reason', 'repeated_on_form')::text;
                    end if;
                end loop;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The students.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            item := register_students.students -> (i - 1);
            if jsonb_typeof(item) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'student')::text;
            end if;

            select * into parsed from public.registration_name(item, i);
            s_name[i] := parsed.student_name;
            s_father[i] := parsed.father_full_name;

            begin
                s_class[i] := (item ->> 'class_name')::public.lead_class;
            exception when invalid_text_representation then
                s_class[i] := null;
            end;
            if s_class[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'class_name')::text;
            end if;
            begin
                s_year[i] := (item ->> 'enrollment_year')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                s_year[i] := null;
            end;
            -- Staff choose from the current year and the next two.
            if s_year[i] is null or s_year[i] not between this_year and this_year + 2 then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'enrollment_year')::text;
            end if;
            begin
                s_boarding[i] := (item ->> 'day_or_boarding')::public.day_or_boarding;
            exception when invalid_text_representation then
                s_boarding[i] := null;
            end;
            if s_boarding[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'day_or_boarding')::text;
            end if;

            select * into custodian from public.registration_custodian(item -> 'custodian', i);
            begin
                k := (item -> 'custodian' ->> 'person')::integer;
            exception when invalid_text_representation or numeric_value_out_of_range then
                k := null;
            end;
            if k is null or k not between 1 and np then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'custodian')::text;
            end if;
            s_person[i] := k;
            s_rel[i] := custodian.relationship;
            s_desc[i] := custodian.relationship_description;
            if not p_used[k] then
                p_used[k] := true;
                p_rel[k] := custodian.relationship;
                p_desc[k] := custodian.relationship_description;
            end if;
            -- "The father is the main custodian": a new person with no name
            -- typed takes the father's full name. Two children can share
            -- that person only with the same father's name.
            if custodian.father and p_contact[k] is null and p_name[k] is null then
                if p_father_name[k] is null then
                    p_father_name[k] := s_father[i];
                elsif public.normalize_father_name(p_father_name[k]) <> public.normalize_father_name(s_father[i]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'custodian', 'reason', 'father_names_differ')::text;
                end if;
            end if;

            select * into parsed from public.registration_brought_by(item -> 'brought_by', i);
            s_by_name[i] := parsed.name;
            s_by_phone[i] := parsed.phone;
            s_by_rel[i] := parsed.relationship;

            select * into parsed from public.registration_previous_school(item -> 'previous_school', s_class[i], i);
            s_school[i] := parsed.name;
            s_school_type[i] := parsed.school_type;
            s_school_region[i] := parsed.region;
            s_school_unknown[i] := parsed.not_known;

            -- The sibling choice: another student on the form, a lead on
            -- file, or none.
            s_sib_student[i] := null;
            s_sib_lead[i] := null;
            s_not_sibling[i] := coalesce(item -> 'not_a_sibling' = 'true'::jsonb, false);
            if item -> 'sibling_of' is not null and jsonb_typeof(item -> 'sibling_of') <> 'null' then
                if s_not_sibling[i] or jsonb_typeof(item -> 'sibling_of') <> 'object' then
                    raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                end if;
                if item -> 'sibling_of' ? 'student' then
                    begin
                        s_sib_student[i] := (item -> 'sibling_of' ->> 'student')::integer;
                    exception when invalid_text_representation or numeric_value_out_of_range then
                        s_sib_student[i] := null;
                    end;
                    if s_sib_student[i] is null or s_sib_student[i] not between 1 and n or s_sib_student[i] = i then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                else
                    begin
                        s_sib_lead[i] := (item -> 'sibling_of' ->> 'lead_id')::uuid;
                    exception when invalid_text_representation then
                        s_sib_lead[i] := null;
                    end;
                    if s_sib_lead[i] is null then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                    targets := targets || s_sib_lead[i];
                end if;
            end if;
            -- The answers the link may need. The student's own father's
            -- name comes from its name fields, never from here.
            s_choice[i] := jsonb_strip_nulls(jsonb_build_object(
                'sibling_father_full_name', item -> 'sibling_father_full_name',
                'name_answer', item -> 'name_answer',
                'request_note', item -> 'request_note',
                'request_id', item -> 'request_id'
            ));
        end loop;

        for k in 1..np loop
            if not p_used[k] then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person', 'reason', 'unused')::text;
            end if;
            if p_contact[k] is null then
                p_name[k] := coalesce(p_name[k], p_father_name[k]);
                if p_name[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact_name')::text;
                end if;
            else
                existing := existing || p_contact[k];
            end if;
        end loop;

        if exists (select 1 from unnest(s_sib_student) x where x is not null) or cardinality(targets) > 0 then
            if not public.has_permission('leads.edit') then
                raise exception 'not_permitted';
            end if;
        end if;

        -- The same student twice on the form: the same name with a custodian
        -- sharing a phone.
        for i in 2..n loop
            for j in 1..i - 1 loop
                if public.normalize_student_name(s_name[i]) = public.normalize_student_name(s_name[j])
                   and (s_person[i] = s_person[j]
                        or (p_contact[s_person[i]] is null and p_contact[s_person[j]] is null
                            and array[p_phone[s_person[i]], p_whatsapp[s_person[i]]]
                                && array_remove(array[p_phone[s_person[j]], p_whatsapp[s_person[j]]], null))) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'student_name', 'reason', 'repeated_on_form', 'same_as_student', j)::text;
                end if;
            end loop;
        end loop;

        -- ------------------------------------------------------------------
        -- Every lock, before the first write.
        -- ------------------------------------------------------------------
        perform public.lock_registration(existing, targets);

        -- The known people's rows, shared, so a correction to their numbers
        -- waits for this form, or this form checks the corrected numbers.
        perform 1 from public.guardian_contacts g where g.id = any (existing) order by g.id for share;
        for k in 1..np loop
            if p_contact[k] is not null then
                select * into contact from public.guardian_contacts g where g.id = p_contact[k];
                if not found then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                p_phone[k] := contact.phone;
                p_whatsapp[k] := contact.whatsapp;
                p_stored_rel[k] := contact.relationship;
                p_stored_desc[k] := contact.relationship_description;
            else
                p_stored_rel[k] := p_rel[k];
                p_stored_desc[k] := p_desc[k];
            end if;
        end loop;

        -- Creations that share a phone number one after the other, in one
        -- order (as create_lead).
        phones := array(
            select distinct p from (
                select unnest(p_phone) as p
                union all select unnest(p_whatsapp)
                union all select jsonb_array_elements_text(e) from unnest(p_extra) e
            ) s where p is not null order by p
        );
        foreach one_phone in array phones loop
            perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
        end loop;

        -- The on-file siblings' rows, in id order.
        perform 1 from public.leads l where l.id = any (targets) order by l.id for update;
        for i in 1..n loop
            if s_sib_lead[i] is not null and not exists (select 1 from public.leads l where l.id = s_sib_lead[i]) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'not_found')::text;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Duplicates: the same name with the same custodian phone, on file
        -- under any status or closure mark (as create_lead).
        -- ------------------------------------------------------------------
        for i in 1..n loop
            k := s_person[i];
            student_phones := array_remove(
                array[p_phone[k], p_whatsapp[k]] || array(select jsonb_array_elements_text(p_extra[k])), null
            );
            select l.* into match
            from public.leads l
            join public.guardian_contacts g on g.id = l.guardian_contact_id
            where l.student_name_key = public.normalize_student_name(s_name[i])
              and (g.phone = any (student_phones) or g.whatsapp = any (student_phones))
            order by l.created_at, l.id
            limit 1;
            if found then
                duplicates := duplicates || jsonb_build_array(jsonb_build_object(
                    'student', i,
                    'lead_id', match.id,
                    'admission_number', match.admission_number,
                    'status', match.status,
                    'closure', match.closure
                ));
            end if;
        end loop;
        if jsonb_array_length(duplicates) > 0 then
            return jsonb_build_object('result', 'duplicate', 'duplicates', duplicates);
        end if;

        -- ------------------------------------------------------------------
        -- Same father, no choice (R8): staff are asked "Sibling of [X]?".
        -- Students linked to each other on the form, directly or through
        -- others, are one set; an on-file lead one of them links to belongs
        -- to that set.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            s_comp[i] := i;
        end loop;
        loop
            changed := false;
            for i in 1..n loop
                j := s_sib_student[i];
                if j is not null and s_comp[i] <> s_comp[j] then
                    s_comp[i] := least(s_comp[i], s_comp[j]);
                    s_comp[j] := s_comp[i];
                    changed := true;
                end if;
            end loop;
            exit when not changed;
        end loop;

        for i in 1..n loop
            if s_sib_student[i] is not null or s_sib_lead[i] is not null or s_not_sibling[i] then
                continue;
            end if;
            for j in 1..n loop
                if j <> i and s_comp[j] <> s_comp[i]
                   and public.normalize_father_name(s_father[j]) = public.normalize_father_name(s_father[i])
                   -- A student that answered Not a sibling settled it. Two
                   -- students with no choice: the later one is asked.
                   and not s_not_sibling[j]
                   and (s_sib_student[j] is not null or s_sib_lead[j] is not null or j < i) then
                    questions := questions || jsonb_build_array(jsonb_build_object(
                        'student', i, 'question', 'same_father', 'other_student', j
                    ));
                    exit;
                end if;
            end loop;
            if exists (select 1 from jsonb_array_elements(questions) q where (q ->> 'student')::integer = i) then
                continue;
            end if;
            select l.* into same_lead
            from public.leads l
            where l.guardian_contact_id = any (existing)
              and l.status <> 'Declined' and l.closure is null
              and public.normalize_father_name(l.father_full_name) = public.normalize_father_name(s_father[i])
              and not exists (
                  select 1 from generate_subscripts(s_sib_lead, 1) x
                  where s_comp[x] = s_comp[i] and s_sib_lead[x] = l.id
              )
            order by l.created_at, l.id
            limit 1;
            if found then
                questions := questions || jsonb_build_array(jsonb_build_object(
                    'student', i, 'question', 'same_father',
                    'other_lead_id', same_lead.id, 'other_admission_number', same_lead.admission_number
                ));
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The writes, in one subtransaction: a question undoes them all.
        -- ------------------------------------------------------------------
        begin
            -- New people.
            for k in 1..np loop
                if p_contact[k] is null then
                    insert into public.guardian_contacts (
                        full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
                    ) values (
                        p_name[k], p_rel[k], p_desc[k], p_phone[k], p_whatsapp[k], 'front_desk', null
                    )
                    returning id into new_id;
                    p_contact[k] := new_id;
                end if;
            end loop;

            -- The students, with no legacy group (S1, R5).
            perform set_config('app.sibling_registration', 'on', true);
            for i in 1..n loop
                k := s_person[i];
                -- ADMSN- and five random digits. The unique constraint
                -- catches a collision and the loop draws again.
                for attempt in 1..20 loop
                    new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
                    begin
                        insert into public.leads (
                            admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                            status, visit_date, guardian_contact_id, returning_family_joined,
                            father_full_name, father_full_name_source,
                            custodian_relationship, custodian_relationship_description, custodian_relationship_own,
                            brought_by_name, brought_by_phone, brought_by_relationship,
                            previous_school_name, previous_school_type, previous_school_region, previous_school_not_known
                        ) values (
                            new_number, s_name[i], s_class[i], s_year[i], s_boarding[i],
                            'Visited', register_students.visited_on, p_contact[k],
                            -- Joining a known Family at the front desk.
                            p_contact[k] = any (existing),
                            s_father[i], 'derived',
                            s_rel[i], s_desc[i],
                            -- Its own when it differs from the person's.
                            (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k]),
                            s_by_name[i], s_by_phone[i], s_by_rel[i],
                            s_school[i], s_school_type[i], s_school_region[i], s_school_unknown[i]
                        )
                        returning id into new_id;
                        exit;
                    exception when unique_violation then
                        if attempt = 20 then
                            raise exception 'unavailable';
                        end if;
                    end;
                end loop;
                s_lead[i] := new_id;
                s_number[i] := new_number;
                insert into public.sibling_group_members (lead_id, group_id, legacy, cause, sibling_choice_made)
                values (new_id, null, false, 'registration', true);
            end loop;
            perform set_config('app.sibling_registration', '', true);

            -- A link never raises a fee by itself (R38): every member of an
            -- on-file sibling's group holding an automatic 10% keeps it.
            kept := array(
                select m.lead_id
                from public.sibling_group_members m
                join public.lead_sibling_results r on r.lead_id = m.lead_id
                where m.group_id in (
                    select t.group_id from public.sibling_group_members t
                    where t.lead_id = any (targets) and t.group_id is not null
                )
                  and r.result = 'ten' and r.source = 'auto'
            );
            perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

            -- The links: a student after the student it links to, so a
            -- student joins its target's group before anyone joins its own.
            -- A link waiting on an answer holds back the students linked to
            -- it, so they get no question built on a group that may change.
            pending := array(select x from generate_series(1, n) x where s_sib_student[x] is not null or s_sib_lead[x] is not null);
            for i in 1..n loop
                blocked[i] := false;
                s_sibling[i] := null;
            end loop;
            while cardinality(pending) > 0 loop
                progressed := false;
                foreach i in array pending loop
                    j := s_sib_student[i];
                    if j is not null and j = any (pending) then
                        continue;
                    end if;
                    pending := array_remove(pending, i);
                    progressed := true;
                    if j is not null and blocked[j] then
                        blocked[i] := true;
                        continue;
                    end if;
                    target := coalesce(s_lead[j], s_sib_lead[i]);
                    saved := public.save_sibling_choice(s_lead[i], target, s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end loop;
                if not progressed then
                    -- Students linked in a ring: the lowest number goes first.
                    i := (select min(x) from unnest(pending) x);
                    pending := array_remove(pending, i);
                    saved := public.save_sibling_choice(s_lead[i], s_lead[s_sib_student[i]], s_choice[i], i);
                    if saved ->> 'result' = 'question' then
                        blocked[i] := true;
                        questions := questions || jsonb_build_array(saved - 'result');
                    else
                        s_sibling[i] := saved - 'result' - 'left_group';
                        touched := touched || (saved ->> 'group_id')::uuid || (saved ->> 'left_group')::uuid;
                    end if;
                end if;
            end loop;

            if jsonb_array_length(questions) > 0 then
                raise exception using errcode = 'P0114', message = 'registration_questions';
            end if;

            -- Each touched group once, then requests that no longer ask
            -- anything.
            perform public.recompute_sibling_groups_once(touched, 'sibling');
            perform public.withdraw_stale_sibling_requests(array(
                select distinct x from (
                    select unnest(public.sibling_group_leads(g)) as x
                    from unnest(touched) g where g is not null
                    union all select unnest(s_lead)
                ) s
            ));
            perform set_config('app.sibling_keep_ten', '', true);
        exception when sqlstate 'P0114' then
            return jsonb_build_object(
                'result', 'questions',
                'questions', (
                    select jsonb_agg(q order by (q ->> 'student')::integer, q ->> 'question')
                    from jsonb_array_elements(questions) q
                )
            );
        end;

        for i in 1..n loop
            result_rows := result_rows || jsonb_build_array(jsonb_build_object(
                'student', i,
                'lead_id', s_lead[i],
                'admission_number', s_number[i],
                'sibling', s_sibling[i]
            ));
        end loop;
        return jsonb_build_object('result', 'created', 'students', result_rows);
    end;
    $fn$;

    revoke execute on function public.register_students(date, jsonb, jsonb) from public, anon;
    grant execute on function public.register_students(date, jsonb, jsonb) to authenticated;

    -- -----------------------------------------------------------------------
    -- Checks: nothing moved.
    -- -----------------------------------------------------------------------

    perform public.assert_fee_snapshot_unchanged('pg_temp.register_students_snapshot_before');
    drop table pg_temp.register_students_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
