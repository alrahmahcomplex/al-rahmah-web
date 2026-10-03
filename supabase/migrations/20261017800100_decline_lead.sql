-- Declining a lead (slice 8, #97). Staff mark an open lead Declined with a
-- Declined reason from the fixed list and an optional explanation, required
-- for Other. The lead remembers the status it held before, so an approved
-- reopening (#99) can put it back.
--
-- 1. The `declined_reason` list and, on leads, the reason, explanation, when,
--    who, and the status before the decline. The existing audit trigger on
--    leads records each change, so the history needs nothing extra. A lead
--    declined while Applied may have no Visit date.
-- 2. decline_lead, the one way to decline. It takes no transaction control of
--    its own: slice 7's record_follow_up calls it inside its transaction.
-- 3. lead_closure, for the closed-lead banner: the decline with the decliner's
--    name, which staff who may view leads cannot read from staff_members.
--
-- Refusal codes: `not_permitted`, `not_found`, `lead_closed` (already
-- Declined, Inactive or Archived), and `invalid` with the offending field as
-- JSON in the detail.

create type public.declined_reason as enum (
    'Enrolled elsewhere',
    'Family changed plans',
    'Fees or cost',
    'Fee payment not completed',
    'No seat available',
    'Did not pass interview',
    'Unreachable after follow-up',
    'School decision',
    'Other'
);

-- The decline details are set together when a lead is declined, and an
-- approved reopening clears them together. Leads seeded as Declined before
-- this slice may lack who and when, so only the reason is required.
alter table public.leads
    add column declined_reason public.declined_reason,
    add column declined_explanation text,
    add column declined_at timestamptz,
    add column declined_by uuid references public.staff_members (id),
    add column status_before_decline public.lead_status,
    add constraint leads_declined_reason_check
        check ((status = 'Declined') = (declined_reason is not null)),
    add constraint leads_declined_other_check
        check (declined_reason is distinct from 'Other' or declined_explanation is not null),
    add constraint leads_declined_explanation_check
        check (declined_explanation is null or (btrim(declined_explanation) <> '' and char_length(declined_explanation) <= 1000)),
    add constraint leads_decline_details_check
        check (declined_reason is not null or (
            declined_explanation is null and declined_at is null and declined_by is null and status_before_decline is null
        )),
    add constraint leads_status_before_decline_check
        check (status_before_decline is distinct from 'Declined'),
    -- Slice 2's rule that only an Applied lead may lack a Visit date, now also
    -- for a lead declined while Applied: a family can drop out before its
    -- first visit.
    drop constraint leads_check,
    add constraint leads_check
        check (coalesce(status_before_decline, status) = 'Applied' or visit_date is not null);

-- ---------------------------------------------------------------------------
-- decline_lead(lead_id, reason, explanation): needs leads.decline, and
-- academic_years.manage for No seat available, the reason that releases a
-- seat. Any open lead can be declined, Enrolled included; a lead already
-- Declined or carrying a closure mark is refused as `lead_closed`. Saves the
-- current status as the status before decline, then sets Declined.
--
-- No transaction control: a caller's own transaction holds it, so slice 7
-- writes a follow-up and declines in one go.
-- ---------------------------------------------------------------------------

create function public.decline_lead(lead_id uuid, reason text, explanation text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    chosen public.declined_reason;
    note text := nullif(btrim(coalesce(decline_lead.explanation, '')), '');
    staff_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.decline') then
        raise exception 'not_permitted';
    end if;

    begin
        chosen := decline_lead.reason::public.declined_reason;
    exception when invalid_text_representation then
        chosen := null;
    end;
    if chosen is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    if chosen = 'No seat available' and not public.has_permission('academic_years.manage') then
        raise exception 'not_permitted';
    end if;
    if (chosen = 'Other' and note is null) or char_length(note) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'explanation')::text;
    end if;

    -- Locked, so two staff declining the same lead at once decline it once:
    -- whoever comes second finds it closed.
    select * into target from public.leads l where l.id = decline_lead.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    update public.leads l
    set status = 'Declined',
        declined_reason = chosen,
        declined_explanation = note,
        declined_at = now(),
        declined_by = staff_id,
        status_before_decline = target.status
    where l.id = target.id;
end;
$$;

revoke execute on function public.decline_lead(uuid, text, text) from public, anon;
grant execute on function public.decline_lead(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_closure(lead_id): why a lead is closed, for staff who may view leads.
-- Returns {"decline": null} for a lead that is not Declined, else its reason,
-- explanation, when, the decliner's name (looked up now, so a deactivated
-- staff member still shows by name) and the status before. #98 adds the
-- closure mark's details as another key.
-- ---------------------------------------------------------------------------

create function public.lead_closure(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.leads;
    decliner text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.leads l where l.id = lead_closure.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select s.full_name into decliner from public.staff_members s where s.id = target.declined_by;

    return jsonb_build_object(
        'decline',
        case when target.declined_reason is null then null else jsonb_build_object(
            'reason', target.declined_reason,
            'explanation', target.declined_explanation,
            'declined_at', target.declined_at,
            'declined_by', decliner,
            'status_before', target.status_before_decline
        ) end
    );
end;
$$;

revoke execute on function public.lead_closure(uuid) from public, anon;
grant execute on function public.lead_closure(uuid) to authenticated;
