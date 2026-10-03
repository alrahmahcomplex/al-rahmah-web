-- Interviews (slice 5, #26), starting with registration (#67): the interviews
-- table the rest of the slice builds on, the S/N counters, and the function
-- that registers a lead for interview and gives it the next S/N for its
-- enrollment year.
--
-- Interviews are lead data, audited under ADR 4's `lead` scope like the lead
-- itself. Nothing writes to them through the API: every write is a security
-- definer function that checks the permission itself and calls
-- assert_lead_open first, so a closed lead stays read-only however the
-- database is reached.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `lead_enrolled`, or
-- `already_registered`.

-- ---------------------------------------------------------------------------
-- The fixed lists.
-- ---------------------------------------------------------------------------

create type public.interview_result as enum ('Passed', 'Failed');

create type public.interview_fee_status as enum ('Paid', 'Not Paid');

-- ---------------------------------------------------------------------------
-- Interviews. A lead can hold several over time (a retaken interview after a
-- reopening); its current interview is the newest registration. Next action
-- is not stored: it follows from the result.
-- ---------------------------------------------------------------------------

create table public.interviews (
    id uuid primary key default gen_random_uuid(),
    lead uuid not null references public.leads (id),
    -- The S/N and the enrollment year it was issued in. Neither changes after
    -- registration, even when the lead's enrollment year is corrected
    -- (guard_interview_change).
    serial_number integer not null check (serial_number > 0),
    serial_year integer not null check (serial_year between 2000 and 2100),
    registered_at timestamptz not null default now(),
    registered_by uuid not null references public.staff_members (id),
    interview_date date,
    result public.interview_result,
    -- A percentage, to one decimal place at most. A finer score is refused,
    -- not rounded, so a typo never saves as something else.
    score numeric check (score between 0 and 100 and score = round(score, 1)),
    fee_status public.interview_fee_status not null default 'Not Paid',
    -- Whole TZS, locked when the fee is marked Paid and cleared when it goes
    -- back to Not Paid.
    locked_amount integer check (locked_amount >= 0),
    unique (serial_year, serial_number),
    -- A result is never saved without its score and date.
    constraint interviews_result_complete check (
        (result is null and score is null and interview_date is null)
        or (result is not null and score is not null and interview_date is not null)
    ),
    -- The amount is locked only while Paid.
    constraint interviews_amount_locked_while_paid check ((fee_status = 'Paid') = (locked_amount is not null))
);

create index interviews_lead_idx on public.interviews (lead, registered_at desc);

-- The rules no caller may skip: an interview stays on its lead, and its S/N,
-- the year it was issued in, and who registered it when never change.
create function public.guard_interview_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.lead is distinct from old.lead
       or new.serial_number is distinct from old.serial_number
       or new.serial_year is distinct from old.serial_year
       or new.registered_at is distinct from old.registered_at
       or new.registered_by is distinct from old.registered_by then
        raise exception 'interview_registration_locked';
    end if;
    return new;
end;
$$;

create trigger guard_interview_change
    before update on public.interviews
    for each row
    execute function public.guard_interview_change();

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.interviews', 'lead', 'lead');

create trigger audit_row_change
    after insert or update on public.interviews
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.interviews
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.interviews
    for each statement
    execute function public.refuse_delete();

alter table public.interviews enable row level security;

create policy "Staff who may view leads read interviews"
    on public.interviews for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.interviews from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- S/N counters: the last S/N issued in each enrollment year. Registration
-- takes the year's row with an upsert, which holds its lock to the end of the
-- registering transaction, so registrations at the same moment get
-- consecutive numbers and never the same one. Numbers are never reused. Not
-- lead data, so not audited, and nobody reads it through the API.
-- ---------------------------------------------------------------------------

create table public.interview_serial_counters (
    enrollment_year integer primary key check (enrollment_year between 2000 and 2100),
    last_number integer not null check (last_number > 0)
);

alter table public.interview_serial_counters enable row level security;

revoke all on public.interview_serial_counters from anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_for_interview: a first interview for an Applied or Visited lead
-- with none. Needs interviews.record. Returns the interview's id, its S/N and
-- the enrollment year the S/N was issued in. Retaken interviews after a
-- reopening come with slice 8's retake rule.
-- ---------------------------------------------------------------------------

create function public.register_for_interview(lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    staff_id uuid;
    issued integer;
    new_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interviews.record') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two staff registering the same lead at once register it
    -- once: whoever comes second finds the interview.
    select * into target from public.leads l where l.id = register_for_interview.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);

    if target.status = 'Enrolled' then
        raise exception 'lead_enrolled';
    end if;
    if target.status not in ('Applied', 'Visited')
       or exists (select 1 from public.interviews i where i.lead = target.id) then
        raise exception 'already_registered';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.interview_serial_counters as c (enrollment_year, last_number)
    values (target.enrollment_year, 1)
    on conflict (enrollment_year) do update set last_number = c.last_number + 1
    returning c.last_number into issued;

    insert into public.interviews (lead, serial_number, serial_year, registered_by)
    values (target.id, issued, target.enrollment_year, staff_id)
    returning id into new_id;

    return jsonb_build_object(
        'interview_id', new_id,
        'serial_number', issued,
        'serial_year', target.enrollment_year
    );
end;
$$;

revoke execute on function public.register_for_interview(uuid) from public, anon;
grant execute on function public.register_for_interview(uuid) to authenticated;
