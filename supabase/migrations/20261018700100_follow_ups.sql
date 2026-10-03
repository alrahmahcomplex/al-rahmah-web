-- Follow-ups (slice 7, #28), starting with scheduling one and changing its
-- date (#90): the follow-ups table the rest of the slice builds on, and the
-- two functions that write it.
--
-- A follow-up is a plan: the date the school will next contact the family,
-- with an optional note. It is never updated or deleted (ADR 4). Changing the
-- date adds a new follow-up that replaces the old one and carries a reason,
-- so the lead's history keeps every plan.
--
-- A lead has at most one open follow-up. Openness comes from other rows, so
-- it can't be a unique index: the write functions keep the rule under an
-- advisory lock on the lead. Until #91 adds follow-up records, a follow-up is
-- open while no later follow-up replaces it; #91 extends
-- open_follow_up(lead_id) with `create or replace` to leave out follow-ups a
-- record has closed.
--
-- Follow-ups are lead data, audited under ADR 4's `lead` scope. Nothing
-- writes to them through the API: every write is a security definer function
-- that checks follow_ups.record itself and calls assert_lead_open first.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `conflict`, or
-- `invalid` with the field in the detail (`due_on`, `note`, `reason`).

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.follow_ups (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    -- A calendar date in Tanzania time.
    due_on date not null,
    note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),
    -- The follow-up this one replaced, when its date was changed. A follow-up
    -- is replaced at most once.
    replaces_id uuid unique references public.follow_ups (id),
    change_reason text check (change_reason is null or char_length(btrim(change_reason)) between 3 and 500),
    -- The replaced follow-up's date, kept on the replacement so its history
    -- entry reads as a change from one date to another on its own.
    replaced_due_on date,
    created_at timestamptz not null default now(),
    -- A reason exactly when this follow-up replaces another.
    constraint follow_ups_reason_with_replacement check ((replaces_id is null) = (change_reason is null)),
    constraint follow_ups_earlier_date_with_replacement check ((replaces_id is null) = (replaced_due_on is null))
);

create index follow_ups_lead_due_idx on public.follow_ups (lead_id, due_on);

-- Follow-ups are never changed after they are written, by anyone.
create function public.refuse_follow_up_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception 'update_refused' using detail = tg_table_name;
end;
$$;

revoke execute on function public.refuse_follow_up_update() from public, anon, authenticated;

create trigger refuse_update
    before update on public.follow_ups
    for each row
    execute function public.refuse_follow_up_update();

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.follow_ups', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.follow_ups
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.follow_ups
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.follow_ups
    for each statement
    execute function public.refuse_delete();

alter table public.follow_ups enable row level security;

create policy "Staff who may view leads read follow-ups"
    on public.follow_ups for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.follow_ups from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_follow_up(lead_id): the lead's open follow-up, or null. For write
-- functions only, like assert_lead_open, so it is granted to no signed-in
-- role. #91 replaces it to leave out follow-ups a record has closed.
-- ---------------------------------------------------------------------------

create function public.open_follow_up(lead_id uuid)
returns public.follow_ups
language sql
stable
set search_path = ''
as $$
    select f.*
    from public.follow_ups f
    where f.lead_id = open_follow_up.lead_id
      and not exists (select 1 from public.follow_ups r where r.replaces_id = f.id)
    order by f.created_at desc
    limit 1;
$$;

revoke execute on function public.open_follow_up(uuid) from public, anon, authenticated;

-- The checks both writes make on the date and the note.
create function public.check_follow_up_plan(due_on date, note text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
    if due_on is null
       or due_on < public.tanzania_today()
       or due_on > public.tanzania_today() + 365 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'due_on')::text;
    end if;
    if note is not null and char_length(note) > 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
    end if;
end;
$$;

revoke execute on function public.check_follow_up_plan(date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- schedule_follow_up: plans the next contact with a lead that has no open
-- follow-up. Needs follow_ups.record. Returns the new follow-up's id.
-- ---------------------------------------------------------------------------

create function public.schedule_follow_up(lead_id uuid, due_on date, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    plan_note text := nullif(btrim(coalesce(schedule_follow_up.note, '')), '');
    new_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('follow_ups.record') then
        raise exception 'not_permitted';
    end if;
    -- The lead is held shared first, so a decline or closure running
    -- alongside finishes before this and is seen. Then two staff scheduling
    -- the same lead at once schedule it once: whoever comes second finds the
    -- open follow-up. Always the row first, then the advisory lock.
    perform 1 from public.leads l where l.id = schedule_follow_up.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('follow-up-lead:' || schedule_follow_up.lead_id::text, 0));
    perform public.assert_lead_open(schedule_follow_up.lead_id);
    perform public.check_follow_up_plan(schedule_follow_up.due_on, plan_note);

    if (public.open_follow_up(schedule_follow_up.lead_id)).id is not null then
        raise exception 'conflict';
    end if;

    insert into public.follow_ups (lead_id, due_on, note)
    values (schedule_follow_up.lead_id, schedule_follow_up.due_on, plan_note)
    returning id into new_id;

    return new_id;
end;
$$;

revoke execute on function public.schedule_follow_up(uuid, date, text) from public, anon;
grant execute on function public.schedule_follow_up(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- change_follow_up_date: moves an open follow-up to a new date, with a
-- reason. The follow-up stays as it was; a new one replaces it, keeping its
-- note unless a new one is given. Needs follow_ups.record. Returns the new
-- follow-up's id.
-- ---------------------------------------------------------------------------

create function public.change_follow_up_date(follow_up_id uuid, due_on date, reason text, note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    earlier public.follow_ups;
    change_reason text := btrim(coalesce(change_follow_up_date.reason, ''));
    plan_note text;
    new_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('follow_ups.record') then
        raise exception 'not_permitted';
    end if;
    select * into earlier from public.follow_ups f where f.id = change_follow_up_date.follow_up_id;
    if not found then
        raise exception 'not_found';
    end if;

    perform 1 from public.leads l where l.id = earlier.lead_id for share;
    perform pg_advisory_xact_lock(hashtextextended('follow-up-lead:' || earlier.lead_id::text, 0));
    perform public.assert_lead_open(earlier.lead_id);

    plan_note := coalesce(nullif(btrim(coalesce(change_follow_up_date.note, '')), ''), earlier.note);
    perform public.check_follow_up_plan(change_follow_up_date.due_on, plan_note);
    if char_length(change_reason) not between 3 and 500 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;

    -- Replaced or closed since the form was loaded.
    if (public.open_follow_up(earlier.lead_id)).id is distinct from earlier.id then
        raise exception 'conflict';
    end if;
    -- A change moves the date; the same date again would record nothing new.
    if change_follow_up_date.due_on = earlier.due_on then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'due_on')::text;
    end if;

    insert into public.follow_ups (lead_id, due_on, note, replaces_id, change_reason, replaced_due_on)
    values (earlier.lead_id, change_follow_up_date.due_on, plan_note, earlier.id, change_reason, earlier.due_on)
    returning id into new_id;

    return new_id;
end;
$$;

revoke execute on function public.change_follow_up_date(uuid, date, text, text) from public, anon;
grant execute on function public.change_follow_up_date(uuid, date, text, text) to authenticated;
