-- Shared foundations for slices 3–10 (Wave 0, #122), so parallel work on
-- those slices never creates the same function twice.
--
-- 1. The closure guard slice 8 (#96) owns: `lead_is_closed` and
--    `assert_lead_open`. Slice 2's write functions call it in place of their
--    inline checks. #96 keeps the trigger, the lifecycle override and the
--    screen; it may `create or replace` these two.
-- 2. A stand-in for `expected_interview_amount`, which slice 4 (#80) replaces
--    with `create or replace` and slice 5 (#69) locks on Paid.
--
-- Refusal codes: `lead_closed`. Slice 2's lead module reads it as it read
-- `closed`, so what staff see is unchanged.

-- ---------------------------------------------------------------------------
-- The closure guard. A lead is closed when it is Declined or carries an
-- Inactive or Archived mark; a closed lead is read-only. A lead that does not
-- exist is not closed: callers report it as `not_found` themselves.
-- ---------------------------------------------------------------------------

create function public.lead_is_closed(lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.leads l
        where l.id = lead_is_closed.lead_id
          and (l.status = 'Declined' or l.closure is not null)
    );
$$;

revoke execute on function public.lead_is_closed(uuid) from public, anon;
grant execute on function public.lead_is_closed(uuid) to authenticated, service_role;

create function public.assert_lead_open(lead_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if public.lead_is_closed(assert_lead_open.lead_id) then
        raise exception 'lead_closed';
    end if;
end;
$$;

revoke execute on function public.assert_lead_open(uuid) from public, anon;
grant execute on function public.assert_lead_open(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- expected_interview_amount: what the lead's interview costs, in whole TZS,
-- and whether an Approved Marketing Agent's discount brought it down. Until
-- slice 4 (#80) replaces it, every lead pays the full TZS 50,000. Needs
-- leads.view.
-- ---------------------------------------------------------------------------

create function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'forbidden';
    end if;
    if not exists (select 1 from public.leads l where l.id = expected_interview_amount.lead_id) then
        raise exception 'not_found';
    end if;

    amount := 50000;
    discount_applied := false;
end;
$$;

revoke execute on function public.expected_interview_amount(uuid) from public, anon;
grant execute on function public.expected_interview_amount(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Slice 2's write functions on a single lead, each now refusing a closed lead
-- through assert_lead_open. The contact-wide checks in update_guardian_contact
-- and check_pending_match stay as they are: they ask about every child on a
-- contact, and #96 changes them.
-- ---------------------------------------------------------------------------

-- update_lead_details: unchanged but for the closure check.
create or replace function public.update_lead_details(lead_id uuid, changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
    contact public.guardian_contacts;
    pupil_name text;
    student_class public.lead_class;
    student_year integer;
    student_boarding public.day_or_boarding;
    this_year integer := extract(year from public.tanzania_today());
    phones text[];
    match public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two corrections made at once never undo each other's fields.
    select * into lead from public.leads l where l.id = update_lead_details.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(lead.id);

    pupil_name := lead.student_name;
    if changes ? 'full_name' then
        pupil_name := btrim(coalesce(changes ->> 'full_name', ''));
        if pupil_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
        end if;
    end if;

    student_class := lead.class_name;
    if changes ? 'class_name' then
        begin
            student_class := (changes ->> 'class_name')::public.lead_class;
        exception when invalid_text_representation then
            student_class := null;
        end;
        if student_class is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
        end if;
    end if;

    -- A new year is one staff could choose today: this year or the next two.
    -- An older year already on the lead stays as it is.
    student_year := lead.enrollment_year;
    if changes ? 'enrollment_year' then
        begin
            student_year := (changes ->> 'enrollment_year')::integer;
        exception when invalid_text_representation or numeric_value_out_of_range then
            student_year := null;
        end;
        if student_year is null
           or (student_year <> lead.enrollment_year and student_year not between this_year and this_year + 2) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
        end if;
    end if;

    student_boarding := lead.day_or_boarding;
    if changes ? 'day_or_boarding' then
        begin
            student_boarding := (changes ->> 'day_or_boarding')::public.day_or_boarding;
        exception when invalid_text_representation then
            student_boarding := null;
        end;
        if student_boarding is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
        end if;
    end if;

    -- A new name must not make this child a duplicate of another lead, a
    -- brother or sister on the same contact included.
    if public.normalize_student_name(pupil_name) <> lead.student_name_key then
        -- Shared, so a change to the contact's numbers waits until this
        -- check is done, and is then checked against the new name.
        select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for share;
        phones := array[contact.phone, contact.whatsapp];
        perform public.lock_lead_phones(phones);
        match := public.find_duplicate_lead(public.normalize_student_name(pupil_name), phones, lead.id);
        if match.id is not null then
            return public.duplicate_result(match);
        end if;
    end if;

    update public.leads l
    set student_name = pupil_name,
        class_name = student_class,
        enrollment_year = student_year,
        day_or_boarding = student_boarding
    where l.id = lead.id;

    return jsonb_build_object('result', 'updated');
end;
$$;



revoke execute on function public.update_lead_details(uuid, jsonb) from public, anon;
grant execute on function public.update_lead_details(uuid, jsonb) to authenticated;

-- correct_visit_date: unchanged but for the closure check.
create or replace function public.correct_visit_date(lead_id uuid, visited_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('visits.record') then
        raise exception 'not_permitted';
    end if;

    select * into lead from public.leads l where l.id = correct_visit_date.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(lead.id);
    if lead.visit_date is null then
        raise exception 'not_visited';
    end if;
    if visited_on is null or visited_on > public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    update public.leads l set visit_date = visited_on where l.id = lead.id;
end;
$$;



revoke execute on function public.correct_visit_date(uuid, date) from public, anon;
grant execute on function public.correct_visit_date(uuid, date) to authenticated;

-- record_visit: unchanged but for the closure check.
create or replace function public.record_visit(lead_id uuid, visited_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('visits.record') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two staff recording the same arrival at once record it once:
    -- whoever comes second finds the lead Visited.
    select * into lead from public.leads l where l.id = record_visit.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if lead.status <> 'Applied' then
        raise exception 'not_applied';
    end if;
    -- An Applied lead can still carry an Inactive or Archived mark.
    perform public.assert_lead_open(lead.id);
    -- Never later than today in Tanzania, as at a walk-in.
    if visited_on is null or visited_on > public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    update public.leads l set status = 'Visited', visit_date = visited_on where l.id = lead.id;
end;
$$;



revoke execute on function public.record_visit(uuid, date) from public, anon;
grant execute on function public.record_visit(uuid, date) to authenticated;

-- separate_from_family: unchanged but for the closure check.
create or replace function public.separate_from_family(lead_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    locked record;
    lead public.leads;
    contact public.guardian_contacts;
    copy_id uuid;
begin
    select * into locked from public.lock_lead_contact(separate_from_family.lead_id);
    lead := locked.lead;
    contact := locked.contact;

    perform public.assert_lead_open(lead.id);
    if not exists (
        select 1 from public.leads l where l.guardian_contact_id = contact.id and l.id <> lead.id
    ) then
        raise exception 'not_shared';
    end if;

    insert into public.guardian_contacts (full_name, relationship, relationship_description, phone, whatsapp, origin)
    values (contact.full_name, contact.relationship, contact.relationship_description, contact.phone, contact.whatsapp, contact.origin)
    returning id into copy_id;

    update public.leads l
    set guardian_contact_id = copy_id, returning_family_joined = false
    where l.id = lead.id;
end;
$$;



revoke execute on function public.separate_from_family(uuid) from public, anon;
grant execute on function public.separate_from_family(uuid) to authenticated;
