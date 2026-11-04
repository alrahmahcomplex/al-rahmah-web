-- The WhatsApp group link for each Enrollment year (slice 11, #183). Staff
-- save one link per year; the group invitation (#186) sends it to families.
--
-- whatsapp_group_links has no foreign key to fee_schedules: a year's link may
-- be saved before its Fee schedule exists. It is audited in the `lead` scope
-- with no lead id, refuses deletes, and is written only through
-- set_group_link, which checks group_links.manage and the link itself.
-- Replacing a link is an update, so the audit log keeps every earlier link.
--
-- Refusal codes from set_group_link: `not_permitted`, `invalid` with the
-- field (`year` or `link`) as JSON in the detail, and `stale` when the year's
-- link is no longer the one the caller saw.

-- ---------------------------------------------------------------------------
-- The permission. It takes the next position and goes to every current role
-- that can edit leads, so the Admissions Manager and Admissions Staff get it.
-- ---------------------------------------------------------------------------

insert into public.permissions (position, name, label)
select coalesce(max(position), 0) + 1, 'group_links.manage', 'Set WhatsApp group links'
from public.permissions;

-- A fresh database has no staff yet, so nobody administers, and the old
-- check refused any change to the Manager's role, this grant included. A
-- role update that leaves the role administering can't lower the count, so
-- it is allowed whatever the count. Staff changes keep the old rule.
create or replace function public.refuse_no_administrator_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    was_administering boolean;
begin
    -- Only a change to a row that gave someone the power to administer can
    -- take it away, so a fresh database with no administrator yet can still
    -- be set up.
    if tg_table_name = 'staff_members' then
        was_administering := old.active and exists (
            select 1 from public.roles r
            where r.id = old.role_id and not r.retired and 'staff.administer' = any (r.permissions)
        );
    else
        was_administering := not old.retired and 'staff.administer' = any (old.permissions)
            and (new.retired or not 'staff.administer' = any (new.permissions));
    end if;
    if not was_administering then
        return null;
    end if;

    -- Two changes that each leave one administrator behind could both pass
    -- if they counted at the same time. The lock makes the second wait for
    -- the first to commit, and its count then sees the first one's change.
    perform pg_advisory_xact_lock(hashtext('public.administrator_count'));
    if public.administrator_count() = 0 then
        raise exception 'no_administrator_left';
    end if;
    return null;
end;
$$;

revoke execute on function public.refuse_no_administrator_left() from public, anon, authenticated;

-- The grant goes by permission, never by role name, and matching no role is
-- not an error. Roles created later don't get group_links.manage
-- automatically: an administrator ticks it on the role like any other.
select public.set_audit_actor('system');

update public.roles
set permissions = array_append(permissions, 'group_links.manage')
where not retired
  and 'leads.edit' = any (permissions)
  and not 'group_links.manage' = any (permissions);

-- ---------------------------------------------------------------------------
-- The links.
-- ---------------------------------------------------------------------------

create table public.whatsapp_group_links (
    id uuid primary key default gen_random_uuid(),
    enrollment_year integer not null unique check (enrollment_year between 2000 and 2999),
    -- An invite code and, optionally, WhatsApp's own query string. Nothing
    -- else, so no space, line break or path can ride into the message.
    url text not null check (
        url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+(\?[A-Za-z0-9_=&.-]*)?$'
        and length(url) <= 200
    ),
    set_by uuid not null references public.staff_members (id),
    set_at timestamptz not null default now()
);

create index whatsapp_group_links_set_by_idx on public.whatsapp_group_links (set_by);

insert into public.audit_scopes (table_name, scope, lead_id_column) values
    ('public.whatsapp_group_links', 'lead', null);

create trigger audit_row_change
    after insert or update on public.whatsapp_group_links
    for each row
    execute function public.audit_row_change();

create trigger refuse_delete
    before delete on public.whatsapp_group_links
    for each row
    execute function public.refuse_delete();

create trigger refuse_truncate
    before truncate on public.whatsapp_group_links
    for each statement
    execute function public.refuse_delete();

-- Reads for staff who view leads, since the link goes out on a lead's
-- screen. Every write is set_group_link.
alter table public.whatsapp_group_links enable row level security;

create policy "Staff who view leads read group links"
    on public.whatsapp_group_links for select
    to authenticated
    using ((select public.has_permission('leads.view')));

revoke insert, update, delete, truncate on public.whatsapp_group_links from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_group_link: saves or replaces a year's link. Needs group_links.manage.
-- `link_was` is the link the caller saw, null for none; if the year's link is
-- no longer that one, someone else changed it first, and the save is refused
-- as `stale`. Surrounding spaces are trimmed. The same link again writes
-- nothing.
-- ---------------------------------------------------------------------------

create function public.set_group_link(link_year integer, link text, link_was text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid;
    clean text := btrim(link, E' \t\r\n');
    current_url text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('group_links.manage') then
        raise exception 'not_permitted';
    end if;

    if link_year is null or link_year not between 2000 and 2999 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'year')::text;
    end if;
    if clean is null
        or length(clean) > 200
        or clean !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+(\?[A-Za-z0-9_=&.-]*)?$'
    then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'link')::text;
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    -- Locked, so two people saving the same year take turns. A year with no
    -- link yet has no row to lock; the unique year makes the second insert
    -- fail, and it is then refused as stale below.
    select l.url into current_url
    from public.whatsapp_group_links l
    where l.enrollment_year = link_year
    for update;

    if current_url is distinct from link_was then
        raise exception 'stale';
    end if;
    if current_url = clean then
        return;
    end if;

    if current_url is null then
        begin
            insert into public.whatsapp_group_links (enrollment_year, url, set_by)
            values (link_year, clean, staff_id);
        exception when unique_violation then
            raise exception 'stale';
        end;
    else
        update public.whatsapp_group_links
        set url = clean, set_by = staff_id, set_at = now()
        where enrollment_year = link_year;
    end if;
end;
$$;

revoke execute on function public.set_group_link(integer, text, text) from public, anon;
grant execute on function public.set_group_link(integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- group_links(): every year's link with the name of who set it, for staff
-- with leads.view. Names come through here because staff_members shows other
-- staff only to administrators.
-- ---------------------------------------------------------------------------

create function public.group_links()
returns table (enrollment_year integer, url text, set_by_name text, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return query
    select l.enrollment_year, l.url, s.full_name, l.set_at
    from public.whatsapp_group_links l
    join public.staff_members s on s.id = l.set_by
    order by l.enrollment_year;
end;
$$;

revoke execute on function public.group_links() from public, anon;
grant execute on function public.group_links() to authenticated;
