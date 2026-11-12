-- Sibling counts, the group explanation and the invariant check (#306, spec
-- #296, align brief S1, S3, S4, S5, S9, R11, R38, R43). Read-only: nothing
-- here writes a fee, a result, a request or a status, and nothing calls these
-- from a screen yet (#310 and #311 do).
--
-- 1. Three count readers, each behind the permission that already guards
--    what it reads. Each takes an optional enrollment year (null: every
--    year) and returns the count with the rows behind it, so a list never
--    disagrees with its number.
--
--    sibling_lead_counts(year), leads.view:
--      typo_confirmed   members whose basis is `typo_confirmed` now, each
--                       with the staff member who set it (the newest audit
--                       entry that wrote that basis), counted by staff
--                       member. As latest_result_release does, this reads
--                       one fact from the history, never the history itself.
--      previous_school  open leads (not Declined, no closure mark) in a class
--                       that is asked for the previous school (STD 2 and
--                       above) whose answer is "Not known yet" or missing.
--
--    sibling_fee_counts(year), payments.view:
--      fee_edits             every saved manual Sibling fee edit, by reason
--                            and by accountant (sibling_fee_edits, read with
--                            payments.view).
--      kept_ten              open leads holding a 10% kept when leaving
--                            legacy (source `legacy`).
--      enrolled_ten_no_full  open Enrolled leads whose discount is the Sibling
--                            10%, fixed at enrolment, whose group has no
--                            anchor: no other counting member Enrolled without
--                            the 10%. Leaves out a 10% set by hand (a person
--                            already chose it, with a reason in the log) and
--                            the prior-sibling tick (the sibling is the tick's).
--      fee_edit_needed       granted Sibling requests marked "Granted: fee
--                            edit needed". Closed leads stay in, because the
--                            Accountant can still dismiss one.
--    The Accountant's lists show a lead only while the Accountant can act on
--    it: edit_sibling_fee refuses a closed lead.
--
--    sibling_request_counts(year), discounts.approve: every Pending Sibling
--    request, oldest first, with the days it has waited (Tanzania dates),
--    the same rows pending_sibling_requests lists.
--
-- 2. explain_sibling_group(lead_id), leads.view: the lead's group (or the
--    lead alone) with, for each member, a reason code, secondary notes and
--    the facts a sentence needs: who (lead ids and student names), which
--    sibling, which request. No sentences: those are screen copy (#310,
--    #311). It builds on sibling_group_results' reason codes. Fee figures
--    stay out; the two fee facts (whether the full payer still has the
--    highest fee, and the latest manual edit) are given only to staff with
--    payments.view, and are null otherwise.
--
-- 3. sibling_invariant_breaks(year): every broken invariant among the leads
--    of a year and the other members of their groups (a group may span
--    years), for the integration suite. Internal. It looks for two
--    automatic full payers in a group, an automatic full result on a member
--    that isn't the stored full payer, an automatic 10% with no counting
--    sibling, a result fixed at enrolment changed without a manual source,
--    an Enrolled lead with no fixed result, a stored full payer that no
--    longer counts, and an automatic result out of step with the rule.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. It snapshots every fee first and compares at the
-- end; any difference raises and nothing is applied.
--
-- Rollback: a new migration dropping the functions below. Nothing else
-- reads them.

do $migration$
begin
    perform public.set_audit_actor('system');

    drop table if exists pg_temp.sibling_counts_snapshot_before;
    create temp table sibling_counts_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- Shared pieces. Internal.
    -- -----------------------------------------------------------------------

    -- sibling_group_anchors(group_id, except_lead_id): the group's anchors
    -- (S1 rule 1), as sibling_rule_result finds them: counting members that
    -- are Enrolled, have no closure mark, and don't hold the 10% or hold a
    -- larger discount. Oldest fixed result first. Internal.
    create function public.sibling_group_anchors(group_id uuid, except_lead_id uuid default null)
    returns uuid[]
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(array_agg(s.id order by r.locked_at nulls last, s.id), '{}')
        from public.sibling_group_members o
        join public.leads s on s.id = o.lead_id
        left join public.lead_sibling_results r on r.lead_id = s.id
        where sibling_group_anchors.group_id is not null
          and o.group_id = sibling_group_anchors.group_id
          and o.lead_id is distinct from sibling_group_anchors.except_lead_id
          and s.status = 'Enrolled'
          and s.closure is null
          and (o.legacy or public.sibling_basis_counts(o.basis))
          and (
              coalesce(r.result, 'none') <> 'ten'
              or exists (
                  select 1 from public.discount_requests d
                  where d.lead_id = s.id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
              )
          );
    $fn$;

    revoke execute on function public.sibling_group_anchors(uuid, uuid) from public, anon, authenticated, service_role;

    -- sibling_result_out_of_step(lead_id): whether a lead's stored result
    -- differs from what refresh_sibling_result would write now. A manual or
    -- kept (`legacy`) result is never out of step; while grants are paused,
    -- `none` stands where the rule would give a new automatic 10%. Internal.
    create function public.sibling_result_out_of_step(lead_id uuid)
    returns boolean
    language sql
    stable
    set search_path = ''
    as $fn$
        select case
                   when coalesce(r.source::text, 'auto') in ('manual', 'legacy') then false
                   else (coalesce(r.result, 'none'), coalesce(r.source, 'auto')) is distinct from (a.result, a.source)
                        and not (a.result = 'ten' and a.source = 'auto' and public.sibling_grants_paused()
                                 and coalesce(r.result, 'none') = 'none' and coalesce(r.source, 'auto') = 'auto')
               end
        from (select 1) one
        left join public.lead_sibling_results r on r.lead_id = sibling_result_out_of_step.lead_id
        cross join lateral public.sibling_rule_result(sibling_result_out_of_step.lead_id) a;
    $fn$;

    revoke execute on function public.sibling_result_out_of_step(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The counts.
    -- -----------------------------------------------------------------------

    -- sibling_lead_counts(year): typo-confirmed matches by staff member and
    -- previous schools still to add. Needs leads.view.
    create function public.sibling_lead_counts(year integer default null)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        typo jsonb;
        school jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;

        with confirmed as (
            select m.lead_id, m.group_id, who.actor_staff_id as staff_id, who.created_at as confirmed_at
            from public.sibling_group_members m
            join public.leads l on l.id = m.lead_id
            left join lateral (
                select a.actor_staff_id, a.created_at
                from public.audit_log a
                where a.table_name = 'sibling_group_members'
                  and a.row_id = m.id
                  and a.new_values ->> 'basis' = 'typo_confirmed'
                order by a.created_at desc, a.id desc
                limit 1
            ) who on true
            where m.basis = 'typo_confirmed'
              and (sibling_lead_counts.year is null or l.enrollment_year = sibling_lead_counts.year)
        ),
        by_staff as (
            select c.staff_id, s.full_name, count(*)::integer as n
            from confirmed c
            left join public.staff_members s on s.id = c.staff_id
            group by c.staff_id, s.full_name
        )
        select jsonb_build_object(
                   'count', (select count(*) from confirmed),
                   'by_staff', coalesce((
                       select jsonb_agg(jsonb_build_object('staff_id', b.staff_id, 'staff_name', b.full_name, 'count', b.n)
                                        order by b.n desc, b.full_name nulls last, b.staff_id)
                       from by_staff b
                   ), '[]'::jsonb),
                   'members', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'lead_id', c.lead_id, 'group_id', c.group_id,
                                  'staff_id', c.staff_id, 'confirmed_at', c.confirmed_at
                              ) order by c.confirmed_at desc nulls last, c.lead_id)
                       from confirmed c
                   ), '[]'::jsonb)
               )
        into typo;

        with asked as (
            select l.id, l.previous_school_not_known as not_known
            from public.leads l
            where public.previous_school_asked(l.class_name)
              and l.status <> 'Declined' and l.closure is null
              and (l.previous_school_not_known
                   or public.previous_school_answer_missing(l.class_name, l.previous_school_name, l.previous_school_not_known))
              and (sibling_lead_counts.year is null or l.enrollment_year = sibling_lead_counts.year)
        )
        select jsonb_build_object(
                   'count', (select count(*) from asked),
                   'not_known', (select count(*) from asked where not_known),
                   'missing', (select count(*) from asked where not not_known),
                   'not_known_lead_ids', coalesce((select jsonb_agg(id order by id) from asked where not_known), '[]'::jsonb),
                   'missing_lead_ids', coalesce((select jsonb_agg(id order by id) from asked where not not_known), '[]'::jsonb)
               )
        into school;

        return jsonb_build_object('typo_confirmed', typo, 'previous_school', school);
    end;
    $fn$;

    revoke execute on function public.sibling_lead_counts(integer) from public, anon;
    grant execute on function public.sibling_lead_counts(integer) to authenticated;

    -- sibling_fee_counts(year): the Accountant's counts. Needs payments.view.
    create function public.sibling_fee_counts(year integer default null)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        edits jsonb;
        kept jsonb;
        no_full jsonb;
        needed jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.view') then
            raise exception 'not_permitted';
        end if;

        with made as (
            select e.id, e.lead_id, e.staff_id, e.value, e.reason, e.created_at
            from public.sibling_fee_edits e
            join public.leads l on l.id = e.lead_id
            where sibling_fee_counts.year is null or l.enrollment_year = sibling_fee_counts.year
        )
        select jsonb_build_object(
                   'count', (select count(*) from made),
                   'by_reason', (
                       select jsonb_object_agg(x.reason::text, (select count(*) from made m where m.reason = x.reason))
                       from unnest(enum_range(null::public.sibling_fee_edit_reason)) x(reason)
                   ),
                   'by_staff', coalesce((
                       select jsonb_agg(jsonb_build_object('staff_id', b.staff_id, 'staff_name', b.full_name, 'count', b.n)
                                        order by b.n desc, b.full_name, b.staff_id)
                       from (
                           select m.staff_id, s.full_name, count(*)::integer as n
                           from made m join public.staff_members s on s.id = m.staff_id
                           group by m.staff_id, s.full_name
                       ) b
                   ), '[]'::jsonb),
                   'edits', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'edit_id', m.id, 'lead_id', m.lead_id, 'staff_id', m.staff_id,
                                  'value', m.value, 'reason', m.reason, 'created_at', m.created_at
                              ) order by m.created_at desc, m.id)
                       from made m
                   ), '[]'::jsonb)
               )
        into edits;

        with holding as (
            select l.id
            from public.lead_sibling_results r
            join public.leads l on l.id = r.lead_id
            where r.source = 'legacy' and r.result = 'ten'
              and l.status <> 'Declined' and l.closure is null
              and (sibling_fee_counts.year is null or l.enrollment_year = sibling_fee_counts.year)
        )
        select jsonb_build_object(
                   'count', (select count(*) from holding),
                   'lead_ids', coalesce((select jsonb_agg(id order by id) from holding), '[]'::jsonb)
               )
        into kept;

        with alone as (
            select l.id
            from public.lead_sibling_results r
            join public.leads l on l.id = r.lead_id
            left join public.lead_fee_profiles p on p.lead_id = l.id
            cross join lateral public.lead_discount(l.id) d
            where l.status = 'Enrolled' and l.closure is null
              and r.result = 'ten' and r.locked_result = 'ten' and r.source <> 'manual'
              and not coalesce(p.prior_sibling, false)
              and d.discount = 'sibling'
              and cardinality(public.sibling_group_anchors(public.lead_sibling_group(l.id), l.id)) = 0
              and (sibling_fee_counts.year is null or l.enrollment_year = sibling_fee_counts.year)
        )
        select jsonb_build_object(
                   'count', (select count(*) from alone),
                   'lead_ids', coalesce((select jsonb_agg(id order by id) from alone), '[]'::jsonb)
               )
        into no_full;

        with waiting as (
            select d.id, d.lead_id, d.decided_at, l.status <> 'Declined' and l.closure is null as lead_open
            from public.discount_requests d
            join public.leads l on l.id = d.lead_id
            where d.fee_edit = 'needed'
              and (sibling_fee_counts.year is null or l.enrollment_year = sibling_fee_counts.year)
        )
        select jsonb_build_object(
                   'count', (select count(*) from waiting),
                   'requests', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'request_id', w.id, 'lead_id', w.lead_id, 'decided_at', w.decided_at, 'lead_open', w.lead_open
                              ) order by w.decided_at, w.id)
                       from waiting w
                   ), '[]'::jsonb)
               )
        into needed;

        return jsonb_build_object(
            'fee_edits', edits,
            'kept_ten', kept,
            'enrolled_ten_no_full', no_full,
            'fee_edit_needed', needed
        );
    end;
    $fn$;

    revoke execute on function public.sibling_fee_counts(integer) from public, anon;
    grant execute on function public.sibling_fee_counts(integer) to authenticated;

    -- sibling_request_counts(year): Pending Sibling requests by age. Needs
    -- discounts.approve.
    create function public.sibling_request_counts(year integer default null)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('discounts.approve') then
            raise exception 'not_permitted';
        end if;

        return (
            with waiting as (
                select d.id, d.lead_id, d.requested_at,
                       public.tanzania_today() - (d.requested_at at time zone 'Africa/Dar_es_Salaam')::date as days,
                       l.status <> 'Declined' and l.closure is null as lead_open
                from public.discount_requests d
                join public.leads l on l.id = d.lead_id
                where d.kind = 'sibling' and d.state = 'pending'
                  and (sibling_request_counts.year is null or l.enrollment_year = sibling_request_counts.year)
            )
            select jsonb_build_object('pending', jsonb_build_object(
                       'count', (select count(*) from waiting),
                       'oldest_requested_at', (select min(requested_at) from waiting),
                       'requests', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'request_id', w.id, 'lead_id', w.lead_id, 'requested_at', w.requested_at,
                                      'days_waiting', w.days, 'lead_open', w.lead_open
                                  ) order by w.requested_at, w.id)
                           from waiting w
                       ), '[]'::jsonb)
                   ))
        );
    end;
    $fn$;

    revoke execute on function public.sibling_request_counts(integer) from public, anon;
    grant execute on function public.sibling_request_counts(integer) to authenticated;

    -- -----------------------------------------------------------------------
    -- The explanation.
    -- -----------------------------------------------------------------------

    -- explain_sibling_group(lead_id): why each member of the lead's group
    -- (or the lead alone, when it has none) holds its Sibling result. Needs
    -- leads.view. Returns
    --   {"lead_id", "group_id", "all_legacy", "full_payer_lead_id",
    --    "anchors": [lead ids], "grants_paused",
    --    "members": [{"lead_id", "student_name", "class_name", "status",
    --                 "lead_open", "legacy", "basis", "sibling_of_lead_id",
    --                 "full_payer", "result", "source", "locked_result",
    --                 "reason", "notes": [codes], "because_of": [lead ids],
    --                 "pending_request", "decided_request",
    --                 "larger_discount", "highest_fee", "fee_edit"}]}
    -- Reason codes, one per member:
    --   manual_full, manual_ten        set by hand (#303)
    --   kept_when_leaving_legacy       a 10% kept when leaving legacy (R38)
    --   prior_sibling                  the prior-sibling tick
    --   enrolled_full                  Enrolled, fixed at the full fee
    --   enrolled_ten_anchor            Enrolled with the 10%; a sibling is
    --                                  Enrolled at full (because_of)
    --   enrolled_ten_full_payer_waiting  Enrolled with the 10%; the full
    --                                  payer (because_of) has not enrolled
    --   enrolled_ten_no_full           Enrolled with the 10%; nobody pays full
    --   locked_not_enrolled            fixed at enrolment, out of Enrolled
    --                                  since (a payment correction)
    --   enrolled_unlocked              Enrolled with nothing fixed (an
    --                                  invariant break)
    --   no_family                      no confirmed Family (no contact, or a
    --                                  Family match is pending)
    --   on_own                         in no sibling group
    --   legacy_sibling_enrolled        legacy, 10%: a sibling is Enrolled
    --                                  (because_of)
    --   legacy_no_sibling_enrolled     legacy, no sibling Enrolled yet
    --   request_pending                names differ, a Sibling request waits
    --                                  (because_of: the sibling it names)
    --   request_needed                 names differ, no request waits
    --   request_refused                the request was refused (because_of)
    --   declined, closed               the member doesn't count
    --   anchor                         10%: a sibling is Enrolled without
    --                                  the 10% (because_of)
    --   full_payer                     the stored full payer; highest_fee
    --                                  says whether it still has the highest
    --                                  fee (null without payments.view)
    --   full_payer_sibling             10%: the full payer (because_of)
    --                                  pays full
    --   no_full_payer                  counts, but no anchor and no full payer
    -- Notes, any number per member:
    --   granted                        counts by a granted Sibling request
    --   request_pending                a Sibling request waits on the lead
    --   fee_edit_needed                "Granted: fee edit needed"
    --   larger_discount                Staff child or Qualified orphan
    --                                  replaces the 10% (larger_discount)
    --   prior_sibling_tick             the prior-sibling tick is set
    --   grants_paused                  the kill switch holds back the 10%
    --   result_out_of_step             the stored result isn't what the rule
    --                                  gives now (an invariant break)
    create function public.explain_sibling_group(lead_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
        fees_visible boolean;
        own_group uuid;
        grp public.sibling_groups;
        paused boolean := public.sibling_grants_paused();
        group_anchors uuid[] := '{}';
        mem record;
        target public.leads;
        stored public.lead_sibling_results;
        answer record;
        tick boolean;
        pending public.discount_requests;
        decided public.discount_requests;
        larger text;
        needed boolean;
        my_anchors uuid[];
        enrolled_siblings uuid[];
        payer_waiting boolean;
        code text;
        notes text[];
        because uuid[];
        highest boolean;
        last_edit jsonb;
        members jsonb := '[]'::jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;
        if not exists (select 1 from public.leads l where l.id = explain_sibling_group.lead_id) then
            raise exception 'not_found';
        end if;
        fees_visible := public.has_permission('payments.view');

        own_group := public.lead_sibling_group(explain_sibling_group.lead_id);
        if own_group is not null then
            select * into grp from public.sibling_groups g where g.id = own_group;
            group_anchors := public.sibling_group_anchors(own_group);
        end if;

        for mem in
            select x.lead_id, x.legacy, x.basis, x.full_payer, x.reason
            from public.sibling_group_results(own_group) x
            where own_group is not null
            union all
            select l.id, false, null, false,
                   case when r.source = 'manual' then 'manual'
                        when r.source = 'legacy' then 'kept_when_leaving_legacy'
                        else a.reason end
            from public.leads l
            left join public.lead_sibling_results r on r.lead_id = l.id
            cross join lateral public.sibling_rule_result(l.id) a
            where own_group is null and l.id = explain_sibling_group.lead_id
            order by 1
        loop
            select * into target from public.leads l where l.id = mem.lead_id;
            select * into stored from public.lead_sibling_results r where r.lead_id = mem.lead_id;
            select * into answer from public.sibling_rule_result(mem.lead_id);
            select coalesce(p.prior_sibling, false) into tick
            from (select 1) one left join public.lead_fee_profiles p on p.lead_id = mem.lead_id;

            pending := null;
            select * into pending from public.discount_requests d
            where d.lead_id = mem.lead_id and d.kind = 'sibling' and d.state = 'pending'
            order by d.requested_at desc, d.id limit 1;
            decided := null;
            select * into decided from public.discount_requests d
            where d.lead_id = mem.lead_id and d.kind = 'sibling' and d.state <> 'pending'
            order by d.decided_at desc, d.id limit 1;
            select d.discount into larger from public.lead_discount(mem.lead_id) d;
            larger := case when larger in ('staff_child', 'qualified_orphan') then larger end;
            needed := exists (
                select 1 from public.discount_requests d
                where d.lead_id = mem.lead_id and d.kind = 'sibling' and d.state = 'granted' and d.fee_edit = 'needed'
            );

            my_anchors := array_remove(group_anchors, mem.lead_id);
            enrolled_siblings := array(
                select o.lead_id
                from public.sibling_group_members o
                join public.leads s on s.id = o.lead_id
                left join public.lead_sibling_results rs on rs.lead_id = s.id
                where own_group is not null and o.group_id = own_group and o.lead_id <> mem.lead_id
                  and s.status = 'Enrolled' and (o.legacy or public.sibling_basis_counts(o.basis))
                order by rs.locked_at nulls last, s.id
            );
            -- The full payer as sibling_rule_result counts it for its
            -- siblings: not legacy, counting, open, not yet Enrolled, and
            -- never Enrolled (one out of Enrolled since a payment correction
            -- keeps its fixed result and pays nobody's place).
            payer_waiting := grp.full_payer_lead_id is not null
                and grp.full_payer_lead_id <> mem.lead_id
                and exists (
                    select 1
                    from public.sibling_group_members o
                    join public.leads s on s.id = o.lead_id
                    where o.lead_id = grp.full_payer_lead_id and o.group_id = own_group
                      and not o.legacy
                      and public.sibling_basis_counts(o.basis)
                      and s.status not in ('Enrolled', 'Declined') and s.closure is null
                      and not exists (
                          select 1 from public.lead_sibling_results rp
                          where rp.lead_id = s.id and rp.locked_result is not null
                      )
                );

            code := case
                when stored.source = 'manual' then 'manual_' || stored.result::text
                when stored.source = 'legacy' then 'kept_when_leaving_legacy'
                -- The tick explains a 10%, also once enrolment has fixed it.
                when stored.source = 'prior_sibling' or (tick and stored.result = 'ten') then 'prior_sibling'
                when stored.locked_result is not null and target.status = 'Enrolled' then
                    case
                        when stored.locked_result = 'full' then 'enrolled_full'
                        when cardinality(my_anchors) > 0 then 'enrolled_ten_anchor'
                        when payer_waiting then 'enrolled_ten_full_payer_waiting'
                        else 'enrolled_ten_no_full'
                    end
                when stored.locked_result is not null then 'locked_not_enrolled'
                else case mem.reason
                    when 'no_group' then 'on_own'
                    when 'enrolled' then 'enrolled_unlocked'
                    when 'locked' then 'locked_not_enrolled'
                    when 'legacy_enrolled_sibling' then 'legacy_sibling_enrolled'
                    when 'legacy_no_enrolled_sibling' then 'legacy_no_sibling_enrolled'
                    when 'basis_request_needed' then case when pending.id is not null then 'request_pending' else 'request_needed' end
                    when 'basis_refused' then 'request_refused'
                    else mem.reason
                end
            end;

            because := case code
                when 'enrolled_ten_anchor' then my_anchors
                when 'anchor' then my_anchors
                when 'legacy_sibling_enrolled' then enrolled_siblings
                when 'full_payer_sibling' then array[grp.full_payer_lead_id]
                when 'enrolled_ten_full_payer_waiting' then array[grp.full_payer_lead_id]
                when 'request_pending' then array_remove(array[pending.sibling_of_lead_id], null)
                when 'request_refused' then
                    case when decided.state = 'refused' then array_remove(array[decided.sibling_of_lead_id], null) else '{}' end
                else '{}'
            end;

            notes := '{}';
            if mem.basis = 'granted' then notes := notes || 'granted'::text; end if;
            if pending.id is not null then notes := notes || 'request_pending'::text; end if;
            if needed then notes := notes || 'fee_edit_needed'::text; end if;
            if larger is not null then notes := notes || 'larger_discount'::text; end if;
            if tick then notes := notes || 'prior_sibling_tick'::text; end if;
            if paused and answer.result = 'ten' and answer.source = 'auto'
               and coalesce(stored.result, 'none') <> 'ten' and coalesce(stored.source::text, 'auto') = 'auto' then
                notes := notes || 'grants_paused'::text;
            end if;
            if public.sibling_result_out_of_step(mem.lead_id) then
                notes := notes || 'result_out_of_step'::text;
            end if;

            -- Whether the full payer still has the highest School fee before
            -- discount among the members ranked for the place. Fees need
            -- payments.view.
            highest := null;
            if code = 'full_payer' and fees_visible then
                select coalesce(
                           (select f.band_fee from public.lead_fee_amounts(mem.lead_id) f)
                           >= coalesce(max(fee.band_fee), 0),
                           false)
                into highest
                from public.sibling_group_members o
                join public.leads s on s.id = o.lead_id
                left join public.lead_sibling_results rs on rs.lead_id = s.id
                cross join lateral public.lead_fee_amounts(s.id) fee
                where o.group_id = own_group and o.lead_id <> mem.lead_id
                  and (o.legacy or public.sibling_basis_counts(o.basis))
                  and s.status not in ('Enrolled', 'Declined') and s.closure is null
                  and coalesce(rs.source::text, 'auto') <> 'manual'
                  and rs.locked_result is null
                  and not exists (
                      select 1 from public.discount_requests d
                      where d.lead_id = s.id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
                  );
            end if;

            last_edit := null;
            if fees_visible then
                select jsonb_build_object(
                           'edit_id', e.id, 'value', e.value, 'reason', e.reason, 'created_at', e.created_at,
                           'staff_id', e.staff_id, 'staff_name', s.full_name
                       )
                into last_edit
                from public.sibling_fee_edits e
                join public.staff_members s on s.id = e.staff_id
                where e.lead_id = mem.lead_id
                order by e.created_at desc, e.id
                limit 1;
            end if;

            members := members || jsonb_build_array(jsonb_build_object(
                'lead_id', target.id,
                'student_name', target.student_name,
                'class_name', target.class_name,
                'status', target.status,
                'lead_open', target.status <> 'Declined' and target.closure is null,
                'legacy', mem.legacy,
                'basis', mem.basis,
                'sibling_of_lead_id', (select m.sibling_of_lead_id from public.sibling_group_members m where m.lead_id = target.id),
                'full_payer', mem.full_payer,
                'result', coalesce(stored.result, 'none'),
                'source', coalesce(stored.source, 'auto'),
                'locked_result', stored.locked_result,
                'reason', code,
                'notes', to_jsonb(notes),
                'because_of', to_jsonb(because),
                'pending_request', case when pending.id is null then null else jsonb_build_object(
                    'request_id', pending.id,
                    'sibling_of_lead_id', pending.sibling_of_lead_id,
                    'across_groups', pending.merge_from_group_id is not null,
                    'requested_at', pending.requested_at
                ) end,
                'decided_request', case when decided.id is null then null else jsonb_build_object(
                    'request_id', decided.id,
                    'state', decided.state,
                    'sibling_of_lead_id', decided.sibling_of_lead_id,
                    'decided_at', decided.decided_at,
                    'fee_edit', decided.fee_edit
                ) end,
                'larger_discount', larger,
                'highest_fee', highest,
                'fee_edit', last_edit
            ));
        end loop;

        return jsonb_build_object(
            'lead_id', explain_sibling_group.lead_id,
            'group_id', own_group,
            'all_legacy', case when own_group is null then null else not exists (
                select 1 from public.sibling_group_members m where m.group_id = own_group and not m.legacy
            ) end,
            'full_payer_lead_id', grp.full_payer_lead_id,
            'anchors', to_jsonb(group_anchors),
            'grants_paused', paused,
            'members', members
        );
    end;
    $fn$;

    revoke execute on function public.explain_sibling_group(uuid) from public, anon;
    grant execute on function public.explain_sibling_group(uuid) to authenticated;

    -- -----------------------------------------------------------------------
    -- The invariant check.
    -- -----------------------------------------------------------------------

    -- sibling_invariant_breaks(year): one row per broken invariant among the
    -- leads of `year` (null: every lead). Internal: the integration suite
    -- calls it as the database owner.
    create function public.sibling_invariant_breaks(year integer default null)
    returns table (kind text, group_id uuid, lead_id uuid, detail jsonb)
    language sql
    stable
    set search_path = ''
    as $fn$
        -- The year's leads, and every member of a group one of them is in:
        -- a group may span years, and its invariants hold group-wide.
        with in_year as (
            select l.*
            from public.leads l
            where sibling_invariant_breaks.year is null
               or l.enrollment_year = sibling_invariant_breaks.year
               or exists (
                   select 1
                   from public.sibling_group_members m
                   join public.sibling_group_members o on o.group_id = m.group_id
                   join public.leads y on y.id = o.lead_id
                   where m.lead_id = l.id and m.group_id is not null
                     and y.enrollment_year = sibling_invariant_breaks.year
               )
        ),
        results as (
            select l.id as lead_id, l.status, l.closure, r.result, r.source, r.locked_result,
                   m.group_id, m.legacy, m.basis
            from in_year l
            join public.lead_sibling_results r on r.lead_id = l.id
            left join public.sibling_group_members m on m.lead_id = l.id
        )
        -- Two members of one group paying full by the rule.
        select 'two_auto_full_payers', x.group_id, null::uuid,
               jsonb_build_object('lead_ids', jsonb_agg(x.lead_id order by x.lead_id))
        from results x
        where x.group_id is not null and x.result = 'full' and x.source = 'auto'
        group by x.group_id
        having count(*) > 1
        union all
        -- A full result by the rule on a member that isn't the stored full payer.
        select 'auto_full_not_full_payer', x.group_id, x.lead_id, '{}'::jsonb
        from results x
        left join public.sibling_groups g on g.id = x.group_id
        where x.result = 'full' and x.source = 'auto'
          and g.full_payer_lead_id is distinct from x.lead_id
        union all
        -- An automatic 10% with no other member that counts: for a legacy
        -- member an Enrolled one (today's rule), otherwise one that is open.
        select 'ten_without_counting_sibling', x.group_id, x.lead_id, '{}'::jsonb
        from results x
        where x.result = 'ten' and x.source = 'auto'
          and not exists (
              select 1
              from public.sibling_group_members o
              join public.leads s on s.id = o.lead_id
              where x.group_id is not null and o.group_id = x.group_id and o.lead_id <> x.lead_id
                and (o.legacy or public.sibling_basis_counts(o.basis))
                and case when x.legacy then s.status = 'Enrolled'
                         else s.status <> 'Declined' and s.closure is null end
          )
        union all
        -- A result fixed at enrolment changed by anything but a manual edit
        -- (the prior-sibling tick may still give 10% over a full lock).
        select 'enrolled_result_changed', x.group_id, x.lead_id,
               jsonb_build_object('locked_result', x.locked_result, 'result', x.result, 'source', x.source)
        from results x
        where x.locked_result is not null
          and x.source <> 'manual'
          and x.result is distinct from x.locked_result
          and not (x.source = 'prior_sibling' and x.result = 'ten')
        union all
        -- An Enrolled lead with nothing fixed.
        select 'enrolled_without_lock', m.group_id, l.id, '{}'::jsonb
        from in_year l
        left join public.lead_sibling_results r on r.lead_id = l.id
        left join public.sibling_group_members m on m.lead_id = l.id
        where l.status = 'Enrolled' and r.locked_result is null
        union all
        -- A stored full payer that choose_full_payer would replace: out of the
        -- group, not counting, Declined, closed or holding a manual 10%.
        select 'full_payer_not_counting', g.id, g.full_payer_lead_id, '{}'::jsonb
        from public.sibling_groups g
        left join public.sibling_group_members m on m.lead_id = g.full_payer_lead_id and m.group_id = g.id
        left join public.leads l on l.id = g.full_payer_lead_id
        left join public.lead_sibling_results r on r.lead_id = g.full_payer_lead_id
        where g.full_payer_lead_id is not null
          and exists (select 1 from in_year y where y.id = g.full_payer_lead_id)
          and (
              m.id is null
              or not (m.legacy or public.sibling_basis_counts(m.basis))
              or l.status = 'Declined' or l.closure is not null
              or (r.source = 'manual' and r.result <> 'full')
          )
        union all
        -- A stored result that isn't what the rule gives now.
        select 'result_out_of_step', m.group_id, l.id,
               jsonb_build_object('result', coalesce(r.result, 'none'), 'source', coalesce(r.source, 'auto'),
                                  'rule_result', a.result, 'rule_source', a.source, 'rule_reason', a.reason)
        from in_year l
        left join public.lead_sibling_results r on r.lead_id = l.id
        left join public.sibling_group_members m on m.lead_id = l.id
        cross join lateral public.sibling_rule_result(l.id) a
        where public.sibling_result_out_of_step(l.id);
    $fn$;

    revoke execute on function public.sibling_invariant_breaks(integer) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Migration-day check: nothing moved.
    -- -----------------------------------------------------------------------

    perform public.assert_fee_snapshot_unchanged('pg_temp.sibling_counts_snapshot_before');
    drop table pg_temp.sibling_counts_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
