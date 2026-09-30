-- Settling an unconfirmed Family match (slice 2). The Admission form never
-- joins a Family by itself: a child whose parent's phone matches a known
-- contact gets a contact of its own that carries a pending Family match, and
-- staff settle it from the lead screen. Confirming moves every child on that
-- contact into the matched Family, rejecting clears the match for all of
-- them, and separating gives one lead its own copy of a shared contact.
--
-- Each write is a security definer function that checks leads.edit itself,
-- like the corrections. Refusals raise a stable code as the error message:
-- `not_permitted`, `not_found`, `closed`, `no_pending_match`, `not_shared` or
-- `children_changed`. A confirmation that would make a duplicate is refused
-- too, but comes back as data with the lead it matches, as create_lead does.
--
-- None of these ever touches `returning_family_reapplied`: that cause is
-- slice 3's, set by a Re-application, and holds whatever happens here.

-- ---------------------------------------------------------------------------
-- create_lead, as in 20261001200000_find_family_by_phone.sql, but an
-- Admission form child's pending match points only at a contact that still
-- has children: a Family. A contact whose children all moved on when its own
-- match was confirmed is left behind with no one on it, and is never matched.
-- ---------------------------------------------------------------------------

create or replace function public.create_lead(
    start_kind text,
    existing_contact_id uuid,
    new_contact jsonb,
    student_details jsonb,
    visited_on date default null,
    also_check_phones text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    walk_in boolean;
    caller_role text := auth.role();
    contact public.guardian_contacts;
    contact_id uuid := existing_contact_id;
    contact_name text;
    contact_relationship public.guardian_relationship;
    contact_description text;
    contact_phone text;
    contact_whatsapp text;
    pupil_name text;
    student_class public.lead_class;
    student_year integer;
    student_boarding public.day_or_boarding;
    this_year integer := extract(year from public.tanzania_today());
    phones text[];
    extra_phones text[] := '{}';
    one_phone text;
    match public.leads;
    pending_match uuid;
    joined boolean := false;
    new_lead_id uuid;
    new_number text;
    attempt integer;
begin
    -- Who may start which way. The staff start is refused from the secret
    -- key and the form start from any staff session, so neither can write as
    -- the other.
    if start_kind = 'walk_in' then
        walk_in := true;
        if caller_role is distinct from 'authenticated'
           or not public.has_permission('leads.create')
           or not public.has_permission('visits.record') then
            raise exception 'not_permitted';
        end if;
    elsif start_kind = 'admission_form' then
        walk_in := false;
        if caller_role is distinct from 'service_role' then
            raise exception 'not_permitted';
        end if;
        -- Each RPC is its own transaction, so the actor is set here.
        perform public.set_audit_actor('public_form', null);
    else
        raise exception 'invalid' using detail = jsonb_build_object('field', 'start')::text;
    end if;

    -- The guardian.
    if contact_id is not null then
        -- Shared, so a correction to this contact's numbers waits for this
        -- child, or this child is checked against the corrected numbers.
        select * into contact from public.guardian_contacts g where g.id = contact_id for share;
        if not found or (not walk_in and contact.origin <> 'admission_form') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
        end if;
        contact_phone := contact.phone;
        contact_whatsapp := contact.whatsapp;

        -- The numbers staff typed for a walk-in parent they confirmed, which
        -- the stored contact may not hold. The duplicate check covers them
        -- too, so keeping the stored details never lets through a child who
        -- is on file under the other number.
        if also_check_phones is not null then
            if not walk_in then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'contact')::text;
            end if;
            extra_phones := array(
                select n from unnest(also_check_phones) p, public.normalize_phone(p) n where n is not null
            );
        end if;
    else
        contact_name := btrim(coalesce(new_contact ->> 'full_name', ''));
        if contact_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
        end if;

        begin
            contact_relationship := (new_contact ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            contact_relationship := null;
        end;
        if contact_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;

        contact_description := nullif(btrim(coalesce(new_contact ->> 'relationship_description', '')), '');
        if contact_relationship = 'Other' and contact_description is null then
            raise exception 'invalid'
                using detail = jsonb_build_object('field', 'relationship_description')::text;
        end if;
        if contact_relationship <> 'Other' then
            contact_description := null;
        end if;

        contact_phone := public.normalize_phone(coalesce(new_contact ->> 'phone', ''));
        if contact_phone is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
        end if;

        contact_whatsapp := nullif(btrim(coalesce(new_contact ->> 'whatsapp', '')), '');
        if contact_whatsapp is not null then
            contact_whatsapp := public.normalize_phone(contact_whatsapp);
            if contact_whatsapp is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
            end if;
            if contact_whatsapp = contact_phone then
                contact_whatsapp := null;
            end if;
        end if;
    end if;

    -- The student.
    pupil_name := btrim(coalesce(student_details ->> 'full_name', ''));
    if pupil_name = '' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'student_name')::text;
    end if;

    begin
        student_class := (student_details ->> 'class_name')::public.lead_class;
    exception when invalid_text_representation then
        student_class := null;
    end;
    if student_class is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'class_name')::text;
    end if;

    begin
        student_year := (student_details ->> 'enrollment_year')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
        student_year := null;
    end;
    -- Staff choose from the current year and the next two.
    if student_year is null
       or (walk_in and student_year not between this_year and this_year + 2)
       or student_year not between 2000 and 2100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'enrollment_year')::text;
    end if;

    begin
        student_boarding := (student_details ->> 'day_or_boarding')::public.day_or_boarding;
    exception when invalid_text_representation then
        student_boarding := null;
    end;
    if student_boarding is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'day_or_boarding')::text;
    end if;

    -- A walk-in has a Visit date, never later than today in Tanzania; the
    -- Admission form starts at Applied and has none.
    if walk_in then
        if visited_on is null or visited_on > public.tanzania_today() then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
        end if;
    elsif visited_on is not null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'visit_date')::text;
    end if;

    -- Serialize creations that share a phone number, in a fixed order so two
    -- callers can never wait on each other. Whoever comes second sees the
    -- first one's lead when it checks for a duplicate.
    phones := array(
        select distinct p from unnest(array[contact_phone, contact_whatsapp] || extra_phones) p
        where p is not null order by p
    );
    foreach one_phone in array phones loop
        perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
    end loop;

    -- A duplicate is the same student name with the same parent phone, in a
    -- lead of any status or closure mark.
    select l.* into match
    from public.leads l
    join public.guardian_contacts g on g.id = l.guardian_contact_id
    where l.student_name_key = public.normalize_student_name(pupil_name)
      and (g.phone = any (phones) or g.whatsapp = any (phones))
    order by l.created_at, l.id
    limit 1;
    if found then
        return jsonb_build_object(
            'result', 'duplicate',
            'lead_id', match.id,
            'admission_number', match.admission_number,
            'status', match.status,
            'closure', match.closure
        );
    end if;

    -- The Family link and the Returning family cause.
    if contact_id is not null then
        -- Joining a known Family at the front desk, or an Admission form
        -- child sharing its sibling's contact and that contact's pending match.
        joined := case when walk_in then true else contact.pending_family_match_id is not null end;
    elsif not walk_in then
        -- The form never joins a Family by itself: a known number leaves a
        -- pending match for staff to confirm.
        -- A contact with children, a settled one before one that is itself
        -- still waiting on staff, then the oldest.
        select g.id into pending_match
        from public.guardian_contacts g
        where (g.phone = any (phones) or g.whatsapp = any (phones))
          and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
        order by g.pending_family_match_id is not null, g.created_at, g.id
        limit 1;
        joined := pending_match is not null;
    end if;

    if contact_id is null then
        insert into public.guardian_contacts (
            full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
        ) values (
            contact_name, contact_relationship, contact_description, contact_phone, contact_whatsapp,
            case when walk_in then 'front_desk'::public.contact_origin else 'admission_form'::public.contact_origin end,
            pending_match
        )
        returning id into contact_id;
    end if;

    -- ADMSN- and five random digits. The unique constraint catches a
    -- collision and the loop draws again.
    for attempt in 1..20 loop
        new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
        begin
            insert into public.leads (
                admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                status, visit_date, guardian_contact_id, returning_family_joined
            ) values (
                new_number, pupil_name, student_class, student_year, student_boarding,
                case when walk_in then 'Visited'::public.lead_status else 'Applied'::public.lead_status end,
                visited_on, contact_id, joined
            )
            returning id into new_lead_id;
            exit;
        exception when unique_violation then
            if attempt = 20 then
                raise exception 'unavailable';
            end if;
        end;
    end loop;

    return jsonb_build_object('result', 'created', 'lead_id', new_lead_id, 'admission_number', new_number);
end;
$$;

revoke execute on function public.create_lead(text, uuid, jsonb, jsonb, date, text[]) from public, anon;
grant execute on function public.create_lead(text, uuid, jsonb, jsonb, date, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A Family's children: the leads on its contact, then, marked unconfirmed,
-- the leads on every contact whose pending Family match points at it. Oldest
-- first within each. Runs as the caller, so row-level security applies.
-- ---------------------------------------------------------------------------

create function public.family_children(family_contact_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', l.id,
            'admission_number', l.admission_number,
            'student_name', l.student_name,
            'class_name', l.class_name,
            'enrollment_year', l.enrollment_year,
            'status', l.status,
            'closure', l.closure,
            'contact_id', g.id,
            'unconfirmed', g.id <> family_children.family_contact_id
        )
        order by g.id <> family_children.family_contact_id, l.created_at, l.id
    ), '[]'::jsonb)
    from public.guardian_contacts g
    join public.leads l on l.guardian_contact_id = g.id
    where g.id = family_children.family_contact_id
       or g.pending_family_match_id = family_children.family_contact_id;
$$;

revoke execute on function public.family_children(uuid) from public, anon;
grant execute on function public.family_children(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- find_family_by_phone, as in 20261001200000_find_family_by_phone.sql, but a
-- contact still waiting on staff is not a Family of its own: its children
-- are listed, marked unconfirmed, under the Family it matched. A contact with
-- no children left, because they all moved into a confirmed Family, is not
-- listed.
-- ---------------------------------------------------------------------------

create or replace function public.find_family_by_phone(phone text, whatsapp text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    direct text;
    other text;
    phones text[];
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    direct := public.normalize_phone(coalesce(find_family_by_phone.phone, ''));
    if direct is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
    end if;

    other := nullif(btrim(coalesce(find_family_by_phone.whatsapp, '')), '');
    if other is not null then
        other := public.normalize_phone(other);
        if other is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
        end if;
        if other = direct then
            other := null;
        end if;
    end if;

    phones := array_remove(array[direct, other], null);

    return jsonb_build_object(
        'phone', direct,
        'whatsapp', other,
        'contacts', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', g.id,
                    'full_name', g.full_name,
                    'relationship', g.relationship,
                    'relationship_description', g.relationship_description,
                    'phone', g.phone,
                    'whatsapp', g.whatsapp,
                    'children', public.family_children(g.id)
                )
                order by g.created_at, g.id
            )
            from public.guardian_contacts g
            where g.id in (
                select coalesce(m.pending_family_match_id, m.id)
                from public.guardian_contacts m
                where m.phone = any (phones) or m.whatsapp = any (phones)
            )
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
        ), '[]'::jsonb)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- lead_family: the Family a lead belongs to, for the lead screen. For a lead
-- whose contact carries a pending match, that is the matched Family, with the
-- contact it matched; otherwise its own contact's. Needs leads.view.
-- ---------------------------------------------------------------------------

create function public.lead_family(lead_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    lead public.leads;
    contact public.guardian_contacts;
    matched public.guardian_contacts;
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into lead from public.leads l where l.id = lead_family.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id;

    if contact.pending_family_match_id is not null then
        select * into matched from public.guardian_contacts g where g.id = contact.pending_family_match_id;
    end if;

    return jsonb_build_object(
        'contact_id', contact.id,
        'pending_match', case when matched.id is not null then jsonb_build_object(
            'id', matched.id,
            'full_name', matched.full_name,
            'relationship', matched.relationship,
            'relationship_description', matched.relationship_description,
            'phone', matched.phone,
            'whatsapp', matched.whatsapp
        ) end,
        'children', public.family_children(coalesce(matched.id, contact.id))
    );
end;
$$;

revoke execute on function public.lead_family(uuid) from public, anon;
grant execute on function public.lead_family(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The three writes start the same way: leads.edit, then the lead's contact,
-- locked so two staff settling the same contact at once settle it once, and
-- the lead read again under that lock, so a lead that moved off the contact
-- in the meantime is refused as `children_changed`.
-- ---------------------------------------------------------------------------

create function public.lock_lead_contact(lead_id uuid, out lead public.leads, out contact public.guardian_contacts)
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
    select * into contact from public.guardian_contacts g where g.id = lead.guardian_contact_id for update;
    select * into lead from public.leads l where l.id = lock_lead_contact.lead_id;
    if lead.guardian_contact_id is distinct from contact.id then
        raise exception 'children_changed';
    end if;
end;
$$;

revoke execute on function public.lock_lead_contact(uuid) from public, anon, authenticated;

-- Refuses to settle a contact's pending match when it has none, when a child
-- on it is closed, or when its children are no longer the ones staff saw.
create function public.check_pending_match(contact public.guardian_contacts, expected_lead_ids uuid[])
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
    if contact.pending_family_match_id is null then
        raise exception 'no_pending_match';
    end if;
    if exists (
        select 1 from public.leads l
        where l.guardian_contact_id = contact.id and (l.status = 'Declined' or l.closure is not null)
    ) then
        raise exception 'closed';
    end if;
    if expected_lead_ids is not null and exists (
        (select l.id from public.leads l where l.guardian_contact_id = contact.id
         except select unnest(expected_lead_ids))
        union all
        (select unnest(expected_lead_ids)
         except select l.id from public.leads l where l.guardian_contact_id = contact.id)
    ) then
        raise exception 'children_changed';
    end if;
end;
$$;

revoke execute on function public.check_pending_match(public.guardian_contacts, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- confirm_family_match: staff have checked that the parent the Admission form
-- matched is the same person. Every child on the lead's contact moves onto
-- the matched contact, keeping the Family cause, and the pending match is
-- cleared. Contacts that were waiting on the lead's contact now wait on the
-- matched one. `expected_lead_ids` are the children staff were told move.
-- ---------------------------------------------------------------------------

create function public.confirm_family_match(lead_id uuid, expected_lead_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    locked record;
    contact public.guardian_contacts;
    family public.guardian_contacts;
    phones text[];
    match public.leads;
begin
    select * into locked from public.lock_lead_contact(confirm_family_match.lead_id);
    contact := locked.contact;
    perform public.check_pending_match(contact, expected_lead_ids);

    -- Shared, so the matched contact's numbers hold while the children are
    -- checked against them.
    select * into family from public.guardian_contacts g where g.id = contact.pending_family_match_id for share;

    -- Once moved, each child answers to the matched contact's numbers, so
    -- none may share a name with a lead already on file under them.
    phones := array[family.phone, family.whatsapp];
    perform public.lock_lead_phones(phones);
    select m.* into match
    from public.leads child
    cross join lateral public.find_duplicate_lead(child.student_name_key, phones, child.id, contact.id) m
    where child.guardian_contact_id = contact.id and m.id is not null
    order by m.created_at, m.id
    limit 1;
    if match.id is not null then
        return public.duplicate_result(match);
    end if;

    update public.leads l set guardian_contact_id = family.id where l.guardian_contact_id = contact.id;
    update public.guardian_contacts g set pending_family_match_id = null where g.id = contact.id;
    update public.guardian_contacts g
    set pending_family_match_id = nullif(family.id, g.id)
    where g.pending_family_match_id = contact.id;

    return jsonb_build_object('result', 'confirmed');
end;
$$;

revoke execute on function public.confirm_family_match(uuid, uuid[]) from public, anon;
grant execute on function public.confirm_family_match(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_family_match: the parent the Admission form matched is someone else.
-- The pending match is cleared, and with it the Family cause of every child
-- on the lead's contact.
-- ---------------------------------------------------------------------------

create function public.reject_family_match(lead_id uuid, expected_lead_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    locked record;
    contact public.guardian_contacts;
begin
    select * into locked from public.lock_lead_contact(reject_family_match.lead_id);
    contact := locked.contact;
    perform public.check_pending_match(contact, expected_lead_ids);

    update public.guardian_contacts g set pending_family_match_id = null where g.id = contact.id;
    update public.leads l
    set returning_family_joined = false
    where l.guardian_contact_id = contact.id and l.returning_family_joined;
end;
$$;

revoke execute on function public.reject_family_match(uuid, uuid[]) from public, anon;
grant execute on function public.reject_family_match(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- separate_from_family: the lead was joined to a Family by mistake. It gets a
-- contact of its own, a copy of the shared one with no pending match, and
-- loses the Family cause. The children it leaves behind keep theirs. A lead
-- alone on its contact has no Family to leave: `not_shared`.
-- ---------------------------------------------------------------------------

create function public.separate_from_family(lead_id uuid)
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

    if lead.status = 'Declined' or lead.closure is not null then
        raise exception 'closed';
    end if;
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
