-- The Sibling discount request (#302, spec #296, align brief S1, S2, S4, S5,
-- R16, R17, R36). Fees, discounts, statuses and seat counts do not move on
-- migration day: no Sibling request exists yet, and nothing here changes
-- what a member without one gets.
--
-- 1. The request. A `sibling` row in discount_requests asks the Admissions
--    Manager to let a linked lead count in a sibling group although the
--    fathers' names don't match ("Father's names don't match"; the note says
--    what proof the family brings). Two forms:
--      in its group   the lead is a member waiting on a request
--                     (`request_needed`) or refused (`refused`): it asks to
--                     count in that group (group_id).
--      across groups  the lead counts in its own group with other members,
--                     and asks to bring that group into another lead's
--                     group (sibling_of_lead_id; group_id is that lead's
--                     group, merge_from_group_id its own). link_sibling
--                     refuses that merge when the names differ.
--    `leads.edit` requests (request_sibling_discount); `discounts.approve`
--    decides, through decide_discount as for every kind. A lead holds at most
--    one Pending request of each kind, so a Sibling request and a Staff child
--    request can both wait; Staff child and Qualified orphan still share one
--    Pending request between them, as before.
--
-- 2. States: pending, granted, refused, withdrawn. A grant sets the member's
--    basis to `granted`, which counts (sibling_basis_counts); across groups
--    it merges the two groups, the lead counting as `granted`. A refusal sets
--    the basis to `refused`. A request is withdrawn, with the staff member
--    whose action caused it, when the lead leaves the group it asked about
--    or is linked into it by a match. A father's-name correction that makes
--    the names the same withdraws nothing: the request stays open and the
--    Manager decides (S2, R36, replacing R17's withdrawal).
--
-- 3. A refusal holds. `refused` is kept wherever the lead is linked next,
--    like `request_needed`. A lead whose refusal for a group stands (no later
--    grant for that group) is linked into it only as `refused`, and a merge
--    of two groups is refused while a refusal stands between them, by name
--    edits or any other route. A new request may be raised; only its grant
--    lifts the refusal.
--
-- 4. Enrolled students may be requested for (S4). A grant makes the student
--    count, so it can anchor its siblings, but leaves its own fee alone: the
--    system never changes an Enrolled result by itself. When the result fixed
--    at enrolment is not the 10% (and no larger discount replaces it), the
--    grant marks the request `fee_edit = needed` ("Granted: fee edit
--    needed"). #303's fee edit calls close_sibling_fee_edit with `applied`;
--    dismiss_sibling_fee_edit (payments.record) closes it with a reason.
--
-- 5. A grant lapses when the member leaves the group: a granted member
--    linked into another group gets that group's father's-name check. A
--    merge moves the whole group, so its members keep their bases, and its
--    pending requests follow it.
--
-- 6. The existing kinds are unchanged. lead_discount reads only Staff child
--    and Qualified orphan rows (Sibling 10% still comes from the stored
--    result), and lead_discount_requests and pending_discount_requests leave
--    Sibling rows out, so today's screens show exactly what they show now.
--    lead_sibling_requests and pending_sibling_requests read the new kind
--    for #310.
--
-- Lock order, as before: the Family locks and every group they reach
-- (lock_lead_families), then lead rows in id order, then the request row.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction. It snapshots every fee first and compares at the
-- end; any difference raises and nothing is applied.
--
-- Rollback: a new migration putting back sibling_basis_counts, link_sibling,
-- the father's-name trigger, lead_discount and the discount functions from
-- 20261213100100 and 20261106901100, and the two pending indexes. Rows of
-- the new kind would have to be withdrawn first.

do $migration$
begin
    perform public.set_audit_actor('system');

    lock table public.leads, public.guardian_contacts, public.sibling_groups, public.sibling_group_members,
        public.discount_requests
        in share row exclusive mode;

    drop table if exists pg_temp.sibling_request_snapshot_before;
    create temp table sibling_request_snapshot_before as select * from public.fee_snapshot();

    if exists (select 1 from public.discount_requests r where r.kind = 'sibling' or r.state = 'withdrawn') then
        raise exception 'sibling_request_unexpected_row';
    end if;

    -- -----------------------------------------------------------------------
    -- Columns.
    -- -----------------------------------------------------------------------

    alter table public.discount_requests
        -- The group a Sibling request asks the lead to count in.
        add column group_id uuid references public.sibling_groups (id),
        -- The lead it is linked to (in its group), or the lead whose group
        -- it asks to join (across groups).
        add column sibling_of_lead_id uuid references public.leads (id),
        -- Across groups: the lead's own group, brought along on a grant.
        add column merge_from_group_id uuid references public.sibling_groups (id),
        add column withdrawn_by uuid references public.staff_members (id),
        add column withdrawn_reason text check (withdrawn_reason in ('left_group', 'already_linked')),
        -- "Granted: fee edit needed" and how it was closed (S4).
        add column fee_edit text check (fee_edit in ('needed', 'applied', 'dismissed')),
        add column fee_edit_closed_by uuid references public.staff_members (id),
        add column fee_edit_closed_at timestamptz,
        add column fee_edit_reason text
            check (fee_edit_reason is null or (btrim(fee_edit_reason) <> '' and char_length(fee_edit_reason) <= 1000)),
        drop constraint discount_requests_decided_check,
        add constraint discount_requests_decided_check check (
            (state = 'pending') = (decided_at is null)
            and (state in ('granted', 'refused')) = (decided_by is not null)
        ),
        add constraint discount_requests_withdrawn_check check (
            (state = 'withdrawn') = (withdrawn_reason is not null)
            and (withdrawn_by is null or state = 'withdrawn')
            and (state <> 'withdrawn' or kind = 'sibling')
        ),
        add constraint discount_requests_sibling_check check (
            (kind = 'sibling') = (group_id is not null)
            and (kind = 'sibling' or sibling_of_lead_id is null)
            and (merge_from_group_id is null or sibling_of_lead_id is not null)
            and (sibling_of_lead_id is null or sibling_of_lead_id <> lead_id)
        ),
        add constraint discount_requests_fee_edit_state_check check (
            (fee_edit is null or (kind = 'sibling' and state = 'granted'))
            and coalesce(fee_edit in ('applied', 'dismissed'), false) = (fee_edit_closed_at is not null)
            and (fee_edit_closed_by is null or fee_edit_closed_at is not null)
            and (fee_edit_reason is null or fee_edit_closed_at is not null)
            and (fee_edit is distinct from 'dismissed' or fee_edit_reason is not null)
        );

    comment on column public.discount_requests.group_id is
        'Sibling requests: the sibling group the lead asks to count in (#302).';
    comment on column public.discount_requests.merge_from_group_id is
        'Sibling requests across groups: the lead''s own group, merged into group_id on a grant (#302).';
    comment on column public.discount_requests.fee_edit is
        'Granted Sibling requests for a lead whose fee is fixed at enrolment: needed until the Accountant applies the 10% or dismisses it (#302, S4).';

    -- One Pending request of each kind; Staff child and Qualified orphan
    -- keep one between them, as before.
    drop index public.discount_requests_one_pending_idx;
    create unique index discount_requests_one_pending_idx on public.discount_requests (lead_id, kind) where state = 'pending';
    create unique index discount_requests_one_pending_fee_idx on public.discount_requests (lead_id)
        where state = 'pending' and kind <> 'sibling';
    -- A Sibling grant belongs to a group, and a lead may change group, so
    -- only the other kinds keep one grant each.
    drop index public.discount_requests_one_granted_idx;
    create unique index discount_requests_one_granted_idx on public.discount_requests (lead_id, kind)
        where state = 'granted' and kind <> 'sibling';
    create index discount_requests_group_id_idx on public.discount_requests (group_id) where group_id is not null;
    create index discount_requests_sibling_of_lead_id_idx on public.discount_requests (sibling_of_lead_id)
        where sibling_of_lead_id is not null;
    create index discount_requests_merge_from_group_id_idx on public.discount_requests (merge_from_group_id)
        where merge_from_group_id is not null;
    create index discount_requests_withdrawn_by_idx on public.discount_requests (withdrawn_by) where withdrawn_by is not null;
    create index discount_requests_fee_edit_closed_by_idx on public.discount_requests (fee_edit_closed_by)
        where fee_edit_closed_by is not null;
    -- The Accountant's list (#306).
    create index discount_requests_fee_edit_needed_idx on public.discount_requests (decided_at) where fee_edit = 'needed';
    -- The refusal check reads a lead's decided Sibling requests.
    create index discount_requests_sibling_lead_idx on public.discount_requests (lead_id, decided_at)
        where kind = 'sibling' and state in ('granted', 'refused');

    alter table public.sibling_group_members
        drop constraint sibling_group_members_basis_check,
        add constraint sibling_group_members_basis_check
            check (basis in ('matched', 'typo_confirmed', 'request_needed', 'granted', 'refused')),
        drop constraint sibling_group_members_cause_check,
        add constraint sibling_group_members_cause_check
            check (cause in ('migration', 'lead_created', 'family', 'sibling_link', 'merge', 'father_name', 'sibling_request'));

    comment on column public.sibling_group_members.basis is
        'For a member that is not legacy: matched, typo_confirmed, request_needed, granted or refused (#301, #302). matched, typo_confirmed and granted count.';

    -- -----------------------------------------------------------------------
    -- The request row's own rule.
    -- -----------------------------------------------------------------------

    -- refuse_decided_discount_change, as 20261103900900 made it. What was
    -- asked, by whom and when never changes. A Pending request leaves
    -- Pending once; while Pending, a Sibling request's groups may follow a
    -- merge. A decided request never changes, except that a granted one's
    -- "fee edit needed" is closed once. Same trigger.
    create or replace function public.refuse_decided_discount_change()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
        if new.lead_id is distinct from old.lead_id
           or new.kind is distinct from old.kind
           or new.note is distinct from old.note
           or new.requested_by is distinct from old.requested_by
           or new.requested_at is distinct from old.requested_at
           or new.request_id is distinct from old.request_id
           or new.sibling_of_lead_id is distinct from old.sibling_of_lead_id then
            raise exception 'update_refused' using detail = tg_table_name;
        end if;
        if old.state = 'pending' then
            if new.fee_edit is distinct from old.fee_edit
               and not (new.state = 'granted' and new.fee_edit = 'needed' and old.fee_edit is null) then
                raise exception 'update_refused' using detail = tg_table_name;
            end if;
            return new;
        end if;
        if old.state = 'granted' and old.fee_edit = 'needed' and new.fee_edit in ('applied', 'dismissed')
           and (to_jsonb(new) - 'fee_edit' - 'fee_edit_closed_by' - 'fee_edit_closed_at' - 'fee_edit_reason')
               = (to_jsonb(old) - 'fee_edit' - 'fee_edit_closed_by' - 'fee_edit_closed_at' - 'fee_edit_reason') then
            return new;
        end if;
        raise exception 'update_refused' using detail = tg_table_name;
    end;
    $fn$;

    revoke execute on function public.refuse_decided_discount_change() from public, anon, authenticated;

    -- -----------------------------------------------------------------------
    -- Counting and refusals.
    -- -----------------------------------------------------------------------

    -- sibling_basis_counts, as 20261213100100 made it, now counting a
    -- granted request. Same signature.
    create or replace function public.sibling_basis_counts(basis text)
    returns boolean
    language sql
    immutable
    set search_path = ''
    as $fn$
        select coalesce(sibling_basis_counts.basis in ('matched', 'typo_confirmed', 'granted'), false);
    $fn$;

    revoke execute on function public.sibling_basis_counts(text) from public, anon, authenticated, service_role;

    -- The leads of a group, legacy members included, sorted. Internal.
    create function public.sibling_group_leads(group_id uuid)
    returns uuid[]
    language sql
    stable
    set search_path = ''
    as $fn$
        select coalesce(array_agg(m.lead_id order by m.lead_id), '{}')
        from public.sibling_group_members m
        where sibling_group_leads.group_id is not null and m.group_id = sibling_group_leads.group_id;
    $fn$;

    revoke execute on function public.sibling_group_leads(uuid) from public, anon, authenticated, service_role;

    -- sibling_refusal_stands(lead_id, group_id, group_leads): whether a
    -- Sibling request of this lead about this group (asked for the group, or
    -- for a lead now in it) was refused with no later grant about it.
    -- Internal.
    create function public.sibling_refusal_stands(lead_id uuid, group_id uuid, group_leads uuid[])
    returns boolean
    language sql
    stable
    set search_path = ''
    as $fn$
        select exists (
            select 1
            from public.discount_requests r
            where r.lead_id = sibling_refusal_stands.lead_id
              and r.kind = 'sibling'
              and r.state = 'refused'
              and (r.group_id = sibling_refusal_stands.group_id or r.sibling_of_lead_id = any (sibling_refusal_stands.group_leads))
              and not exists (
                  select 1
                  from public.discount_requests q
                  where q.lead_id = r.lead_id
                    and q.kind = 'sibling'
                    and q.state = 'granted'
                    and q.decided_at > r.decided_at
                    and (q.group_id = sibling_refusal_stands.group_id or q.sibling_of_lead_id = any (sibling_refusal_stands.group_leads))
              )
        );
    $fn$;

    revoke execute on function public.sibling_refusal_stands(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;

    -- sibling_refusal_between(a_leads, a_group, b_leads, b_group): whether a
    -- refusal stands between two sides that are about to be one group: one
    -- of a_leads refused about b, or one of b_leads refused about a.
    -- Internal.
    create function public.sibling_refusal_between(a_leads uuid[], a_group uuid, b_leads uuid[], b_group uuid)
    returns boolean
    language sql
    stable
    set search_path = ''
    as $fn$
        select exists (
            select 1 from unnest(sibling_refusal_between.a_leads) a
            where public.sibling_refusal_stands(a, sibling_refusal_between.b_group, sibling_refusal_between.b_leads)
        ) or exists (
            select 1 from unnest(sibling_refusal_between.b_leads) b
            where public.sibling_refusal_stands(b, sibling_refusal_between.a_group, sibling_refusal_between.a_leads)
        );
    $fn$;

    revoke execute on function public.sibling_refusal_between(uuid[], uuid, uuid[], uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Merges and stale requests.
    -- -----------------------------------------------------------------------

    -- merge_sibling_groups(from_group, into_group, moving_lead): every member
    -- of from_group that is not legacy, other than moving_lead (the caller
    -- writes that one), joins into_group with its basis. The full payer of
    -- the merged group is the one with the higher fee when both still
    -- stand, oldest lead on a tie; the other becomes a later sibling, which
    -- can only lower its fee. Pending Sibling requests about from_group now
    -- ask about into_group. The caller holds both groups' locks and
    -- recomputes both. Taken out of link_sibling (20261213100100) unchanged.
    -- Internal.
    create function public.merge_sibling_groups(from_group uuid, into_group uuid, moving_lead uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        px uuid;
        pt uuid;
        px_ok boolean;
        pt_ok boolean;
    begin
        select g.full_payer_lead_id into pt from public.sibling_groups g where g.id = merge_sibling_groups.into_group;
        select g.full_payer_lead_id into px from public.sibling_groups g where g.id = merge_sibling_groups.from_group;
        select exists (
            select 1 from public.sibling_group_members m
            where m.lead_id = px and m.group_id = merge_sibling_groups.from_group and not m.legacy
        ) into px_ok;
        if px is not null and px_ok then
            select exists (
                select 1 from public.sibling_group_members m
                where m.lead_id = pt and m.group_id = merge_sibling_groups.into_group
            ) into pt_ok;
            if pt is null or not pt_ok or (
                select (fx.band_fee, -extract(epoch from lx.created_at)) > (ft.band_fee, -extract(epoch from lt.created_at))
                from public.leads lx cross join lateral public.lead_fee_amounts(lx.id) fx,
                     public.leads lt cross join lateral public.lead_fee_amounts(lt.id) ft
                where lx.id = px and lt.id = pt
            ) then
                update public.sibling_groups g
                set full_payer_lead_id = px, full_payer_chosen_at = now(), updated_at = now()
                where g.id = merge_sibling_groups.into_group;
            end if;
            update public.sibling_groups g
            set full_payer_lead_id = null, full_payer_chosen_at = null, updated_at = now()
            where g.id = merge_sibling_groups.from_group;
        end if;

        update public.sibling_group_members m
        set group_id = merge_sibling_groups.into_group, cause = 'merge', joined_at = now(), updated_at = now()
        where m.group_id = merge_sibling_groups.from_group and not m.legacy and m.lead_id <> merge_sibling_groups.moving_lead;

        update public.discount_requests r
        set group_id = merge_sibling_groups.into_group
        where r.kind = 'sibling' and r.state = 'pending' and r.group_id = merge_sibling_groups.from_group;
        update public.discount_requests r
        set merge_from_group_id = merge_sibling_groups.into_group
        where r.kind = 'sibling' and r.state = 'pending' and r.merge_from_group_id = merge_sibling_groups.from_group;
    end;
    $fn$;

    revoke execute on function public.merge_sibling_groups(uuid, uuid, uuid) from public, anon, authenticated, service_role;

    -- withdraw_stale_sibling_requests(lead_ids): withdraws each Pending
    -- Sibling request of, or naming, these leads that no longer asks
    -- anything: in its group, when the lead has left that group
    -- (`left_group`) or counts there (`already_linked`); across groups, when
    -- the two leads now share a group (`already_linked`), or either has left
    -- its group or no longer counts in its own (`left_group`). The staff
    -- member signed in, if any, is recorded. The caller holds the groups'
    -- locks. Internal.
    create function public.withdraw_stale_sibling_requests(lead_ids uuid[])
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        staff_id uuid;
        request record;
        mine public.sibling_group_members;
        other public.sibling_group_members;
        why text;
    begin
        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
        for request in
            select r.id, r.lead_id, r.group_id, r.sibling_of_lead_id, r.merge_from_group_id
            from public.discount_requests r
            where r.kind = 'sibling' and r.state = 'pending'
              and (r.lead_id = any (withdraw_stale_sibling_requests.lead_ids)
                   or r.sibling_of_lead_id = any (withdraw_stale_sibling_requests.lead_ids))
            order by r.id
            for update
        loop
            why := null;
            mine := null;
            other := null;
            select * into mine from public.sibling_group_members m where m.lead_id = request.lead_id;
            if request.merge_from_group_id is null then
                if mine.group_id is distinct from request.group_id or mine.legacy then
                    why := 'left_group';
                elsif public.sibling_basis_counts(mine.basis) then
                    why := 'already_linked';
                end if;
            else
                select * into other from public.sibling_group_members m where m.lead_id = request.sibling_of_lead_id;
                if mine.group_id is not null and mine.group_id = other.group_id then
                    why := 'already_linked';
                elsif mine.group_id is null or mine.legacy or not public.sibling_basis_counts(mine.basis)
                      or other.group_id is null or other.legacy then
                    why := 'left_group';
                end if;
            end if;
            if why is not null then
                update public.discount_requests r
                set state = 'withdrawn',
                    decided_at = now(),
                    withdrawn_by = staff_id,
                    withdrawn_reason = why
                where r.id = request.id;
            end if;
        end loop;
    end;
    $fn$;

    revoke execute on function public.withdraw_stale_sibling_requests(uuid[]) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- Fees: the existing kinds only.
    -- -----------------------------------------------------------------------

    -- lead_discount, as 20261106901100 made it, reading only Staff child and
    -- Qualified orphan grants: a Sibling grant is about membership, and the
    -- 10% comes from the stored result. Same signature.
    create or replace function public.lead_discount(lead_id uuid, out discount text, out percent integer)
    language sql
    stable
    set search_path = ''
    as $fn$
        select d.kind, d.percent
        from (
            select r.kind::text as kind,
                   case r.kind when 'qualified_orphan' then 100 when 'staff_child' then 25 end as percent
            from public.discount_requests r
            where r.lead_id = lead_discount.lead_id and r.state = 'granted' and r.kind in ('staff_child', 'qualified_orphan')
            union all
            select 'sibling', 10
            where public.sibling_discount_applies(lead_discount.lead_id)
        ) d
        order by d.percent desc
        limit 1;
    $fn$;

    revoke execute on function public.lead_discount(uuid) from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- The existing request functions.
    -- -----------------------------------------------------------------------

    -- request_discount, as 20261103900900 made it, refusing the Sibling kind
    -- (request_sibling_discount asks for it) and looking only at the other
    -- kinds' Pending request. Same signature and answers.
    create or replace function public.request_discount(lead_id uuid, kind text, note text, request_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        chosen public.discount_kind;
        written text := btrim(coalesce(request_discount.note, ''));
        staff_id uuid;
        new_id uuid;
        earlier public.discount_requests;
        pending public.discount_requests;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;
        if request_discount.request_id is null then
            raise exception 'request_missing';
        end if;

        begin
            chosen := request_discount.kind::public.discount_kind;
        exception when invalid_text_representation then
            chosen := null;
        end;
        if chosen is null or chosen = 'sibling' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
        end if;
        if written = '' or char_length(written) > 1000 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
        end if;

        perform 1 from public.leads l where l.id = request_discount.lead_id for share;
        if not found then
            raise exception 'not_found';
        end if;

        select * into earlier from public.discount_requests r where r.request_id = request_discount.request_id;
        if found then
            if earlier.lead_id <> request_discount.lead_id or earlier.kind <> chosen or earlier.note <> written then
                raise exception 'request_reused';
            end if;
            return earlier.id;
        end if;

        perform public.assert_lead_open(request_discount.lead_id);

        if exists (
            select 1 from public.discount_requests r
            where r.lead_id = request_discount.lead_id and r.kind = chosen and r.state = 'granted'
        ) then
            raise exception 'already_granted';
        end if;

        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        for attempt in 1..3 loop
            begin
                insert into public.discount_requests (lead_id, kind, note, requested_by, request_id)
                values (request_discount.lead_id, chosen, written, staff_id, request_discount.request_id)
                returning id into new_id;
                return new_id;
            exception when unique_violation then
                select * into earlier from public.discount_requests r where r.request_id = request_discount.request_id;
                if found then
                    if earlier.lead_id <> request_discount.lead_id or earlier.kind <> chosen or earlier.note <> written then
                        raise exception 'request_reused';
                    end if;
                    return earlier.id;
                end if;
                select * into pending from public.discount_requests r
                where r.lead_id = request_discount.lead_id and r.state = 'pending' and r.kind <> 'sibling';
                if found then
                    raise exception 'already_pending' using detail = jsonb_build_object(
                        'requested_by', (select s.full_name from public.staff_members s where s.id = pending.requested_by),
                        'requested_at', pending.requested_at
                    )::text;
                end if;
                if exists (
                    select 1 from public.discount_requests r
                    where r.lead_id = request_discount.lead_id and r.kind = chosen and r.state = 'granted'
                ) then
                    raise exception 'already_granted';
                end if;
            end;
        end loop;

        raise exception 'busy';
    end;
    $fn$;

    revoke execute on function public.request_discount(uuid, text, text, uuid) from public, anon;
    grant execute on function public.request_discount(uuid, text, text, uuid) to authenticated;

    -- lead_discount_requests, as 20261103900900 made it, leaving Sibling
    -- requests out (lead_sibling_requests reads them). Same signature.
    create or replace function public.lead_discount_requests(lead_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;
        if not exists (select 1 from public.leads l where l.id = lead_discount_requests.lead_id) then
            raise exception 'not_found';
        end if;

        return coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id,
                'kind', r.kind,
                'note', r.note,
                'state', r.state,
                'requested_at', r.requested_at,
                'requested_by_id', r.requested_by,
                'requested_by', requester.full_name,
                'decided_at', r.decided_at,
                'decided_by', decider.full_name,
                'refusal_reason', r.refusal_reason
            ) order by r.requested_at desc, r.id)
            from public.discount_requests r
            left join public.staff_members requester on requester.id = r.requested_by
            left join public.staff_members decider on decider.id = r.decided_by
            where r.lead_id = lead_discount_requests.lead_id and r.kind <> 'sibling'
        ), '[]'::jsonb);
    end;
    $fn$;

    revoke execute on function public.lead_discount_requests(uuid) from public, anon;
    grant execute on function public.lead_discount_requests(uuid) to authenticated;

    -- pending_discount_requests, as 20261103900900 made it, leaving Sibling
    -- requests out (pending_sibling_requests reads them). Same signature.
    create or replace function public.pending_discount_requests()
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

        return coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id,
                'lead_id', r.lead_id,
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'class_name', l.class_name,
                'enrollment_year', l.enrollment_year,
                'day_or_boarding', l.day_or_boarding,
                'lead_open', l.status <> 'Declined' and l.closure is null,
                'kind', r.kind,
                'note', r.note,
                'requested_at', r.requested_at,
                'requested_by', requester.full_name
            ) order by r.requested_at, r.id)
            from public.discount_requests r
            join public.leads l on l.id = r.lead_id
            left join public.staff_members requester on requester.id = r.requested_by
            where r.state = 'pending' and r.kind <> 'sibling'
        ), '[]'::jsonb);
    end;
    $fn$;

    revoke execute on function public.pending_discount_requests() from public, anon;
    grant execute on function public.pending_discount_requests() to authenticated;

    -- -----------------------------------------------------------------------
    -- Sibling requests.
    -- -----------------------------------------------------------------------

    -- request_sibling_discount(lead_id, note, request_id, sibling_of_lead_id):
    -- asks for a Sibling request on an open lead (Enrolled included). Needs
    -- leads.edit. Without sibling_of_lead_id, the lead is a linked member
    -- waiting on a request or refused, and asks to count in its group. With
    -- it, the lead counts in its own group with other members and asks to
    -- bring that group into the other lead's group, whose fathers' names are
    -- not the same. Refusals: `not_permitted`, `request_missing`, `invalid`
    -- (field `note`, or `sibling_of` with a reason: `not_linked`,
    -- `same_group`, `not_counting`, `no_merge`, `names_match`), `not_found`,
    -- `lead_closed`, `already_counts`, `already_pending` (requester and date
    -- in the detail), `request_reused`, `busy`. Returns the request's id; the
    -- same request sent again with the same id returns it again.
    create function public.request_sibling_discount(
        lead_id uuid,
        note text,
        request_id uuid,
        sibling_of_lead_id uuid default null
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        written text := btrim(coalesce(request_sibling_discount.note, ''));
        x public.leads;
        t public.leads;
        mx public.sibling_group_members;
        mt public.sibling_group_members;
        earlier public.discount_requests;
        pending public.discount_requests;
        checked record;
        target_group uuid;
        target_lead uuid;
        from_group uuid;
        staff_id uuid;
        new_id uuid;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
            raise exception 'not_permitted';
        end if;
        if request_sibling_discount.request_id is null then
            raise exception 'request_missing';
        end if;
        if written = '' or char_length(written) > 1000 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
        end if;
        if request_sibling_discount.lead_id is null
           or request_sibling_discount.lead_id is not distinct from request_sibling_discount.sibling_of_lead_id then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'same_group')::text;
        end if;

        perform public.lock_lead_families(array_remove(
            array[request_sibling_discount.lead_id, request_sibling_discount.sibling_of_lead_id], null
        ));
        perform 1 from public.leads l
        where l.id in (request_sibling_discount.lead_id, request_sibling_discount.sibling_of_lead_id)
        order by l.id
        for share;
        select * into x from public.leads l where l.id = request_sibling_discount.lead_id;
        if x.id is null then
            raise exception 'not_found';
        end if;
        if request_sibling_discount.sibling_of_lead_id is not null then
            select * into t from public.leads l where l.id = request_sibling_discount.sibling_of_lead_id;
            if t.id is null then
                raise exception 'not_found';
            end if;
        end if;

        select * into earlier from public.discount_requests r where r.request_id = request_sibling_discount.request_id;
        if found then
            if earlier.lead_id <> x.id or earlier.kind <> 'sibling' or earlier.note <> written
               or earlier.sibling_of_lead_id is distinct from request_sibling_discount.sibling_of_lead_id
                  and request_sibling_discount.sibling_of_lead_id is not null then
                raise exception 'request_reused';
            end if;
            return earlier.id;
        end if;

        perform public.assert_lead_open(x.id);

        select * into mx from public.sibling_group_members m where m.lead_id = x.id;
        if mx.group_id is null or mx.legacy then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'not_linked')::text;
        end if;

        if request_sibling_discount.sibling_of_lead_id is null then
            if public.sibling_basis_counts(mx.basis) then
                raise exception 'already_counts';
            end if;
            target_group := mx.group_id;
            target_lead := mx.sibling_of_lead_id;
        else
            perform public.assert_lead_open(t.id);
            select * into mt from public.sibling_group_members m where m.lead_id = t.id;
            if mt.group_id is null or mt.legacy then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'not_linked')::text;
            end if;
            if mt.group_id = mx.group_id then
                if public.sibling_basis_counts(mx.basis) then
                    raise exception 'already_counts';
                end if;
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'same_group')::text;
            end if;
            if not public.sibling_basis_counts(mx.basis) then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'not_counting')::text;
            end if;
            if not exists (
                select 1 from public.sibling_group_members o
                where o.group_id = mx.group_id and o.lead_id <> x.id and not o.legacy
            ) then
                -- Alone, it is simply linked (and needs a request in that group).
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'no_merge')::text;
            end if;
            select * into checked from public.sibling_name_check(x.id, x.father_full_name, mt.group_id);
            if checked.verdict = 'same' then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'sibling_of', 'reason', 'names_match')::text;
            end if;
            target_group := mt.group_id;
            target_lead := t.id;
            from_group := mx.group_id;
        end if;

        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        for attempt in 1..3 loop
            begin
                insert into public.discount_requests (
                    lead_id, kind, note, requested_by, request_id, group_id, sibling_of_lead_id, merge_from_group_id
                )
                values (x.id, 'sibling', written, staff_id, request_sibling_discount.request_id, target_group, target_lead, from_group)
                returning id into new_id;
                return new_id;
            exception when unique_violation then
                select * into earlier from public.discount_requests r where r.request_id = request_sibling_discount.request_id;
                if found then
                    if earlier.lead_id <> x.id or earlier.kind <> 'sibling' or earlier.note <> written then
                        raise exception 'request_reused';
                    end if;
                    return earlier.id;
                end if;
                select * into pending from public.discount_requests r
                where r.lead_id = x.id and r.state = 'pending' and r.kind = 'sibling';
                if found then
                    raise exception 'already_pending' using detail = jsonb_build_object(
                        'requested_by', (select s.full_name from public.staff_members s where s.id = pending.requested_by),
                        'requested_at', pending.requested_at
                    )::text;
                end if;
            end;
        end loop;

        raise exception 'busy';
    end;
    $fn$;

    revoke execute on function public.request_sibling_discount(uuid, text, uuid, uuid) from public, anon;
    grant execute on function public.request_sibling_discount(uuid, text, uuid, uuid) to authenticated;

    -- decide_sibling_request(request_id, granting, reason): decide_discount
    -- for a Sibling request, once the caller has checked discounts.approve
    -- and the decision. Locks both leads' Families and every group they
    -- reach, then the leads, then the request. A refusal works on a closed
    -- lead too, and makes a member waiting in that group `refused`. A grant
    -- needs the lead open:
    --   in its group   the member becomes `granted` and the group is
    --                  recomputed; for a lead whose fee was fixed at
    --                  enrolment without the 10%, `fee_edit` becomes
    --                  `needed` and its fee stays.
    --   across groups  the lead's group is merged into the other lead's,
    --                  the lead counting as `granted`; refused as invalid
    --                  `refused_request` while another refusal stands
    --                  between the two groups.
    -- A request whose lead has since moved is refused as invalid `stale`;
    -- it can still be refused. Internal.
    create function public.decide_sibling_request(request_id uuid, granting boolean, reason text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        request public.discount_requests;
        staff_id uuid;
        mx public.sibling_group_members;
        mt public.sibling_group_members;
        gx uuid;
        gt uuid;
        needs_edit boolean;
        kept uuid[];
    begin
        select * into request from public.discount_requests r where r.id = decide_sibling_request.request_id;
        if not found then
            raise exception 'not_found';
        end if;
        perform public.lock_lead_families(array_remove(array[request.lead_id, request.sibling_of_lead_id], null));
        perform 1 from public.leads l
        where l.id in (request.lead_id, request.sibling_of_lead_id)
        order by l.id
        for update;
        select * into request from public.discount_requests r where r.id = decide_sibling_request.request_id for update;

        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        if request.state <> 'pending' then
            if request.decided_by = staff_id
               and ((granting and request.state = 'granted')
                    or (not granting and request.state = 'refused' and request.refusal_reason = decide_sibling_request.reason)) then
                return;
            end if;
            raise exception 'not_pending';
        end if;

        select * into mx from public.sibling_group_members m where m.lead_id = request.lead_id for update;

        if not granting then
            update public.discount_requests r
            set state = 'refused',
                decided_by = staff_id,
                decided_at = now(),
                refusal_reason = decide_sibling_request.reason
            where r.id = request.id;
            if request.merge_from_group_id is null
               and mx.group_id = request.group_id and not mx.legacy and mx.basis = 'request_needed' then
                update public.sibling_group_members m
                set basis = 'refused', cause = 'sibling_request', updated_at = now()
                where m.id = mx.id;
            end if;
            return;
        end if;

        perform public.assert_lead_open(request.lead_id);

        if request.merge_from_group_id is null then
            if mx.group_id is distinct from request.group_id or mx.legacy or mx.basis not in ('request_needed', 'refused') then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'request', 'reason', 'stale')::text;
            end if;

            -- Fixed at enrolment without the 10%: the fee stays, and the
            -- Accountant is asked to edit it (S4). A larger discount
            -- replaces the 10% anyway.
            needs_edit := exists (
                select 1 from public.lead_sibling_results r
                where r.lead_id = request.lead_id and r.locked_result is not null and r.result <> 'ten'
            ) and not exists (
                select 1 from public.discount_requests d
                where d.lead_id = request.lead_id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
            );

            update public.discount_requests r
            set state = 'granted',
                decided_by = staff_id,
                decided_at = now(),
                fee_edit = case when needs_edit then 'needed' end
            where r.id = request.id;
            update public.sibling_group_members m
            set basis = 'granted', cause = 'sibling_request', updated_at = now()
            where m.id = mx.id;
            perform public.recompute_sibling_group(mx.group_id, 'sibling');
            return;
        end if;

        -- Across groups.
        perform public.assert_lead_open(request.sibling_of_lead_id);
        select * into mt from public.sibling_group_members m where m.lead_id = request.sibling_of_lead_id for update;
        gx := mx.group_id;
        gt := mt.group_id;
        if gx is null or mx.legacy or not public.sibling_basis_counts(mx.basis)
           or gt is null or mt.legacy or gx = gt then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'request', 'reason', 'stale')::text;
        end if;

        update public.discount_requests r
        set state = 'granted',
            decided_by = staff_id,
            decided_at = now()
        where r.id = request.id;

        -- This grant lifts the lead's own refusals about the other group;
        -- any other refusal between the two still holds.
        if public.sibling_refusal_between(public.sibling_group_leads(gx), gx, public.sibling_group_leads(gt), gt) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'request', 'reason', 'refused_request')::text;
        end if;

        -- A merge never raises a fee by itself (R38), as in link_sibling.
        kept := array(
            select m.lead_id
            from public.sibling_group_members m
            join public.lead_sibling_results r on r.lead_id = m.lead_id
            where m.group_id in (gx, gt) and r.result = 'ten' and r.source = 'auto'
        );
        perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

        perform public.merge_sibling_groups(gx, gt, request.lead_id);
        update public.sibling_group_members m
        set group_id = gt,
            basis = 'granted',
            sibling_of_lead_id = request.sibling_of_lead_id,
            cause = 'sibling_request',
            joined_at = now(),
            updated_at = now()
        where m.id = mx.id;

        perform public.refresh_sibling_group_contacts(gt);
        perform public.refresh_sibling_group_contacts(gx);
        perform public.recompute_sibling_group(gt, 'sibling');
        perform public.recompute_sibling_group(gx, 'sibling');
        perform set_config('app.sibling_keep_ten', '', true);
        perform public.withdraw_stale_sibling_requests(public.sibling_group_leads(gt));
    end;
    $fn$;

    revoke execute on function public.decide_sibling_request(uuid, boolean, text) from public, anon, authenticated, service_role;

    -- decide_discount, as 20261106901100 made it, handing a Sibling request
    -- to decide_sibling_request. Unchanged for the other kinds. Same
    -- signature.
    create or replace function public.decide_discount(request_id uuid, decision text, reason text default null)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        request public.discount_requests;
        why text := nullif(btrim(coalesce(decide_discount.reason, '')), '');
        staff_id uuid;
        granting boolean;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('discounts.approve') then
            raise exception 'not_permitted';
        end if;
        if decide_discount.decision is null or decide_discount.decision not in ('grant', 'refuse') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'decision')::text;
        end if;
        granting := decide_discount.decision = 'grant';
        if not granting and (why is null or char_length(why) > 1000) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
        end if;

        select * into request from public.discount_requests r where r.id = decide_discount.request_id;
        if not found then
            raise exception 'not_found';
        end if;
        if request.kind = 'sibling' then
            perform public.decide_sibling_request(request.id, granting, why);
            return;
        end if;
        perform public.lock_lead_family(request.lead_id);
        perform 1 from public.leads l where l.id = request.lead_id for update;
        select * into request from public.discount_requests r where r.id = decide_discount.request_id for update;

        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        if request.state <> 'pending' then
            if request.decided_by = staff_id
               and ((granting and request.state = 'granted') or (not granting and request.state = 'refused' and request.refusal_reason = why)) then
                return;
            end if;
            raise exception 'not_pending';
        end if;

        if granting then
            perform public.assert_lead_open(request.lead_id);
            update public.discount_requests r
            set state = 'granted',
                decided_by = staff_id,
                decided_at = now()
            where r.id = request.id;
            perform public.recompute_lead_fee(request.lead_id, 'discount');
        else
            update public.discount_requests r
            set state = 'refused',
                decided_by = staff_id,
                decided_at = now(),
                refusal_reason = why
            where r.id = request.id;
        end if;
    end;
    $fn$;

    revoke execute on function public.decide_discount(uuid, text, text) from public, anon;
    grant execute on function public.decide_discount(uuid, text, text) to authenticated;

    -- One Sibling request as the readers below give it. Internal.
    create function public.sibling_request_json(request public.discount_requests)
    returns jsonb
    language sql
    stable
    set search_path = ''
    as $fn$
        select jsonb_build_object(
            'id', request.id,
            'lead_id', request.lead_id,
            'state', request.state,
            'note', request.note,
            'group_id', request.group_id,
            'across_groups', request.merge_from_group_id is not null,
            'sibling_of_lead_id', request.sibling_of_lead_id,
            'sibling_of_student_name', (select l.student_name from public.leads l where l.id = request.sibling_of_lead_id),
            'sibling_of_father_full_name', (select l.father_full_name from public.leads l where l.id = request.sibling_of_lead_id),
            'requested_at', request.requested_at,
            'requested_by_id', request.requested_by,
            'requested_by', (select s.full_name from public.staff_members s where s.id = request.requested_by),
            'decided_at', request.decided_at,
            'decided_by', (select s.full_name from public.staff_members s where s.id = request.decided_by),
            'refusal_reason', request.refusal_reason,
            'withdrawn_by', (select s.full_name from public.staff_members s where s.id = request.withdrawn_by),
            'withdrawn_reason', request.withdrawn_reason,
            'fee_edit', request.fee_edit,
            'fee_edit_closed_at', request.fee_edit_closed_at,
            'fee_edit_closed_by', (select s.full_name from public.staff_members s where s.id = request.fee_edit_closed_by),
            'fee_edit_reason', request.fee_edit_reason
        );
    $fn$;

    revoke execute on function public.sibling_request_json(public.discount_requests) from public, anon, authenticated, service_role;

    -- lead_sibling_requests(lead_id): every Sibling request on a lead, newest
    -- first, for staff who may view leads.
    create function public.lead_sibling_requests(lead_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;
        if not exists (select 1 from public.leads l where l.id = lead_sibling_requests.lead_id) then
            raise exception 'not_found';
        end if;
        return coalesce((
            select jsonb_agg(public.sibling_request_json(r) order by r.requested_at desc, r.id)
            from public.discount_requests r
            where r.lead_id = lead_sibling_requests.lead_id and r.kind = 'sibling'
        ), '[]'::jsonb);
    end;
    $fn$;

    revoke execute on function public.lead_sibling_requests(uuid) from public, anon;
    grant execute on function public.lead_sibling_requests(uuid) to authenticated;

    -- pending_sibling_requests(): every Pending Sibling request, oldest
    -- first, with its lead and the lead's father's name, for the Manager.
    -- Needs discounts.approve.
    create function public.pending_sibling_requests()
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
        return coalesce((
            select jsonb_agg(public.sibling_request_json(r) || jsonb_build_object(
                'admission_number', l.admission_number,
                'student_name', l.student_name,
                'father_full_name', l.father_full_name,
                'class_name', l.class_name,
                'enrollment_year', l.enrollment_year,
                'day_or_boarding', l.day_or_boarding,
                'status', l.status,
                'lead_open', l.status <> 'Declined' and l.closure is null
            ) order by r.requested_at, r.id)
            from public.discount_requests r
            join public.leads l on l.id = r.lead_id
            where r.kind = 'sibling' and r.state = 'pending'
        ), '[]'::jsonb);
    end;
    $fn$;

    revoke execute on function public.pending_sibling_requests() from public, anon;
    grant execute on function public.pending_sibling_requests() to authenticated;

    -- close_sibling_fee_edit(lead_id, outcome, reason): closes the lead's
    -- "Granted: fee edit needed" as `applied` (#303's fee edit set the 10%)
    -- or `dismissed`, recording the staff member signed in. Returns how many
    -- it closed (0 or 1). The caller holds the lead's Family lock and checks
    -- payments.record. Internal.
    create function public.close_sibling_fee_edit(lead_id uuid, outcome text, reason text default null)
    returns integer
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        closed integer;
    begin
        if close_sibling_fee_edit.outcome is null or close_sibling_fee_edit.outcome not in ('applied', 'dismissed') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'outcome')::text;
        end if;
        update public.discount_requests r
        set fee_edit = close_sibling_fee_edit.outcome,
            fee_edit_closed_at = now(),
            fee_edit_closed_by = (select s.id from public.staff_members s where s.user_id = auth.uid()),
            fee_edit_reason = nullif(btrim(coalesce(close_sibling_fee_edit.reason, '')), '')
        where r.lead_id = close_sibling_fee_edit.lead_id
          and r.kind = 'sibling'
          and r.state = 'granted'
          and r.fee_edit = 'needed';
        get diagnostics closed = row_count;
        return closed;
    end;
    $fn$;

    revoke execute on function public.close_sibling_fee_edit(uuid, text, text) from public, anon, authenticated, service_role;

    -- dismiss_sibling_fee_edit(lead_id, reason): the Accountant closes
    -- "Granted: fee edit needed" without editing the fee, with a reason.
    -- Needs payments.record. Refusals: `not_permitted`, `not_found`,
    -- `invalid` (field `reason`), `not_needed`.
    create function public.dismiss_sibling_fee_edit(lead_id uuid, reason text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        why text := nullif(btrim(coalesce(dismiss_sibling_fee_edit.reason, '')), '');
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
            raise exception 'not_permitted';
        end if;
        if why is null or char_length(why) > 1000 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
        end if;
        perform public.lock_lead_family(dismiss_sibling_fee_edit.lead_id);
        perform 1 from public.leads l where l.id = dismiss_sibling_fee_edit.lead_id for update;
        if not found then
            raise exception 'not_found';
        end if;
        if public.close_sibling_fee_edit(dismiss_sibling_fee_edit.lead_id, 'dismissed', why) = 0 then
            raise exception 'not_needed';
        end if;
    end;
    $fn$;

    revoke execute on function public.dismiss_sibling_fee_edit(uuid, text) from public, anon;
    grant execute on function public.dismiss_sibling_fee_edit(uuid, text) to authenticated;

    -- -----------------------------------------------------------------------
    -- Father's-name changes.
    -- -----------------------------------------------------------------------

    -- sibling_check_on_father_name_change, as 20261213100100 made it. Only a
    -- member that counts by its name (matched or typo_confirmed) is checked
    -- again: a granted member counts by the Manager's decision, and a
    -- member waiting or refused stays so until a grant (R36). A member that
    -- stops counting withdraws its request to bring its group along. Same
    -- trigger.
    create or replace function public.sibling_check_on_father_name_change()
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
        if member.group_id is null or member.legacy or member.basis not in ('matched', 'typo_confirmed') then
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
            perform public.withdraw_stale_sibling_requests(array[new.id]);
        end if;
        return null;
    end;
    $fn$;

    revoke execute on function public.sibling_check_on_father_name_change() from public, anon, authenticated, service_role;

    -- -----------------------------------------------------------------------
    -- link_sibling, as 20261213100100 made it, now:
    --   - a refusal holds: a lead whose refusal about the group it joins
    --     stands is linked as `refused`, and a merge across a standing
    --     refusal is refused as invalid `sibling_of` (`refused_request`);
    --   - a granted member linked into another group is checked against it
    --     (the grant lapses); waiting and refused members keep their state;
    --   - the merge is merge_sibling_groups, which moves pending requests;
    --   - requests that no longer ask anything are withdrawn.
    -- Same signature and answers; `linked` may now give the basis `refused`.
    -- -----------------------------------------------------------------------

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

        if gx is not null and gx = gt and not mx.legacy then
            return jsonb_build_object('result', 'linked', 'basis', mx.basis, 'group_id', gx);
        end if;

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

        kept := array(
            select m.lead_id
            from public.sibling_group_members m
            join public.lead_sibling_results r on r.lead_id = m.lead_id
            where m.group_id in (gx, gt) and r.result = 'ten' and r.source = 'auto'
        );
        perform set_config('app.sibling_keep_ten', array_to_string(kept, ','), true);

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

        perform public.recompute_sibling_group(gt, 'sibling');
        perform public.recompute_sibling_group(moving_out, 'sibling');

        perform public.withdraw_stale_sibling_requests(
            public.sibling_group_leads(gt) || public.sibling_group_leads(moving_out) || array[x.id]
        );

        perform set_config('app.sibling_keep_ten', '', true);
        return jsonb_build_object('result', 'linked', 'basis', x_basis, 'group_id', gt);
    end;
    $fn$;

    revoke execute on function public.link_sibling(uuid, uuid, text, text, text, text) from public, anon;
    grant execute on function public.link_sibling(uuid, uuid, text, text, text, text) to authenticated;

    -- -----------------------------------------------------------------------
    -- Checks: nothing moved.
    -- -----------------------------------------------------------------------

    perform public.assert_fee_snapshot_unchanged('pg_temp.sibling_request_snapshot_before');
    drop table pg_temp.sibling_request_snapshot_before;

    perform set_config('audit.actor_kind', '', true);
end;
$migration$;
