-- A closed lead is read-only (slice 8, #96). A lead is closed when it is
-- Declined or carries an Inactive or Archived mark, the condition
-- lead_is_closed and assert_lead_open test (Wave 0).
--
-- 1. A `before update` trigger on leads refuses every change to a closed
--    lead, whatever function or session makes it, unless the transaction has
--    set the lifecycle override to one of the three changes a closed lead
--    allows: `close` (a closure mark), `reopen` (an approved reopening) and
--    `payment_recompute` (slice 9). Only a function running as its owner
--    (security definer) can set it, so no staff session can.
-- 2. update_guardian_contact refuses a contact only when every child on it
--    is closed. A contact an open sibling holds stays editable.
--
-- Refusal codes: `lead_closed` from the trigger, `closed` from the contact,
-- `invalid` for an unknown override.

-- ---------------------------------------------------------------------------
-- set_lead_lifecycle_override(path): lets the rest of this transaction change
-- a closed lead along `path`. For write functions only: like assert_lead_open
-- it is granted to no signed-in role, so only functions running as their
-- owner can call it.
-- ---------------------------------------------------------------------------

create function public.set_lead_lifecycle_override(path text)
returns void
language plpgsql
set search_path = ''
as $$
begin
    if path is null or path not in ('close', 'reopen', 'payment_recompute') then
        raise exception 'invalid';
    end if;
    -- Transaction-local: it ends with the transaction that set it.
    perform set_config('app.lead_lifecycle_override', path, true);
end;
$$;

revoke execute on function public.set_lead_lifecycle_override(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The read-only guard. The override counts only when the update runs as a
-- privileged role: a session signed in as staff, or anon, runs its
-- statements as `authenticated` or `anon`, so a value it set with set_config
-- itself is ignored. Security definer functions run as their owner, so the
-- override they set counts.
-- ---------------------------------------------------------------------------

create function public.refuse_closed_lead_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if (old.status = 'Declined' or old.closure is not null)
       and not (
           current_user not in ('authenticated', 'anon')
           and coalesce(current_setting('app.lead_lifecycle_override', true), '') in ('close', 'reopen', 'payment_recompute')
       ) then
        raise exception 'lead_closed';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_closed_lead_change() from public, anon, authenticated;

create trigger refuse_closed_lead_change
    before update on public.leads
    for each row
    execute function public.refuse_closed_lead_change();

-- ---------------------------------------------------------------------------
-- update_guardian_contact, as in 20260930000000_lead_corrections.sql, but a
-- contact is read-only only when every child on it is closed. While an open
-- sibling holds it the open child's family can still be reached, and the
-- change shows in every sibling's history, the closed ones' too.
-- ---------------------------------------------------------------------------

create or replace function public.update_guardian_contact(contact_id uuid, changes jsonb, expected_lead_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    contact public.guardian_contacts;
    contact_name text;
    contact_relationship public.guardian_relationship;
    contact_description text;
    contact_phone text;
    contact_whatsapp text;
    phones text[];
    match public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so a child renamed at the same moment is checked against the
    -- numbers this saves, or this against the new name.
    select * into contact from public.guardian_contacts g where g.id = update_guardian_contact.contact_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if not exists (
        select 1 from public.leads l
        where l.guardian_contact_id = contact.id and l.status <> 'Declined' and l.closure is null
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

    contact_name := contact.full_name;
    if changes ? 'full_name' then
        contact_name := btrim(coalesce(changes ->> 'full_name', ''));
        if contact_name = '' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'contact_name')::text;
        end if;
    end if;

    contact_relationship := contact.relationship;
    contact_description := contact.relationship_description;
    if changes ? 'relationship' then
        begin
            contact_relationship := (changes ->> 'relationship')::public.guardian_relationship;
        exception when invalid_text_representation then
            contact_relationship := null;
        end;
        if contact_relationship is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship')::text;
        end if;
    end if;
    if changes ? 'relationship_description' then
        contact_description := nullif(btrim(coalesce(changes ->> 'relationship_description', '')), '');
    end if;
    if contact_relationship = 'Other' and contact_description is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'relationship_description')::text;
    end if;
    if contact_relationship <> 'Other' then
        contact_description := null;
    end if;

    contact_phone := contact.phone;
    if changes ? 'phone' then
        contact_phone := public.normalize_phone(coalesce(changes ->> 'phone', ''));
        if contact_phone is null then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'phone')::text;
        end if;
    end if;

    contact_whatsapp := contact.whatsapp;
    if changes ? 'whatsapp' then
        contact_whatsapp := nullif(btrim(coalesce(changes ->> 'whatsapp', '')), '');
        if contact_whatsapp is not null then
            contact_whatsapp := public.normalize_phone(contact_whatsapp);
            if contact_whatsapp is null then
                raise exception 'invalid' using detail = jsonb_build_object('field', 'whatsapp')::text;
            end if;
        end if;
    end if;
    if contact_whatsapp = contact_phone then
        contact_whatsapp := null;
    end if;

    -- New numbers must not make any child on this contact a duplicate of a
    -- lead on another contact. Children on one contact never share a name,
    -- so the contact's own leads are left out.
    phones := array(
        select p from unnest(array[contact_phone, contact_whatsapp]) p
        where p is not null and p is distinct from contact.phone and p is distinct from contact.whatsapp
    );
    if cardinality(phones) > 0 then
        perform public.lock_lead_phones(array[contact_phone, contact_whatsapp]);
        select m.* into match
        from public.leads child
        cross join lateral public.find_duplicate_lead(child.student_name_key, phones, child.id, contact.id) m
        where child.guardian_contact_id = contact.id and m.id is not null
        order by m.created_at, m.id
        limit 1;
        if match.id is not null then
            return public.duplicate_result(match);
        end if;
    end if;

    update public.guardian_contacts g
    set full_name = contact_name,
        relationship = contact_relationship,
        relationship_description = contact_description,
        phone = contact_phone,
        whatsapp = contact_whatsapp
    where g.id = contact.id;

    return jsonb_build_object('result', 'updated');
end;
$$;

revoke execute on function public.update_guardian_contact(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_guardian_contact(uuid, jsonb, uuid[]) to authenticated;
