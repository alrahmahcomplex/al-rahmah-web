-- One stored Sibling result per lead, locked at Enrolled (#297, for #291).
--
-- Until now lead_discount worked the Sibling discount out live on every read
-- (sibling_discount_applies), with one stored flag, sibling_kept, for a lead
-- that became Enrolled holding it. From here each lead stores its result in
-- lead_sibling_results:
--   result  full, ten or none. Only `ten` takes 10% off. `full` is a result
--           fixed at enrolment without the 10%; `none` is no Sibling result.
--   source  auto (today's rule), locked (fixed at enrolment), prior_sibling
--           (the Has a sibling already at Al-Rahmah tick). `manual` and
--           `legacy` are for #300 and the fee-edit ticket; nothing writes them
--           yet.
-- A lead with no row holds none/auto. sibling_discount_applies now reads the
-- stored result, so lead_discount, lead_fee_amounts and every fee reader
-- built on them (the School fee, Seat priority, Enrolled, the seat counts and
-- the payment preview) read it too.
--
-- The rule that writes it is today's, with one intended change. In order:
--   1. The lead's guardian contact carries a pending Family match: none.
--   2. Locked at enrolment with the 10%: ten (source locked).
--   3. The prior-sibling tick: ten (source prior_sibling).
--   4. Locked at enrolment without the 10%: full (source locked).
--   5. Not Enrolled, and another lead on the contact is Enrolled: ten (auto).
--   6. Otherwise none (auto).
-- The intended change (R27, R35): a lead is locked when it becomes Enrolled,
-- with whatever result it holds then, and the lock survives leaving Enrolled
-- through a payment correction, a decline or anything else. Today only a
-- kept 10% survived; a lead Enrolled at full went back to the live rule when
-- a correction took it out of Enrolled, and could gain the 10% from an
-- Enrolled sibling. Now it keeps its full result. sibling_kept is still
-- written, as the locked 10%, for one release; nothing reads it for the fee.
--
-- The kill switch (R13). sibling_rule_settings holds one setting. While new
-- grants are paused, rule 5 gives no new 10%: a lead not yet Enrolled that
-- doesn't already hold an automatic 10% stays at none, and one that becomes
-- Enrolled meanwhile locks at full. Leads that hold a 10% keep it, the tick
-- still works (it is staff's own answer, not the rule), and Enrolled results
-- never move. Resuming recomputes every Family the pause may have held back.
-- Only the database owner turns it, from the SQL editor:
--   select public.set_audit_actor('system');   -- or ('staff', <id>)
--   select public.set_sibling_grants_paused(true);
--
-- Migration-day safety (R12). Before anything changes, every lead's fee,
-- discount, status and Seat priority, and every year's seat counts, are
-- copied into a temporary table. The stored results are backfilled from
-- today's rule, a parity check compares each lead's stored 10% with
-- today's live answer, and at the end the snapshot is taken again and
-- compared. Any difference raises fee_snapshot_changed and the migration
-- stops. The snapshot and the check stay as functions, for the tests and for
-- #300's migration.
--
-- Who writes a stored result, always under the lead's Family lock:
--   - recompute_lead_fee, first thing after its locks (Declined leads too,
--     whose fee still reads the rule), and again when it enrols the lead,
--     which locks the result as it stands just before;
--   - recompute_family and the pending-match trigger, which now also refresh
--     the Declined leads on the contact;
--   - a new lead (it may join a contact with an Enrolled child), taking the
--     Family lock before the insert;
--   - any status change into Enrolled that didn't come through the recompute
--     (the student import): it locks with the rule's answer for an Enrolled
--     lead, which is what the import's Enrolled leads hold today;
--   - a change to the prior-sibling tick on lead_fee_profiles;
--   - resuming new grants.
-- The cascade still ends for the reason in 20261106901100: it recomputes only
-- leads not yet Enrolled, and the one status change it makes is into
-- Enrolled. Refreshing a Declined lead changes no status.
--
-- Lock order is unchanged: the Academic-year lock, then Family locks, then
-- rows. A new lead takes its contact's Family lock in a before-insert
-- trigger, after create_lead has taken the contact `for share`; confirming
-- or rejecting a match on that same contact at that moment can deadlock, and
-- Postgres then rolls one back, as the lock-order note in parallel-work.md
-- already says of lead corrections.

-- ---------------------------------------------------------------------------
-- The fee snapshot (R12).
-- ---------------------------------------------------------------------------

-- fee_snapshot(): one row per lead and one per year, class and Day or
-- boarding with seat holders. Internal; no API role may call it.
create function public.fee_snapshot()
returns table (item text, value jsonb)
language sql
stable
set search_path = ''
as $$
    select 'lead:' || l.id::text,
           jsonb_build_object(
               'status', l.status,
               'closure', l.closure,
               'has_schedule', fee.has_schedule,
               'band_fee', fee.band_fee,
               'school_fee', fee.school_fee,
               'first_amount', fee.first_amount,
               'second_amount', fee.second_amount,
               'third_amount', fee.third_amount,
               'discount', fee.discount,
               'discount_percent', fee.discount_percent,
               'total_paid', seat.total_paid,
               'priority', seat.priority,
               'reached_on', seat.reached_on
           )
    from public.leads l
    cross join lateral public.lead_fee_amounts(l.id) fee
    cross join lateral public.lead_seat_priority(l.id) seat
    union all
    select 'seats:' || s.enrollment_year || ':' || h.class_name || ':' || h.day_or_boarding,
           jsonb_build_object('taken', count(*))
    from public.fee_schedules s
    cross join lateral public.seat_holders(s.enrollment_year) h
    group by s.enrollment_year, h.class_name, h.day_or_boarding;
$$;

revoke execute on function public.fee_snapshot() from public, anon, authenticated, service_role;

-- assert_fee_snapshot_unchanged(before): raises fee_snapshot_changed, with up
-- to 20 differences in the detail, when fee_snapshot() now differs from the
-- table `before` holds (made with `create temp table ... as select * from
-- public.fee_snapshot()`). Internal.
create function public.assert_fee_snapshot_unchanged(before regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
    differences jsonb;
    total integer;
begin
    execute format(
        $q$
        with now_taken as (select * from public.fee_snapshot()),
        changed as (
            select coalesce(b.item, n.item) as item, b.value as before, n.value as after
            from %s b
            full join now_taken n on n.item = b.item
            where b.value is distinct from n.value
        )
        select count(*)::integer,
               (select jsonb_agg(to_jsonb(c) order by c.item) from (select * from changed order by item limit 20) c)
        from changed
        $q$,
        before
    ) into total, differences;

    if total > 0 then
        raise exception 'fee_snapshot_changed'
            using detail = jsonb_build_object('count', total, 'first', differences)::text;
    end if;
end;
$$;

revoke execute on function public.assert_fee_snapshot_unchanged(regclass) from public, anon, authenticated, service_role;

drop table if exists pg_temp.sibling_result_snapshot_before;
create temp table sibling_result_snapshot_before as select * from public.fee_snapshot();

-- ---------------------------------------------------------------------------
-- The stored result.
-- ---------------------------------------------------------------------------

create type public.sibling_result as enum ('full', 'ten', 'none');
create type public.sibling_result_source as enum ('auto', 'locked', 'manual', 'legacy', 'prior_sibling');

create table public.lead_sibling_results (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null unique references public.leads (id),
    result public.sibling_result not null default 'none',
    source public.sibling_result_source not null default 'auto',
    -- The result fixed when the lead became Enrolled, full or ten. It never
    -- changes once set, whatever the lead's status does afterwards.
    locked_result public.sibling_result check (locked_result <> 'none'),
    locked_at timestamptz,
    -- What last wrote the row: a recompute cause, or one of the events below.
    cause text not null check (cause in (
        'payment', 'payment_adjustment', 'discount', 'fee_schedule', 'lead_details', 'family',
        'academic_year_start', 'reopening', 'sibling', 'prior_sibling',
        'migration', 'lead_created', 'enrolled', 'grants_resumed'
    )),
    updated_at timestamptz not null default now(),
    check ((locked_result is null) = (locked_at is null)),
    check (source <> 'locked' or result = locked_result)
);

comment on column public.lead_fee_profiles.sibling_kept is
    'Since #297 the 10% locked at enrolment (lead_sibling_results.locked_result = ten), written for one release; no fee reads it.';

-- Reads only, for staff who may view leads, as lead_fee_profiles. Every
-- write is one of the functions below.
alter table public.lead_sibling_results enable row level security;

create policy "Staff who may view leads read Sibling results"
    on public.lead_sibling_results for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.lead_sibling_results from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The kill switch.
-- ---------------------------------------------------------------------------

create table public.sibling_rule_settings (
    id uuid primary key default gen_random_uuid(),
    -- Only ever one row.
    singleton boolean not null default true unique check (singleton),
    new_grants_paused boolean not null default false,
    -- Empty while it has never changed since setup.
    changed_at timestamptz,
    changed_by_kind text check (changed_by_kind in ('staff', 'system')),
    changed_by uuid references public.staff_members (id),
    check ((changed_at is null) = (changed_by_kind is null)),
    check ((changed_by_kind = 'staff') = (changed_by is not null))
);

alter table public.sibling_rule_settings enable row level security;

-- Nobody reads or writes it through the API; the functions below do, as the owner.
revoke all on public.sibling_rule_settings from anon, authenticated, service_role;

insert into public.audit_scopes (table_name, scope) values ('public.sibling_rule_settings', 'staff_admin');

create trigger audit_row_change
    after insert or update on public.sibling_rule_settings
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.sibling_rule_settings
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.sibling_rule_settings
    for each statement
    execute function public.refuse_delete();

do $$
begin
    perform public.set_audit_actor('system');
    insert into public.sibling_rule_settings (new_grants_paused) values (false);
    perform set_config('audit.actor_kind', '', true);
end;
$$;

-- The one reader of the switch. Internal.
create function public.sibling_grants_paused()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce((select s.new_grants_paused from public.sibling_rule_settings s), false);
$$;

revoke execute on function public.sibling_grants_paused() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sibling_rule_result(lead_id): what the rule gives the lead now, from its
-- contact, its tick, its lock and its siblings' statuses. Reads nothing it
-- writes, and ignores the kill switch (refresh applies it). Internal.
-- ---------------------------------------------------------------------------

create function public.sibling_rule_result(
    lead_id uuid,
    out result public.sibling_result,
    out source public.sibling_result_source
)
language sql
stable
set search_path = ''
as $$
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
        where l.id = sibling_rule_result.lead_id
    ) answer on true;
$$;

revoke execute on function public.sibling_rule_result(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- refresh_sibling_result(lead_id, cause): writes the rule's answer when it
-- differs from what is stored, under the lead's Family lock. While new grants
-- are paused, an automatic 10% the lead doesn't already hold is not given.
-- A lead with no row and nothing but none/auto gets no row. Internal.
-- ---------------------------------------------------------------------------

create function public.refresh_sibling_result(lead_id uuid, cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    stored public.lead_sibling_results;
    answer record;
    next_result public.sibling_result;
    next_source public.sibling_result_source;
begin
    perform public.lock_lead_family(refresh_sibling_result.lead_id);

    select * into stored from public.lead_sibling_results r where r.lead_id = refresh_sibling_result.lead_id for update;
    select * into answer from public.sibling_rule_result(refresh_sibling_result.lead_id);
    next_result := answer.result;
    next_source := answer.source;

    if next_result = 'ten' and next_source = 'auto' and public.sibling_grants_paused()
       and not (stored.id is not null and stored.result = 'ten' and stored.source = 'auto') then
        next_result := 'none';
    end if;

    if stored.id is null then
        if next_result = 'none' and next_source = 'auto' then
            return;
        end if;
        insert into public.lead_sibling_results (lead_id, result, source, cause)
        values (refresh_sibling_result.lead_id, next_result, next_source, refresh_sibling_result.cause);
    elsif (stored.result, stored.source) is distinct from (next_result, next_source) then
        update public.lead_sibling_results r
        set result = next_result,
            source = next_source,
            cause = refresh_sibling_result.cause,
            updated_at = now()
        where r.id = stored.id;
    end if;
end;
$$;

revoke execute on function public.refresh_sibling_result(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lock_sibling_result(lead_id, cause, refresh_first): fixes the lead's result
-- at enrolment, ten when it holds the 10% and full otherwise, then refreshes.
-- A lead already locked keeps its lock. With refresh_first, the result is
-- first refreshed for the lead as it stands now (used once the status already
-- says Enrolled); the recompute passes false, having refreshed just before
-- the lead's status moves. Internal.
-- ---------------------------------------------------------------------------

create function public.lock_sibling_result(lead_id uuid, cause text, refresh_first boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.lock_sibling_result(uuid, text, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The backfill: today's answer for every lead, stored. sibling_kept becomes a
-- ten lock and every Enrolled lead without it a full lock, which changes no
-- fee today: an Enrolled lead's live answer was the kept discount or the tick.
-- Written before the audit trigger exists, so it adds nothing to any lead's
-- history (R12).
-- ---------------------------------------------------------------------------

-- sibling_result_backfill(): each lead's row as the backfill writes it, from
-- today's inputs (sibling_kept, the tick, the contact and the statuses).
-- Leads it leaves out hold none/auto. Kept for the tests and #300.
-- Internal.
create function public.sibling_result_backfill()
returns table (
    lead_id uuid,
    result public.sibling_result,
    source public.sibling_result_source,
    locked_result public.sibling_result
)
language sql
stable
set search_path = ''
as $$
    select b.lead_id, b.result, b.source, b.locked_result
    from (
    select l.id as lead_id,
           locks.locked_result,
           case
               when g.id is null or g.pending_family_match_id is not null then 'none'
               when locks.locked_result = 'ten' then 'ten'
               when p.prior_sibling then 'ten'
               when locks.locked_result = 'full' then 'full'
               when l.status <> 'Enrolled' and exists (
                   select 1 from public.leads s
                   where s.guardian_contact_id = l.guardian_contact_id and s.id <> l.id and s.status = 'Enrolled'
               ) then 'ten'
               else 'none'
           end::public.sibling_result as result,
           case
               when g.id is null or g.pending_family_match_id is not null then 'auto'
               when locks.locked_result = 'ten' then 'locked'
               when p.prior_sibling then 'prior_sibling'
               when locks.locked_result = 'full' then 'locked'
               else 'auto'
           end::public.sibling_result_source as source
    from public.leads l
    left join public.guardian_contacts g on g.id = l.guardian_contact_id
    left join public.lead_fee_profiles p on p.lead_id = l.id
    cross join lateral (
        select case
                   when coalesce(p.sibling_kept, false) then 'ten'
                   when l.status = 'Enrolled' then 'full'
               end::public.sibling_result as locked_result
    ) locks
    ) b
    where not (b.result = 'none' and b.source = 'auto' and b.locked_result is null);
$$;

revoke execute on function public.sibling_result_backfill() from public, anon, authenticated, service_role;

insert into public.lead_sibling_results (lead_id, result, source, locked_result, locked_at, cause)
select b.lead_id, b.result, b.source, b.locked_result, case when b.locked_result is not null then now() end, 'migration'
from public.sibling_result_backfill() b;

-- Parity: every lead's stored 10% is today's live answer, before the reader
-- switches over.
do $$
declare
    mismatches integer;
begin
    select count(*)::integer into mismatches
    from public.leads l
    left join public.lead_sibling_results r on r.lead_id = l.id
    where coalesce(r.result = 'ten', false) is distinct from public.sibling_discount_applies(l.id);
    if mismatches > 0 then
        raise exception 'sibling_backfill_mismatch' using detail = mismatches::text;
    end if;
end;
$$;

-- Audit (ADR 4): the lead's history, from here on.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.lead_sibling_results', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.lead_sibling_results
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.lead_sibling_results
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.lead_sibling_results
    for each statement
    execute function public.refuse_delete();

-- ---------------------------------------------------------------------------
-- sibling_discount_applies, now the stored result. Same signature, so
-- lead_discount and everything after it read the stored value.
-- ---------------------------------------------------------------------------

create or replace function public.sibling_discount_applies(lead_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1 from public.lead_sibling_results r
        where r.lead_id = sibling_discount_applies.lead_id and r.result = 'ten'
    );
$$;

revoke execute on function public.sibling_discount_applies(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- recompute_lead_fee, as 20261204130500_student_import.sql made it, now:
--   - refreshing the stored result after its locks, Declined leads included;
--   - locking the result when the lead becomes Enrolled, and writing
--     sibling_kept from that lock.
-- Everything else is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_lead_fee(lead_id uuid, cause text, as_of date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    profile public.lead_fee_profiles;
    lines record;
    start_on date;
    -- The Academic-year sweep sets its date for the transaction, so a sibling
    -- its cascade recomputes is judged on the same day.
    on_date date := coalesce(as_of, nullif(current_setting('app.recompute_as_of', true), '')::date, public.tanzania_today());
    from_start date;
    qualifies boolean := false;
    trigger_kind text;
    trigger_payment uuid;
    trigger_on date;
    before_enrolled public.lead_status;
    next_status public.lead_status;
    earlier_override text;
    locked_contact uuid;
    keeps_sibling boolean := false;
    clears_import boolean := false;
begin
    if cause is null or cause not in (
        'payment', 'payment_adjustment', 'discount', 'fee_schedule',
        'lead_details', 'family', 'academic_year_start', 'reopening',
        'sibling', 'prior_sibling'
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'cause')::text;
    end if;

    -- The Family lock first, then the row: two recomputes in one Family take
    -- turns, and the second sees what the first enrolled.
    locked_contact := public.lock_lead_family(recompute_lead_fee.lead_id);

    -- Locked, so two recomputes of one lead take turns and the second sees
    -- what the first wrote.
    select * into target from public.leads l where l.id = recompute_lead_fee.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- Moved to another contact before the row lock was taken.
    if target.guardian_contact_id is distinct from locked_contact then
        perform public.lock_families(array[target.guardian_contact_id]);
    end if;

    -- The stored Sibling result first: the fee below reads it. A Declined
    -- lead's fee reads it too.
    perform public.refresh_sibling_result(target.id, recompute_lead_fee.cause);

    -- A Declined lead keeps its payments and its status.
    if target.status = 'Declined' then
        return;
    end if;

    select * into profile from public.lead_fee_profiles p where p.lead_id = target.id;
    select * into lines from public.lead_fee_crossings(target.id);

    if lines.has_schedule and lines.payments > 0 then
        select s.academic_year_start into start_on
        from public.fee_schedules s
        where s.enrollment_year = target.enrollment_year;

        if lines.first_on is not null and start_on is not null and greatest(lines.first_on, start_on) <= on_date then
            from_start := greatest(lines.first_on, start_on);
        end if;

        if lines.full_on is not null and (from_start is null or lines.full_on <= from_start) then
            qualifies := true;
            trigger_kind := 'payment';
            trigger_payment := lines.full_payment_id;
            trigger_on := lines.full_on;
        elsif from_start is not null then
            qualifies := true;
            if start_on > lines.first_on then
                trigger_kind := 'academic_year_start';
                trigger_on := start_on;
            else
                trigger_kind := 'payment';
                trigger_payment := lines.first_payment_id;
                trigger_on := lines.first_on;
            end if;
        end if;
    end if;

    if qualifies then
        next_status := 'Enrolled';
        before_enrolled := case when target.status = 'Enrolled' then profile.status_before_enrolled else target.status end;
        clears_import := target.enrolled_by_import;
    elsif target.enrolled_by_import and target.status = 'Enrolled' then
        -- The import's Enrolled stands until a payment qualifies.
        next_status := target.status;
    elsif target.status = 'Enrolled' and profile.enrolled_trigger is not null then
        -- Interviewed when the earlier status was never kept: the status a
        -- lead holds once it may pay.
        next_status := coalesce(profile.status_before_enrolled, 'Interviewed');
    else
        next_status := target.status;
    end if;

    -- Becoming Enrolled fixes the Sibling result the lead holds now, the 10%
    -- or the full fee, whatever its siblings do later (R27, R35). A lead
    -- locked on an earlier enrolment keeps that lock.
    if next_status = 'Enrolled' and target.status <> 'Enrolled' then
        perform public.lock_sibling_result(target.id, recompute_lead_fee.cause, false);
        keeps_sibling := not coalesce(profile.sibling_kept, false) and exists (
            select 1 from public.lead_sibling_results r where r.lead_id = target.id and r.locked_result = 'ten'
        );
    end if;

    -- Also written, for its cause alone, when the status is about to move
    -- and the profile's cause is another one: a lead declined while Enrolled
    -- keeps its profile, and when a reopening enrols it again the history
    -- must say the reopening did it, not the payment that first did.
    if (profile.id is null and (before_enrolled is not null or trigger_kind is not null))
       or (profile.id is not null and (
           profile.status_before_enrolled,
           profile.enrolled_trigger,
           profile.enrolled_trigger_payment_id,
           profile.enrolled_on
       ) is distinct from (before_enrolled, trigger_kind, trigger_payment, trigger_on))
       or (profile.id is not null
           and next_status <> target.status
           and profile.recompute_cause is distinct from recompute_lead_fee.cause)
       or keeps_sibling then
        insert into public.lead_fee_profiles as p (
            lead_id, status_before_enrolled, enrolled_trigger, enrolled_trigger_payment_id, enrolled_on, recompute_cause,
            sibling_kept
        ) values (
            target.id, before_enrolled, trigger_kind, trigger_payment, trigger_on, recompute_lead_fee.cause, keeps_sibling
        )
        on conflict on constraint lead_fee_profiles_lead_id_key do update
        set status_before_enrolled = excluded.status_before_enrolled,
            enrolled_trigger = excluded.enrolled_trigger,
            enrolled_trigger_payment_id = excluded.enrolled_trigger_payment_id,
            enrolled_on = excluded.enrolled_on,
            recompute_cause = excluded.recompute_cause,
            sibling_kept = p.sibling_kept or excluded.sibling_kept;
    end if;

    if next_status <> target.status or clears_import then
        -- Slice 8's override lets this one update through on an Inactive or
        -- Archived lead; the caller's own override comes back after it.
        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('payment_recompute');
        update public.leads l
        set status = next_status,
            enrolled_by_import = l.enrolled_by_import and not clears_import
        where l.id = target.id;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end if;
end;
$$;

revoke execute on function public.recompute_lead_fee(uuid, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- recompute_family, as 20261106901100_sibling_discount.sql made it, now also
-- refreshing the stored result of the contact's Declined leads, whose fee
-- still reads the rule.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_family(contact_id uuid, cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
begin
    if contact_id is null or exists (
        select 1 from public.guardian_contacts g
        where g.id = recompute_family.contact_id and g.pending_family_match_id is not null
    ) then
        return;
    end if;
    perform public.lock_families(array[contact_id]);

    for each_lead in
        select l.id
        from public.leads l
        where l.guardian_contact_id = recompute_family.contact_id
          and l.status not in ('Enrolled', 'Declined')
        order by l.id
    loop
        perform public.recompute_lead_fee(each_lead, recompute_family.cause);
    end loop;

    for each_lead in
        select l.id
        from public.leads l
        where l.guardian_contact_id = recompute_family.contact_id
          and l.status = 'Declined'
        order by l.id
    loop
        perform public.refresh_sibling_result(each_lead, recompute_family.cause);
    end loop;
end;
$$;

revoke execute on function public.recompute_family(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The pending-match trigger, as 20261106901100_sibling_discount.sql made it,
-- now also refreshing the contact's Declined leads.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_family_on_match_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
begin
    perform public.lock_families(array[new.id]);
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
$$;

revoke execute on function public.recompute_family_on_match_change() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A new lead: its contact's Family lock before the row exists, so a sibling
-- enrolling at the same moment is either seen or sees this lead; then its
-- stored result. A lead created Enrolled (seeds, fixtures) is locked as an
-- Enrolled lead.
-- ---------------------------------------------------------------------------

create function public.lock_family_before_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_families(array[new.guardian_contact_id]);
    return new;
end;
$$;

revoke execute on function public.lock_family_before_lead_insert() from public, anon, authenticated, service_role;

create trigger lock_family_before_lead_insert
    before insert on public.leads
    for each row
    execute function public.lock_family_before_lead_insert();

create function public.sibling_result_on_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.status = 'Enrolled' then
        perform public.lock_sibling_result(new.id, 'lead_created', true);
    else
        perform public.refresh_sibling_result(new.id, 'lead_created');
    end if;
    return null;
end;
$$;

revoke execute on function public.sibling_result_on_lead_insert() from public, anon, authenticated, service_role;

create trigger sibling_result_on_lead_insert
    after insert on public.leads
    for each row
    execute function public.sibling_result_on_lead_insert();

-- ---------------------------------------------------------------------------
-- A status change into Enrolled that didn't come through the recompute (the
-- student import's Enrolled): lock with the rule's answer for an Enrolled
-- lead, the tick or nothing. After the recompute's own lock this does
-- nothing.
-- ---------------------------------------------------------------------------

create function public.lock_sibling_result_on_enrolled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.lock_sibling_result(new.id, 'enrolled', true);
    return null;
end;
$$;

revoke execute on function public.lock_sibling_result_on_enrolled() from public, anon, authenticated, service_role;

create trigger lock_sibling_result_on_enrolled
    after update of status on public.leads
    for each row
    when (new.status = 'Enrolled' and old.status <> 'Enrolled')
    execute function public.lock_sibling_result_on_enrolled();

-- ---------------------------------------------------------------------------
-- The prior-sibling tick changed on the lead fee profile, by set_prior_sibling
-- or any other writer: the stored result follows.
-- ---------------------------------------------------------------------------

create function public.sibling_result_on_tick_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.refresh_sibling_result(new.lead_id, 'prior_sibling');
    return null;
end;
$$;

revoke execute on function public.sibling_result_on_tick_change() from public, anon, authenticated, service_role;

create trigger sibling_result_on_tick_change
    after insert or update of prior_sibling on public.lead_fee_profiles
    for each row
    when (new.prior_sibling)
    execute function public.sibling_result_on_tick_change();

create trigger sibling_result_on_tick_cleared
    after update of prior_sibling on public.lead_fee_profiles
    for each row
    when (old.prior_sibling and not new.prior_sibling)
    execute function public.sibling_result_on_tick_change();

-- ---------------------------------------------------------------------------
-- set_sibling_grants_paused(paused): turns the kill switch. For the database
-- owner only, after set_audit_actor('system') or set_audit_actor('staff',
-- <id>) in the same transaction. Resuming recomputes every confirmed Family
-- with an Enrolled child and a child not yet Enrolled, with the cause
-- `sibling`, under their Family locks in key order. The same value again
-- changes nothing.
-- ---------------------------------------------------------------------------

create function public.set_sibling_grants_paused(paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor record;
    was_paused boolean;
    families uuid[];
    each_contact uuid;
begin
    if set_sibling_grants_paused.paused is null then
        raise exception 'invalid';
    end if;
    select * into actor from public.audit_actor();
    if actor.kind is null or actor.kind not in ('staff', 'system') then
        raise exception 'not_permitted';
    end if;

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

    select coalesce(array_agg(distinct w.guardian_contact_id), '{}')
    into families
    from public.leads w
    join public.guardian_contacts g on g.id = w.guardian_contact_id
    where g.pending_family_match_id is null
      and w.status <> 'Enrolled'
      and exists (
          select 1 from public.leads s
          where s.guardian_contact_id = w.guardian_contact_id and s.id <> w.id and s.status = 'Enrolled'
      );

    perform public.lock_families(families);
    foreach each_contact in array families loop
        perform public.recompute_family(each_contact, 'sibling');
    end loop;
end;
$$;

revoke execute on function public.set_sibling_grants_paused(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nothing moved: the snapshot taken first matches what every lead and every
-- class holds now.
-- ---------------------------------------------------------------------------

select public.assert_fee_snapshot_unchanged('pg_temp.sibling_result_snapshot_before');

drop table pg_temp.sibling_result_snapshot_before;
