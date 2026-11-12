-- The manual Sibling fee edit and its preview (#303, spec #296, align brief
-- S1 rule 3, S1b, S3, S4, R42, R43). No screen calls them yet; #311 does.
-- Fees, discounts, statuses and seat counts do not move on migration day:
-- nothing here writes a lead's result until the Accountant saves an edit.
--
-- 1. edit_sibling_fee(lead_id, value, reason, note, request_id), for staff
--    with payments.record (the Accountant template). No new permission. It
--    sets the lead's Sibling result by hand:
--      full       Full fee: result `full`, source `manual`;
--      ten        10%: result `ten`, source `manual`;
--      automatic  Back to automatic: the rule's answer again. For a lead
--                 with a result fixed at enrolment that is the fixed result
--                 (source `locked`), never a fresh calculation; otherwise
--                 the group rule as it stands. Allowed only on a manual
--                 value or a 10% kept when leaving legacy (source `legacy`,
--                 cause `left_legacy`, #301), the two results no recompute
--                 rewrites.
--    A reason is required, one of full_fee_sibling_not_enrolled,
--    sibling_proof_after_enrolment and data_entry_correction; a note is
--    optional. An edit that changes nothing (the same manual value again,
--    or Back to automatic on a result that is automatic) is refused as
--    `unchanged`. The lead must be open (not Declined, no closure mark), as
--    for a discount decision. request_id makes a retry safe: the same id
--    with the same edit hands back the first answer, and with another edit
--    it is refused as `request_reused`.
--
-- 2. Afterwards Seat priority and Enrolled are recomputed, as after a
--    payment adjustment: the lead itself when it is Enrolled or in no group,
--    then its group (recompute_sibling_group, cause `sibling`). The
--    group recompute chooses a new full payer, among members not yet
--    Enrolled, when the stored one now holds a manual 10%, and recomputes
--    every member not yet Enrolled. A stored full payer set to Full fee by
--    hand keeps the place (choose_full_payer below): it still pays full,
--    and choosing another would charge a second sibling full too. Manual
--    members are never ranked for the place. An Enrolled sibling's result
--    never changes: only the edited lead's own result is written by hand.
--    The largest-discount rule still applies, because lead_discount still
--    takes the highest percent: a manual 10% does not beat Staff child 25%.
--
-- 3. preview_sibling_fee_edit(lead_id, value), for the same staff: the same
--    edit, run in a subtransaction that is then rolled back, so it lists
--    exactly what the save would change, and saves nothing. Both return
--      {"result": "preview" | "saved", "lead_id", "value",
--       "old": {"result", "source"}, "new": {"result", "source"},
--       "changes": [{"lead_id", "edited", "school_fee_change",
--                    "before": {...}, "after": {...}}]}
--    where each change is a lead (the edited one or a sibling) whose School
--    fee, discount, instalments, status or Seat priority moves, with the
--    values before and after. The save also returns "edit_id".
--
-- 4. Audit (S3). Every saved edit is a row in sibling_fee_edits: who
--    (staff_id), when (created_at), the old and new result and source, the
--    value, the reason, the note and the changes. The audit trigger puts it
--    in the lead's history, next to the lead_sibling_results change it
--    made. Nobody writes the table through the API.
--
-- 5. A manual value is kept at enrolment. lock_sibling_result fixes the
--    result a lead holds when it becomes Enrolled; for a manual value it now
--    stores the fixed result and leaves the result and source as they are,
--    so the history still says the value was set by hand. Back to automatic
--    on that lead then restores the same fixed result.
--
-- 6. The kill switch (set_sibling_grants_paused). The pause stops the
--    rule's new automatic 10% only. It never changes a manual value, and the
--    Accountant may still save a manual 10% while it is on: that is a
--    person's decision with a reason, like the prior-sibling tick, not the
--    rule's. Back to automatic while paused follows the pause: a lead that
--    does not already hold an automatic 10% gets no new one.
--
-- 7. "Granted: fee edit needed" (S4) is set by #302's Sibling request
--    grant. A saved 10% closes it as applied, through
--    clear_sibling_fee_edit_needed(lead_id, reason) and #302's
--    close_sibling_fee_edit, with the edit's reason. A Full fee or Back to
--    automatic leaves it open, and a save that fails closes nothing.
--
-- Lock order is unchanged: Family locks (lock_lead_family takes the lead's
-- Family lock, every contact its group reaches and the group's lock), then
-- the lead's row, then its result row. A busy contact found under the locks
-- raises `unavailable` (40001) and the caller retries, as in #301.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. It snapshots every fee first and compares the
-- snapshot at the end; any difference raises and nothing is applied.
--
-- Rollback: a new migration dropping the two RPCs, putting back
-- lock_sibling_result from 20261211100100, and turning any manual result
-- back to automatic with a reason recorded.

do $migration$
begin
    perform public.set_audit_actor('system');

    lock table public.leads, public.lead_sibling_results, public.sibling_groups, public.sibling_group_members
        in share row exclusive mode;

    drop table if exists pg_temp.sibling_fee_edit_snapshot_before;
    create temp table sibling_fee_edit_snapshot_before as select * from public.fee_snapshot();

    -- -----------------------------------------------------------------------
    -- The edit log.
    -- -----------------------------------------------------------------------

    create type public.sibling_fee_edit_value as enum ('full', 'ten', 'automatic');
    create type public.sibling_fee_edit_reason as enum (
        'full_fee_sibling_not_enrolled',
        'sibling_proof_after_enrolment',
        'data_entry_correction'
    );

    create table public.sibling_fee_edits (
        id uuid primary key default gen_random_uuid(),
        -- The caller's id for this edit, so a retry is not saved twice.
        request_id uuid not null unique,
        lead_id uuid not null references public.leads (id),
        staff_id uuid not null references public.staff_members (id),
        value public.sibling_fee_edit_value not null,
        reason public.sibling_fee_edit_reason not null,
        note text check (note is null or char_length(note) between 1 and 1000),
        old_result public.sibling_result not null,
        old_source public.sibling_result_source not null,
        new_result public.sibling_result not null,
        new_source public.sibling_result_source not null,
        -- The leads whose fee moved, as the preview lists them.
        changes jsonb not null check (jsonb_typeof(changes) = 'array'),
        created_at timestamptz not null default now()
    );

    comment on table public.sibling_fee_edits is
        'Every manual Sibling fee edit (#303): who, when, the old and new result, the reason and the fees it moved. Written only by edit_sibling_fee.';

    create index sibling_fee_edits_lead_id_idx on public.sibling_fee_edits (lead_id);
    create index sibling_fee_edits_staff_id_idx on public.sibling_fee_edits (staff_id);

    -- Reads only, for staff who may view leads, as lead_sibling_results.
    alter table public.sibling_fee_edits enable row level security;

    create policy "Staff who may view leads read Sibling fee edits"
        on public.sibling_fee_edits for select
        to authenticated
        using ((select public.has_permission('leads.view')));

    revoke insert, update, delete, truncate on public.sibling_fee_edits from anon, authenticated, service_role;

    insert into public.audit_scopes (table_name, scope, lead_id_column) values
        ('public.sibling_fee_edits', 'lead', 'lead_id');

    create trigger audit_row_change
        after insert or update on public.sibling_fee_edits
        for each row
        execute function public.audit_row_change();

    create trigger refuse_delete
        before delete on public.sibling_fee_edits
        for each row
        execute function public.refuse_delete();

    create trigger refuse_truncate
        before truncate on public.sibling_fee_edits
        for each statement
        execute function public.refuse_delete();

    -- -----------------------------------------------------------------------
    -- A manual value kept at enrolment.
    -- -----------------------------------------------------------------------

    -- lock_sibling_result, as 20261211100100 made it, now keeping a manual
    -- value's result and source when it fixes the result at enrolment.
    -- Same signature.
    create or replace function public.lock_sibling_result(lead_id uuid, cause text, refresh_first boolean)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        stored public.lead_sibling_results;
        locking public.sibling_result;
    begin
        perform public.lock_lead_family(lock_sibling_result.lead_id);
        if refresh_first then
            perform public.refresh_sibling_result(lock_sibling_result.lead_id, lock_sibling_result.cause);
        end if;

        select * into stored from public.lead_sibling_results r where r.lead_id = lock_sibling_result.lead_id for update;
        if stored.locked_result is not null then
            return;
        end if;
        locking := case when stored.result = 'ten' then 'ten' else 'full' end;

        if stored.source = 'manual' then
            update public.lead_sibling_results r
            set locked_result = locking,
                locked_at = now(),
                cause = lock_sibling_result.cause,
                updated_at = now()
            where r.id = stored.id;
            return;
        end if;

        insert into public.lead_sibling_results as r (lead_id, result, source, locked_result, locked_at, cause)
        values (lock_sibling_result.lead_id, locking, 'locked', locking, now(), lock_sibling_result.cause)
        on conflict on constraint lead_sibling_results_lead_id_key do update
        set locked_result = excluded.locked_result,
            locked_at = excluded.locked_at,
            result = excluded.result,
            source = excluded.source,
            cause = excluded.cause,
            updated_at = now();

        -- The tick may still say ten over a full lock.
        perform public.refresh_sibling_result(lock_sibling_result.lead_id, lock_sibling_result.cause);
    end;
    $fn$;

    revoke execute on function public.lock_sibling_result(uuid, text, boolean) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The full payer and a manual value.
    -- -----------------------------------------------------------------------

    -- choose_full_payer, as 20261213100100 made it, with one change: a
    -- stored full payer the Accountant set to Full fee by hand keeps the
    -- place. It still pays full, so choosing another would charge a second
    -- sibling full as well. A full payer set to 10% by hand is replaced, as
    -- before (S3). Same signature.
    create or replace function public.choose_full_payer(group_id uuid)
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
                   and (coalesce(r.source::text, 'auto') <> 'manual' or r.result = 'full')
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
    -- The pieces the save and the preview share.
    -- -----------------------------------------------------------------------

    -- clear_sibling_fee_edit_needed(lead_id, reason): a saved 10% closes the
    -- lead's "Granted: fee edit needed" (S4, #302) as applied, recording the
    -- staff member signed in and the edit's reason. Nothing to close is not
    -- an error. The caller holds the lead's Family lock. Internal.
    create function public.clear_sibling_fee_edit_needed(lead_id uuid, reason text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    begin
        perform public.close_sibling_fee_edit(
            clear_sibling_fee_edit_needed.lead_id, 'applied', clear_sibling_fee_edit_needed.reason
        );
    end;
    $fn$;

    revoke execute on function public.clear_sibling_fee_edit_needed(uuid, text) from public, anon, authenticated, service_role;

    -- sibling_fee_edit_reach(lead_id): the lead and every member of its
    -- group, the leads an edit can move. Internal.
    create function public.sibling_fee_edit_reach(lead_id uuid)
    returns uuid[]
    language sql
    stable
    set search_path = ''
    as $fn$
        select array(
            select sibling_fee_edit_reach.lead_id
            union
            select o.lead_id
            from public.sibling_group_members m
            join public.sibling_group_members o on o.group_id = m.group_id
            where m.lead_id = sibling_fee_edit_reach.lead_id and m.group_id is not null
        );
    $fn$;

    revoke execute on function public.sibling_fee_edit_reach(uuid) from public, anon, authenticated, service_role;

    -- sibling_fee_edit_fees(lead_ids): each lead's fee as a payer sees it,
    -- keyed by lead id: status, School fee, discount, instalments and Seat
    -- priority. Internal.
    create function public.sibling_fee_edit_fees(lead_ids uuid[])
    returns jsonb
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(jsonb_object_agg(l.id::text, jsonb_build_object(
                   'status', l.status,
                   'school_fee', fee.school_fee,
                   'discount', fee.discount,
                   'discount_percent', fee.discount_percent,
                   'first_amount', fee.first_amount,
                   'second_amount', fee.second_amount,
                   'third_amount', fee.third_amount,
                   'priority', seat.priority
               )), '{}'::jsonb)
        from public.leads l
        cross join lateral public.lead_fee_amounts(l.id) fee
        cross join lateral public.lead_seat_priority(l.id) seat
        where l.id = any (sibling_fee_edit_fees.lead_ids);
    $fn$;

    revoke execute on function public.sibling_fee_edit_fees(uuid[]) from public, anon, authenticated, service_role;

    -- sibling_fee_edit_run(lead_id, value): the edit itself, for the save
    -- and the preview alike. Takes the locks, writes the lead's result,
    -- recomputes, and returns the old and new result and the leads whose fee
    -- moved, the edited one first. Raises not_found, lead_closed and
    -- unchanged. The callers check the permission. Internal.
    create function public.sibling_fee_edit_run(lead_id uuid, value public.sibling_fee_edit_value)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        target public.leads;
        stored public.lead_sibling_results;
        old_result public.sibling_result;
        old_source public.sibling_result_source;
        next_result public.sibling_result;
        next_source public.sibling_result_source;
        answer record;
        own_group uuid;
        reach uuid[];
        fees_before jsonb;
        fees_after jsonb;
        changes jsonb;
    begin
        -- Family locks (with the group's), then the lead's row.
        perform public.lock_lead_family(sibling_fee_edit_run.lead_id);
        select * into target from public.leads l where l.id = sibling_fee_edit_run.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        perform public.assert_lead_open(target.id);

        select * into stored from public.lead_sibling_results r where r.lead_id = target.id for update;
        old_result := coalesce(stored.result, 'none');
        old_source := coalesce(stored.source, 'auto');

        if sibling_fee_edit_run.value = 'automatic' then
            -- Only a manual value or a kept 10% is not already automatic.
            if old_source not in ('manual', 'legacy') then
                raise exception 'unchanged';
            end if;
            -- The fixed result for a lead locked at enrolment, else the rule.
            select * into answer from public.sibling_rule_result(target.id);
            next_result := answer.result;
            next_source := answer.source;
            if next_result = 'ten' and next_source = 'auto' and public.sibling_grants_paused() then
                next_result := 'none';
            end if;
        else
            next_result := sibling_fee_edit_run.value::text::public.sibling_result;
            next_source := 'manual';
            if old_source = 'manual' and old_result = next_result then
                raise exception 'unchanged';
            end if;
        end if;

        reach := public.sibling_fee_edit_reach(target.id);
        fees_before := public.sibling_fee_edit_fees(reach);

        if stored.id is null then
            insert into public.lead_sibling_results (lead_id, result, source, cause)
            values (target.id, next_result, next_source, 'sibling');
        else
            update public.lead_sibling_results r
            set result = next_result,
                source = next_source,
                cause = 'sibling',
                updated_at = now()
            where r.id = stored.id;
        end if;

        -- Seat priority and Enrolled, as after a payment adjustment. An
        -- Enrolled lead (or one in no group) is recomputed itself; the group
        -- recompute then chooses the full payer again if needed and
        -- recomputes every member not yet Enrolled, this lead included.
        own_group := public.lead_sibling_group(target.id);
        if own_group is null or target.status = 'Enrolled' then
            perform public.recompute_lead_fee(target.id, 'sibling');
        end if;
        if own_group is not null then
            perform public.recompute_sibling_group(own_group, 'sibling');
        end if;

        -- The group can't change here, but read it again to be sure every
        -- lead that moved is compared.
        reach := array(select distinct x from unnest(reach || public.sibling_fee_edit_reach(target.id)) x);
        fees_after := public.sibling_fee_edit_fees(reach);

        select coalesce(jsonb_agg(jsonb_build_object(
                   'lead_id', c.lead_id,
                   'edited', c.lead_id = target.id,
                   'school_fee_change', (c.after ->> 'school_fee')::integer - (c.before ->> 'school_fee')::integer,
                   'before', c.before,
                   'after', c.after
               ) order by c.lead_id <> target.id, c.lead_id), '[]'::jsonb)
        into changes
        from (
            select x as lead_id, fees_before -> x::text as before, fees_after -> x::text as after
            from unnest(reach) x
        ) c
        where c.before is distinct from c.after;

        select r.result, r.source into next_result, next_source
        from public.lead_sibling_results r where r.lead_id = target.id;

        return jsonb_build_object(
            'lead_id', target.id,
            'value', sibling_fee_edit_run.value,
            'old', jsonb_build_object('result', old_result, 'source', old_source),
            'new', jsonb_build_object('result', next_result, 'source', next_source),
            'changes', changes
        );
    end;
    $fn$;

    revoke execute on function public.sibling_fee_edit_run(uuid, public.sibling_fee_edit_value) from public, anon, authenticated, service_role;

    -- The value as the API sends it, or `invalid` with the field. Internal.
    create function public.sibling_fee_edit_value_of(value text)
    returns public.sibling_fee_edit_value
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    begin
        if sibling_fee_edit_value_of.value is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'value')::text;
        end if;
        return sibling_fee_edit_value_of.value::public.sibling_fee_edit_value;
    exception when invalid_text_representation then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'value')::text;
    end;
    $fn$;

    revoke execute on function public.sibling_fee_edit_value_of(text) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The preview and the save.
    -- -----------------------------------------------------------------------

    -- preview_sibling_fee_edit(lead_id, value): what edit_sibling_fee would
    -- change, saving nothing. Needs payments.record.
    create function public.preview_sibling_fee_edit(lead_id uuid, value text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        chosen public.sibling_fee_edit_value;
        answer jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
            raise exception 'not_permitted';
        end if;
        chosen := public.sibling_fee_edit_value_of(preview_sibling_fee_edit.value);

        -- The save's own steps, rolled back: what it lists is what the save
        -- would do from the same state.
        begin
            answer := public.sibling_fee_edit_run(preview_sibling_fee_edit.lead_id, chosen);
            raise exception using errcode = 'P0114', message = 'sibling_fee_edit_preview';
        exception when sqlstate 'P0114' then
            null;
        end;

        return jsonb_build_object('result', 'preview') || answer;
    end;
    $fn$;

    revoke execute on function public.preview_sibling_fee_edit(uuid, text) from public, anon;
    grant execute on function public.preview_sibling_fee_edit(uuid, text) to authenticated;

    -- edit_sibling_fee(lead_id, value, reason, note, request_id): saves the
    -- edit, logs it and recomputes. Needs payments.record.
    create function public.edit_sibling_fee(lead_id uuid, value text, reason text, note text, request_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        chosen public.sibling_fee_edit_value;
        chosen_reason public.sibling_fee_edit_reason;
        clean_note text := nullif(btrim(coalesce(edit_sibling_fee.note, '')), '');
        staff_id uuid;
        earlier public.sibling_fee_edits;
        answer jsonb;
        new_id uuid;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
            raise exception 'not_permitted';
        end if;
        if edit_sibling_fee.request_id is null then
            raise exception 'request_missing';
        end if;
        chosen := public.sibling_fee_edit_value_of(edit_sibling_fee.value);
        begin
            chosen_reason := edit_sibling_fee.reason::public.sibling_fee_edit_reason;
        exception when invalid_text_representation then
            chosen_reason := null;
        end;
        if chosen_reason is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
        end if;
        if char_length(clean_note) > 1000 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
        end if;
        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
        if staff_id is null then
            raise exception 'not_permitted';
        end if;

        -- The locks first, so a retry waits for the first try and then sees it.
        perform public.lock_lead_family(edit_sibling_fee.lead_id);
        perform 1 from public.leads l where l.id = edit_sibling_fee.lead_id for update;

        select * into earlier from public.sibling_fee_edits e where e.request_id = edit_sibling_fee.request_id;
        if found then
            if earlier.lead_id is distinct from edit_sibling_fee.lead_id
               or earlier.value is distinct from chosen
               or earlier.reason is distinct from chosen_reason
               or earlier.note is distinct from clean_note then
                raise exception 'request_reused';
            end if;
            return jsonb_build_object(
                'result', 'saved',
                'edit_id', earlier.id,
                'lead_id', earlier.lead_id,
                'value', earlier.value,
                'old', jsonb_build_object('result', earlier.old_result, 'source', earlier.old_source),
                'new', jsonb_build_object('result', earlier.new_result, 'source', earlier.new_source),
                'changes', earlier.changes
            );
        end if;

        answer := public.sibling_fee_edit_run(edit_sibling_fee.lead_id, chosen);

        -- The locks above serialize retries on one lead. The same request_id
        -- used at the same moment on another family's lead passes the check
        -- above and stops here on the unique key: that is a reused request,
        -- and the whole edit rolls back.
        begin
            insert into public.sibling_fee_edits (
                request_id, lead_id, staff_id, value, reason, note,
                old_result, old_source, new_result, new_source, changes
            ) values (
                edit_sibling_fee.request_id, edit_sibling_fee.lead_id, staff_id, chosen, chosen_reason, clean_note,
                (answer #>> '{old,result}')::public.sibling_result,
                (answer #>> '{old,source}')::public.sibling_result_source,
                (answer #>> '{new,result}')::public.sibling_result,
                (answer #>> '{new,source}')::public.sibling_result_source,
                answer -> 'changes'
            )
            returning id into new_id;
        exception when unique_violation then
            raise exception 'request_reused';
        end;

        if chosen = 'ten' then
            perform public.clear_sibling_fee_edit_needed(edit_sibling_fee.lead_id, chosen_reason::text);
        end if;

        return jsonb_build_object('result', 'saved', 'edit_id', new_id) || answer;
    end;
    $fn$;

    revoke execute on function public.edit_sibling_fee(uuid, text, text, text, uuid) from public, anon;
    grant execute on function public.edit_sibling_fee(uuid, text, text, text, uuid) to authenticated;

    -- -----------------------------------------------------------------------
    -- Migration-day checks.
    -- -----------------------------------------------------------------------

    if exists (select 1 from public.lead_sibling_results r where r.source = 'manual') then
        raise exception 'sibling_fee_edit_unexpected_manual';
    end if;

    perform public.assert_fee_snapshot_unchanged('pg_temp.sibling_fee_edit_snapshot_before');
    drop table pg_temp.sibling_fee_edit_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
