-- Staff child and Qualified orphan discounts, and Fee waived (slice 9, #112).
--
-- Admissions Staff request a Staff child or Qualified orphan discount on a
-- lead, with a note. The Admissions Manager grants it, or refuses it with a
-- written reason the requester reads on the lead. A lead holds at most one
-- Pending request: a partial unique index keeps that rule, so two staff
-- requesting at once end with one request and one `already_pending`. Once a
-- request leaves Pending it never changes again, and no request is ever
-- deleted (ADR 4). Supporting documents are checked outside the system.
--
-- A granted request is the lead's discount of that kind. The School fee is
-- the band fee less the largest discount the lead holds (Staff child 25%,
-- Qualified orphan 100%), rounded to the whole shilling. #113 adds Sibling
-- 10% to lead_discount. lead_fee_amounts is the one place the fee is
-- calculated, so the lead's fee, its Seat priority, Enrolled, the seat
-- counts and the payment preview all follow a grant without changing their
-- own code. A grant recomputes the lead (recompute_lead_fee with the cause
-- `discount`), so a lower fee enrols a lead whose payments now reach the
-- line. Nothing withdraws a granted discount (#29, out of scope).
--
-- With a granted Qualified orphan discount the School fee is 0, and the
-- Accountant may record Fee waived, with no amount, which makes the lead
-- Full. The Discount code never touches school fees.
--
-- Refusal codes: `not_permitted`, `not_found`, `lead_closed` (from
-- assert_lead_open), `invalid` with the field in the detail,
-- `already_pending` (with the requester's name and the date as JSON in the
-- detail), `already_granted`, `not_pending`, `request_missing`,
-- `request_reused`, `busy`, and for payments `not_waivable`,
-- `amount_not_allowed` and `already_waived`.

create type public.discount_kind as enum ('staff_child', 'qualified_orphan');

create type public.discount_request_state as enum ('pending', 'granted', 'refused');

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.discount_requests (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    kind public.discount_kind not null,
    -- What the Manager needs to decide. It sits in the audit log for good, so
    -- the form asks staff to write only that.
    note text not null check (btrim(note) <> '' and char_length(note) <= 1000),
    requested_by uuid not null references public.staff_members (id),
    requested_at timestamptz not null default now(),
    state public.discount_request_state not null default 'pending',
    decided_by uuid references public.staff_members (id),
    decided_at timestamptz,
    refusal_reason text check (refusal_reason is null or (btrim(refusal_reason) <> '' and char_length(refusal_reason) <= 1000)),
    -- The form's own id for one request: a Request retried after a lost
    -- response gets the request already made instead of `already_pending`.
    request_id uuid unique,
    constraint discount_requests_decided_check
        check ((state = 'pending') = (decided_at is null) and (state = 'pending') = (decided_by is null)),
    constraint discount_requests_refusal_check
        check ((state = 'refused') = (refusal_reason is not null))
);

-- One Pending request per lead.
create unique index discount_requests_one_pending_idx on public.discount_requests (lead_id) where state = 'pending';
-- One granted discount of each kind per lead.
create unique index discount_requests_one_granted_idx on public.discount_requests (lead_id, kind) where state = 'granted';
create index discount_requests_lead_idx on public.discount_requests (lead_id, requested_at desc);
-- The Manager's list, oldest first.
create index discount_requests_pending_idx on public.discount_requests (requested_at) where state = 'pending';
create index discount_requests_requested_by_idx on public.discount_requests (requested_by);
create index discount_requests_decided_by_idx on public.discount_requests (decided_by) where decided_by is not null;

-- A request is written once and then only taken out of Pending, once. What
-- was asked, by whom and when never changes, and a decided request never
-- changes at all.
create function public.refuse_decided_discount_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.state <> 'pending'
       or new.lead_id is distinct from old.lead_id
       or new.kind is distinct from old.kind
       or new.note is distinct from old.note
       or new.requested_by is distinct from old.requested_by
       or new.requested_at is distinct from old.requested_at
       or new.request_id is distinct from old.request_id then
        raise exception 'update_refused' using detail = tg_table_name;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_decided_discount_change() from public, anon, authenticated;

create trigger refuse_decided_change
    before update on public.discount_requests
    for each row
    execute function public.refuse_decided_discount_change();

-- Audit (ADR 4): the lead's history.
insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.discount_requests', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.discount_requests
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.discount_requests
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.discount_requests
    for each statement
    execute function public.refuse_delete();

-- Reads only, for staff who may view leads. Every write is a function below
-- that checks its own permission.
alter table public.discount_requests enable row level security;

create policy "Staff who may view leads read discount requests"
    on public.discount_requests for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.discount_requests from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_discount(lead_id): the one discount the lead's School fee carries, the
-- largest it holds, and its percentage; both empty when it holds none. #113
-- adds Sibling here. No permission check, so no API role may call it.
-- ---------------------------------------------------------------------------

create function public.lead_discount(lead_id uuid, out discount text, out percent integer)
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
    ) d
    order by d.percent desc
    limit 1;
$$;

revoke execute on function public.lead_discount(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_fee_amounts, as #106 made it, now taking the discount off: School fee
-- = band fee less the discount, rounded to the whole shilling. It also says
-- the band fee and the discount, so its result changes, and it is dropped and
-- made again. Its callers are PL/pgSQL functions that read it by column name,
-- so they need no change. No API role may call it.
-- ---------------------------------------------------------------------------

drop function public.lead_fee_amounts(uuid);

create function public.lead_fee_amounts(
    lead_id uuid,
    out enrollment_year integer,
    out band public.fee_band,
    out day_or_boarding public.day_or_boarding,
    out has_schedule boolean,
    out school_fee integer,
    out first_amount integer,
    out first_due date,
    out second_amount integer,
    out second_due date,
    out third_amount integer,
    out third_due date,
    out band_fee integer,
    out discount text,
    out discount_percent integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
    lead public.leads;
    schedule public.fee_schedules;
    held record;
begin
    select * into lead from public.leads l where l.id = lead_fee_amounts.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    enrollment_year := lead.enrollment_year;
    band := public.fee_band_of(lead.class_name);
    day_or_boarding := lead.day_or_boarding;

    select * into held from public.lead_discount(lead.id);
    discount := held.discount;
    discount_percent := held.percent;

    select * into schedule from public.fee_schedules s where s.enrollment_year = lead.enrollment_year;
    has_schedule := found;
    if not has_schedule then
        return;
    end if;

    select case lead.day_or_boarding when 'Day' then a.day_fee else a.boarding_fee end
    into band_fee
    from public.fee_band_amounts a
    where a.enrollment_year = lead.enrollment_year and a.band = lead_fee_amounts.band;

    school_fee := round(band_fee::numeric * (100 - coalesce(discount_percent, 0)) / 100)::integer;
    first_amount := round(school_fee::numeric * schedule.first_share / 100)::integer;
    second_amount := round(school_fee::numeric * schedule.second_share / 100)::integer;
    third_amount := school_fee - first_amount - second_amount;
    first_due := schedule.first_due;
    second_due := schedule.second_due;
    third_due := schedule.third_due;
end;
$$;

revoke execute on function public.lead_fee_amounts(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_fee_crossings, as #108 made it, now adding the unrecorded payment of
-- a preview whenever it has a date, so a Fee waived preview, which has no
-- amount, counts as a payment of nothing. Same signature and columns.
-- ---------------------------------------------------------------------------

create or replace function public.lead_fee_crossings(
    lead_id uuid,
    with_amount integer default null,
    with_paid_on date default null,
    out has_schedule boolean,
    out school_fee integer,
    out total_paid bigint,
    out payments integer,
    out full_on date,
    out full_payment_id uuid,
    out first_on date,
    out first_payment_id uuid,
    out deposit_on date
)
language plpgsql
stable
set search_path = ''
as $$
declare
    fee record;
    schedule public.fee_schedules;
begin
    select * into fee from public.lead_fee_amounts(lead_fee_crossings.lead_id);
    has_schedule := fee.has_schedule;
    school_fee := fee.school_fee;

    select * into schedule from public.fee_schedules s where s.enrollment_year = fee.enrollment_year;

    with counted as (
        select e.payment_id, e.amount::bigint as amount, e.paid_on, e.recorded_at, e.payment_id::text as tiebreak
        from public.effective_school_fee_payments(lead_fee_crossings.lead_id) e
        where e.payment_type <> 'pre_form_one_fee'
        union all
        select null::uuid, with_amount, with_paid_on, now(), 'unrecorded'
        where with_paid_on is not null
    ),
    running as (
        select c.payment_id, c.paid_on, c.recorded_at, c.tiebreak,
               sum(coalesce(c.amount, 0)) over (order by c.paid_on, c.recorded_at, c.tiebreak rows unbounded preceding) as total
        from counted c
    ),
    crossings as (
        select r.*,
               r.total >= school_fee as full_line,
               r.total * 100 >= school_fee::bigint * schedule.first_share as first_line,
               r.total >= schedule.minimum_deposit as deposit_line
        from running r
    )
    select count(*)::integer,
           coalesce(max(x.total), 0),
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.full_line))[1],
           (array_agg(x.payment_id order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.full_line))[1],
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.first_line))[1],
           (array_agg(x.payment_id order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.first_line))[1],
           (array_agg(x.paid_on order by x.paid_on, x.recorded_at, x.tiebreak) filter (where x.deposit_line))[1]
    into payments, total_paid, full_on, full_payment_id, first_on, first_payment_id, deposit_on
    from crossings x;

    if not has_schedule then
        full_on := null;
        full_payment_id := null;
        first_on := null;
        first_payment_id := null;
        deposit_on := null;
    end if;
end;
$$;

revoke execute on function public.lead_fee_crossings(uuid, integer, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_school_fee_payment, as #107 made it, now taking Fee waived: with no
-- amount, only while the lead holds a granted Qualified orphan discount, and
-- once. Every other rule is unchanged, and the preview and the recording
-- both still call it.
-- ---------------------------------------------------------------------------

create or replace function public.check_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
    current_result public.interview_result;
    lead_year integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    select l.enrollment_year into lead_year from public.leads l where l.id = check_school_fee_payment.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(check_school_fee_payment.lead_id);

    select i.result into current_result
    from public.interviews i
    where i.lead = check_school_fee_payment.lead_id
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    if current_result is distinct from 'Passed' then
        raise exception 'not_passed';
    end if;

    if not exists (select 1 from public.fee_schedules s where s.enrollment_year = lead_year) then
        raise exception 'no_schedule';
    end if;

    -- The Pre-Form One fee comes with its own ticket (#114).
    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment', 'fee_waived'
    ) then
        raise exception 'invalid_type';
    end if;

    if payment_type = 'fee_waived' then
        if not exists (
            select 1 from public.discount_requests r
            where r.lead_id = check_school_fee_payment.lead_id and r.kind = 'qualified_orphan' and r.state = 'granted'
        ) then
            raise exception 'not_waivable';
        end if;
        if amount is not null then
            raise exception 'amount_not_allowed';
        end if;
        if exists (
            select 1 from public.effective_school_fee_payments(check_school_fee_payment.lead_id) e
            where e.payment_type = 'fee_waived'
        ) then
            raise exception 'already_waived';
        end if;
    else
        if amount is null or amount <= 0 then
            raise exception 'amount_not_positive';
        end if;
        if amount <> trunc(amount) then
            raise exception 'amount_not_whole';
        end if;
        if amount > 2147483647 then
            raise exception 'amount_too_large';
        end if;
    end if;

    if paid_on is null then
        raise exception 'date_missing';
    end if;
    if paid_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
end;
$$;

revoke execute on function public.check_school_fee_payment(uuid, text, numeric, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A lead counts at most one Fee waived payment. Recording checks it above;
-- this trigger checks the other way one could come back: restoring a voided
-- Fee waived payment (Data-entry correction) while another one counts. It
-- runs after guard_payment_adjustment, which has set the adjustment's lead.
-- ---------------------------------------------------------------------------

create function public.refuse_second_fee_waiver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if not new.voided
       and new.payment_type = 'fee_waived'
       and exists (
           select 1 from public.effective_school_fee_payments(new.lead_id) e
           where e.payment_type = 'fee_waived' and e.payment_id <> new.payment_id
       ) then
        raise exception 'already_waived';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_second_fee_waiver() from public, anon, authenticated;

create trigger refuse_second_fee_waiver
    before insert on public.payment_adjustments
    for each row
    execute function public.refuse_second_fee_waiver();

-- ---------------------------------------------------------------------------
-- request_discount(lead_id, kind, note, request_id): asks for a Staff child
-- or Qualified orphan discount on an open lead. Needs leads.edit. Refuses a
-- lead with a Pending request as `already_pending`, and a kind the lead
-- already holds as `already_granted`. Returns the request's id; the same
-- request sent again with the same id returns it again.
-- ---------------------------------------------------------------------------

create function public.request_discount(lead_id uuid, kind text, note text, request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
    if chosen is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end if;
    if written = '' or char_length(written) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
    end if;

    -- Held shared, so a closure or a decision running alongside finishes
    -- first and is seen.
    perform 1 from public.leads l where l.id = request_discount.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;

    -- A retry of a request already made: hand it back. The same id with a
    -- different request is a caller's mistake, refused rather than guessed at.
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

    -- Two staff requesting at once both pass a check made here, so the unique
    -- index decides: whoever inserts second waits for the first to commit and
    -- is then refused, naming the request that won. If that request was
    -- decided before it could be read, there is no winner to name and a new
    -- request is allowed again, so the insert is tried again.
    for attempt in 1..3 loop
        begin
            insert into public.discount_requests (lead_id, kind, note, requested_by, request_id)
            values (request_discount.lead_id, chosen, written, staff_id, request_discount.request_id)
            returning id into new_id;
            return new_id;
        exception when unique_violation then
            -- The same request sent twice at once: the first one's.
            select * into earlier from public.discount_requests r where r.request_id = request_discount.request_id;
            if found then
                if earlier.lead_id <> request_discount.lead_id or earlier.kind <> chosen or earlier.note <> written then
                    raise exception 'request_reused';
                end if;
                return earlier.id;
            end if;
            select * into pending from public.discount_requests r
            where r.lead_id = request_discount.lead_id and r.state = 'pending';
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
$$;

revoke execute on function public.request_discount(uuid, text, text, uuid) from public, anon;
grant execute on function public.request_discount(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_discount(request_id, decision, reason): the Manager grants a Pending
-- request (`grant`) or refuses it with a written reason (`refuse`). Needs
-- discounts.approve. A grant needs the lead open, and recomputes it in the
-- same transaction, so a lower fee may enrol it. A refusal works on a closed
-- lead too, so no request waits for ever. The same decision sent again by the
-- same Manager succeeds without changing anything.
--
-- The lead is locked before the request, the order request_discount takes
-- them in, so a request and a decision on one lead never wait on each other
-- in a circle.
-- ---------------------------------------------------------------------------

create function public.decide_discount(request_id uuid, decision text, reason text default null)
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

-- ---------------------------------------------------------------------------
-- lead_discount_requests(lead_id): every request on a lead, newest first, for
-- staff who may view leads, each naming the requester and the Manager who
-- decided it, looked up now, since staff who may view leads cannot read
-- staff_members themselves.
-- ---------------------------------------------------------------------------

create function public.lead_discount_requests(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        where r.lead_id = lead_discount_requests.lead_id
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.lead_discount_requests(uuid) from public, anon;
grant execute on function public.lead_discount_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- pending_discount_requests(): every Pending request, oldest first, with its
-- lead, for the Manager's Discount requests screen. Needs discounts.approve.
-- ---------------------------------------------------------------------------

create function public.pending_discount_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        where r.state = 'pending'
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.pending_discount_requests() from public, anon;
grant execute on function public.pending_discount_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- lead_school_fee, as #108 made it, now also naming the band fee and the
-- discount the School fee carries, with its percentage. Its result changes,
-- so it is dropped and made again with the same grants.
-- ---------------------------------------------------------------------------

drop function public.lead_school_fee(uuid);

create function public.lead_school_fee(
    lead_id uuid,
    out enrollment_year integer,
    out band public.fee_band,
    out day_or_boarding public.day_or_boarding,
    out has_schedule boolean,
    out school_fee integer,
    out total_paid bigint,
    out balance bigint,
    out first_amount integer,
    out first_due date,
    out second_amount integer,
    out second_due date,
    out third_amount integer,
    out third_due date,
    out priority public.seat_priority,
    out priority_reached_on date,
    out enrolled_trigger text,
    out enrolled_on date,
    out enrolled_payment_type public.school_fee_payment_type,
    out enrolled_payment_amount integer,
    out band_fee integer,
    out discount text,
    out discount_percent integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    fee record;
    seat record;
    profile public.lead_fee_profiles;
begin
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.view')
       or not public.has_permission('payments.view') then
        raise exception 'forbidden';
    end if;

    select * into fee from public.lead_fee_amounts(lead_school_fee.lead_id);

    enrollment_year := fee.enrollment_year;
    band := fee.band;
    day_or_boarding := fee.day_or_boarding;
    has_schedule := fee.has_schedule;
    discount := fee.discount;
    discount_percent := fee.discount_percent;
    if not has_schedule then
        return;
    end if;

    select * into seat from public.lead_seat_priority(lead_school_fee.lead_id);

    band_fee := fee.band_fee;
    school_fee := fee.school_fee;
    total_paid := seat.total_paid;
    balance := school_fee - total_paid;
    first_amount := fee.first_amount;
    first_due := fee.first_due;
    second_amount := fee.second_amount;
    second_due := fee.second_due;
    third_amount := fee.third_amount;
    third_due := fee.third_due;
    priority := seat.priority;
    priority_reached_on := seat.reached_on;

    -- The trigger is set while recompute_lead_fee has the lead Enrolled. A
    -- lead declined while Enrolled keeps its profile, since nothing changes a
    -- Declined lead, but it is no longer Enrolled, so it says nothing.
    if not exists (
        select 1 from public.leads l where l.id = lead_school_fee.lead_id and l.status = 'Enrolled'
    ) then
        return;
    end if;
    select * into profile from public.lead_fee_profiles p where p.lead_id = lead_school_fee.lead_id;
    enrolled_trigger := profile.enrolled_trigger;
    enrolled_on := profile.enrolled_on;
    if profile.enrolled_trigger_payment_id is not null then
        select e.payment_type, e.amount into enrolled_payment_type, enrolled_payment_amount
        from public.effective_school_fee_payments(lead_school_fee.lead_id) e
        where e.payment_id = profile.enrolled_trigger_payment_id;
    end if;
end;
$$;

revoke execute on function public.lead_school_fee(uuid) from public, anon;
grant execute on function public.lead_school_fee(uuid) to authenticated;
