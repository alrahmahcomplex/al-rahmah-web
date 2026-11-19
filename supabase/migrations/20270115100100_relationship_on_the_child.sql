-- The custodian's relationship is read and written only on each child (#312,
-- PR 1 of 2; spec #296, align brief S6, R14). 20261211200100 copied the
-- guardian contact's relationship onto every lead and kept the two in step;
-- this stops the copy and moves every reader and writer to the lead's. The
-- contact's columns stay one more release, frozen, and the next migration
-- drops them.
--
-- 1. The check. Before the copy stops, every lead not marked as holding its
--    own relationship (custodian_relationship_own, #304) must hold its
--    contact's: the copy kept them equal, so any difference means a lead's
--    relationship would change on screen today. It raises
--    `custodian_relationship_differs` (the first leads in its detail) and
--    nothing is applied. Contacts whose relationship no lead holds (no
--    child left on them, or only children with their own) are counted and
--    listed in a notice; their value is only the parent's first answer and
--    stays in the audit log.
-- 2. The copy triggers go: sync_lead_custodian_relationship (contact to its
--    leads) and the move half of set_lead_custodian_relationship. What is
--    left of the second fills an empty relationship on a new lead from its
--    contact, for test and seed rows only: every function below sets the
--    lead's own. The next migration removes it.
-- 3. The contact's relationship is frozen: it may be empty on a new contact
--    (nothing writes it now), and refuse_contact_relationship_change refuses
--    any change to it, so a writer missed here fails loudly instead of
--    leaving the two out of step.
-- 4. Writers set each child's relationship: create_lead (the Admission form
--    sends it with every child; a front-desk child on a known contact
--    without one takes the contact's first child's), register_students and
--    complete_admission_visit (the person's relationship, for the "own"
--    mark, is now their first child's), confirm_student_import (each row its
--    own), separate_from_family (the child keeps its own).
-- 5. Corrections: update_guardian_contact takes the child staff edited
--    (`lead_id`). A relationship change goes to that child and to every
--    child on the contact that held the same relationship before, closed
--    ones included, as the copy did. Without a child, a relationship is
--    accepted only when every child already holds it. The re-application
--    Apply passes its child.
-- 6. Readers read the lead's: the re-application compare, Export, Home's
--    call-backs, check-in's Admission form family (the looked-up child's),
--    and the Family match line (the matched parent's first child's).
--    find_family_by_phone no longer returns a parent's relationship.
--
-- Fees, discounts, statuses and Seat priority do not move: the do block
-- compares fee_snapshot() before and after and raises on any difference.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction, so a raised check undoes everything here.
--
-- Rollback: a new migration putting back the functions from their earlier
-- migrations and both copy triggers from 20261216100100, then copying each
-- contact's relationship from its first lead not marked own. No data is
-- lost here: the contact's columns keep their values.

do $migration$
declare
    differing uuid[];
    unheld uuid[];
    unheld_count integer;
begin
    perform public.set_audit_actor('system');

    lock table public.leads, public.guardian_contacts in share row exclusive mode;

    drop table if exists pg_temp.relationship_snapshot_before;
    create temp table relationship_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- 1. The check.
    -- -----------------------------------------------------------------------

    differing := array(
        select l.id
        from public.leads l
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where not l.custodian_relationship_own
          and (l.custodian_relationship, l.custodian_relationship_description)
              is distinct from (g.relationship, g.relationship_description)
        order by l.id
        limit 20
    );
    if cardinality(differing) > 0 then
        raise exception 'custodian_relationship_differs'
            using detail = jsonb_build_object('lead_ids', differing)::text;
    end if;

    select count(*), (array_agg(g.id order by g.id))[1:50]
    into unheld_count, unheld
    from public.guardian_contacts g
    where not exists (
        select 1 from public.leads l
        where l.guardian_contact_id = g.id
          and (l.custodian_relationship, l.custodian_relationship_description)
              is not distinct from (g.relationship, g.relationship_description)
    );
    raise notice 'contacts whose relationship no child holds: % (first 50: %)', unheld_count, unheld;

    -- -----------------------------------------------------------------------
    -- 2. The copy triggers.
    -- -----------------------------------------------------------------------

    drop trigger sync_lead_custodian_relationship on public.guardian_contacts;
    drop function public.sync_lead_custodian_relationship();

    -- set_lead_custodian_relationship, as 20261216100100 made it, now only
    -- filling an empty relationship on a new lead, for test and seed rows
    -- that insert leads directly: the contact's first child's, as create_lead
    -- gives a child on a known contact, or else the contact's frozen one. A
    -- lead moved to another contact keeps its own. Removed with the
    -- contact's columns.
    create or replace function public.set_lead_custodian_relationship()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    declare
        contact public.guardian_contacts;
    begin
        if new.custodian_relationship is null then
            select l.custodian_relationship, l.custodian_relationship_description
            into new.custodian_relationship, new.custodian_relationship_description
            from public.leads l
            where l.guardian_contact_id = new.guardian_contact_id
            order by l.created_at, l.id
            limit 1;
        end if;
        if new.custodian_relationship is null then
            select * into contact from public.guardian_contacts g where g.id = new.guardian_contact_id;
            if found then
                new.custodian_relationship := contact.relationship;
                new.custodian_relationship_description := contact.relationship_description;
            end if;
        end if;
        return new;
    end;
    $fn$;

    revoke execute on function public.set_lead_custodian_relationship() from public, anon, authenticated, service_role;

    drop trigger set_lead_custodian_relationship on public.leads;
    create trigger set_lead_custodian_relationship
        before insert on public.leads
        for each row
        execute function public.set_lead_custodian_relationship();

    -- -----------------------------------------------------------------------
    -- 3. The contact's relationship, frozen.
    -- -----------------------------------------------------------------------

    alter table public.guardian_contacts alter column relationship drop not null;

    comment on column public.guardian_contacts.relationship is
        'Retired (#312): each child holds the relationship (leads.custodian_relationship). Frozen, empty on new contacts, and dropped by the next migration.';
    comment on column public.guardian_contacts.relationship_description is
        'Retired with guardian_contacts.relationship (#312).';
    comment on column public.leads.custodian_relationship is
        'The custodian''s relationship to this child. Every reader reads it here (#312).';
    comment on column public.leads.custodian_relationship_own is
        'This child''s relationship differs from the one the person''s first child holds (#304, #312). Read by nothing.';

    create function public.refuse_contact_relationship_change()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
        raise exception 'contact_relationship_retired';
    end;
    $fn$;

    revoke execute on function public.refuse_contact_relationship_change() from public, anon, authenticated, service_role;

    create trigger refuse_contact_relationship_change
        before update of relationship, relationship_description on public.guardian_contacts
        for each row
        when (old.relationship is distinct from new.relationship
              or old.relationship_description is distinct from new.relationship_description)
        execute function public.refuse_contact_relationship_change();

    -- -----------------------------------------------------------------------
    -- Internal helpers.
    -- -----------------------------------------------------------------------

    -- A child's relationship as a writer sent it ("relationship" and, for
    -- Other, "relationship_description"), refused with the field the way
    -- create_lead always refused it.
    create function public.custodian_relationship_sent(
        sent jsonb,
        out custodian_relationship public.guardian_relationship,
        out custodian_relationship_description text
    )
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    begin
        begin
            custodian_relationship := (custodian_relationship_sent.sent ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            custodian_relationship := null;
        end;
        if custodian_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;
        custodian_relationship_description :=
            nullif(btrim(coalesce(custodian_relationship_sent.sent ->> 'relationship_description', '')), '');
        if custodian_relationship = 'Other' and custodian_relationship_description is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
        end if;
        if custodian_relationship <> 'Other' then
            custodian_relationship_description := null;
        end if;
    end;
    $fn$;

    revoke execute on function public.custodian_relationship_sent(jsonb) from public, anon, authenticated, service_role;

    -- The relationship the contact's first child holds (oldest lead first),
    -- or empty when no child is on the contact.
    create function public.contact_first_child_relationship(
        contact_id uuid,
        out custodian_relationship public.guardian_relationship,
        out custodian_relationship_description text
    )
    language sql
    stable
    set search_path = ''
    as $fn$
        select l.custodian_relationship, l.custodian_relationship_description
        from public.leads l
        where l.guardian_contact_id = contact_first_child_relationship.contact_id
        order by l.created_at, l.id
        limit 1;
    $fn$;

    revoke execute on function public.contact_first_child_relationship(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- 5. update_guardian_contact, as 20261211200100 made it, now taking the
    -- child staff edited and writing the relationship on the children, not
    -- the contact. Same locks, in the same order.
    -- -----------------------------------------------------------------------

    drop function public.update_guardian_contact(uuid, jsonb, uuid[]);

    create function public.update_guardian_contact(
        contact_id uuid,
        changes jsonb,
        expected_lead_ids uuid[] default null,
        lead_id uuid default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        contact public.guardian_contacts;
        child public.leads;
        contact_name text;
        child_relationship public.guardian_relationship;
        child_description text;
        relationship_given boolean := changes ?| array['relationship', 'relationship_description'];
        contact_phone text;
        contact_whatsapp text;
        phones text[];
        match public.leads;
        earlier_override text;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;

        -- The Family, then its children (#298), then the contact.
        perform public.lock_families(array[update_guardian_contact.contact_id]);
        perform 1 from public.leads l
        where l.guardian_contact_id = update_guardian_contact.contact_id
        order by l.id
        for update;

        -- Locked, so a child renamed at the same moment is checked against the
        -- numbers this saves, or this against the new name.
        select * into contact from public.guardian_contacts g where g.id = update_guardian_contact.contact_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        if not exists (
            select 1 from public.leads l
            where l.guardian_contact_id = contact.id and l.status <> 'Declined' and l.closure is null
        ) then
            raise exception 'closed';
        end if;
        if expected_lead_ids is not null and exists (
            (select l.id from public.leads l where l.guardian_contact_id = contact.id
             except select unnest(expected_lead_ids))
            union all
            (select unnest(expected_lead_ids)
             except select l.id from public.leads l where l.guardian_contact_id = contact.id)
        ) then
            raise exception 'children_changed';
        end if;
        -- The child staff edited is one of this contact's.
        if update_guardian_contact.lead_id is not null then
            select * into child from public.leads l where l.id = update_guardian_contact.lead_id;
            if not found or child.guardian_contact_id is distinct from contact.id then
                raise exception 'children_changed';
            end if;
        end if;

        contact_name := contact.full_name;
        if changes ? 'full_name' then
            contact_name := btrim(coalesce(changes ->> 'full_name', ''));
            if contact_name = '' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
            end if;
        end if;

        -- The relationship, starting from the edited child's.
        if relationship_given then
            child_relationship := child.custodian_relationship;
            child_description := child.custodian_relationship_description;
            if changes ? 'relationship' then
                begin
                    child_relationship := (changes ->> 'relationship')::public.guardian_relationship;
                exception when invalid_text_representation then
                    child_relationship := null;
                end;
                if child_relationship is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
                end if;
            end if;
            if changes ? 'relationship_description' then
                child_description := nullif(btrim(coalesce(changes ->> 'relationship_description', '')), '');
            end if;
            if child_relationship is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
            end if;
            if child_relationship = 'Other' and child_description is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
            end if;
            if child_relationship <> 'Other' then
                child_description := null;
            end if;
            -- With no child named, nothing says whose relationship this is:
            -- it is accepted only when no child would change.
            if child.id is null and exists (
                select 1 from public.leads l
                where l.guardian_contact_id = contact.id
                  and (l.custodian_relationship, l.custodian_relationship_description)
                      is distinct from (child_relationship, child_description)
            ) then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
            end if;
        end if;

        contact_phone := contact.phone;
        if changes ? 'phone' then
            contact_phone := public.normalize_phone(coalesce(changes ->> 'phone', ''));
            if contact_phone is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
            end if;
        end if;

        contact_whatsapp := contact.whatsapp;
        if changes ? 'whatsapp' then
            contact_whatsapp := nullif(btrim(coalesce(changes ->> 'whatsapp', '')), '');
            if contact_whatsapp is not null then
                contact_whatsapp := public.normalize_phone(contact_whatsapp);
                if contact_whatsapp is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
                end if;
            end if;
        end if;
        if contact_whatsapp = contact_phone then
            contact_whatsapp := null;
        end if;

        -- New numbers must not make any child on this contact a duplicate of a
        -- lead on another contact. Children on one contact never share a name,
        -- so the contact's own leads are left out.
        phones := array(
            select p from unnest(array[contact_phone, contact_whatsapp]) p
            where p is not null and p is distinct from contact.phone and p is distinct from contact.whatsapp
        );
        if cardinality(phones) > 0 then
            perform public.lock_lead_phones(array[contact_phone, contact_whatsapp]);
            select m.* into match
            from public.leads l
            cross join lateral public.find_duplicate_lead(l.student_name_key, phones, l.id, contact.id) m
            where l.guardian_contact_id = contact.id and m.id is not null
            order by m.created_at, m.id
            limit 1;
            if match.id is not null then
                return public.duplicate_result(match);
            end if;
        end if;

        update public.guardian_contacts g
        set full_name = contact_name,
            phone = contact_phone,
            whatsapp = contact_whatsapp
        where g.id = contact.id;

        -- The edited child and every child that held the same relationship
        -- before it, closed ones included, as the contact-to-lead copy did,
        -- under the same lifecycle override (custodian_sync), which lets only
        -- these two columns change on a closed child.
        if relationship_given
           and child.id is not null
           and (child_relationship, child_description)
               is distinct from (child.custodian_relationship, child.custodian_relationship_description) then
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform set_config('app.lead_lifecycle_override', 'custodian_sync', true);
            update public.leads l
            set custodian_relationship = child_relationship,
                custodian_relationship_description = child_description
            where l.guardian_contact_id = contact.id
              and (l.custodian_relationship, l.custodian_relationship_description)
                  is not distinct from (child.custodian_relationship, child.custodian_relationship_description);
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;

        return jsonb_build_object('result', 'updated');
    end;
    $fn$;

    revoke execute on function public.update_guardian_contact(uuid, jsonb, uuid[], uuid) from public, anon;
    grant execute on function public.update_guardian_contact(uuid, jsonb, uuid[], uuid) to authenticated;

    -- -----------------------------------------------------------------------
    -- 4 and 6. Writers and readers, each as its latest migration made it,
    -- with only the relationship changed.
    -- -----------------------------------------------------------------------

create or replace function public.create_lead(start_kind text, existing_contact_id uuid, new_contact jsonb, student_details jsonb, visited_on date DEFAULT NULL::date, also_check_phones text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
        walk_in boolean;
        caller_role text := auth.role();
        contact public.guardian_contacts;
        contact_id uuid := existing_contact_id;
        contact_name text;
        contact_relationship public.guardian_relationship;
        contact_description text;
        contact_phone text;
        contact_whatsapp text;
        pupil_name text;
        pupil_father text;
        named record;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        student_gender public.student_gender;
        this_year integer := extract(year from public.tanzania_today());
        phones text[];
        extra_phones text[] := '{}';
        one_phone text;
        match public.leads;
        pending_match uuid;
        matched_contact public.guardian_contacts;
        joined boolean := false;
        new_lead_id uuid;
        new_number text;
        attempt integer;
    begin
        -- Who may start which way. The staff start is refused from the secret
        -- key and the form start from any staff session, so neither can write as
        -- the other.
        if start_kind = 'walk_in' then
            walk_in := true;
            if caller_role is distinct from 'authenticated'
               or not public.has_permission('leads.create')
               or not public.has_permission('visits.record') then
                raise exception 'not_permitted';
            end if;
        elsif start_kind = 'admission_form' then
            walk_in := false;
            if caller_role is distinct from 'service_role' then
                raise exception 'not_permitted';
            end if;
            -- Each RPC is its own transaction, so the actor is set here.
            perform public.set_audit_actor('public_form', null);
        else
            raise exception 'invalid' using detail = jsonb_build_object('field', 'start')::text;
        end if;

        -- The guardian.
        if contact_id is not null then
            -- The Family lock first (#297): the new lead joins this Family, and
            -- confirming a match into it takes this lock before the phone locks
            -- below, so taking it after them could deadlock.
            perform public.lock_families(array[contact_id]);
            -- Shared, so a correction to this contact's numbers waits for this
            -- child, or this child is checked against the corrected numbers.
            select * into contact from public.guardian_contacts g where g.id = contact_id for share;
            if not found or (not walk_in and contact.origin <> 'admission_form') then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
            end if;
            contact_phone := contact.phone;
            contact_whatsapp := contact.whatsapp;

            -- The child's own relationship (#312): the one sent with it, as
            -- the Admission form sends for each of its children, or else the
            -- one the contact's first child holds.
            if new_contact ? 'relationship' then
                select r.custodian_relationship, r.custodian_relationship_description
                into contact_relationship, contact_description
                from public.custodian_relationship_sent(new_contact) r;
            else
                select r.custodian_relationship, r.custodian_relationship_description
                into contact_relationship, contact_description
                from public.contact_first_child_relationship(contact_id) r;
                if contact_relationship is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
                end if;
            end if;

            -- The numbers staff typed for a walk-in parent they confirmed, which
            -- the stored contact may not hold. The duplicate check covers them
            -- too, so keeping the stored details never lets through a child who
            -- is on file under the other number.
            if also_check_phones is not null then
                if not walk_in then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
                end if;
                extra_phones := array(
                    select n from unnest(also_check_phones) p, public.normalize_phone(p) n where n is not null
                );
            end if;
        else
            -- The three name parts (#400), or the one box of the live
            -- Admission form, stored as typed.
            if new_contact ?| array['first_name', 'middle_name', 'last_name'] then
                contact_name := coalesce(public.registration_person_name(new_contact, null), '');
                if contact_name = '' then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_first_name')::text;
                end if;
            else
                contact_name := btrim(coalesce(new_contact ->> 'full_name', ''));
            end if;
            if contact_name = '' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
            end if;

            -- The child's relationship to the parent (#312).
            select r.custodian_relationship, r.custodian_relationship_description
            into contact_relationship, contact_description
            from public.custodian_relationship_sent(new_contact) r;

            contact_phone := public.normalize_phone(coalesce(new_contact ->> 'phone', ''));
            if contact_phone is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
            end if;

            contact_whatsapp := nullif(btrim(coalesce(new_contact ->> 'whatsapp', '')), '');
            if contact_whatsapp is not null then
                contact_whatsapp := public.normalize_phone(contact_whatsapp);
                if contact_whatsapp is null then
                    raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
                end if;
                if contact_whatsapp = contact_phone then
                    contact_whatsapp := null;
                end if;
            end if;
        end if;

        -- The student: the student's own name and the father's three names
        -- (#400), or the one box of the live Admission form, stored as
        -- typed, whose father's name the insert trigger derives as before.
        if student_details ?| array['first_name', 'father_first', 'father_middle', 'father_last'] then
            select * into named from public.registration_name(student_details, null);
            pupil_name := named.student_name;
            pupil_father := named.father_full_name;
        else
            pupil_name := btrim(coalesce(student_details ->> 'full_name', ''));
        end if;
        if pupil_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
        end if;

        begin
            student_class := (student_details ->> 'class_name')::public.lead_class;
        exception when invalid_text_representation then
            student_class := null;
        end;
        if student_class is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
        end if;

        begin
            student_year := (student_details ->> 'enrollment_year')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
            student_year := null;
        end;
        -- Staff choose from the current year and the next two.
        if student_year is null
           or (walk_in and student_year not between this_year and this_year + 2)
           or student_year not between 2000 and 2100 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
        end if;

        begin
            student_boarding := (student_details ->> 'day_or_boarding')::public.day_or_boarding;
        exception when invalid_text_representation then
            student_boarding := null;
        end;
        if student_boarding is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
        end if;

        -- Boy or girl (#449): empty from a form that does not ask it yet.
        student_gender := public.student_gender_of(student_details -> 'gender', null);

        -- A walk-in has a Visit date, never later than today in Tanzania; the
        -- Admission form starts at Applied and has none.
        if walk_in then
            if visited_on is null or visited_on > public.tanzania_today() then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
            end if;
        elsif visited_on is not null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;

        -- Serialize creations that share a phone number, in a fixed order so two
        -- callers can never wait on each other. Whoever comes second sees the
        -- first one's lead when it checks for a duplicate.
        phones := array(
            select distinct p from unnest(array[contact_phone, contact_whatsapp] || extra_phones) p
            where p is not null order by p
        );
        foreach one_phone in array phones loop
            perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
        end loop;

        -- A duplicate is the same student name with the same parent phone, in a
        -- lead of any status or closure mark.
        select l.* into match
        from public.leads l
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where l.student_name_key = public.normalize_student_name(pupil_name)
          and (g.phone = any (phones) or g.whatsapp = any (phones))
        order by l.created_at, l.id
        limit 1;
        if found then
            return jsonb_build_object(
                'result', 'duplicate',
                'lead_id', match.id,
                'admission_number', match.admission_number,
                'status', match.status,
                'closure', match.closure
            );
        end if;

        -- The Family link and the Returning family cause.
        if contact_id is not null then
            -- Joining a known Family at the front desk, or an Admission form
            -- child sharing its sibling's contact and that contact's pending match.
            joined := case when walk_in then true else contact.pending_family_match_id is not null end;
        elsif not walk_in then
            -- The form never joins a Family by itself: a known number leaves a
            -- pending match for staff to confirm.
            -- A contact with children, a settled one before one that is itself
            -- still waiting on staff, then the oldest. Held shared, so staff
            -- settling that contact's own match wait for this, or this reads
            -- how they settled it.
            select g.* into matched_contact
            from public.guardian_contacts g
            where (g.phone = any (phones) or g.whatsapp = any (phones))
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
            order by g.pending_family_match_id is not null, g.created_at, g.id
            limit 1
            for share of g;
            -- A contact still waiting on staff is not a Family: the match goes to
            -- the Family it waits on. A match always points at a contact with no
            -- match of its own, so there is never a chain to follow, and that
            -- contact keeps its children: confirming only adds to them, and
            -- separating never takes the last one.
            pending_match := coalesce(matched_contact.pending_family_match_id, matched_contact.id);
            joined := pending_match is not null;
        end if;

        if contact_id is null then
            insert into public.guardian_contacts (
                full_name, phone, whatsapp, origin, pending_family_match_id
            ) values (
                contact_name, contact_phone, contact_whatsapp,
                case when walk_in then 'front_desk'::public.contact_origin else 'admission_form'::public.contact_origin end,
                pending_match
            )
            returning id into contact_id;
        end if;

        -- ADMSN- and five random digits. The unique constraint catches a
        -- collision and the loop draws again.
        for attempt in 1..20 loop
            new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
            begin
                insert into public.leads (
                    admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                    status, visit_date, guardian_contact_id, returning_family_joined,
                    father_full_name, father_full_name_source, gender,
                    custodian_relationship, custodian_relationship_description
                ) values (
                    new_number, pupil_name, student_class, student_year, student_boarding,
                    case when walk_in then 'Visited'::public.lead_status else 'Applied'::public.lead_status end,
                    visited_on, contact_id, joined,
                    -- Empty for a one-box name: the insert trigger derives it.
                    pupil_father, case when pupil_father is not null then 'entered'::public.father_name_source end,
                    student_gender,
                    contact_relationship, contact_description
                )
                returning id into new_lead_id;
                exit;
            exception when unique_violation then
                if attempt = 20 then
                    raise exception 'unavailable';
                end if;
            end;
        end loop;

        return jsonb_build_object('result', 'created', 'lead_id', new_lead_id, 'admission_number', new_number);
    end;
    $function$;

create or replace function public.submit_admission_form_child(submission_key uuid, payload_hash text, child_count integer, child_index integer, new_contact jsonb, student_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
        submission public.admission_submissions;
        stored jsonb;
        created jsonb;
        outcome jsonb;
        created_contact uuid;
        re_application_id uuid;
        named record;
        built_contact_name text;
    begin
        if auth.role() is distinct from 'service_role' then
            raise exception 'not_permitted';
        end if;
        if submit_admission_form_child.submission_key is null
           or submit_admission_form_child.payload_hash is null
           or submit_admission_form_child.payload_hash !~ '^[0-9a-f]{64}$' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'submission_key')::text;
        end if;
        if submit_admission_form_child.child_count is null or submit_admission_form_child.child_count not between 1 and 8
           or child_index is null or child_index not between 0 and submit_admission_form_child.child_count - 1 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'children')::text;
        end if;

        perform pg_advisory_xact_lock(
            hashtextextended('admission-submission:' || submit_admission_form_child.submission_key::text, 0)
        );

        insert into public.admission_submissions (submission_key, payload_hash, child_count)
        values (
            submit_admission_form_child.submission_key,
            submit_admission_form_child.payload_hash,
            submit_admission_form_child.child_count
        )
        on conflict on constraint admission_submissions_pkey do nothing;

        select * into submission
        from public.admission_submissions s
        where s.submission_key = submit_admission_form_child.submission_key;

        if submission.payload_hash <> submit_admission_form_child.payload_hash then
            if submission.outcomes = '{}'::jsonb then
                update public.admission_submissions s
                set payload_hash = submit_admission_form_child.payload_hash,
                    child_count = submit_admission_form_child.child_count,
                    updated_at = now()
                where s.submission_key = submit_admission_form_child.submission_key;
            else
                raise exception 'submission_key_reused' using detail = jsonb_build_object(
                    'complete', (select count(*) from jsonb_object_keys(submission.outcomes)) = submission.child_count,
                    'children', (
                        select jsonb_agg(
                            jsonb_build_object('full_name', o.value ->> 'full_name', 'admission_number', o.value ->> 'admission_number')
                            order by o.key::integer
                        )
                        from jsonb_each(submission.outcomes) o
                    )
                )::text;
            end if;
        end if;

        stored := submission.outcomes -> child_index::text;
        if stored is not null then
            return stored || jsonb_build_object('replayed', true);
        end if;

        -- The names built from their parts (#400), as create_lead builds
        -- them again: the outcome and a Re-application carry the full
        -- names. One-box names pass through unchanged.
        if student_details ?| array['first_name', 'father_first', 'father_middle', 'father_last'] then
            select * into named from public.registration_name(student_details, null);
            student_details := student_details
                || jsonb_build_object('full_name', named.student_name, 'father_full_name', named.father_full_name);
        end if;
        if new_contact ?| array['first_name', 'middle_name', 'last_name'] then
            built_contact_name := public.registration_person_name(new_contact, null);
            if built_contact_name is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_first_name')::text;
            end if;
            new_contact := new_contact || jsonb_build_object('full_name', built_contact_name);
        end if;

        -- create_lead sets the Admission form as the actor itself.
        created := public.create_lead(
            'admission_form',
            submission.contact_id,
            -- Every child, so each one carries the form's relationship (#312);
            -- a contact already made takes nothing else from it.
            new_contact,
            student_details
        );

        if created ->> 'result' = 'created' then
            if submission.contact_id is null then
                select l.guardian_contact_id into created_contact
                from public.leads l
                where l.id = (created ->> 'lead_id')::uuid;
            end if;
            outcome := created;
        elsif created ->> 'result' = 'duplicate' then
            if exists (
                select 1 from jsonb_each(submission.outcomes) o
                where o.value ->> 'lead_id' = created ->> 'lead_id'
            ) then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'duplicate_child')::text;
            end if;
            re_application_id := public.record_re_application(
                (created ->> 'lead_id')::uuid,
                submit_admission_form_child.submission_key,
                jsonb_build_object('contact', new_contact, 'student', student_details)
            );
            outcome := jsonb_build_object(
                'result', 're_applied',
                'lead_id', created ->> 'lead_id',
                'admission_number', created ->> 'admission_number',
                're_application_id', re_application_id
            );
        else
            return created;
        end if;

        update public.admission_submissions s
        set outcomes = s.outcomes || jsonb_build_object(
                child_index::text,
                outcome || jsonb_build_object('full_name', student_details ->> 'full_name')
            ),
            contact_id = coalesce(s.contact_id, created_contact),
            updated_at = now()
        where s.submission_key = submit_admission_form_child.submission_key;

        return outcome || jsonb_build_object('replayed', false);
    end;
    $function$;

create or replace function public.register_students(visited_on date, people jsonb, students jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        s_gender public.student_gender[] := '{}';
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
                   or public.name_part(person ->> 'first_name') is not null
                   or public.name_part(person ->> 'middle_name') is not null
                   or public.name_part(person ->> 'last_name') is not null
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
                -- The name in its three parts (#400). A one-box name is
                -- refused, so no caller stores one by mistake.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact_name', 'reason', 'name_parts')::text;
                end if;
                p_name[k] := public.registration_person_name(person, k);
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
            s_gender[i] := public.student_gender_of(item -> 'gender', i);

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
                -- The person's relationship is the one their first child holds
                -- (#312); a person with no child yet takes this form's.
                p_stored_rel[k] := (
                    select r.custodian_relationship from public.contact_first_child_relationship(p_contact[k]) r
                );
                p_stored_desc[k] := (
                    select r.custodian_relationship_description from public.contact_first_child_relationship(p_contact[k]) r
                );
                if p_stored_rel[k] is null then
                    p_stored_rel[k] := p_rel[k];
                    p_stored_desc[k] := p_desc[k];
                end if;
            else
                p_stored_rel[k] := p_rel[k];
                p_stored_desc[k] := p_desc[k];
            end if;
        end loop;

        -- The same student twice on the form: the same name with custodians
        -- sharing any phone, known people included (their stored numbers and
        -- the ones staff typed).
        for i in 2..n loop
            for j in 1..i - 1 loop
                if public.normalize_student_name(s_name[i]) = public.normalize_student_name(s_name[j])
                   and array_remove(
                           array[p_phone[s_person[i]], p_whatsapp[s_person[i]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[i]])), null)
                       && array_remove(
                           array[p_phone[s_person[j]], p_whatsapp[s_person[j]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[j]])), null) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'student_name', 'reason', 'repeated_on_form', 'same_as_student', j)::text;
                end if;
            end loop;
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
                        full_name, phone, whatsapp, origin, pending_family_match_id
                    ) values (
                        p_name[k], p_phone[k], p_whatsapp[k], 'front_desk', null
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
                            previous_school_name, previous_school_type, previous_school_region, previous_school_not_known,
                            gender
                        ) values (
                            new_number, s_name[i], s_class[i], s_year[i], s_boarding[i],
                            'Visited', register_students.visited_on, p_contact[k],
                            -- Joining a known Family at the front desk.
                            p_contact[k] = any (existing),
                            s_father[i], 'entered',
                            s_rel[i], s_desc[i],
                            -- Its own when it differs from the person's.
                            (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k]),
                            s_by_name[i], s_by_phone[i], s_by_rel[i],
                            s_school[i], s_school_type[i], s_school_region[i], s_school_unknown[i],
                            s_gender[i]
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
            -- A student on this form is named by its number: its lead was
            -- rolled back with everything else.
            return jsonb_build_object(
                'result', 'questions',
                'questions', (
                    select jsonb_agg(
                        case
                            when x.n is not null then (q - 'sibling_lead_id') || jsonb_build_object('sibling_student', x.n)
                            else q
                        end
                        order by (q ->> 'student')::integer, q ->> 'question')
                    from jsonb_array_elements(questions) q
                    left join lateral (
                        select y as n from generate_subscripts(s_lead, 1) y
                        where s_lead[y]::text = q ->> 'sibling_lead_id'
                    ) x on true
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
    $function$;

create or replace function public.complete_admission_visit(visited_on date, people jsonb, students jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
        n integer;
        np integer;
        i integer;
        j integer;
        k integer;
        item jsonb;
        person jsonb;
        -- People, by number.
        p_contact uuid[] := '{}';
        p_known boolean[] := '{}';
        p_name text[] := '{}';
        p_phone text[] := '{}';
        p_whatsapp text[] := '{}';
        p_extra jsonb[] := '{}';
        extra text[];
        p_rel public.guardian_relationship[] := '{}';
        p_desc text[] := '{}';
        p_stored_rel public.guardian_relationship[] := '{}';
        p_stored_desc text[] := '{}';
        p_used boolean[] := '{}';
        p_father_name text[] := '{}';
        -- Students, by number.
        s_lead uuid[] := '{}';
        s_item jsonb[] := '{}';
        s_name text[] := '{}';
        s_father text[] := '{}';
        s_person integer[] := '{}';
        s_rel public.guardian_relationship[] := '{}';
        s_desc text[] := '{}';
        s_by_given boolean[] := '{}';
        s_by_name text[] := '{}';
        s_by_phone text[] := '{}';
        s_by_rel text[] := '{}';
        s_school_given boolean[] := '{}';
        s_school text[] := '{}';
        s_school_type public.previous_school_type[] := '{}';
        s_school_region text[] := '{}';
        s_school_unknown boolean[] := '{}';
        s_gender public.student_gender[] := '{}';
        s_sib_student integer[] := '{}';
        s_sib_lead uuid[] := '{}';
        s_not_sibling boolean[] := '{}';
        s_linked boolean[] := '{}';
        s_choice jsonb[] := '{}';
        s_comp integer[] := '{}';
        s_sibling jsonb[] := '{}';
        s_number text[] := '{}';
        parsed record;
        custodian record;
        lead public.leads;
        member public.sibling_group_members;
        contact public.guardian_contacts;
        targets uuid[] := '{}';
        existing uuid[] := '{}';
        all_leads uuid[];
        submission uuid;
        one_phone text;
        phones text[];
        match public.leads;
        same_lead public.leads;
        duplicates jsonb := '[]';
        questions jsonb := '[]';
        changed boolean;
        new_id uuid;
        kept uuid[];
        touched uuid[] := '{}';
        pending integer[];
        blocked boolean[] := '{}';
        progressed boolean;
        target uuid;
        saved jsonb;
        old_group uuid;
        result_rows jsonb := '[]';
    begin
        if auth.role() is distinct from 'authenticated'
           or not public.has_permission('visits.record')
           or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;

        if complete_admission_visit.visited_on is null or complete_admission_visit.visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
        if complete_admission_visit.students is null or jsonb_typeof(complete_admission_visit.students) <> 'array'
           or jsonb_array_length(complete_admission_visit.students) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students')::text;
        end if;
        n := jsonb_array_length(complete_admission_visit.students);
        -- One Admission form holds at most 8 children.
        if n > 8 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'students', 'reason', 'too_many')::text;
        end if;
        if complete_admission_visit.people is null or jsonb_typeof(complete_admission_visit.people) <> 'array'
           or jsonb_array_length(complete_admission_visit.people) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people')::text;
        end if;
        np := jsonb_array_length(complete_admission_visit.people);
        if np > n then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'people', 'reason', 'too_many')::text;
        end if;

        -- ------------------------------------------------------------------
        -- The people, as register_students reads them.
        -- ------------------------------------------------------------------
        for k in 1..np loop
            person := complete_admission_visit.people -> (k - 1);
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
                   or public.name_part(person ->> 'first_name') is not null
                   or public.name_part(person ->> 'middle_name') is not null
                   or public.name_part(person ->> 'last_name') is not null
                   or nullif(btrim(coalesce(person ->> 'phone', '')), '') is not null
                   or nullif(btrim(coalesce(person ->> 'whatsapp', '')), '') is not null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                -- The numbers staff typed for the person they confirmed,
                -- which the stored person may not hold: the duplicate check
                -- covers them too.
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
                p_known[k] := true;
                p_name[k] := null;
                p_phone[k] := null;
                p_whatsapp[k] := null;
                existing := existing || p_contact[k];
            else
                p_known[k] := false;
                p_extra[k] := '[]';
                p_contact[k] := null;
                -- The name in its three parts (#400). A one-box name is
                -- refused, so no caller stores one by mistake.
                if nullif(btrim(coalesce(person ->> 'full_name', '')), '') is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'contact_name', 'reason', 'name_parts')::text;
                end if;
                p_name[k] := public.registration_person_name(person, k);
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
                for j in 1..k - 1 loop
                    if not p_known[j]
                       and array[p_phone[k], p_whatsapp[k]] && array_remove(array[p_phone[j], p_whatsapp[j]], null) then
                        raise exception 'invalid'
                            using detail = jsonb_build_object('person', k, 'field', 'phone', 'reason', 'repeated_on_form')::text;
                    end if;
                end loop;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- The students: what does not need the stored lead.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            item := complete_admission_visit.students -> (i - 1);
            if jsonb_typeof(item) <> 'object' then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'student')::text;
            end if;
            s_item[i] := item;
            begin
                s_lead[i] := (item ->> 'lead_id')::uuid;
            exception when invalid_text_representation then
                s_lead[i] := null;
            end;
            if s_lead[i] is null then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'lead_id')::text;
            end if;
            if s_lead[i] = any (s_lead[1:i - 1]) then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'repeated_on_form')::text;
            end if;

            select * into parsed from public.registration_name(item, i);
            s_name[i] := parsed.student_name;
            s_father[i] := parsed.father_full_name;

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
            -- typed takes the father's full name.
            if custodian.father and not p_known[k] and p_name[k] is null then
                if p_father_name[k] is null then
                    p_father_name[k] := s_father[i];
                elsif public.normalize_father_name(p_father_name[k]) <> public.normalize_father_name(s_father[i]) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'custodian', 'reason', 'father_names_differ')::text;
                end if;
            end if;

            s_by_given[i] := item -> 'brought_by' is not null and jsonb_typeof(item -> 'brought_by') <> 'null';
            select * into parsed from public.registration_brought_by(item -> 'brought_by', i);
            s_by_name[i] := parsed.name;
            s_by_phone[i] := parsed.phone;
            s_by_rel[i] := parsed.relationship;

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
                    if s_sib_lead[i] is null or s_sib_lead[i] = s_lead[i] then
                        raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of')::text;
                    end if;
                end if;
            end if;
            s_choice[i] := jsonb_strip_nulls(jsonb_build_object(
                'sibling_father_full_name', item -> 'sibling_father_full_name',
                'name_answer', item -> 'name_answer',
                'request_note', item -> 'request_note',
                'request_id', item -> 'request_id'
            ));
        end loop;

        -- A lead on file that is another child of this form is that student.
        for i in 1..n loop
            if s_sib_lead[i] is not null then
                j := array_position(s_lead, s_sib_lead[i]);
                if j is not null then
                    s_sib_student[i] := j;
                    s_sib_lead[i] := null;
                else
                    targets := targets || s_sib_lead[i];
                end if;
            end if;
        end loop;

        for k in 1..np loop
            if not p_used[k] then
                raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'person', 'reason', 'unused')::text;
            end if;
            if not p_known[k] then
                p_name[k] := coalesce(p_name[k], p_father_name[k]);
                if p_name[k] is null then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact_name')::text;
                end if;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Every lock, before the first write.
        -- ------------------------------------------------------------------
        all_leads := array(select distinct x from unnest(s_lead || targets) x order by 1);
        perform public.lock_registration(existing, all_leads);

        perform 1 from public.guardian_contacts g where g.id = any (existing) order by g.id for share;
        for k in 1..np loop
            if p_known[k] then
                select * into contact from public.guardian_contacts g where g.id = p_contact[k];
                if not found then
                    raise exception 'invalid' using detail = jsonb_build_object('person', k, 'field', 'contact')::text;
                end if;
                if contact.pending_family_match_id is not null then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('person', k, 'field', 'family_match')::text;
                end if;
                p_phone[k] := contact.phone;
                p_whatsapp[k] := contact.whatsapp;
                -- The person's relationship is the one their first child holds
                -- (#312); a person with no child yet takes this form's.
                p_stored_rel[k] := (
                    select r.custodian_relationship from public.contact_first_child_relationship(p_contact[k]) r
                );
                p_stored_desc[k] := (
                    select r.custodian_relationship_description from public.contact_first_child_relationship(p_contact[k]) r
                );
                if p_stored_rel[k] is null then
                    p_stored_rel[k] := p_rel[k];
                    p_stored_desc[k] := p_desc[k];
                end if;
            else
                p_stored_rel[k] := p_rel[k];
                p_stored_desc[k] := p_desc[k];
            end if;
        end loop;

        -- The same student twice on the form: the same name with custodians
        -- sharing any phone, known people included.
        for i in 2..n loop
            for j in 1..i - 1 loop
                if public.normalize_student_name(s_name[i]) = public.normalize_student_name(s_name[j])
                   and array_remove(
                           array[p_phone[s_person[i]], p_whatsapp[s_person[i]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[i]])), null)
                       && array_remove(
                           array[p_phone[s_person[j]], p_whatsapp[s_person[j]]]
                               || array(select jsonb_array_elements_text(p_extra[s_person[j]])), null) then
                    raise exception 'invalid'
                        using detail = jsonb_build_object('student', i, 'field', 'student_name', 'reason', 'repeated_on_form', 'same_as_student', j)::text;
                end if;
            end loop;
        end loop;

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

        perform 1 from public.leads l where l.id = any (all_leads) order by l.id for update;

        -- ------------------------------------------------------------------
        -- The stored leads: one submission's Applied children.
        -- ------------------------------------------------------------------
        select s.submission_key into submission
        from public.admission_submissions s
        cross join lateral jsonb_each(s.outcomes) o
        where o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = s_lead[1]::text
        limit 1;
        if submission is null then
            raise exception 'invalid'
                using detail = jsonb_build_object('student', 1, 'field', 'lead_id', 'reason', 'not_admission_form')::text;
        end if;

        for i in 1..n loop
            select * into lead from public.leads l where l.id = s_lead[i];
            if not found then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'not_found')::text;
            end if;
            if not exists (
                select 1 from public.admission_submissions s cross join lateral jsonb_each(s.outcomes) o
                where s.submission_key = submission
                  and o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = s_lead[i]::text
            ) then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'lead_id', 'reason', 'other_submission')::text;
            end if;
            if lead.closure is not null or lead.status = 'Declined' then
                raise exception 'lead_closed' using detail = jsonb_build_object('student', i)::text;
            end if;
            if lead.status <> 'Applied' then
                raise exception 'not_applied' using detail = jsonb_build_object('student', i)::text;
            end if;
            if exists (
                select 1 from public.guardian_contacts g
                where g.id = lead.guardian_contact_id and g.pending_family_match_id is not null
            ) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'family_match')::text;
            end if;
            s_number[i] := lead.admission_number;

            -- The previous school: what staff give, or what the lead holds.
            item := s_item[i];
            s_school_given[i] := (item -> 'previous_school' is not null and jsonb_typeof(item -> 'previous_school') <> 'null')
                or not (lead.previous_school_name is not null or lead.previous_school_not_known);
            if s_school_given[i] then
                select * into parsed from public.registration_previous_school(item -> 'previous_school', lead.class_name, i);
                s_school[i] := parsed.name;
                s_school_type[i] := parsed.school_type;
                s_school_region[i] := parsed.region;
                s_school_unknown[i] := parsed.not_known;
            end if;

            -- Boy or girl: what staff give, or what the family gave.
            s_gender[i] := public.student_gender_of(item -> 'gender', i);

            -- A child linked before check-in keeps its link (rule 5).
            select * into member from public.sibling_group_members m where m.lead_id = lead.id;
            s_linked[i] := member.group_id is not null and not member.legacy;
            if s_linked[i] and s_not_sibling[i] then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'already_linked')::text;
            end if;
            if s_linked[i] and member.basis in ('matched', 'typo_confirmed')
               and public.father_name_match(lead.father_full_name, s_father[i]) is distinct from 'same' then
                raise exception 'invalid'
                    using detail = jsonb_build_object('student', i, 'field', 'father_full_name', 'reason', 'linked_member')::text;
            end if;
        end loop;

        for i in 1..n loop
            if s_sib_lead[i] is not null and not exists (select 1 from public.leads l where l.id = s_sib_lead[i]) then
                raise exception 'invalid' using detail = jsonb_build_object('student', i, 'field', 'sibling_of', 'reason', 'not_found')::text;
            end if;
        end loop;

        -- ------------------------------------------------------------------
        -- Duplicates: a corrected name, the new custodian's phones, or a number
        -- staff typed for the person they confirmed.
        -- ------------------------------------------------------------------
        for i in 1..n loop
            k := s_person[i];
            select * into lead from public.leads l where l.id = s_lead[i];
            if public.normalize_student_name(s_name[i]) <> lead.student_name_key
               or p_contact[k] is distinct from lead.guardian_contact_id
               or jsonb_array_length(p_extra[k]) > 0 then
                match := public.find_duplicate_lead(
                    public.normalize_student_name(s_name[i]),
                    array_remove(array[p_phone[k], p_whatsapp[k]] || array(select jsonb_array_elements_text(p_extra[k])), null),
                    lead.id
                );
                if match.id is not null then
                    duplicates := duplicates || jsonb_build_array(jsonb_build_object(
                        'student', i,
                        'lead_id', match.id,
                        'admission_number', match.admission_number,
                        'status', match.status,
                        'closure', match.closure
                    ));
                end if;
            end if;
        end loop;
        if jsonb_array_length(duplicates) > 0 then
            return jsonb_build_object('result', 'duplicate', 'duplicates', duplicates);
        end if;

        -- ------------------------------------------------------------------
        -- Same father, no choice (R8), as register_students asks it. The
        -- children on file are those of every contact the form's children
        -- sit on or move to.
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
            if s_sib_student[i] is not null or s_sib_lead[i] is not null or s_not_sibling[i] or s_linked[i] then
                continue;
            end if;
            for j in 1..n loop
                if j <> i and s_comp[j] <> s_comp[i]
                   and public.normalize_father_name(s_father[j]) = public.normalize_father_name(s_father[i])
                   and not s_not_sibling[j]
                   and (s_sib_student[j] is not null or s_sib_lead[j] is not null or s_linked[j] or j < i) then
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
            where l.guardian_contact_id in (
                      select x from unnest(existing) x
                      union select l2.guardian_contact_id from public.leads l2 where l2.id = any (s_lead)
                  )
              and l.id <> all (s_lead)
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
            for k in 1..np loop
                if not p_known[k] then
                    insert into public.guardian_contacts (
                        full_name, phone, whatsapp, origin, pending_family_match_id
                    ) values (
                        p_name[k], p_phone[k], p_whatsapp[k], 'front_desk', null
                    )
                    returning id into new_id;
                    p_contact[k] := new_id;
                end if;
            end loop;

            -- Never a fee raise (R38): every automatic 10% in a group this
            -- call reaches, and each child's own, is kept.
            kept := array(
                select r.lead_id
                from public.lead_sibling_results r
                where r.result = 'ten' and r.source = 'auto'
                  and (
                      r.lead_id = any (s_lead)
                      or exists (
                          select 1 from public.sibling_group_members m
                          join public.sibling_groups g on g.id = m.group_id
                          where m.lead_id = r.lead_id
                            and (
                                g.contact_ids && (existing || array(
                                    select l.guardian_contact_id from public.leads l where l.id = any (all_leads)
                                ))
                                or g.id in (
                                    select t.group_id from public.sibling_group_members t
                                    where t.lead_id = any (all_leads) and t.group_id is not null
                                )
                            )
                      )
                  )
            );
            perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

            -- Each child's choice is made here: it never joins a Family's
            -- legacy group again.
            for i in 1..n loop
                insert into public.sibling_group_members as m (lead_id, group_id, legacy, cause, sibling_choice_made)
                values (s_lead[i], null, false, 'visit_completion', true)
                on conflict on constraint sibling_group_members_lead_id_key do update
                set sibling_choice_made = true,
                    updated_at = now()
                where not m.sibling_choice_made;
            end loop;

            -- The details staff confirmed or completed, and the visit.
            for i in 1..n loop
                select * into lead from public.leads l where l.id = s_lead[i];
                update public.leads l
                set student_name = s_name[i],
                    father_full_name = s_father[i],
                    father_full_name_source = case
                        when s_father[i] is not distinct from lead.father_full_name
                             and lead.father_full_name_source in ('edited', 'typo_confirmed')
                            then lead.father_full_name_source
                        else 'entered'
                    end,
                    brought_by_name = case when s_by_given[i] then s_by_name[i] else l.brought_by_name end,
                    brought_by_phone = case when s_by_given[i] then s_by_phone[i] else l.brought_by_phone end,
                    brought_by_relationship = case when s_by_given[i] then s_by_rel[i] else l.brought_by_relationship end,
                    previous_school_name = case when s_school_given[i] then s_school[i] else l.previous_school_name end,
                    previous_school_type = case when s_school_given[i] then s_school_type[i] else l.previous_school_type end,
                    previous_school_region = case when s_school_given[i] then s_school_region[i] else l.previous_school_region end,
                    previous_school_not_known = case when s_school_given[i] then s_school_unknown[i] else l.previous_school_not_known end,
                    gender = coalesce(s_gender[i], l.gender),
                    status = 'Visited',
                    visit_date = complete_admission_visit.visited_on
                where l.id = s_lead[i];
            end loop;

            -- Every child leaves its Family's legacy group before any link,
            -- so the links alone make the groups: two pairs of siblings on
            -- one form make two groups, and a child left out of the check-in
            -- stays legacy in the old one, outside them.
            for i in 1..n loop
                select * into member from public.sibling_group_members m where m.lead_id = s_lead[i];
                if member.legacy and member.group_id is not null then
                    touched := touched || member.group_id;
                    perform public.leave_legacy_sibling_group(s_lead[i], 'visit_completion');
                    perform public.refresh_sibling_group_contacts(member.group_id);
                end if;
            end loop;

            -- The custodians, before any link. The move's trigger leaves
            -- its recomputes to the final pass below (a child linked before
            -- check-in keeps its group through the move), so no group is
            -- recomputed before every link is made.
            perform set_config('app.sibling_defer_contact_recompute', 'on', true);
            for i in 1..n loop
                k := s_person[i];
                select * into lead from public.leads l where l.id = s_lead[i];
                if lead.guardian_contact_id is distinct from p_contact[k] then
                    old_group := public.lead_sibling_group(lead.id);
                    touched := touched || old_group;
                    update public.leads l
                    set guardian_contact_id = p_contact[k],
                        -- Joining a known Family at the front desk.
                        returning_family_joined = p_known[k]
                    where l.id = lead.id;
                    -- The group the move left the child in, should it differ.
                    touched := touched || public.lead_sibling_group(lead.id);
                end if;
                -- Its own relationship when it differs from the person's.
                update public.leads l
                set custodian_relationship = s_rel[i],
                    custodian_relationship_description = s_desc[i],
                    custodian_relationship_own = (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k])
                where l.id = lead.id
                  and (l.custodian_relationship, l.custodian_relationship_description, l.custodian_relationship_own)
                      is distinct from (s_rel[i], s_desc[i], (s_rel[i], s_desc[i]) is distinct from (p_stored_rel[k], p_stored_desc[k]));
            end loop;
            perform set_config('app.sibling_defer_contact_recompute', '', true);

            -- The links, as register_students makes them: a student after
            -- the student it links to.
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

            -- Each touched group once, then each child's own result, then
            -- requests that no longer ask anything.
            perform public.recompute_sibling_groups_once(touched, 'sibling');
            for i in 1..n loop
                perform public.recompute_lead_fee(s_lead[i], 'sibling');
            end loop;
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
                -- Another child of this form is named by its number.
                'questions', (
                    select jsonb_agg(
                        case
                            when x.n is not null then (q - 'sibling_lead_id') || jsonb_build_object('sibling_student', x.n)
                            else q
                        end
                        order by (q ->> 'student')::integer, q ->> 'question')
                    from jsonb_array_elements(questions) q
                    left join lateral (
                        select y as n from generate_subscripts(s_lead, 1) y
                        where s_lead[y]::text = q ->> 'sibling_lead_id'
                    ) x on true
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
        return jsonb_build_object('result', 'completed', 'students', result_rows);
    end;
    $function$;

create or replace function public.confirm_student_import(file_name text, row_count integer, rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    staff_id uuid;
    batch_file text := btrim(coalesce(confirm_student_import.file_name, ''));
    today date := public.tanzania_today();
    one_phone text;
    checked jsonb;
    changed jsonb;
    creates integer;
    joins integer;
    batch uuid;
    item record;
    contacts jsonb := '{}';
    contact_id uuid;
    first_relationship public.guardian_relationship;
    first_description text;
    new_lead_id uuid;
    new_number text;
    attempt integer;
    lead_status public.lead_status;
    lead_visit date;
    issued integer;
    earlier_override text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.import') then
        raise exception 'not_permitted';
    end if;
    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
    if batch_file = '' or char_length(batch_file) > 255 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'file_name')::text;
    end if;
    if jsonb_typeof(confirm_student_import.rows) is distinct from 'array'
       or confirm_student_import.row_count is null
       or confirm_student_import.row_count not between greatest(jsonb_array_length(confirm_student_import.rows), 1) and 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_count')::text;
    end if;

    -- One import at a time, then every parent phone in sorted order, the
    -- keys create_lead takes: a lead created at the front desk or by the
    -- form with one of these numbers finishes first, and the verdicts below
    -- see it.
    perform pg_advisory_xact_lock(hashtextextended('student-import', 0));
    for one_phone in
        select distinct p
        from public.student_import_rows(confirm_student_import.rows) r,
             unnest(array[r.phone, r.whatsapp]) p
        where p is not null and r.refused_field is null
        order by p
    loop
        perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
            'sheet_row', v.sheet_row,
            'verdict', v.verdict,
            'expected', e.value -> 'expected'
        ) order by v.sheet_row), '[]'::jsonb)
    into checked
    from public.student_import_verdicts(confirm_student_import.rows) v
    join jsonb_array_elements(confirm_student_import.rows) e on (e.value ->> 'sheet_row')::integer = v.sheet_row;

    select coalesce(jsonb_agg(jsonb_build_object('sheet_row', c -> 'sheet_row', 'verdict', c -> 'verdict')
               order by (c ->> 'sheet_row')::integer), '[]'::jsonb)
    into changed
    from jsonb_array_elements(checked) c
    where c -> 'verdict' is distinct from c -> 'expected';
    if jsonb_array_length(changed) > 0 then
        return jsonb_build_object('outcome', 'changed', 'rows', changed);
    end if;

    select count(*) filter (where c -> 'verdict' ->> 'verdict' = 'create'),
           count(*) filter (where c -> 'verdict' ->> 'verdict' = 'joins_family')
    into creates, joins
    from jsonb_array_elements(checked) c;
    if creates + joins = 0 then
        raise exception 'nothing_to_import';
    end if;

    insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
    values ('students', batch_file, staff_id, confirm_student_import.row_count, creates + joins, 0,
            confirm_student_import.row_count - creates - joins)
    returning id into batch;

    for item in
        select r.*, v.verdict
        from public.student_import_rows(confirm_student_import.rows) r
        join public.student_import_verdicts(confirm_student_import.rows) v on v.sheet_row = r.sheet_row
        where v.verdict ->> 'verdict' in ('create', 'joins_family')
        order by r.sheet_row
    loop
        -- One new contact per parent phone in the file, the first row's.
        contact_id := (contacts ->> item.phone)::uuid;
        if contact_id is null then
            insert into public.guardian_contacts (
                full_name, phone, whatsapp, origin, pending_family_match_id
            ) values (
                item.guardian_name, item.phone, item.whatsapp, 'front_desk',
                (item.verdict -> 'family' ->> 'contact_id')::uuid
            )
            returning id into contact_id;
            contacts := contacts || jsonb_build_object(item.phone, contact_id);
        end if;

        -- Each row's own relationship (#312), marked as its own when it
        -- differs from the one the parent's first row gave.
        select r.custodian_relationship, r.custodian_relationship_description
        into first_relationship, first_description
        from public.contact_first_child_relationship(contact_id) r;

        lead_status := case item.status when 'Enrolled' then 'Interviewed' else item.status end::public.lead_status;
        -- The import date stands in for a Visit date the file left out.
        lead_visit := case
            when item.visit_date is not null then item.visit_date
            when item.status in ('Visited', 'Interviewed', 'Enrolled') then today
        end;

        -- ADMSN- and five random digits, as create_lead draws them.
        for attempt in 1..20 loop
            new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
            begin
                insert into public.leads (
                    admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                    status, visit_date, guardian_contact_id, returning_family_joined,
                    referral_code, import_batch_id, imported_as_enrolled,
                    declined_reason, declined_explanation, declined_at, declined_by, status_before_decline,
                    custodian_relationship, custodian_relationship_description, custodian_relationship_own
                ) values (
                    new_number, item.student_name, item.class_name::public.lead_class, item.enrollment_year,
                    item.day_or_boarding::public.day_or_boarding,
                    lead_status, lead_visit, contact_id, item.verdict ->> 'verdict' = 'joins_family',
                    item.referral_code, batch, item.status = 'Enrolled',
                    case when item.status = 'Declined' then 'Other'::public.declined_reason end,
                    case when item.status = 'Declined' then 'Imported from the workbook' end,
                    case when item.status = 'Declined' then now() end,
                    case when item.status = 'Declined' then staff_id end,
                    case when item.status = 'Declined' then
                        case when lead_visit is null then 'Applied' else 'Visited' end::public.lead_status
                    end,
                    item.relationship::public.guardian_relationship, item.relationship_description,
                    first_relationship is not null
                        and (item.relationship::public.guardian_relationship, item.relationship_description)
                            is distinct from (first_relationship, first_description)
                )
                returning id into new_lead_id;
                exit;
            exception when unique_violation then
                if attempt = 20 then
                    raise exception 'unavailable';
                end if;
            end;
        end loop;

        if item.pre_form_one then
            insert into public.lead_fee_profiles (lead_id, pre_form_one) values (new_lead_id, true);
        end if;

        if item.status in ('Interviewed', 'Enrolled') then
            insert into public.interview_serial_counters as c (enrollment_year, last_number)
            values (item.enrollment_year, 1)
            on conflict (enrollment_year) do update set last_number = c.last_number + 1
            returning c.last_number into issued;

            insert into public.interviews (lead, serial_number, serial_year, registered_by, registered_at, import_batch_id)
            values (new_lead_id, issued, item.enrollment_year, staff_id, clock_timestamp(), batch);
        end if;

        if item.status = 'Enrolled' then
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform public.set_lead_lifecycle_override('import');
            update public.leads l
            set status = 'Enrolled', enrolled_by_import = true
            where l.id = new_lead_id;
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;
    end loop;

    return jsonb_build_object(
        'outcome', 'imported',
        'batch_id', batch,
        'created', creates,
        'joined_family', joins,
        'skipped', confirm_student_import.row_count - creates - joins
    );
end;
$function$;

create or replace function public.record_re_application(lead_id uuid, submission_key uuid, submitted jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
        lead public.leads;
        contact public.guardian_contacts;
        sent_contact jsonb := coalesce(submitted -> 'contact', '{}'::jsonb);
        sent_student jsonb := coalesce(submitted -> 'student', '{}'::jsonb);
        contact_name text;
        contact_relationship public.guardian_relationship;
        contact_description text;
        phone_as_sent text;
        whatsapp_as_sent text;
        contact_phone text;
        contact_whatsapp text;
        pupil_name text;
        sent_father text;
        student_class public.lead_class;
        student_year integer;
        student_boarding public.day_or_boarding;
        sent_gender public.student_gender;
        sent_code text;
        differing text[] := '{}';
        existing uuid;
        new_id uuid;
        earlier_override text;
    begin
        perform public.set_audit_actor('public_form', null);

        if record_re_application.lead_id is null or record_re_application.submission_key is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'submission_key')::text;
        end if;

        -- The parent or guardian, checked as create_lead checks a new contact.
        contact_name := btrim(coalesce(sent_contact ->> 'full_name', ''));
        if contact_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
        end if;
        begin
            contact_relationship := (sent_contact ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            contact_relationship := null;
        end;
        if contact_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;
        contact_description := nullif(btrim(coalesce(sent_contact ->> 'relationship_description', '')), '');
        if contact_relationship = 'Other' and contact_description is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
        end if;
        if contact_relationship <> 'Other' then
            contact_description := null;
        end if;

        phone_as_sent := btrim(coalesce(sent_contact ->> 'phone', ''));
        contact_phone := public.normalize_phone(phone_as_sent);
        if contact_phone is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
        end if;
        whatsapp_as_sent := nullif(btrim(coalesce(sent_contact ->> 'whatsapp', '')), '');
        if whatsapp_as_sent is not null then
            contact_whatsapp := public.normalize_phone(whatsapp_as_sent);
            if contact_whatsapp is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
            end if;
            if contact_whatsapp = contact_phone then
                contact_whatsapp := null;
            end if;
        end if;

        -- The child.
        pupil_name := regexp_replace(btrim(coalesce(sent_student ->> 'full_name', '')), '\s+', ' ', 'g');
        -- The father's full name the form built from its three parts (#400),
        -- kept as sent, never put on the lead. Empty from a one-box form.
        sent_father := public.clean_father_name(sent_student ->> 'father_full_name');
        if char_length(sent_father) > 200 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'father_full_name')::text;
        end if;
        if pupil_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
        end if;
        begin
            student_class := (sent_student ->> 'class_name')::public.lead_class;
        exception when invalid_text_representation then
            student_class := null;
        end;
        if student_class is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
        end if;
        begin
            student_year := (sent_student ->> 'enrollment_year')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
            student_year := null;
        end;
        if student_year is null or student_year not between 2000 and 2100 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
        end if;
        begin
            student_boarding := (sent_student ->> 'day_or_boarding')::public.day_or_boarding;
        exception when invalid_text_representation then
            student_boarding := null;
        end;
        if student_boarding is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
        end if;
        sent_gender := public.student_gender_of(sent_student -> 'gender', null);

        -- The Discount code, normalized as every path normalizes it. An empty one
        -- is none.
        if nullif(btrim(coalesce(sent_student ->> 'discount_code', '')), '') is not null then
            sent_code := public.normalize_referral_code(sent_student ->> 'discount_code');
            if sent_code is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'discount_code')::text;
            end if;
        end if;

        -- Held, so the differing fields are read against the lead as it stands
        -- and two sends of one form record it once.
        select * into lead from public.leads l where l.id = record_re_application.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;

        select r.id into existing
        from public.re_applications r
        where r.lead_id = lead.id and r.submission_key = record_re_application.submission_key;
        if found then
            return existing;
        end if;

        select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;

        if pupil_name <> lead.student_name then differing := array_append(differing, 'student_name'); end if;
        if student_class <> lead.class_name then differing := array_append(differing, 'class_name'); end if;
        if student_year <> lead.enrollment_year then differing := array_append(differing, 'enrollment_year'); end if;
        if student_boarding <> lead.day_or_boarding then differing := array_append(differing, 'day_or_boarding'); end if;
        if contact_name <> contact.full_name then differing := array_append(differing, 'contact_name'); end if;
        -- Against this child's own relationship (#312).
        if contact_relationship <> lead.custodian_relationship then differing := array_append(differing, 'relationship'); end if;
        if contact_description is distinct from lead.custodian_relationship_description then
            differing := array_append(differing, 'relationship_description');
        end if;
        if contact_phone <> contact.phone then differing := array_append(differing, 'phone'); end if;
        if contact_whatsapp is distinct from contact.whatsapp then differing := array_append(differing, 'whatsapp'); end if;
        if sent_code is not null and sent_code is distinct from lead.referral_code then
            differing := array_append(differing, 'discount_code');
        end if;

        insert into public.re_applications (
            lead_id, submission_key, contact_name, relationship, relationship_description,
            phone_as_sent, whatsapp_as_sent, phone, whatsapp,
            student_name, class_name, enrollment_year, day_or_boarding, discount_code, differing_fields, father_full_name
        ) values (
            lead.id, record_re_application.submission_key, contact_name, contact_relationship, contact_description,
            phone_as_sent, whatsapp_as_sent, contact_phone, contact_whatsapp,
            pupil_name, student_class, student_year, student_boarding, sent_code, differing, sent_father
        )
        returning id into new_id;

        -- A child on file with no Boy / Girl answer takes the one sent; an
        -- answer already there is never overwritten (#449, Q20).
        if not lead.returning_family_reapplied or (lead.gender is null and sent_gender is not null) then
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform public.set_lead_lifecycle_override('re_application');
            update public.leads l
            set returning_family_reapplied = true,
                gender = coalesce(l.gender, sent_gender)
            where l.id = lead.id;
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;

        return new_id;
    end;
    $function$;

create or replace function public.separate_from_family(lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    locked record;
    lead public.leads;
    contact public.guardian_contacts;
    copy_id uuid;
begin
    select * into locked from public.lock_lead_contact(separate_from_family.lead_id);
    lead := locked.lead;
    contact := locked.contact;

    perform public.assert_lead_open(lead.id);
    if not exists (
        select 1 from public.leads l where l.guardian_contact_id = contact.id and l.id <> lead.id
    ) then
        raise exception 'not_shared';
    end if;

    -- The child keeps its own relationship (#312).
    insert into public.guardian_contacts (full_name, phone, whatsapp, origin)
    values (contact.full_name, contact.phone, contact.whatsapp, contact.origin)
    returning id into copy_id;

    update public.leads l
    set guardian_contact_id = copy_id, returning_family_joined = false
    where l.id = lead.id;
end;
$function$;

create or replace function public.find_family_by_phone(phone text, whatsapp text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    direct text;
    other text;
    phones text[];
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    direct := public.normalize_phone(coalesce(find_family_by_phone.phone, ''));
    if direct is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    other := nullif(btrim(coalesce(find_family_by_phone.whatsapp, '')), '');
    if other is not null then
        other := public.normalize_phone(other);
        if other is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if other = direct then
            other := null;
        end if;
    end if;

    phones := array_remove(array[direct, other], null);

    return jsonb_build_object(
        'phone', direct,
        'whatsapp', other,
        'contacts', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', g.id,
                    'full_name', g.full_name,
                    'phone', g.phone,
                    'whatsapp', g.whatsapp,
                    'children', public.family_children(g.id)
                )
                order by g.created_at, g.id
            )
            from public.guardian_contacts g
            where g.id in (
                select coalesce(m.pending_family_match_id, m.id)
                from public.guardian_contacts m
                where m.phone = any (phones) or m.whatsapp = any (phones)
            )
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
        ), '[]'::jsonb)
    );
end;
$function$;

create or replace function public.lead_family(lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    lead public.leads;
    contact public.guardian_contacts;
    matched public.guardian_contacts;
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into lead from public.leads l where l.id = lead_family.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id;

    if contact.pending_family_match_id is not null then
        select * into matched from public.guardian_contacts g where g.id = contact.pending_family_match_id;
    end if;

    return jsonb_build_object(
        'contact_id', contact.id,
        'pending_match', case when matched.id is not null then jsonb_build_object(
            'id', matched.id,
            'full_name', matched.full_name,
            -- The matched parent's relationship to their first child (#312),
            -- empty when no child is on that contact.
            'relationship', (
                select l.custodian_relationship from public.leads l
                where l.guardian_contact_id = matched.id order by l.created_at, l.id limit 1
            ),
            'relationship_description', (
                select l.custodian_relationship_description from public.leads l
                where l.guardian_contact_id = matched.id order by l.created_at, l.id limit 1
            ),
            'phone', matched.phone,
            'whatsapp', matched.whatsapp
        ) end,
        'children', public.family_children(coalesce(matched.id, contact.id))
    );
end;
$function$;

create or replace function public.admission_form_family(lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    submission public.admission_submissions;
    found_lead boolean;
    child_ids uuid[];
    contact public.guardian_contacts;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select exists (select 1 from public.leads l where l.id = admission_form_family.lead_id) into found_lead;
    if not found_lead then
        return jsonb_build_object('result', 'not_found');
    end if;

    select s.* into submission
    from public.admission_submissions s
    cross join lateral jsonb_each(s.outcomes) o
    where o.value ->> 'result' = 'created' and o.value ->> 'lead_id' = admission_form_family.lead_id::text
    order by s.created_at
    limit 1;
    if submission.submission_key is null then
        return jsonb_build_object('result', 'not_admission_form');
    end if;

    child_ids := array(
        select (o.value ->> 'lead_id')::uuid
        from jsonb_each(submission.outcomes) o
        where o.value ->> 'result' = 'created'
        order by (o.key)::integer
    );

    select g.* into contact
    from public.leads l
    join public.guardian_contacts g on g.id = l.guardian_contact_id
    where l.id = admission_form_family.lead_id;

    return jsonb_build_object(
        'result', 'family',
        'sent_on', (submission.created_at at time zone 'Africa/Dar_es_Salaam')::date,
        'contact', case when contact.id is null then null else jsonb_build_object(
            'id', contact.id,
            'full_name', contact.full_name,
            -- The looked-up child's own relationship to the parent (#312).
            'relationship', (select l.custodian_relationship from public.leads l where l.id = admission_form_family.lead_id),
            'relationship_description', (
                select l.custodian_relationship_description from public.leads l where l.id = admission_form_family.lead_id
            ),
            'phone', contact.phone,
            'whatsapp', contact.whatsapp,
            'family_match', contact.pending_family_match_id is not null
        ) end,
        'children', coalesce((
            select jsonb_agg(jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'father_full_name', l.father_full_name,
                'gender', l.gender,
                'class_name', l.class_name,
                'enrollment_year', l.enrollment_year,
                'day_or_boarding', l.day_or_boarding,
                'status', l.status,
                'closure', l.closure,
                'previous_school_name', l.previous_school_name,
                'previous_school_type', l.previous_school_type,
                'previous_school_region', l.previous_school_region,
                'previous_school_not_known', l.previous_school_not_known,
                'brought_by_name', l.brought_by_name,
                'contact_id', l.guardian_contact_id,
                'linked', m.group_id is not null,
                'group_id', m.group_id
            ) order by x.position)
            from unnest(child_ids) with ordinality as x (id, position)
            join public.leads l on l.id = x.id
            -- One membership row per lead (sibling_group_members_lead_id_key).
            left join public.sibling_group_members m on m.lead_id = l.id and m.group_id is not null and not m.legacy
        ), '[]'::jsonb),
        'on_file', coalesce((
            select jsonb_agg(jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'status', l.status,
                'closure', l.closure,
                'father_full_name', l.father_full_name
            ) order by l.created_at, l.id)
            from public.leads l
            where contact.id is not null
              and l.guardian_contact_id = contact.id
              -- The same rule as waitingChildren in lib/services/admission-form-family.ts.
              and not (l.id = any (child_ids) and l.status = 'Applied' and l.closure is null)
        ), '[]'::jsonb)
    );
end;
$function$;

create or replace function public.home_activity(row_offset integer, row_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    today date := public.tanzania_today();
    day_start timestamptz := (public.tanzania_today()::timestamp at time zone 'Africa/Dar_es_Salaam');
    week_start timestamptz := ((public.tanzania_today() - 7)::timestamp at time zone 'Africa/Dar_es_Salaam');
    sees_leads boolean;
    sees_payments boolean;
    sees_claims boolean;
    ready jsonb := '[]'::jsonb;
    result jsonb;
begin
    if auth.role() is distinct from 'authenticated' then
        raise exception 'not_permitted';
    end if;
    sees_leads := public.has_permission('leads.view');
    sees_payments := sees_leads and public.has_permission('payments.view');
    -- Agents are read under leads.view (marketing_agents' policy and the
    -- claim queue), and confirming a claim needs agents.approve.
    sees_claims := sees_leads and public.has_permission('agents.approve');
    if not sees_leads then
        raise exception 'not_permitted';
    end if;
    if row_offset is null or row_offset < 0 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_offset')::text;
    end if;
    if row_limit is null or row_limit < 1 or row_limit > 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_limit')::text;
    end if;

    -- Results to send: of an open lead's interviews with a result and the fee
    -- Paid, the ones interview_release_status calls ready (the lead's current
    -- interview, never sent or changed since). Asked only under sees_leads,
    -- like every branch, though a caller without it is refused above.
    if sees_leads then
        select coalesce(jsonb_agg(jsonb_build_object(
                   'interview_id', st.interview_id,
                   'changed_since_sent', st.changed_since_sent
               )), '[]'::jsonb)
        into ready
        from public.interview_release_status(array(
            select c.id
            from public.interviews c
            join public.leads cl on cl.id = c.lead
            where c.result is not null
              and c.fee_status = 'Paid'
              and cl.status <> 'Declined'
              and cl.closure is null
        )) st
        where st.ready_to_send;
    end if;

    with
    -- The Admission form's children from the last 7 days and today, from the
    -- forms' own record of what each child became.
    form_children as (
        select s.submission_key, s.created_at as sent_at, l.*
        from public.admission_submissions s
        cross join lateral jsonb_each(s.outcomes) o
        join public.leads l on l.id = (o.value ->> 'lead_id')::uuid
        where sees_leads
          and s.created_at >= week_start
          and o.value ->> 'result' = 'created'
    ),
    expected as (
        select
            true as all_day,
            min(c.sent_at) as at,
            'expected'::text as kind,
            c.submission_key::text as id,
            jsonb_build_object(
                'sent_on', (min(c.sent_at) at time zone 'Africa/Dar_es_Salaam')::date,
                'children', jsonb_agg(jsonb_build_object(
                    'lead_id', c.id,
                    'admission_number', c.admission_number,
                    'student_name', c.student_name,
                    'class_name', c.class_name
                ) order by c.created_at, c.id)
            ) as body
        from form_children c
        where c.sent_at < day_start
          and c.created_at < day_start
          and c.status = 'Applied'
          and c.closure is null
        group by c.submission_key
    ),
    new_application as (
        select
            false, c.created_at, 'new_application'::text, c.id::text,
            jsonb_build_object(
                'lead_id', c.id,
                'admission_number', c.admission_number,
                'student_name', c.student_name,
                'class_name', c.class_name,
                'referral_code', c.referral_code,
                'status', c.status,
                'closure', c.closure
            )
        from form_children c
        where c.created_at >= day_start
    ),
    -- Results to send, worked out above (ready).
    result_ready as (
        select
            false, (i.interview_date::timestamp at time zone 'Africa/Dar_es_Salaam'), 'result_ready'::text, i.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'interview_date', i.interview_date,
                'result', i.result,
                'score', i.score,
                'changed_since_sent', st.changed_since_sent
            )
        from jsonb_to_recordset(ready) as st (interview_id uuid, changed_since_sent boolean)
        join public.interviews i on i.id = st.interview_id
        join public.leads l on l.id = i.lead
    ),
    discount_request as (
        select
            false, r.requested_at, 'discount_request'::text, r.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'discount', r.kind,
                'note', r.note,
                'requested_by', requester.full_name
            )
        from public.discount_requests r
        join public.leads l on l.id = r.lead_id
        left join public.staff_members requester on requester.id = r.requested_by
        where sees_leads and r.state = 'pending'
    ),
    agent_claim as (
        select
            false, min(c.created_at), 'agent_claim'::text, a.id::text,
            jsonb_build_object(
                'agent_id', a.id,
                'full_name', a.full_name,
                'code', a.code,
                'claims', count(*)
            )
        from public.marketing_agents a
        cross join lateral public.agent_open_claims(a.id) c
        where sees_claims
          and a.retired_at is null
          and a.switched_off_at is null
          and a.email is null
        group by a.id
    ),
    re_application as (
        select
            false, r.received_at, 're_application'::text, r.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'asked_class', r.class_name,
                'differing_fields', to_jsonb(r.differing_fields)
            )
        from public.re_applications r
        join public.leads l on l.id = r.lead_id
        where sees_leads and r.reviewed_at is null
    ),
    fee_paid as (
        select
            false, p.recorded_at, 'fee_paid'::text, p.id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'payment_type', coalesce(a.payment_type, p.payment_type),
                'amount', case when a.id is null then p.amount else a.amount end,
                'recorded_by', recorder.full_name
            )
        from public.school_fee_payments p
        join public.leads l on l.id = p.lead_id
        left join public.staff_members recorder on recorder.id = p.recorded_by
        left join lateral (
            select x.id, x.voided, x.payment_type, x.amount
            from public.payment_adjustments x
            where x.payment_id = p.id
            order by x.sequence desc
            limit 1
        ) a on true
        where sees_payments
          and p.recorded_at >= day_start
          and not coalesce(a.voided, false)
          and coalesce(a.payment_type, p.payment_type) in
              ('full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment')
    ),
    call_back as (
        select
            false, (q.due_on::timestamp at time zone 'Africa/Dar_es_Salaam'), 'call_back'::text, q.follow_up_id::text,
            jsonb_build_object(
                'lead_id', l.id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'due_on', q.due_on,
                'note', q.note,
                'custodian_name', g.full_name,
                'relationship', l.custodian_relationship,
                'relationship_description', l.custodian_relationship_description
            )
        from public.open_follow_ups() q
        join public.leads l on l.id = q.lead_id
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        where sees_leads and q.due_on <= today
    ),
    activity (all_day, at, kind, id, body) as (
        select * from expected
        union all select * from new_application
        union all select * from result_ready
        union all select * from discount_request
        union all select * from agent_claim
        union all select * from re_application
        union all select * from fee_paid
        union all select * from call_back
    ),
    ordered as (
        select a.*, count(*) over () as total,
               row_number() over (order by a.all_day desc, a.at, a.kind, a.id) as position
        from activity a
    )
    select jsonb_build_object(
        'total', coalesce(max(o.total), 0),
        'rows', coalesce(
            jsonb_agg(
                jsonb_build_object('kind', o.kind, 'id', o.id, 'all_day', o.all_day, 'at', o.at) || o.body
                order by o.position
            ) filter (where o.position > row_offset and o.position <= row_offset::bigint + row_limit),
            '[]'::jsonb
        )
    )
    into result
    from ordered o;

    return result;
end;
$function$;

create or replace function public.export_leads(filters jsonb, columns text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    declare
        staff_id uuid;
        filter_set jsonb := coalesce(export_leads.filters, '{}'::jsonb);
        unknown text;
        tiers text[];
        query_text text;
        admission text;
        status_filter public.lead_status;
        closure_filter text;
        class_filter public.lead_class;
        year_filter integer;
        link_year integer;
        batch_filter uuid;
        found_ids uuid[];
        found_count integer;
        answer jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;
        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        -- The columns: known, each once, every tier held.
        if export_leads.columns is null or cardinality(export_leads.columns) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns')::text;
        end if;
        select c into unknown from unnest(export_leads.columns) c where public.export_column_tier(c) is null limit 1;
        if found or exists (select 1 from unnest(export_leads.columns) c where c is null) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns', 'column', unknown)::text;
        end if;
        if (select count(distinct c) from unnest(export_leads.columns) c) <> cardinality(export_leads.columns) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns')::text;
        end if;
        tiers := array(select distinct public.export_column_tier(c) from unnest(export_leads.columns) c);
        if ('contact' = any (tiers) and not public.has_permission('leads.export'))
           or ('full' = any (tiers) and not public.is_super_admin()) then
            raise exception 'not_permitted';
        end if;

        -- The filters.
        if jsonb_typeof(filter_set) is distinct from 'object' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end if;
        begin
            query_text := nullif(btrim(coalesce(filter_set ->> 'query', '')), '');
            status_filter := (filter_set ->> 'status')::public.lead_status;
            closure_filter := coalesce(filter_set ->> 'closure', 'open');
            class_filter := (filter_set ->> 'class_name')::public.lead_class;
            year_filter := (filter_set ->> 'enrollment_year')::integer;
            link_year := (filter_set ->> 'earlier_link_year')::integer;
            batch_filter := (filter_set ->> 'import_batch_id')::uuid;
        exception when others then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end;
        if closure_filter not in ('open', 'all', 'Inactive', 'Archived') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end if;
        admission := case when query_text ~* '^(ADMSN-)?[0-9]{5}$'
            then 'ADMSN-' || substring(query_text from '([0-9]{5})$') end;

        -- The leads, in the screen's order.
        select coalesce(array_agg(l.id order by
                   case when query_text is not null and admission is null then l.closure is not null end,
                   case when query_text is not null and admission is null then l.student_name_key end,
                   case when query_text is null then l.created_at end desc,
                   l.id desc), '{}')
        into found_ids
        from public.leads l
        where (admission is null or l.admission_number = admission)
          and (query_text is null or admission is not null
               or strpos(l.student_name_key, public.normalize_student_name(query_text)) > 0)
          and (query_text is not null or status_filter is null or l.status = status_filter)
          and (query_text is not null
               or closure_filter = 'all'
               or (closure_filter = 'open' and l.closure is null)
               or l.closure::text = closure_filter)
          and (query_text is not null or link_year is null
               or l.id in (select e.id from public.leads_with_earlier_group_link(link_year) e))
          and (class_filter is null or l.class_name = class_filter)
          and (year_filter is null or l.enrollment_year = year_filter)
          and (batch_filter is null or l.import_batch_id = batch_filter);

        found_count := cardinality(found_ids);
        if found_count > 5000 then
            raise exception 'too_many' using detail = jsonb_build_object('row_count', found_count)::text;
        end if;

        with picked as (
            select l.*, ordinal
            from unnest(found_ids) with ordinality as f (id, ordinal)
            join public.leads l on l.id = f.id
        ),
        values_by_lead as (
            select p.ordinal,
                jsonb_build_object(
                    'admission_number', p.admission_number,
                    'student_name', p.student_name,
                    'class_name', p.class_name::text,
                    'enrollment_year', p.enrollment_year,
                    'day_or_boarding', p.day_or_boarding::text,
                    'gender', p.gender::text,
                    'status', p.status::text,
                    'status_since', coalesce((
                        select max(a.created_at) from public.audit_log a
                        where a.table_name = 'leads' and a.row_id = p.id and a.new_values ? 'status'
                    ), p.created_at),
                    'visit_date', p.visit_date,
                    'discount_code', p.referral_code,
                    'discount_holder', (select d.holder_name from public.code_discount(p.referral_code) d),
                    'pre_form_one', coalesce((select f.pre_form_one from public.lead_fee_profiles f where f.lead_id = p.id), false),
                    'imported', p.import_batch_id is not null
                )
                || case when 'contact' = any (tiers) then (
                    select jsonb_build_object(
                        'guardian_name', g.full_name,
                        -- Each child's own relationship (#312).
                        'relationship', case
                            when p.custodian_relationship = 'Other' then p.custodian_relationship_description
                            else p.custodian_relationship::text
                        end,
                        'guardian_phone', g.phone,
                        'guardian_whatsapp', g.whatsapp
                    )
                    from public.guardian_contacts g where g.id = p.guardian_contact_id
                ) else '{}'::jsonb end
                || case when 'full' = any (tiers) then (
                    select jsonb_build_object(
                        'interview_fee_status', i.fee_status::text,
                        'interview_fee_amount', case
                            when i.id is null then null
                            when i.fee_status = 'Paid' then i.locked_amount
                            else public.interview_fee(false) - coalesce((select d.amount_off from public.lead_code_discount(p.referral_code, p.created_at, p.import_batch_id is not null) d), 0)
                        end,
                        'interview_result', i.result::text,
                        'interview_score', i.score,
                        'school_fee', fee.school_fee,
                        'school_fee_paid', (select c.total_paid from public.lead_fee_crossings(p.id) c),
                        'school_fee_discount', case when fee.discount is not null then fee.discount || ' ' || fee.discount_percent || '%' end,
                        'follow_up_notes', (
                            select string_agg(n.comment, ' | ' order by n.entered_at desc)
                            from (
                                select r.comment, r.entered_at from public.follow_up_records r
                                where r.lead_id = p.id and r.comment is not null
                                order by r.entered_at desc limit 5
                            ) n
                        ),
                        'declined_reason', p.declined_reason::text,
                        'declined_explanation', p.declined_explanation,
                        'closure', p.closure::text,
                        'history_count', (select count(*) from public.audit_log a where a.lead_id = p.id)
                    )
                    from (select 1) one
                    left join lateral (
                        select * from public.interviews iv where iv.lead = p.id
                        order by iv.registered_at desc, iv.serial_number desc limit 1
                    ) i on true
                    cross join lateral public.lead_fee_amounts(p.id) fee
                ) else '{}'::jsonb end as all_values
            from picked p
        )
        select coalesce(jsonb_agg((
                   select jsonb_object_agg(c, v.all_values -> c) from unnest(export_leads.columns) c
               ) order by v.ordinal), '[]'::jsonb)
        into answer
        from values_by_lead v;

        insert into public.export_log (exported_by, kind, columns, row_count, filters)
        values (staff_id, 'students', export_leads.columns, found_count, filter_set);

        return jsonb_build_object('rows', answer, 'row_count', found_count);
    end;
    $function$;

create or replace function public.update_guardian_contact_for_lead(lead_id uuid, contact_id uuid, changes jsonb, expected_lead_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    target public.leads;
    current_phone text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- The Family, then its children (#298), then the source lead, then the
    -- contact. A concurrent closure either wins before these locks, or waits
    -- until the contact correction commits. Reassignment cannot change the
    -- contact between this check and the write either.
    perform public.lock_families(array[update_guardian_contact_for_lead.contact_id]);
    perform 1 from public.leads l
    where l.guardian_contact_id = update_guardian_contact_for_lead.contact_id
    order by l.id
    for update;
    select * into target from public.leads l
    where l.id = update_guardian_contact_for_lead.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);
    if target.guardian_contact_id is distinct from contact_id then
        raise exception 'children_changed';
    end if;

    select c.phone into current_phone from public.guardian_contacts c
    where c.id = contact_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- A single-field Apply must not report success when normalization would
    -- clear the submitted WhatsApp number. Check after any phone edit that
    -- held this contact, while keeping the contact locked through the write.
    if changes ? 'whatsapp' and not (changes ? 'phone')
       and public.normalize_phone(coalesce(changes ->> 'whatsapp', '')) = current_phone then
        raise exception 'phone_first';
    end if;

    -- The relationship it carries is this child's (#312).
    return public.update_guardian_contact(contact_id, changes, expected_lead_ids, update_guardian_contact_for_lead.lead_id);
end;
$function$;
    -- -----------------------------------------------------------------------
    -- Nothing moved.
    -- -----------------------------------------------------------------------

    perform public.assert_fee_snapshot_unchanged('pg_temp.relationship_snapshot_before');
    drop table pg_temp.relationship_snapshot_before;
    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
