-- A lead's history (slice 2, ADR 4): the lead's own audit rows plus the rows
-- of every parent/guardian contact the lead is or was linked to, newest
-- first. Contact rows carry no lead id, so the contacts are taken from the
-- lead's own history of its contact link: every guardian_contact_id its
-- creation and later changes recorded. A contact shared by siblings is logged
-- once and shows on each sibling's history, and a contact the lead left, at a
-- separation, keeps showing.
--
-- Each row carries the actor's name, looked up now, so a deactivated staff
-- member still shows by name. Staff who may view leads cannot read other
-- staff members' records, which is why this is a security definer function:
-- it checks leads.view itself, the same check the audit log's read policy
-- makes for the `lead` scope, and returns only `lead` scope rows.
--
-- Refusals raise a stable code as the error message: `not_permitted`, or
-- `not_found` for a lead that does not exist.

create function public.lead_history(lead_id uuid)
returns table (
    id bigint,
    created_at timestamptz,
    table_name text,
    row_id uuid,
    action text,
    old_values jsonb,
    new_values jsonb,
    actor_kind text,
    actor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    if not exists (select 1 from public.leads l where l.id = lead_history.lead_id) then
        raise exception 'not_found';
    end if;

    return query
    with own as (
        select a.*
        from public.audit_log a
        where a.lead_id = lead_history.lead_id and a.scope = 'lead'
    ),
    contacts as (
        select (o.new_values ->> 'guardian_contact_id')::uuid as contact_id
        from own o
        where o.table_name = 'leads' and o.new_values ? 'guardian_contact_id'
        union
        select (o.old_values ->> 'guardian_contact_id')::uuid
        from own o
        where o.table_name = 'leads' and o.old_values ? 'guardian_contact_id'
    ),
    entries as (
        select * from own
        union all
        select a.*
        from public.audit_log a
        where a.table_name = 'guardian_contacts'
          and a.scope = 'lead'
          and a.row_id in (select c.contact_id from contacts c where c.contact_id is not null)
    )
    select e.id, e.created_at, e.table_name, e.row_id, e.action, e.old_values, e.new_values,
           e.actor_kind, s.full_name
    from entries e
    left join public.staff_members s on s.id = e.actor_staff_id
    order by e.created_at desc, e.id desc;
end;
$$;

revoke execute on function public.lead_history(uuid) from public, anon;
grant execute on function public.lead_history(uuid) to authenticated;
