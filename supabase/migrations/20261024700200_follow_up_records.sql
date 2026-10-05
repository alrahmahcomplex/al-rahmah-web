-- Follow-up records (slice 7, #28), starting with recording a contact (#91).
--
-- A follow-up record is a contact staff made with the family, or the end of a
-- follow-up when its lead closes. Like a follow-up, it is never updated or
-- deleted (ADR 4). A record closes the follow-up it names, so a follow-up is
-- open while no record closes it and no later follow-up replaces it.
--
-- Recording a contact on an open lead needs an outcome. `next_date` plans the
-- next follow-up in the same transaction. `lead_enrolled` ends with no next
-- date and is allowed only while the lead is Enrolled. `lead_declined`
-- belongs to the table now, but record_follow_up refuses it until #94 adds
-- the decline flow. The `closed_with_lead` kind and its cause belong to the
-- table now too; #93 adds the trigger that writes them.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `conflict`, or
-- `invalid` with the field in the detail (`comment`, `method`,
-- `contacted_by`, `contacted_at`, `outcome`, `next_due_on`, `next_note`).

create type public.follow_up_contact_method as enum ('Phone call', 'WhatsApp', 'SMS', 'In-person');

create type public.follow_up_record_kind as enum ('contact', 'closed_with_lead');

create type public.follow_up_outcome as enum ('next_date', 'lead_declined', 'lead_enrolled');

-- Why a follow-up closed with its lead.
create type public.follow_up_closed_cause as enum ('declined', 'inactive', 'archived');

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.follow_up_records (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    -- The follow-up this record closes; empty for an unplanned contact. A
    -- follow-up is closed at most once.
    follow_up_id uuid unique references public.follow_ups (id),
    kind public.follow_up_record_kind not null,
    outcome public.follow_up_outcome,
    cause public.follow_up_closed_cause,
    comment text check (comment is null or (comment = btrim(comment) and char_length(comment) between 3 and 2000)),
    method public.follow_up_contact_method,
    contacted_by uuid references public.staff_members (id),
    contacted_at timestamptz,
    entered_at timestamptz not null default now(),
    -- The follow-up planned with this record, for the next_date outcome.
    next_follow_up_id uuid unique references public.follow_ups (id),
    -- A contact says what happened, how, who made it, when, and how it ended.
    constraint follow_up_records_contact_fields check (
        kind <> 'contact' or (
            comment is not null and method is not null and contacted_by is not null
            and contacted_at is not null and outcome is not null and cause is null
        )
    ),
    -- A follow-up closed with its lead carries only the follow-up and why.
    constraint follow_up_records_closed_with_lead_fields check (
        kind <> 'closed_with_lead' or (
            follow_up_id is not null and cause is not null
            and outcome is null and comment is null and method is null
            and contacted_by is null and contacted_at is null and next_follow_up_id is null
        )
    ),
    -- A next follow-up exactly when the outcome is next_date.
    constraint follow_up_records_next_with_next_date check ((outcome = 'next_date') = (next_follow_up_id is not null))
);

create index follow_up_records_lead_idx on public.follow_up_records (lead_id, entered_at desc);
create index follow_up_records_contacted_by_idx on public.follow_up_records (contacted_by);

-- Never changed after it is written, by anyone.
create trigger refuse_update
    before update on public.follow_up_records
    for each row
    execute function public.refuse_follow_up_update();

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.follow_up_records', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.follow_up_records
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.follow_up_records
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.follow_up_records
    for each statement
    execute function public.refuse_delete();

alter table public.follow_up_records enable row level security;

create policy "Staff who may view leads read follow-up records"
    on public.follow_up_records for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.follow_up_records from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_follow_up(lead_id), replaced: a follow-up a record has closed is no
-- longer open either.
-- ---------------------------------------------------------------------------

create or replace function public.open_follow_up(lead_id uuid)
returns public.follow_ups
language sql
stable
set search_path = ''
as $$
    select f.*
    from public.follow_ups f
    where f.lead_id = open_follow_up.lead_id
      and not exists (select 1 from public.follow_ups r where r.replaces_id = f.id)
      and not exists (select 1 from public.follow_up_records c where c.follow_up_id = f.id)
    order by f.created_at desc
    limit 1;
$$;

revoke execute on function public.open_follow_up(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may be named as having made a contact: active staff on a current role
-- that holds follow_ups.record.
-- ---------------------------------------------------------------------------

create function public.is_contact_staff(staff_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (
        select 1
        from public.staff_members s
        join public.roles r on r.id = s.role_id
        where s.id = is_contact_staff.staff_id
          and s.active
          and not r.retired
          and 'follow_ups.record' = any (r.permissions)
    );
$$;

revoke execute on function public.is_contact_staff(uuid) from public, anon, authenticated;

-- The picker's list: id and full name only, since staff who record contacts
-- may not read other staff rows. Needs follow_ups.record.
create function public.list_contact_staff()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('follow_ups.record') then
        raise exception 'not_permitted';
    end if;
    return query
        select s.id, s.full_name
        from public.staff_members s
        where public.is_contact_staff(s.id)
        order by s.full_name, s.id;
end;
$$;

revoke execute on function public.list_contact_staff() from public, anon;
grant execute on function public.list_contact_staff() to authenticated;

-- The names of the staff who made a lead's recorded contacts, current or
-- deactivated, for its Follow-ups panel and history. Empty without
-- leads.view, as the records themselves are.
create function public.follow_up_record_staff(lead_id uuid)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
    select distinct s.id, s.full_name
    from public.follow_up_records c
    join public.staff_members s on s.id = c.contacted_by
    where c.lead_id = follow_up_record_staff.lead_id
      and public.has_permission('leads.view');
$$;

revoke execute on function public.follow_up_record_staff(uuid) from public, anon;
grant execute on function public.follow_up_record_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_follow_up: records a contact with the family, closing the lead's
-- open follow-up, and plans the next one. Needs follow_ups.record.
--
-- follow_up_id is the open follow-up the form was showing, or null when none
-- was open. Anything else means the plan changed since the form loaded, so
-- the call is a conflict and records nothing.
--
-- decline_reason and decline_note are for the lead_declined outcome, which
-- #94 adds; until then that outcome is refused. Returns the record's id.
-- ---------------------------------------------------------------------------

create function public.record_follow_up(
    lead_id uuid,
    follow_up_id uuid,
    comment text,
    method text,
    contacted_by uuid,
    contacted_at timestamptz,
    outcome text,
    next_due_on date default null,
    next_note text default null,
    decline_reason text default null,
    decline_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead_status public.lead_status;
    contact_comment text := btrim(coalesce(record_follow_up.comment, ''));
    plan_note text := nullif(btrim(coalesce(record_follow_up.next_note, '')), '');
    next_id uuid;
    record_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('follow_ups.record') then
        raise exception 'not_permitted';
    end if;
    -- The same lock order as the other follow-up writes: the lead row shared,
    -- then the lead's advisory lock. Two staff recording the same follow-up
    -- at once record it once: whoever comes second finds it closed.
    select l.status into lead_status from public.leads l where l.id = record_follow_up.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('follow-up-lead:' || record_follow_up.lead_id::text, 0));
    perform public.assert_lead_open(record_follow_up.lead_id);

    if char_length(contact_comment) not between 3 and 2000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'comment')::text;
    end if;
    if record_follow_up.method is null
       or not record_follow_up.method = any (enum_range(null::public.follow_up_contact_method)::text[]) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'method')::text;
    end if;
    if record_follow_up.contacted_by is null or not public.is_contact_staff(record_follow_up.contacted_by) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'contacted_by')::text;
    end if;
    if record_follow_up.contacted_at is null or record_follow_up.contacted_at > clock_timestamp() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'contacted_at')::text;
    end if;

    -- On an Applied, Visited or Interviewed lead the next date is required.
    -- An Enrolled lead may end with none.
    if record_follow_up.outcome = 'next_date' then
        if record_follow_up.next_due_on is null
           or record_follow_up.next_due_on <= public.tanzania_today()
           or record_follow_up.next_due_on > public.tanzania_today() + 365 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'next_due_on')::text;
        end if;
        if plan_note is not null and char_length(plan_note) > 500 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'next_note')::text;
        end if;
    elsif record_follow_up.outcome = 'lead_enrolled' then
        if lead_status <> 'Enrolled' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'outcome')::text;
        end if;
    else
        raise exception 'invalid' using detail = jsonb_build_object('field', 'outcome')::text;
    end if;

    -- Recorded, replaced or newly planned since the form loaded.
    if (public.open_follow_up(record_follow_up.lead_id)).id is distinct from record_follow_up.follow_up_id then
        raise exception 'conflict';
    end if;

    if record_follow_up.outcome = 'next_date' then
        insert into public.follow_ups (lead_id, due_on, note)
        values (record_follow_up.lead_id, record_follow_up.next_due_on, plan_note)
        returning id into next_id;
    end if;

    insert into public.follow_up_records (
        lead_id, follow_up_id, kind, outcome, comment, method, contacted_by, contacted_at, next_follow_up_id
    ) values (
        record_follow_up.lead_id,
        record_follow_up.follow_up_id,
        'contact',
        record_follow_up.outcome::public.follow_up_outcome,
        contact_comment,
        record_follow_up.method::public.follow_up_contact_method,
        record_follow_up.contacted_by,
        record_follow_up.contacted_at,
        next_id
    )
    returning id into record_id;

    return record_id;
end;
$$;

revoke execute on function public.record_follow_up(uuid, uuid, text, text, uuid, timestamptz, text, date, text, text, text) from public, anon;
grant execute on function public.record_follow_up(uuid, uuid, text, text, uuid, timestamptz, text, date, text, text, text) to authenticated;
