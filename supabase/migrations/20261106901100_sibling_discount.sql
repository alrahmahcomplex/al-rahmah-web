-- The Sibling discount within a confirmed Family (slice 9, #113).
--
-- A lead gets the Sibling discount (10%) by itself when its Family link is
-- confirmed (its guardian contact carries no pending Family match) and
-- either another lead on the same guardian contact is Enrolled, or staff
-- ticked Has a sibling already at Al-Rahmah, or the lead became Enrolled
-- holding it (`sibling_kept`). A lead already Enrolled when a sibling enrols
-- doesn't gain it, so the first child to enrol pays the full fee. While a
-- lead is not Enrolled the discount follows the live condition; recompute
-- sets `sibling_kept` at the moment the lead becomes Enrolled holding it.
-- lead_discount picks the largest of Sibling, Staff child and Qualified
-- orphan, and every School fee reader goes through lead_fee_amounts, so the
-- fee, Seat priority, Enrolled, the seat counts and the payment preview all
-- follow.
--
-- What recomputes whom:
--   - An after-update trigger on leads, when a lead's status enters or leaves
--     Enrolled, recomputes the leads on its confirmed guardian contact that
--     are neither Enrolled nor Declined, with the cause `sibling`.
--   - The lead-details trigger also fires when a lead moves to another
--     guardian contact (confirming or separating a Family), with the cause
--     `family`: the lead itself, and the not-yet-Enrolled leads on the
--     contact it left and the one it joined.
--   - An after-update trigger on guardian_contacts, when the pending Family
--     match changes (rejecting a match), recomputes every lead on the
--     contact that isn't Declined, with the cause `family`.
--   - set_prior_sibling, with the cause `prior_sibling`.
--
-- The chain always ends. The cascade recomputes only leads that are not
-- Enrolled, and the one status change a recompute makes to such a lead is
-- into Enrolled. So every step of a cascade adds an Enrolled lead to a
-- finite Family, and an Enrolled lead is never recomputed by one.
--
-- Concurrency and lock order. Every recompute takes a transaction advisory
-- lock on the lead's guardian contact (lock_families), so two payments in
-- one Family take turns, and the second sees what the first enrolled. Locks
-- are taken in this order, never the other way:
--   1. hashtext('enrol_from_academic_year_start'), when the transaction
--      enrols from the Academic-year start or changes the start (#109);
--   2. the Family locks, several always in ascending key order;
--   3. lead rows.
-- So the functions that lock a lead row and then recompute (recording and
-- adjusting a payment, deciding a discount, the prior-sibling tick, the
-- Academic-year sweep, the year recompute, and settling a Family match) now
-- take the Family lock first. They are replaced below with that one change.
--
-- Refusal codes for set_prior_sibling: `not_permitted`, `not_found`,
-- `lead_closed` (from assert_lead_open), and `invalid` with the field
-- (`name` or `class`) in the detail.

-- ---------------------------------------------------------------------------
-- The two new causes, for the history's "because".
-- ---------------------------------------------------------------------------

alter table public.lead_fee_profiles drop constraint lead_fee_profiles_recompute_cause_check;

alter table public.lead_fee_profiles
    add constraint lead_fee_profiles_recompute_cause_check check (recompute_cause in (
        'payment',
        'payment_adjustment',
        'discount',
        'fee_schedule',
        'lead_details',
        'family',
        'academic_year_start',
        'reopening',
        'sibling',
        'prior_sibling'
    ));

-- The sibling's name, kept to what a person's name needs.
alter table public.lead_fee_profiles
    add constraint lead_fee_profiles_prior_sibling_name_length check (char_length(prior_sibling_name) <= 200);

-- The cascade reads a contact's leads by status.
create index if not exists leads_guardian_contact_status_idx on public.leads (guardian_contact_id, status);

-- ---------------------------------------------------------------------------
-- lock_families(contact_ids): the Family locks, one transaction advisory
-- lock per guardian contact, taken in ascending key order so two
-- transactions that need several never wait on each other in a circle. The
-- two-key form keeps them apart from #109's one-key lock. Held until the
-- transaction ends; taking one already held returns at once.
-- ---------------------------------------------------------------------------

create function public.lock_families(contact_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
    family_key integer;
begin
    for family_key in
        select distinct hashtext(c::text)
        from unnest(contact_ids) c
        where c is not null
        order by 1
    loop
        perform pg_advisory_xact_lock(hashtext('lead_family'), family_key);
    end loop;
end;
$$;

revoke execute on function public.lock_families(uuid[]) from public, anon, authenticated, service_role;

-- lock_lead_family(lead_id): the Family lock of the lead's guardian contact,
-- read without locking the lead. Returns the contact it locked, or null for
-- a lead that doesn't exist.
create function public.lock_lead_family(lead_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
    contact_id uuid;
begin
    select l.guardian_contact_id into contact_id from public.leads l where l.id = lock_lead_family.lead_id;
    perform public.lock_families(array[contact_id]);
    return contact_id;
end;
$$;

revoke execute on function public.lock_lead_family(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sibling_discount_applies(lead_id): whether the Sibling discount applies to
-- the lead now. No permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create function public.sibling_discount_applies(lead_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1
        from public.leads l
        join public.guardian_contacts g on g.id = l.guardian_contact_id
        left join public.lead_fee_profiles p on p.lead_id = l.id
        where l.id = sibling_discount_applies.lead_id
          and g.pending_family_match_id is null
          and (
              coalesce(p.sibling_kept, false)
              or coalesce(p.prior_sibling, false)
              or (
                  l.status <> 'Enrolled'
                  and exists (
                      select 1 from public.leads s
                      where s.guardian_contact_id = l.guardian_contact_id
                        and s.id <> l.id
                        and s.status = 'Enrolled'
                  )
              )
          )
    );
$$;

revoke execute on function public.sibling_discount_applies(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_discount, as 20261103900900_discount_requests.sql made it, now with
-- Sibling 10% beside the granted discounts. The largest wins. Same
-- signature.
-- ---------------------------------------------------------------------------

create or replace function public.lead_discount(lead_id uuid, out discount text, out percent integer)
language sql
stable
set search_path = ''
as $$
    select d.kind, d.percent
    from (
        select r.kind::text as kind,
               case r.kind when 'qualified_orphan' then 100 when 'staff_child' then 25 end as percent
        from public.discount_requests r
        where r.lead_id = lead_discount.lead_id and r.state = 'granted'
        union all
        select 'sibling', 10
        where public.sibling_discount_applies(lead_discount.lead_id)
    ) d
    order by d.percent desc
    limit 1;
$$;

revoke execute on function public.lead_discount(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- recompute_lead_fee, as 20261104901000_reopening_fees.sql made it, now:
--   - taking the Family lock before the lead's row lock;
--   - accepting the causes `sibling` and `prior_sibling`;
--   - setting `sibling_kept` when the lead becomes Enrolled while the
--     Sibling discount applies.
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
    on_date date := coalesce(as_of, public.tanzania_today());
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
    elsif target.status = 'Enrolled' and profile.enrolled_trigger is not null then
        -- Interviewed when the earlier status was never kept: the status a
        -- lead holds once it may pay.
        next_status := coalesce(profile.status_before_enrolled, 'Interviewed');
    else
        next_status := target.status;
    end if;

    -- Becoming Enrolled while the Sibling discount applies makes it the
    -- lead's for good, whatever its siblings do later.
    if next_status = 'Enrolled'
       and target.status <> 'Enrolled'
       and not coalesce(profile.sibling_kept, false)
       and public.sibling_discount_applies(target.id) then
        keeps_sibling := true;
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

    if next_status <> target.status then
        -- Slice 8's override lets this one update through on an Inactive or
        -- Archived lead; the caller's own override comes back after it.
        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('payment_recompute');
        update public.leads l set status = next_status where l.id = target.id;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end if;
end;
$$;

revoke execute on function public.recompute_lead_fee(uuid, text, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- recompute_family(contact_id, cause): recomputes the leads on a confirmed
-- guardian contact that are neither Enrolled nor Declined, in id order. A
-- contact with a pending Family match gives no Sibling discount, so nothing
-- on it depends on its other leads, and it is left alone.
-- ---------------------------------------------------------------------------

create function public.recompute_family(contact_id uuid, cause text)
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
end;
$$;

revoke execute on function public.recompute_family(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- When a lead's status enters or leaves Enrolled, its Family's leads that
-- are not yet Enrolled follow: they gain or lose the live Sibling discount.
-- The lead itself is among them when it left Enrolled, since the live
-- condition now counts for it.
-- ---------------------------------------------------------------------------

create function public.recompute_siblings_on_enrolled_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.recompute_family(new.guardian_contact_id, 'sibling');
    return null;
end;
$$;

revoke execute on function public.recompute_siblings_on_enrolled_change() from public, anon, authenticated, service_role;

create trigger recompute_siblings_on_enrolled_change
    after update of status on public.leads
    for each row
    when ((old.status = 'Enrolled') is distinct from (new.status = 'Enrolled'))
    execute function public.recompute_siblings_on_enrolled_change();

-- ---------------------------------------------------------------------------
-- The lead-details trigger, as 20261104901000_reopening_fees.sql made it,
-- now also firing when the lead moves to another guardian contact: staff
-- confirmed its Family match or separated it from a Family. The lead is
-- recomputed with the cause `family`, and so are the not-yet-Enrolled leads
-- on the contact it left and on the one it joined.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_lead_fee_on_lead_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if old.guardian_contact_id is distinct from new.guardian_contact_id then
        perform public.lock_families(array[old.guardian_contact_id, new.guardian_contact_id]);
        perform public.recompute_lead_fee(new.id, 'family');
        perform public.recompute_family(old.guardian_contact_id, 'family');
        perform public.recompute_family(new.guardian_contact_id, 'family');
        return null;
    end if;
    perform public.recompute_lead_fee(
        new.id,
        case when old.status = 'Declined' and new.status <> 'Declined' then 'reopening' else 'lead_details' end
    );
    return null;
end;
$$;

revoke execute on function public.recompute_lead_fee_on_lead_change() from public, anon, authenticated, service_role;

drop trigger recompute_lead_fee_on_lead_change on public.leads;

create trigger recompute_lead_fee_on_lead_change
    after update of class_name, enrollment_year, day_or_boarding, status, guardian_contact_id on public.leads
    for each row
    when (
        old.class_name is distinct from new.class_name
        or old.enrollment_year is distinct from new.enrollment_year
        or old.day_or_boarding is distinct from new.day_or_boarding
        or (old.status = 'Declined' and new.status <> 'Declined')
        or old.guardian_contact_id is distinct from new.guardian_contact_id
    )
    execute function public.recompute_lead_fee_on_lead_change();

-- ---------------------------------------------------------------------------
-- A pending Family match settled on a contact: rejecting it makes the
-- contact's leads a confirmed Family of their own. Every lead on it that
-- isn't Declined is recomputed with the cause `family`, the Enrolled ones
-- too, since a prior-sibling tick or a kept discount now counts for them.
-- Confirming moves the leads off the contact first, so it reaches nobody
-- here; the lead-details trigger above recomputes them.
-- ---------------------------------------------------------------------------

create function public.recompute_family_on_match_change()
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
    return null;
end;
$$;

revoke execute on function public.recompute_family_on_match_change() from public, anon, authenticated, service_role;

create trigger recompute_family_on_match_change
    after update of pending_family_match_id on public.guardian_contacts
    for each row
    when (old.pending_family_match_id is distinct from new.pending_family_match_id)
    execute function public.recompute_family_on_match_change();

-- ---------------------------------------------------------------------------
-- set_prior_sibling(lead_id, sibling_name, sibling_class): ticks Has a
-- sibling already at Al-Rahmah on an open lead, with the sibling's name and
-- class, or clears it when both are null. Needs leads.edit. Recomputes the
-- lead with the cause `prior_sibling` when the tick changes; the same tick
-- again changes nothing.
-- ---------------------------------------------------------------------------

create function public.set_prior_sibling(lead_id uuid, sibling_name text, sibling_class text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    clearing boolean := set_prior_sibling.sibling_name is null and set_prior_sibling.sibling_class is null;
    clean_name text := nullif(btrim(coalesce(set_prior_sibling.sibling_name, '')), '');
    chosen_class public.lead_class;
    profile public.lead_fee_profiles;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    if not clearing then
        if clean_name is null or char_length(clean_name) > 200 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'name')::text;
        end if;
        begin
            chosen_class := set_prior_sibling.sibling_class::public.lead_class;
        exception when invalid_text_representation then
            chosen_class := null;
        end;
        if chosen_class is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'class')::text;
        end if;
    end if;

    perform public.lock_lead_family(set_prior_sibling.lead_id);
    perform 1 from public.leads l where l.id = set_prior_sibling.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(set_prior_sibling.lead_id);

    select * into profile from public.lead_fee_profiles p where p.lead_id = set_prior_sibling.lead_id;
    if (coalesce(profile.prior_sibling, false), profile.prior_sibling_name, profile.prior_sibling_class)
       is not distinct from (not clearing, clean_name, chosen_class) then
        return;
    end if;

    insert into public.lead_fee_profiles as p (lead_id, prior_sibling, prior_sibling_name, prior_sibling_class)
    values (set_prior_sibling.lead_id, not clearing, clean_name, chosen_class)
    on conflict on constraint lead_fee_profiles_lead_id_key do update
    set prior_sibling = excluded.prior_sibling,
        prior_sibling_name = excluded.prior_sibling_name,
        prior_sibling_class = excluded.prior_sibling_class;

    perform public.recompute_lead_fee(set_prior_sibling.lead_id, 'prior_sibling');
end;
$$;

revoke execute on function public.set_prior_sibling(uuid, text, text) from public, anon;
grant execute on function public.set_prior_sibling(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lock_lead_contact, as 20261002100000_admission_form_family_match.sql made
-- it, now taking the Family locks of the lead's contact and of the Family it
-- is matched to before any row lock, since confirming, rejecting and
-- separating recompute the leads they move.
-- ---------------------------------------------------------------------------

create or replace function public.lock_lead_contact(lead_id uuid, out lead public.leads, out contact public.guardian_contacts)
language plpgsql
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    select * into lead from public.leads l where l.id = lock_lead_contact.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.lock_families(array[
        lead.guardian_contact_id,
        (select g.pending_family_match_id from public.guardian_contacts g where g.id = lead.guardian_contact_id)
    ]);
    perform 1 from public.leads l where l.guardian_contact_id = lead.guardian_contact_id order by l.id for update;
    select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for update;
    select * into lead from public.leads l where l.id = lock_lead_contact.lead_id;
    if lead.guardian_contact_id is distinct from contact.id then
        raise exception 'children_changed';
    end if;
end;
$$;

revoke execute on function public.lock_lead_contact(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- recompute_year_fees, as 20261025900500_enrol_from_payments.sql made it,
-- now taking the Family locks of every lead it will recompute, in key order,
-- before it recomputes any.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_year_fees(schedule_year integer, cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
    leads_to_recompute uuid[];
begin
    select coalesce(array_agg(l.id order by l.id), '{}')
    into leads_to_recompute
    from public.leads l
    where l.enrollment_year = schedule_year
      and l.status <> 'Declined'
      and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id);

    perform public.lock_families(array(
        select l.guardian_contact_id from public.leads l where l.id = any(leads_to_recompute)
    ));

    foreach each_lead in array leads_to_recompute loop
        perform public.recompute_lead_fee(each_lead, recompute_year_fees.cause);
    end loop;
end;
$$;

revoke execute on function public.recompute_year_fees(integer, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enrol_from_academic_year_start, as
-- 20261102900800_enrol_on_academic_year_start.sql made it, now taking the
-- Family locks of every lead it may enrol, in key order, after its own
-- advisory lock and before it locks any lead.
-- ---------------------------------------------------------------------------

create or replace function public.enrol_from_academic_year_start(as_of date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    each_lead uuid;
    candidates uuid[];
    enrolled integer := 0;
begin
    if as_of is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'as_of')::text;
    end if;

    perform pg_advisory_xact_lock(hashtext('enrol_from_academic_year_start'));

    select coalesce(array_agg(l.id order by l.id), '{}')
    into candidates
    from public.leads l
    join public.fee_schedules s on s.enrollment_year = l.enrollment_year
    where s.academic_year_start <= enrol_from_academic_year_start.as_of
      and l.status not in ('Enrolled', 'Declined')
      and exists (select 1 from public.school_fee_payments p where p.lead_id = l.id)
      and (public.lead_seat_priority(l.id)).priority = 'First instalment';

    perform public.lock_families(array(
        select l.guardian_contact_id from public.leads l where l.id = any(candidates)
    ));

    -- A lead something else enrolled or declined since the list was read is
    -- dropped, so it isn't counted. Every recompute takes the Family lock,
    -- and this run now holds them, so no other run moves these leads into
    -- Enrolled from here on.
    select coalesce(array_agg(l.id order by l.id), '{}')
    into candidates
    from public.leads l
    where l.id = any(candidates) and l.status not in ('Enrolled', 'Declined');

    foreach each_lead in array candidates loop
        -- An earlier sibling's enrolment may have enrolled it already, and
        -- a decline may have reached it while this run waited.
        perform 1 from public.leads l
        where l.id = each_lead and l.status not in ('Enrolled', 'Declined')
        for update;
        if not found then
            continue;
        end if;
        perform public.recompute_lead_fee(each_lead, 'academic_year_start', enrol_from_academic_year_start.as_of);
    end loop;

    -- Counted at the end, so a lead its sibling's enrolment enrolled in this
    -- run counts too.
    select count(*)::integer into enrolled
    from public.leads l
    where l.id = any(candidates) and l.status = 'Enrolled';

    return enrolled;
end;
$$;

revoke execute on function public.enrol_from_academic_year_start(date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_school_fee_payment, adjust_school_fee_payment and decide_discount,
-- as 20261025900500_enrol_from_payments.sql,
-- 20261101900700_payment_adjustments.sql and
-- 20261103900900_discount_requests.sql made them, each now taking the Family
-- lock before it locks the lead. Nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.record_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date,
    request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid;
    new_id uuid;
    seat record;
    earlier public.school_fee_payments;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;
    if record_school_fee_payment.request_id is null then
        raise exception 'request_missing';
    end if;
    perform public.lock_lead_family(record_school_fee_payment.lead_id);
    perform 1 from public.leads l where l.id = record_school_fee_payment.lead_id for update;

    -- A retry of a payment already recorded: hand back that payment instead
    -- of recording it again. The lead's row lock above makes two retries
    -- take turns, so the second sees the first. The same id with a different
    -- payment is a caller's mistake, refused rather than guessed at.
    select * into earlier from public.school_fee_payments p
    where p.request_id = record_school_fee_payment.request_id;
    if found then
        if earlier.lead_id <> record_school_fee_payment.lead_id
            or earlier.payment_type::text <> record_school_fee_payment.payment_type
            or earlier.amount is distinct from record_school_fee_payment.amount
            or earlier.paid_on <> record_school_fee_payment.paid_on
        then
            raise exception 'request_reused';
        end if;
        select * into seat from public.lead_seat_priority(record_school_fee_payment.lead_id);
        return jsonb_build_object(
            'payment_id', earlier.id,
            'total_paid', seat.total_paid,
            'priority', seat.priority
        );
    end if;

    perform public.check_school_fee_payment(lead_id, payment_type, amount, paid_on);

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by, request_id)
    values (
        record_school_fee_payment.lead_id,
        record_school_fee_payment.payment_type::public.school_fee_payment_type,
        record_school_fee_payment.amount::integer,
        record_school_fee_payment.paid_on,
        staff_id,
        record_school_fee_payment.request_id
    )
    returning id into new_id;

    perform public.recompute_lead_fee(record_school_fee_payment.lead_id, 'payment');

    select * into seat from public.lead_seat_priority(record_school_fee_payment.lead_id);

    return jsonb_build_object(
        'payment_id', new_id,
        'total_paid', seat.total_paid,
        'priority', seat.priority
    );
end;
$$;

revoke execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) from public, anon;
grant execute on function public.record_school_fee_payment(uuid, text, numeric, date, uuid) to authenticated;

create or replace function public.adjust_school_fee_payment(
    payment_id uuid,
    reason text,
    voided boolean,
    payment_type text,
    amount numeric,
    paid_on date,
    note text,
    request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    payment public.school_fee_payments;
    current_values record;
    earlier public.payment_adjustments;
    chosen_reason public.payment_adjustment_reason;
    chosen_type public.school_fee_payment_type;
    chosen_amount integer;
    clean_note text := nullif(btrim(adjust_school_fee_payment.note), '');
    staff_id uuid;
    new_id uuid;
    before_seat record;
    after_seat record;
    actor record;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;
    if adjust_school_fee_payment.request_id is null then
        raise exception 'request_missing';
    end if;

    select * into payment from public.school_fee_payments p where p.id = adjust_school_fee_payment.payment_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.lock_lead_family(payment.lead_id);
    perform 1 from public.leads l where l.id = payment.lead_id for update;

    -- A retry of an adjustment already made: hand it back instead of making
    -- it again. The same id with a different adjustment is refused.
    select * into earlier from public.payment_adjustments a
    where a.request_id = adjust_school_fee_payment.request_id;
    if found then
        if earlier.payment_id <> adjust_school_fee_payment.payment_id
            or earlier.reason::text is distinct from adjust_school_fee_payment.reason
            or earlier.voided is distinct from coalesce(adjust_school_fee_payment.voided, false)
            or (not earlier.voided and (
                earlier.payment_type::text is distinct from adjust_school_fee_payment.payment_type
                or (earlier.amount is not null and earlier.amount is distinct from adjust_school_fee_payment.amount)
                or earlier.paid_on is distinct from adjust_school_fee_payment.paid_on
            ))
            or earlier.note is distinct from clean_note
        then
            raise exception 'request_reused';
        end if;
        select * into after_seat from public.lead_seat_priority(payment.lead_id);
        return jsonb_build_object(
            'adjustment_id', earlier.id,
            'total_paid', after_seat.total_paid,
            'priority', after_seat.priority
        );
    end if;

    begin
        chosen_reason := adjust_school_fee_payment.reason::public.payment_adjustment_reason;
    exception when invalid_text_representation then
        chosen_reason := null;
    end;
    if chosen_reason is null or adjust_school_fee_payment.voided is null then
        raise exception 'invalid_reason';
    end if;
    if adjust_school_fee_payment.voided and chosen_reason <> 'Duplicate entry' then
        raise exception 'void_needs_duplicate';
    end if;
    if not adjust_school_fee_payment.voided and chosen_reason = 'Duplicate entry' then
        raise exception 'duplicate_needs_void';
    end if;

    -- The payment as it counts now: its newest adjustment, or as recorded.
    select a.voided, a.payment_type, a.amount, a.paid_on into current_values
    from public.payment_adjustments a
    where a.payment_id = payment.id
    order by a.sequence desc
    limit 1;
    if not found then
        select false as voided, payment.payment_type, payment.amount, payment.paid_on into current_values;
    end if;
    if current_values.voided and chosen_reason <> 'Data-entry correction' then
        raise exception 'restore_needs_correction';
    end if;

    if not adjust_school_fee_payment.voided then
        begin
            chosen_type := adjust_school_fee_payment.payment_type::public.school_fee_payment_type;
        exception when invalid_text_representation then
            chosen_type := null;
        end;
        if chosen_type is null then
            raise exception 'invalid_type';
        end if;
        if payment.payment_type = 'fee_waived' and chosen_type <> 'fee_waived' then
            raise exception 'type_from_fee_waived';
        end if;
        if chosen_type = 'fee_waived' and payment.payment_type <> 'fee_waived' then
            raise exception 'type_to_fee_waived';
        end if;
        if (payment.payment_type = 'pre_form_one_fee') <> (chosen_type = 'pre_form_one_fee') then
            raise exception 'type_pre_form_one';
        end if;

        if chosen_type <> 'fee_waived' then
            if adjust_school_fee_payment.amount is null or adjust_school_fee_payment.amount <= 0 then
                raise exception 'amount_not_positive';
            end if;
            if adjust_school_fee_payment.amount <> trunc(adjust_school_fee_payment.amount) then
                raise exception 'amount_not_whole';
            end if;
            if adjust_school_fee_payment.amount > 2147483647 then
                raise exception 'amount_too_large';
            end if;
            chosen_amount := adjust_school_fee_payment.amount::integer;
        end if;

        if adjust_school_fee_payment.paid_on is null then
            raise exception 'date_missing';
        end if;
        if adjust_school_fee_payment.paid_on > public.tanzania_today() then
            raise exception 'date_in_future';
        end if;
    end if;

    if char_length(clean_note) > 1000 then
        raise exception 'note_too_long';
    end if;

    if not current_values.voided
        and not adjust_school_fee_payment.voided
        and current_values.payment_type = chosen_type
        and current_values.amount is not distinct from chosen_amount
        and current_values.paid_on = adjust_school_fee_payment.paid_on
    then
        raise exception 'unchanged';
    end if;

    select * into before_seat from public.lead_seat_priority(payment.lead_id);
    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.payment_adjustments (
        payment_id, lead_id, reason, voided, payment_type, amount, paid_on, note, recorded_by, request_id
    ) values (
        payment.id,
        payment.lead_id,
        chosen_reason,
        adjust_school_fee_payment.voided,
        case when not adjust_school_fee_payment.voided then chosen_type end,
        case when not adjust_school_fee_payment.voided then chosen_amount end,
        case when not adjust_school_fee_payment.voided then adjust_school_fee_payment.paid_on end,
        clean_note,
        staff_id,
        adjust_school_fee_payment.request_id
    )
    returning id into new_id;

    perform public.recompute_lead_fee(payment.lead_id, 'payment_adjustment');

    -- The Seat priority is derived when read, so no row records its change.
    -- This entry does, in the lead history beside the adjustment that caused
    -- it. Only this function writes it; record_action knows no such kind, so
    -- nobody can post one by hand.
    select * into after_seat from public.lead_seat_priority(payment.lead_id);
    if after_seat.priority is distinct from before_seat.priority then
        select * into actor from public.audit_actor();
        insert into public.audit_log (row_id, lead_id, action, old_values, new_values, scope, actor_kind, actor_staff_id)
        values (
            new_id,
            payment.lead_id,
            'seat_priority_changed',
            jsonb_build_object('priority', before_seat.priority),
            jsonb_build_object('priority', after_seat.priority, 'cause', 'payment_adjustment'),
            'payment',
            actor.kind,
            actor.staff_id
        );
    end if;

    return jsonb_build_object(
        'adjustment_id', new_id,
        'total_paid', after_seat.total_paid,
        'priority', after_seat.priority
    );
end;
$$;

revoke execute on function public.adjust_school_fee_payment(uuid, text, boolean, text, numeric, date, text, uuid)
    from public, anon;
grant execute on function public.adjust_school_fee_payment(uuid, text, boolean, text, numeric, date, text, uuid)
    to authenticated;


create or replace function public.decide_discount(request_id uuid, decision text, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    perform public.lock_lead_family(request.lead_id);
    perform 1 from public.leads l where l.id = request.lead_id for update;
    select * into request from public.discount_requests r where r.id = decide_discount.request_id for update;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    if request.state <> 'pending' then
        -- The same decision again, as a retried click sends: already done.
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
$$;

revoke execute on function public.decide_discount(uuid, text, text) from public, anon;
grant execute on function public.decide_discount(uuid, text, text) to authenticated;
