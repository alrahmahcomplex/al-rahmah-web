-- Reopening requests (slice 8, #99): raising one on a closed lead, and
-- withdrawing it while it is Pending. #100 adds approving and rejecting.
--
-- A Reopening request asks for a Declined, Inactive or Archived lead to come
-- back into active work, with a written reason. A lead holds at most one
-- Pending request; a partial unique index keeps that rule, so two staff
-- raising at once end with one request and one `already_pending`. Once a
-- request leaves Pending it never changes again, and no request is ever
-- deleted (ADR 4), so the lead keeps every earlier request.
--
-- Requests are lead data, audited under ADR 4's `lead` scope. Nothing writes
-- to them through the API: every write is a security definer function that
-- checks the permission itself. Only a staff member's session can raise one;
-- the Admission form, which runs with the secret key, never does.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_open` (nothing to reopen), `already_pending` (with the
-- requester's name and the date as JSON in the detail), `not_pending`,
-- `not_requester`, `invalid` with the field in the detail, and `busy` when
-- requests on the lead kept changing while one was being raised.

create type public.reopening_state as enum ('pending', 'approved', 'rejected', 'withdrawn');

-- Where the request was raised: a duplicate refusal or the front desk's
-- Family hand-off, the lead screen, or a re-application's review (slice 3).
create type public.reopening_source as enum ('duplicate_match', 'lead', 're_application');

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------

create table public.reopening_requests (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    source public.reopening_source not null,
    reason text not null check (btrim(reason) <> '' and char_length(reason) <= 1000),
    requested_by uuid not null references public.staff_members (id),
    requested_at timestamptz not null default now(),
    state public.reopening_state not null default 'pending',
    -- Who took the request out of Pending and when: the approver, the
    -- rejecter, or the requester withdrawing it.
    decided_by uuid references public.staff_members (id),
    decided_at timestamptz,
    rejection_reason text check (rejection_reason is null or (btrim(rejection_reason) <> '' and char_length(rejection_reason) <= 1000)),
    -- Set on approval (#100): whether a lead declined after its interview
    -- enrols without a retaken one, whether the lead was Declined, and the
    -- status it came back with. They drive the Reopened after decline note.
    enrol_without_retake boolean,
    lead_was_declined boolean,
    restored_status public.lead_status,
    constraint reopening_requests_decided_check
        check ((state = 'pending') = (decided_at is null) and (state = 'pending') = (decided_by is null)),
    constraint reopening_requests_rejection_check
        check ((state = 'rejected') = (rejection_reason is not null)),
    constraint reopening_requests_withdrawn_check
        check (state <> 'withdrawn' or decided_by = requested_by),
    constraint reopening_requests_approval_check
        check (
            case when state = 'approved'
                then lead_was_declined is not null and restored_status is not null
                else enrol_without_retake is null and lead_was_declined is null and restored_status is null
            end
        )
);

-- One Pending request per lead.
create unique index reopening_requests_one_pending_idx on public.reopening_requests (lead_id) where state = 'pending';
create index reopening_requests_lead_idx on public.reopening_requests (lead_id, requested_at desc);
-- The approvers' queue (#100), oldest first.
create index reopening_requests_pending_idx on public.reopening_requests (requested_at) where state = 'pending';

-- A request is written once and then only taken out of Pending, once. What
-- was asked, by whom and when never changes, and a decided request never
-- changes at all.
create function public.refuse_decided_reopening_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.state <> 'pending'
       or new.lead_id is distinct from old.lead_id
       or new.source is distinct from old.source
       or new.reason is distinct from old.reason
       or new.requested_by is distinct from old.requested_by
       or new.requested_at is distinct from old.requested_at then
        raise exception 'update_refused' using detail = tg_table_name;
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_decided_reopening_change() from public, anon, authenticated;

create trigger refuse_decided_change
    before update on public.reopening_requests
    for each row
    execute function public.refuse_decided_reopening_change();

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.reopening_requests', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.reopening_requests
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.reopening_requests
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.reopening_requests
    for each statement
    execute function public.refuse_delete();

alter table public.reopening_requests enable row level security;

create policy "Staff who may view leads read reopening requests"
    on public.reopening_requests for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.reopening_requests from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- raise_reopening_request(lead_id, reason, source): asks for a closed lead to
-- be reopened. Needs leads.create (the duplicate path) or leads.edit (the
-- lead screen and re-application review). Refuses an open lead as
-- `lead_open` and a lead with a Pending request as `already_pending`.
-- Returns the new request's id.
-- ---------------------------------------------------------------------------

create function public.raise_reopening_request(lead_id uuid, reason text, source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    chosen public.reopening_source;
    why text := btrim(coalesce(raise_reopening_request.reason, ''));
    staff_id uuid;
    new_id uuid;
    pending public.reopening_requests;
begin
    if auth.role() is distinct from 'authenticated'
       or not (public.has_permission('leads.create') or public.has_permission('leads.edit')) then
        raise exception 'not_permitted';
    end if;

    begin
        chosen := raise_reopening_request.source::public.reopening_source;
    exception when invalid_text_representation then
        chosen := null;
    end;
    if chosen is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'source')::text;
    end if;
    if why = '' or char_length(why) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;

    -- Held shared, so an approval or a closure running alongside finishes
    -- first and is seen.
    select * into target from public.leads l where l.id = raise_reopening_request.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    if target.status <> 'Declined' and target.closure is null then
        raise exception 'lead_open';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    -- Two staff raising at once both pass a check made here, so the unique
    -- index decides: whoever inserts second waits for the first to commit and
    -- is then refused, naming the request that won. If that request was
    -- withdrawn or decided before it could be read, there is no winner to
    -- name and a new request is allowed again, so the insert is tried again.
    for attempt in 1..3 loop
        begin
            insert into public.reopening_requests (lead_id, source, reason, requested_by)
            values (target.id, chosen, why, staff_id)
            returning id into new_id;
            return new_id;
        exception when unique_violation then
            select * into pending from public.reopening_requests r where r.lead_id = target.id and r.state = 'pending';
            if found then
                raise exception 'already_pending' using detail = jsonb_build_object(
                    'requested_by', (select s.full_name from public.staff_members s where s.id = pending.requested_by),
                    'requested_at', pending.requested_at
                )::text;
            end if;
        end;
    end loop;

    -- Requests kept coming and going faster than this could insert; the
    -- caller is told to try again.
    raise exception 'busy';
end;
$$;

revoke execute on function public.raise_reopening_request(uuid, text, text) from public, anon;
grant execute on function public.raise_reopening_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- withdraw_reopening_request(request_id): the requester takes back their
-- Pending request. Anyone else is refused as `not_requester`, and a request
-- no longer Pending as `not_pending`.
-- ---------------------------------------------------------------------------

create function public.withdraw_reopening_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    request public.reopening_requests;
    staff_id uuid;
begin
    if auth.role() is distinct from 'authenticated'
       or not (public.has_permission('leads.create') or public.has_permission('leads.edit')) then
        raise exception 'not_permitted';
    end if;

    -- Locked, so a withdrawal and a decision at the same moment don't both
    -- take the request out of Pending.
    select * into request from public.reopening_requests r where r.id = withdraw_reopening_request.request_id for update;
    if not found then
        raise exception 'not_found';
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
    if request.requested_by is distinct from staff_id then
        raise exception 'not_requester';
    end if;
    if request.state <> 'pending' then
        raise exception 'not_pending';
    end if;

    update public.reopening_requests r
    set state = 'withdrawn',
        decided_by = staff_id,
        decided_at = now()
    where r.id = request.id;
end;
$$;

revoke execute on function public.withdraw_reopening_request(uuid) from public, anon;
grant execute on function public.withdraw_reopening_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_reopening_requests(lead_id): every request on a lead, newest first,
-- for staff who may view leads. Each names the requester and whoever decided
-- it, looked up now, since staff who may view leads cannot read
-- staff_members themselves.
-- ---------------------------------------------------------------------------

create function public.lead_reopening_requests(lead_id uuid)
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
    if not exists (select 1 from public.leads l where l.id = lead_reopening_requests.lead_id) then
        raise exception 'not_found';
    end if;

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', r.id,
            'source', r.source,
            'reason', r.reason,
            'state', r.state,
            'requested_at', r.requested_at,
            'requested_by_id', r.requested_by,
            'requested_by', requester.full_name,
            'decided_at', r.decided_at,
            'decided_by', decider.full_name,
            'rejection_reason', r.rejection_reason
        ) order by r.requested_at desc, r.id)
        from public.reopening_requests r
        join public.staff_members requester on requester.id = r.requested_by
        left join public.staff_members decider on decider.id = r.decided_by
        where r.lead_id = lead_reopening_requests.lead_id
    ), '[]'::jsonb);
end;
$$;

revoke execute on function public.lead_reopening_requests(uuid) from public, anon;
grant execute on function public.lead_reopening_requests(uuid) to authenticated;
