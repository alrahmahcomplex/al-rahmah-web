-- Sending the admissions WhatsApp group invitation from a lead's screen
-- (slice 11, #186). #183 saved one group link per Enrollment year; this
-- records each time staff send it to a family.
--
-- whatsapp_group_invitations is append-only: one row per send, holding the
-- lead, the Enrollment year, the exact link, the template version, the
-- channel, the siblings included at that moment, and who sent it and when.
-- It is audited in the `lead` scope, refuses updates and deletes, and is
-- written only through send_group_invitation, which needs leads.edit and
-- leads.view, since it returns the family's number and siblings. There
-- is no separate action event and no "latest" row: the latest invitation for
-- a lead is an indexed read.
--
-- A send is recorded when the message leaves the app: for WhatsApp, the click
-- that opens it; for a copy, after the browser confirms the clipboard write.
-- The app can't know whether the family got it or joined the group, and the
-- record doesn't claim so.
--
--   - send_group_invitation(lead_id, method, link_year, link_seen, template_version)
--   - lead_group_invitation(lead_id): what the lead screen shows. Records
--     nothing.
--   - leads_with_earlier_group_link(link_year): the leads whose latest
--     invitation for the year carried a link the year no longer has.
--   - group_invitation_family_count(link_year): distinct families invited.
--
-- Refusal codes from send_group_invitation, in the order it checks them:
-- `forbidden`, `invalid_method`, `invalid_template`, `not-found`,
-- `lead_closed` (from assert_lead_open), `not_visited`, `no_link`,
-- `stale_link` (the lead's year or its link is not the one the caller showed), and
-- `no_whatsapp_number` for a WhatsApp send with no Tanzanian mobile on file.

create table public.whatsapp_group_invitations (
    id uuid primary key default gen_random_uuid(),
    lead_id uuid not null references public.leads (id),
    enrollment_year integer not null check (enrollment_year between 2000 and 2999),
    -- The link as it was sent, kept even after the year's link is replaced.
    url text not null check (
        url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+(\?[A-Za-z0-9_=&.-]*)?$'
        and length(url) <= 200
    ),
    template_version text not null check (template_version ~ '^group_invitation_v[0-9]+$'),
    -- `whatsapp` and `phone` name which of the contact's numbers the wa.me
    -- link opened; `copy` is the text copied for staff to send themselves.
    channel text not null check (channel in ('whatsapp', 'phone', 'copy')),
    -- The other leads of the confirmed Family in the same Enrollment year, as
    -- they were when the invitation went out.
    sibling_lead_ids uuid[] not null default '{}',
    sent_by uuid not null references public.staff_members (id),
    sent_at timestamptz not null default now()
);

create index whatsapp_group_invitations_lead_idx on public.whatsapp_group_invitations (lead_id, sent_at desc);
create index whatsapp_group_invitations_siblings_idx on public.whatsapp_group_invitations using gin (sibling_lead_ids);
create index whatsapp_group_invitations_year_idx on public.whatsapp_group_invitations (enrollment_year, sent_at desc);
create index whatsapp_group_invitations_sent_by_idx on public.whatsapp_group_invitations (sent_by);

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.whatsapp_group_invitations', 'lead', 'lead_id');

create trigger audit_row_change
    after insert or update on public.whatsapp_group_invitations
    for each row
    execute function public.audit_row_change();

-- Never changed after it is written, by anyone.
create trigger refuse_update
    before update on public.whatsapp_group_invitations
    for each row
    execute function public.refuse_follow_up_update();

create trigger refuse_delete
    before delete on public.whatsapp_group_invitations
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.whatsapp_group_invitations
    for each statement
    execute function public.refuse_delete();

alter table public.whatsapp_group_invitations enable row level security;

create policy "Staff who view leads read group invitations"
    on public.whatsapp_group_invitations for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.whatsapp_group_invitations from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- send_group_invitation: records one send. `method` is `link` for a wa.me
-- link, whose number the database picks (the WhatsApp contact, then the
-- direct phone, Tanzanian mobiles only, as result_release_channel does), or
-- `copy`. `link_year` and `link_seen` are the year and link the caller's
-- message carries; if the lead's year or that year's link is no longer the
-- one shown, nothing is recorded, so the row always holds what the family
-- was given.
--
-- The lead is held, then the year's link, then the contact, so neither a
-- closure, a link replacement nor a Family change lands between the check and
-- the record. Siblings come from the confirmed Family: the other leads on
-- the lead's contact when that contact has no unconfirmed match, in the same
-- Enrollment year, whatever their status.
-- ---------------------------------------------------------------------------

create function public.send_group_invitation(lead_id uuid, method text, link_year integer, link_seen text, template_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    lead_row public.leads;
    contact public.guardian_contacts;
    current_url text;
    offered record;
    used text;
    siblings uuid[];
    staff_id uuid;
    invitation_id uuid;
begin
    -- Both: sending needs leads.edit, and the reply carries the family's
    -- number and sibling IDs, which only leads.view may read.
    if auth.role() is distinct from 'authenticated'
       or not public.has_permission('leads.edit')
       or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;
    if send_group_invitation.method is null or send_group_invitation.method not in ('link', 'copy') then
        raise exception 'invalid_method';
    end if;
    if send_group_invitation.template_version is null
       or send_group_invitation.template_version !~ '^group_invitation_v[0-9]+$' then
        raise exception 'invalid_template';
    end if;

    select * into lead_row from public.leads l where l.id = send_group_invitation.lead_id for share;
    if not found then
        raise exception 'not-found';
    end if;
    perform public.assert_lead_open(lead_row.id);
    if lead_row.status = 'Applied' then
        raise exception 'not_visited';
    end if;

    select g.url into current_url
    from public.whatsapp_group_links g
    where g.enrollment_year = lead_row.enrollment_year
    for share;
    if current_url is null then
        raise exception 'no_link';
    end if;
    if lead_row.enrollment_year is distinct from send_group_invitation.link_year
       or current_url is distinct from send_group_invitation.link_seen then
        raise exception 'stale_link';
    end if;

    select * into contact from public.guardian_contacts c where c.id = lead_row.guardian_contact_id for share;

    if send_group_invitation.method = 'link' then
        select * into offered from public.result_release_channel(lead_row.id);
        if offered.channel is distinct from 'whatsapp' then
            raise exception 'no_whatsapp_number';
        end if;
        used := case when offered.number_used = 'whatsapp' then 'whatsapp' else 'phone' end;
    else
        used := 'copy';
    end if;

    select coalesce(array_agg(s.id order by s.created_at, s.id), '{}') into siblings
    from public.leads s
    where contact.pending_family_match_id is null
      and s.guardian_contact_id = contact.id
      and s.id <> lead_row.id
      and s.enrollment_year = lead_row.enrollment_year;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    insert into public.whatsapp_group_invitations
        (lead_id, enrollment_year, url, template_version, channel, sibling_lead_ids, sent_by)
    values
        (lead_row.id, lead_row.enrollment_year, current_url, send_group_invitation.template_version, used, siblings, staff_id)
    returning id into invitation_id;

    return jsonb_build_object(
        'id', invitation_id,
        'channel', used,
        -- The number the wa.me link opens, without copying it into the row.
        'phone', case used when 'whatsapp' then contact.whatsapp when 'phone' then contact.phone end,
        'url', current_url,
        'enrollment_year', lead_row.enrollment_year,
        'sibling_lead_ids', to_jsonb(siblings)
    );
end;
$$;

revoke execute on function public.send_group_invitation(uuid, text, integer, text, text) from public, anon;
grant execute on function public.send_group_invitation(uuid, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_group_invitation: the lead screen's group invitation section, for
-- staff with leads.view. Whether an invitation can go now and why not
-- (`lead_closed`, `not_visited`, `no_link`), the year's link and, for a
-- caller holding leads.edit, the channel on offer. Then the latest
-- invitation that covered this lead, sent from it or from a sibling, with who
-- sent it by name, the other children it covered, and whether the year's link
-- has been replaced since.
-- ---------------------------------------------------------------------------

create function public.lead_group_invitation(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_row public.leads;
    current_url text;
    blocked text;
    can_send boolean := public.has_permission('leads.edit');
    offered record;
    channel text;
    phone text;
    latest record;
    latest_json jsonb;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    select * into lead_row from public.leads l where l.id = lead_group_invitation.lead_id;
    if not found then
        raise exception 'not-found';
    end if;

    select g.url into current_url from public.whatsapp_group_links g where g.enrollment_year = lead_row.enrollment_year;

    if lead_row.status = 'Declined' or lead_row.closure is not null then
        blocked := 'lead_closed';
    elsif lead_row.status = 'Applied' then
        blocked := 'not_visited';
    elsif current_url is null then
        blocked := 'no_link';
    end if;

    if blocked is null and can_send then
        select * into offered from public.result_release_channel(lead_row.id);
        if offered.channel = 'whatsapp' then
            channel := case when offered.number_used = 'whatsapp' then 'whatsapp' else 'phone' end;
            phone := offered.phone;
        else
            channel := 'copy';
        end if;
    end if;

    select i.*, s.full_name as sent_by_name
    into latest
    from public.whatsapp_group_invitations i
    left join public.staff_members s on s.id = i.sent_by
    where i.lead_id = lead_row.id or i.sibling_lead_ids @> array[lead_row.id]
    order by i.sent_at desc, i.id desc
    limit 1;

    if found then
        latest_json := jsonb_build_object(
            'sent_at', latest.sent_at,
            'sent_by', latest.sent_by_name,
            'enrollment_year', latest.enrollment_year,
            'channel', latest.channel,
            'from_lead_id', latest.lead_id,
            -- The other children the invitation covered, oldest lead first:
            -- the lead it was sent from, then its siblings, without this one.
            'with_names', (
                select coalesce(jsonb_agg(c.student_name order by c.ord), '[]'::jsonb)
                from (
                    select l.student_name, x.ord
                    from unnest(array[latest.lead_id] || latest.sibling_lead_ids) with ordinality as x (id, ord)
                    join public.leads l on l.id = x.id
                    where x.id <> lead_row.id
                ) c
            ),
            'earlier_link', latest.url is distinct from (
                select g.url from public.whatsapp_group_links g where g.enrollment_year = latest.enrollment_year
            )
        );
    end if;

    return jsonb_build_object(
        'enrollment_year', lead_row.enrollment_year,
        'blocked', blocked,
        'can_send', can_send,
        'url', current_url,
        'channel', channel,
        'phone', phone,
        'latest', latest_json
    );
end;
$$;

revoke execute on function public.lead_group_invitation(uuid) from public, anon;
grant execute on function public.lead_group_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- leads_with_earlier_group_link: the leads whose latest invitation for the
-- year, sent from them or from a sibling, carried a link other than the
-- year's link now. These are the families to send the new link to; a lead
-- invited again with the current link drops out, and so does a lead since
-- moved to another Enrollment year. Runs as the caller, so the
-- lead, invitation and link policies (all leads.view) decide what it shows.
-- Returns leads rows, so the Leads screen filters and pages it like any
-- other list.
-- ---------------------------------------------------------------------------

create function public.leads_with_earlier_group_link(link_year integer)
returns setof public.leads
language sql
stable
set search_path = ''
as $$
    with covered as (
        select x.id as lead_id, i.url, i.sent_at, i.id
        from public.whatsapp_group_invitations i
        cross join lateral unnest(array[i.lead_id] || i.sibling_lead_ids) as x (id)
        where i.enrollment_year = leads_with_earlier_group_link.link_year
    ),
    latest as (
        select distinct on (c.lead_id) c.lead_id, c.url
        from covered c
        order by c.lead_id, c.sent_at desc, c.id desc
    )
    select l.*
    from public.leads l
    join latest on latest.lead_id = l.id
    join public.whatsapp_group_links g on g.enrollment_year = leads_with_earlier_group_link.link_year
    where latest.url <> g.url
      and l.enrollment_year = leads_with_earlier_group_link.link_year;
$$;

revoke execute on function public.leads_with_earlier_group_link(integer) from public, anon;
grant execute on function public.leads_with_earlier_group_link(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- group_invitation_family_count: how many distinct families were sent an
-- invitation for the year, counted by the parent/guardian contact the
-- invited leads have now, among leads still in that year. Families invited,
-- not group members: nobody knows who joined. For staff with leads.view.
-- ---------------------------------------------------------------------------

create function public.group_invitation_family_count(link_year integer)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    return (
        select count(distinct l.guardian_contact_id)::integer
        from public.whatsapp_group_invitations i
        join public.leads l on l.id = i.lead_id
        where i.enrollment_year = group_invitation_family_count.link_year
          and l.enrollment_year = group_invitation_family_count.link_year
    );
end;
$$;

revoke execute on function public.group_invitation_family_count(integer) from public, anon;
grant execute on function public.group_invitation_family_count(integer) to authenticated;
