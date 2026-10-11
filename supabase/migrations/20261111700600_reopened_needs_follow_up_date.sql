-- Reopened leads that need a follow-up date (slice 7, #28; #95). After an
-- approved reopening a new follow-up date is required, unless the lead goes
-- straight to Enrolled (CONTEXT.md). Until staff set one, the lead shows in
-- Overdue as Needs a follow-up date, dated from the approval, and counts in
-- the nav badge. Read-only: nothing here writes.
--
-- A lead needs a date when it is Applied, Visited or Interviewed, carries no
-- closure mark, has an Approved reopening request, and has no follow-up
-- created after its latest approval's decided_at. Scheduling a follow-up, or
-- recording a contact with a next date, creates one and clears the need. A
-- lead that becomes Enrolled leaves the statuses above, which clears it too.
--
-- follow_up_date_needed() holds that rule once. follow_up_queue_items adds its
-- leads to Overdue as items of kind `needs_date`, with no follow-up id and the
-- approval's day in Tanzania as their date, so follow_up_queue's order and
-- paging and follow_up_overdue_count() take them in unchanged. The lead
-- screen reads the same function for one lead.
--
-- Both functions are security invoker, so row-level security decides what a
-- caller reads: staff with leads.view, who read leads, reopening requests and
-- follow-ups, see the leads that need a date; anyone else sees none. Neither
-- is granted to anon.

-- ---------------------------------------------------------------------------
-- follow_up_date_needed(): every lead that needs a follow-up date, with the
-- time its latest reopening was approved.
-- ---------------------------------------------------------------------------

create function public.follow_up_date_needed()
returns table (lead_id uuid, approved_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
    select l.id, approval.decided_at
    from public.leads l
    join lateral (
        select r.decided_at
        from public.reopening_requests r
        where r.lead_id = l.id
          and r.state = 'approved'
        order by r.decided_at desc
        limit 1
    ) approval on true
    where l.status in ('Applied', 'Visited', 'Interviewed')
      and l.closure is null
      and not exists (
          select 1
          from public.follow_ups f
          where f.lead_id = l.id
            and f.created_at > approval.decided_at
      );
$$;

revoke execute on function public.follow_up_date_needed() from public, anon;
grant execute on function public.follow_up_date_needed() to authenticated;

-- ---------------------------------------------------------------------------
-- follow_up_queue_items(section): as #92 wrote it, plus the leads that need a
-- follow-up date, in Overdue only.
-- ---------------------------------------------------------------------------

create or replace function public.follow_up_queue_items(section text)
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
      end
    union all
    -- Reopened leads with no follow-up date yet, dated from the approval.
    select 'needs_date'::text, n.lead_id, null::uuid, (n.approved_at at time zone 'Africa/Dar_es_Salaam')::date, null::text
    from public.follow_up_date_needed() n
    where follow_up_queue_items.section = 'overdue';
$$;
