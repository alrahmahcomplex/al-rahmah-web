-- The Follow-ups queue (slice 7, #28; #92): open follow-ups in two sections,
-- with the Overdue total for the nav badge. Read-only.
--
--   Overdue   open follow-ups due before today, oldest first, then by
--             Admission Number.
--   Upcoming  open follow-ups due today or later, nearest first. A follow-up
--             due today stays here until the day has passed.
--
-- "Today" is the current date in Tanzania (tanzania_today()), computed here,
-- so the queue and the date rules agree. Both sections leave out leads that
-- are Declined, Enrolled or carry a closure mark. Becoming Enrolled writes
-- nothing, so a lead that drops back out of Enrolled returns with its old
-- follow-up.
--
-- Every function here is security invoker, so row-level security decides what
-- a caller reads: staff with leads.view read the queue, anyone else reads
-- nothing. None is granted to anon.
--
-- follow_up_queue_items(section) is where a section's membership lives. Each
-- item has a `kind`; every item here is a `follow_up`. #95 adds the reopened
-- leads that need a follow-up date to Overdue with `create or replace`, as
-- items of their own kind with no follow-up id, and the queue, its order and
-- the count take them in unchanged.
--
-- Refusals raise a stable code as the error message: `invalid` with the field
-- in the detail (`section`, `page`).

-- ---------------------------------------------------------------------------
-- follow_up_queue_items(section): every item in a section, unordered and
-- unpaged.
-- ---------------------------------------------------------------------------

create function public.follow_up_queue_items(section text)
returns table (kind text, lead_id uuid, follow_up_id uuid, due_on date, note text)
language sql
stable
security invoker
set search_path = ''
as $$
    -- Open follow-ups: no later follow-up replaces them and no record closes
    -- them.
    select 'follow_up'::text, f.lead_id, f.id, f.due_on, f.note
    from public.follow_ups f
    join public.leads l on l.id = f.lead_id
    where l.status not in ('Declined', 'Enrolled')
      and l.closure is null
      and not exists (select 1 from public.follow_ups r where r.replaces_id = f.id)
      and not exists (select 1 from public.follow_up_records c where c.follow_up_id = f.id)
      and case follow_up_queue_items.section
          when 'overdue' then f.due_on < public.tanzania_today()
          when 'upcoming' then f.due_on >= public.tanzania_today()
          else false
      end;
$$;

revoke execute on function public.follow_up_queue_items(text) from public, anon;
grant execute on function public.follow_up_queue_items(text) to authenticated;

-- ---------------------------------------------------------------------------
-- follow_up_queue(section, page): one page of 50 items, with what the screen
-- shows on each row and the section's total.
-- ---------------------------------------------------------------------------

create function public.follow_up_queue(section text, page integer default 1)
returns table (
    kind text,
    lead_id uuid,
    follow_up_id uuid,
    due_on date,
    -- How many days the date has passed; 0 in Upcoming.
    days_overdue integer,
    note text,
    admission_number text,
    student_name text,
    class_name public.lead_class,
    enrollment_year integer,
    status public.lead_status,
    guardian_name text,
    guardian_phone text,
    -- The lead's latest recorded contact, if it has one.
    last_contact_method public.follow_up_contact_method,
    last_contacted_at timestamptz,
    -- Every item in the section, across all pages.
    total bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    today date := public.tanzania_today();
begin
    if follow_up_queue.section is null or follow_up_queue.section not in ('overdue', 'upcoming') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'section')::text;
    end if;
    -- The cap keeps the offset from overflowing; no real queue gets near it.
    if follow_up_queue.page is null or follow_up_queue.page not between 1 and 10000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'page')::text;
    end if;

    return query
    select
        i.kind,
        i.lead_id,
        i.follow_up_id,
        i.due_on,
        greatest(today - i.due_on, 0),
        i.note,
        l.admission_number,
        l.student_name,
        l.class_name,
        l.enrollment_year,
        l.status,
        g.full_name,
        g.phone,
        latest.method,
        latest.contacted_at,
        count(*) over ()
    from public.follow_up_queue_items(follow_up_queue.section) i
    join public.leads l on l.id = i.lead_id
    join public.guardian_contacts g on g.id = l.guardian_contact_id
    left join lateral (
        select r.method, r.contacted_at
        from public.follow_up_records r
        where r.lead_id = i.lead_id
          and r.kind = 'contact'
        order by r.contacted_at desc, r.entered_at desc
        limit 1
    ) latest on true
    order by i.due_on, l.admission_number, i.kind
    limit 50
    offset (follow_up_queue.page - 1) * 50;
end;
$$;

revoke execute on function public.follow_up_queue(text, integer) from public, anon;
grant execute on function public.follow_up_queue(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- follow_up_overdue_count(): how many items Overdue holds, for the nav badge.
-- ---------------------------------------------------------------------------

create function public.follow_up_overdue_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
    select count(*) from public.follow_up_queue_items('overdue');
$$;

revoke execute on function public.follow_up_overdue_count() from public, anon;
grant execute on function public.follow_up_overdue_count() to authenticated;
