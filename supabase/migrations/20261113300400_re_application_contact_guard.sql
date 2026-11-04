-- A re-application may change a shared contact only while its own lead is
-- open. Keep that lead locked through the ordinary contact correction.
-- The legacy correction remains available for an open sibling's own work.
create function public.update_guardian_contact_for_lead(
    lead_id uuid,
    contact_id uuid,
    changes jsonb,
    expected_lead_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Lead before contact, as in update_lead_details and result release.
    -- A concurrent closure either wins before this lock, or waits until the
    -- contact correction commits. Reassignment cannot change the contact
    -- between this check and the write either.
    select * into target from public.leads l
    where l.id = update_guardian_contact_for_lead.lead_id for share;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(target.id);
    if target.guardian_contact_id is distinct from contact_id then
        raise exception 'children_changed';
    end if;

    return public.update_guardian_contact(contact_id, changes, expected_lead_ids);
end;
$$;

revoke execute on function public.update_guardian_contact_for_lead(uuid, uuid, jsonb, uuid[])
    from public, anon, service_role;
grant execute on function public.update_guardian_contact_for_lead(uuid, uuid, jsonb, uuid[])
    to authenticated;
