-- Declining the lead as a contact outcome (slice 7, #28, ticket #94).
--
-- When the family says they will not proceed, staff record the contact and
-- decline the lead together. record_follow_up keeps its signature and gains
-- the `lead_declined` outcome: it checks the lead is open, writes the contact
-- record (closing the open follow-up), then calls slice 8's
-- decline_lead(lead_id, reason, explanation), all in one transaction. The
-- explanation is required for Other.
--
-- If decline_lead refuses (`not_permitted` without leads.decline, or for No
-- seat available without academic_years.manage; `invalid` with the field
-- `reason` or `explanation`), the whole call rolls back, the contact record
-- included, and the refusal reaches the caller unchanged.
--
-- The contact record closes the follow-up before the lead is declined, so the
-- trigger that closes a follow-up with its lead (#93) finds nothing open and
-- adds no `closed_with_lead` record.
--
-- Locking: the other follow-up writes hold the lead row `for share`, then
-- take the lead's advisory lock. decline_lead then needs the row `for
-- update`. Upgrading a shared lock while a second follow-up write also holds
-- it shared and waits on the advisory lock would deadlock, so a decline
-- outcome takes the row `for update` from the start, keeping the same order:
-- the row first, then the advisory lock.

create or replace function public.record_follow_up(
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
    -- The same lock order as the other follow-up writes: the lead row, then
    -- the lead's advisory lock. Two staff recording the same follow-up at
    -- once record it once: whoever comes second finds it closed. A decline
    -- holds the row exclusively, since decline_lead updates it.
    if record_follow_up.outcome = 'lead_declined' then
        select l.status into lead_status from public.leads l where l.id = record_follow_up.lead_id for update;
    else
        select l.status into lead_status from public.leads l where l.id = record_follow_up.lead_id for share;
    end if;
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

    -- On an Applied, Visited or Interviewed lead the next date is required,
    -- unless the lead is declined. An Enrolled lead may end with none.
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
    elsif record_follow_up.outcome is distinct from 'lead_declined' then
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

    -- After the record, so the follow-up it closed is no longer open when
    -- the lead closes. decline_lead checks its own permissions and reason; a
    -- refusal undoes the record too.
    if record_follow_up.outcome = 'lead_declined' then
        perform public.decline_lead(record_follow_up.lead_id, record_follow_up.decline_reason, record_follow_up.decline_note);
    end if;

    return record_id;
end;
$$;

-- create or replace keeps the grants; restated so the file reads alone.
revoke execute on function public.record_follow_up(uuid, uuid, text, text, uuid, timestamptz, text, date, text, text, text) from public, anon;
grant execute on function public.record_follow_up(uuid, uuid, text, text, uuid, timestamptz, text, date, text, text, text) to authenticated;
