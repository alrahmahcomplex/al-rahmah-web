-- Reviewing Re-applications (slice 3, #77). Staff with leads.view read the
-- re-applications #76 records, in a queue of the unreviewed ones and on the
-- lead screen; staff with leads.edit mark each one reviewed.
--
-- The review mark is the one change a re-application row ever takes. It
-- changes the re-application, not the lead, so it is allowed on a Declined,
-- Inactive or Archived lead too.

-- The queue reads the unreviewed ones, oldest first.
create index re_applications_unreviewed_idx on public.re_applications (received_at, id) where reviewed_at is null;

-- ---------------------------------------------------------------------------
-- mark_re_application_reviewed(re_application_id): records the signed-in
-- staff member as its reviewer, now. Needs leads.edit (`not_permitted`
-- otherwise, and for anyone not signed in as active staff). `not_found` for
-- a re-application that doesn't exist; `no_change` for one already reviewed,
-- so two reviews at once record one reviewer. The audit trigger records the
-- review in the lead's history, with the staff member as the actor.
-- ---------------------------------------------------------------------------

create function public.mark_re_application_reviewed(re_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    re_application public.re_applications;
    reviewer uuid;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    select s.id into reviewer from public.staff_members s where s.user_id = auth.uid();
    if reviewer is null then
        raise exception 'not_permitted';
    end if;

    -- Held, so a second review running alongside waits and then finds it
    -- reviewed.
    select * into re_application
    from public.re_applications r
    where r.id = mark_re_application_reviewed.re_application_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    if re_application.reviewed_at is not null then
        raise exception 'no_change';
    end if;

    update public.re_applications r
    set reviewed_at = now(), reviewed_by = reviewer
    where r.id = re_application.id;
end;
$$;

revoke execute on function public.mark_re_application_reviewed(uuid) from public, anon;
grant execute on function public.mark_re_application_reviewed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- re_application_reviewers(re_application_ids): who reviewed each of the
-- given re-applications, by name. Staff who may view leads can't read other
-- staff members' records, so this looks the names up for them. Unreviewed
-- re-applications are left out.
-- ---------------------------------------------------------------------------

create function public.re_application_reviewers(re_application_ids uuid[])
returns table (re_application_id uuid, reviewer_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return query
    select r.id, s.full_name
    from public.re_applications r
    join public.staff_members s on s.id = r.reviewed_by
    where r.id = any (re_application_reviewers.re_application_ids);
end;
$$;

revoke execute on function public.re_application_reviewers(uuid[]) from public, anon;
grant execute on function public.re_application_reviewers(uuid[]) to authenticated;
