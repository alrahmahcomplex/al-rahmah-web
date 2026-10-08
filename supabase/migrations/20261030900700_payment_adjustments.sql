-- Adjust and void school-fee payments (slice 9, #110).
--
-- A recorded payment never changes. The Accountant corrects one with a
-- payment adjustment that states what the payment should have said: its
-- corrected payment type, amount and payment date, or that it is void. Each
-- adjustment carries a reason from a fixed list and an optional note. The
-- newest adjustment wins, so a wrong adjustment is fixed by adjusting the
-- same payment again, and a voided payment comes back the same way.
--
--   - A void needs the reason Duplicate entry, and Duplicate entry always
--     voids.
--   - A voided payment comes back only with Data-entry correction.
--   - No adjustment moves a payment between a school-fee type and the
--     Pre-Form One fee, makes a payment Fee waived, or changes a Fee waived
--     payment's type: each would move money between fees or get round the
--     Qualified orphan rule.
--
-- effective_school_fee_payments now applies the newest adjustment and drops
-- voided payments, so Total paid, the Seat priority, Enrolled and the seat
-- counts all follow adjustments without changing their own code.
--
-- Adjusting works on a Declined, Inactive or Archived lead: it corrects
-- history rather than continuing work, so it never calls assert_lead_open.
-- The lead is recomputed in the same transaction (recompute_lead_fee with
-- the cause `payment_adjustment`), which moves an Inactive or Archived lead
-- into or out of Enrolled through slice 8's `payment_recompute` override and
-- leaves a Declined lead's status alone. When the adjustment changes the
-- lead's Seat priority, the lead history gets a `seat_priority_changed`
-- entry saying from what to what.
--
-- Refusal codes: `not_permitted`, `forbidden` (reads), `not_found`,
-- `request_missing`, `request_reused`, `invalid_reason`, `void_needs_duplicate`,
-- `duplicate_needs_void`, `restore_needs_correction`, `invalid_type`,
-- `type_to_fee_waived`, `type_from_fee_waived`, `type_pre_form_one`,
-- `amount_not_positive`, `amount_not_whole`, `amount_too_large`,
-- `date_missing`, `date_in_future`, `note_too_long`, `unchanged`, and
-- `payment_locked` for any change to a recorded adjustment.

create type public.payment_adjustment_reason as enum (
    'Wrong amount',
    'Wrong payment type',
    'Wrong payment date',
    'Duplicate entry',
    'Data-entry correction'
);

-- ---------------------------------------------------------------------------
-- Payment adjustments. Never updated, never deleted.
-- ---------------------------------------------------------------------------

create table public.payment_adjustments (
    id uuid primary key default gen_random_uuid(),
    -- The order the adjustments were made in. The newest one, the highest
    -- sequence, gives the payment its effective values.
    sequence bigint generated always as identity unique,
    payment_id uuid not null references public.school_fee_payments (id),
    -- The payment's lead, so the adjustment shows in the lead's history.
    -- guard_payment_adjustment copies it from the payment.
    lead_id uuid not null references public.leads (id),
    reason public.payment_adjustment_reason not null,
    voided boolean not null default false,
    -- What the payment should have said; empty when voided. The amount is
    -- empty exactly for Fee waived.
    payment_type public.school_fee_payment_type,
    amount integer check (amount > 0),
    paid_on date,
    note text check (note is null or (btrim(note) <> '' and char_length(note) <= 1000)),
    recorded_by uuid not null references public.staff_members (id),
    recorded_at timestamptz not null default now(),
    -- The form's own id for one saved adjustment: a Save retried after a lost
    -- response gets the adjustment already made instead of a second one.
    request_id uuid unique,
    check (voided = (reason = 'Duplicate entry')),
    check (
        case when voided
            then payment_type is null and amount is null and paid_on is null
            else payment_type is not null and paid_on is not null and (payment_type = 'fee_waived') = (amount is null)
        end
    )
);

create index payment_adjustments_payment_idx on public.payment_adjustments (payment_id, sequence desc);
create index payment_adjustments_lead_idx on public.payment_adjustments (lead_id);
create index payment_adjustments_recorded_by_idx on public.payment_adjustments (recorded_by);

-- The rules no caller may skip: an adjustment never changes; it belongs to
-- its payment's lead; its date is never later than today in Tanzania; it
-- keeps the payment within its own fee and the Fee waived rule; and a
-- voided payment comes back only with Data-entry correction.
create function public.guard_payment_adjustment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    payment public.school_fee_payments;
    latest public.payment_adjustments;
begin
    if tg_op = 'UPDATE' then
        raise exception 'payment_locked';
    end if;

    select * into payment from public.school_fee_payments p where p.id = new.payment_id;
    if not found then
        raise exception 'not_found';
    end if;
    new.lead_id := payment.lead_id;

    select * into latest from public.payment_adjustments a
    where a.payment_id = new.payment_id
    order by a.sequence desc
    limit 1;
    if latest.voided and new.reason <> 'Data-entry correction' then
        raise exception 'restore_needs_correction';
    end if;

    if not new.voided then
        if new.paid_on > public.tanzania_today() then
            raise exception 'date_in_future';
        end if;
        if payment.payment_type = 'fee_waived' and new.payment_type <> 'fee_waived' then
            raise exception 'type_from_fee_waived';
        end if;
        if new.payment_type = 'fee_waived' and payment.payment_type <> 'fee_waived' then
            raise exception 'type_to_fee_waived';
        end if;
        if (payment.payment_type = 'pre_form_one_fee') <> (new.payment_type = 'pre_form_one_fee') then
            raise exception 'type_pre_form_one';
        end if;
    end if;
    return new;
end;
$$;

revoke execute on function public.guard_payment_adjustment() from public, anon, authenticated;

create trigger guard_payment_adjustment
    before insert or update on public.payment_adjustments
    for each row
    execute function public.guard_payment_adjustment();

-- Audit (ADR 4): the payment scope, on the payment's lead's history.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.payment_adjustments', 'payment', 'lead_id');

create trigger audit_row_change
    after insert or update on public.payment_adjustments
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.payment_adjustments
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.payment_adjustments
    for each statement
    execute function public.refuse_delete();

alter table public.payment_adjustments enable row level security;

create policy "Staff who may view payments read payment adjustments"
    on public.payment_adjustments for select
    to authenticated
    using ((select public.has_permission('payments.view')));

revoke insert, update, delete, truncate on public.payment_adjustments from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- effective_school_fee_payments, as #107 made it, keeping its columns: each
-- payment as its newest adjustment says, and voided payments left out. The
-- payment keeps its own recorded_at, which only orders payments paid on the
-- same day. No permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create or replace function public.effective_school_fee_payments(lead_id uuid)
returns table (
    payment_id uuid,
    payment_type public.school_fee_payment_type,
    amount integer,
    paid_on date,
    recorded_at timestamptz
)
language sql
stable
set search_path = ''
as $$
    select p.id,
           coalesce(a.payment_type, p.payment_type),
           case when a.id is null then p.amount else a.amount end,
           coalesce(a.paid_on, p.paid_on),
           p.recorded_at
    from public.school_fee_payments p
    left join lateral (
        select x.id, x.voided, x.payment_type, x.amount, x.paid_on
        from public.payment_adjustments x
        where x.payment_id = p.id
        order by x.sequence desc
        limit 1
    ) a on true
    where p.lead_id = effective_school_fee_payments.lead_id
      and a.voided is not true;
$$;

revoke execute on function public.effective_school_fee_payments(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- adjust_school_fee_payment: records an adjustment under the signed-in
-- Accountant and recomputes the lead. Needs payments.record, and nothing
-- about the lead: a closed lead takes adjustments too.
--
-- `voided` true voids the payment (reason Duplicate entry); the type, amount
-- and date are then ignored. Otherwise they are what the payment should have
-- said; the amount is ignored for Fee waived. An adjustment that would leave
-- the payment as it already counts is refused as `unchanged`.
--
-- The lead row is locked first, as recording a payment does, so adjustments
-- and payments on one lead are checked and counted one after the other.
-- ---------------------------------------------------------------------------

create function public.adjust_school_fee_payment(
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

-- ---------------------------------------------------------------------------
-- lead_school_fee_payments, as #107 made it, now with each payment as it
-- counts (its effective type, amount and date, and whether it is void) and
-- its adjustments, oldest first, each with who made it and when. Newest
-- effective payment date first. Its result changes, so it is dropped and made
-- again with the same grants. Needs leads.view and payments.view.
-- ---------------------------------------------------------------------------

drop function public.lead_school_fee_payments(uuid);

create function public.lead_school_fee_payments(lead_id uuid)
returns table (
    id uuid,
    payment_type public.school_fee_payment_type,
    amount integer,
    paid_on date,
    recorded_at timestamptz,
    recorded_by_name text,
    voided boolean,
    effective_type public.school_fee_payment_type,
    effective_amount integer,
    effective_paid_on date,
    adjustments jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;
    if not exists (select 1 from public.leads l where l.id = lead_school_fee_payments.lead_id) then
        raise exception 'not_found';
    end if;

    return query
    select p.id, p.payment_type, p.amount, p.paid_on, p.recorded_at, s.full_name,
           coalesce(latest.voided, false),
           case when latest.voided then null else coalesce(latest.payment_type, p.payment_type) end,
           case when latest.voided then null when latest.id is null then p.amount else latest.amount end,
           case when latest.voided then null else coalesce(latest.paid_on, p.paid_on) end,
           coalesce(made.adjustments, '[]'::jsonb)
    from public.school_fee_payments p
    left join public.staff_members s on s.id = p.recorded_by
    left join lateral (
        select x.id, x.voided, x.payment_type, x.amount, x.paid_on
        from public.payment_adjustments x
        where x.payment_id = p.id
        order by x.sequence desc
        limit 1
    ) latest on true
    left join lateral (
        select jsonb_agg(
                   jsonb_build_object(
                       'id', x.id,
                       'reason', x.reason,
                       'voided', x.voided,
                       'payment_type', x.payment_type,
                       'amount', x.amount,
                       'paid_on', x.paid_on,
                       'note', x.note,
                       'recorded_at', x.recorded_at,
                       'recorded_by_name', r.full_name
                   )
                   order by x.sequence
               ) as adjustments
        from public.payment_adjustments x
        left join public.staff_members r on r.id = x.recorded_by
        where x.payment_id = p.id
    ) made on true
    where p.lead_id = lead_school_fee_payments.lead_id
    order by case when latest.voided then p.paid_on else coalesce(latest.paid_on, p.paid_on) end desc,
             p.recorded_at desc,
             p.id desc;
end;
$$;

revoke execute on function public.lead_school_fee_payments(uuid) from public, anon;
grant execute on function public.lead_school_fee_payments(uuid) to authenticated;
