-- Closing a lead's follow-up when the lead closes (slice 7, #28, ticket #93).
--
-- When a lead is declined, or gets an Inactive or Archived closure mark, by
-- any route, its open follow-up closes in the same transaction: a
-- `closed_with_lead` record with the cause `declined`, `inactive` or
-- `archived`. The trigger sits on slice 2's leads table but reads only its
-- `status` and `closure` columns, so slice 8 needs no follow-up code. The
-- record is audited like any other, under whoever closed the lead.
--
-- 1. The trigger, after update on leads.
-- 2. A one-off pass that closes the follow-ups of leads that closed before
--    the trigger existed, so no closed lead keeps an open follow-up.

-- ---------------------------------------------------------------------------
-- 1. The trigger.
--
-- Locking: every follow-up write locks the lead row `for share`, then takes
-- the lead's advisory lock (`follow-up-lead:<id>`). The update that fires
-- this trigger already holds the lead row exclusively, so no follow-up write
-- on the lead can run alongside it, and the trigger takes no advisory lock:
-- taking it while holding the row would invert that order and could
-- deadlock. A write that held the row first has committed by the time the
-- update gets the row, and the trigger's own statement sees what it wrote.
-- ---------------------------------------------------------------------------

create function public.close_follow_up_with_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    closing_cause public.follow_up_closed_cause;
    open_id uuid;
begin
    if new.status = 'Declined' and old.status is distinct from 'Declined' then
        closing_cause := 'declined';
    elsif old.closure is null and new.closure = 'Inactive' then
        closing_cause := 'inactive';
    elsif old.closure is null and new.closure = 'Archived' then
        closing_cause := 'archived';
    else
        return null;
    end if;

    open_id := (public.open_follow_up(new.id)).id;
    if open_id is not null then
        insert into public.follow_up_records (lead_id, follow_up_id, kind, cause)
        values (new.id, open_id, 'closed_with_lead', closing_cause);
    end if;
    return null;
end;
$$;

revoke execute on function public.close_follow_up_with_lead() from public, anon, authenticated;

-- Every update that changes the status or the mark, whichever columns its
-- statement names.
create trigger close_follow_up_with_lead
    after update on public.leads
    for each row
    when (new.status is distinct from old.status or new.closure is distinct from old.closure)
    execute function public.close_follow_up_with_lead();

-- ---------------------------------------------------------------------------
-- 2. Leads that closed before the trigger: their open follow-ups close now,
-- as the system. A Declined lead's cause is the decline, whatever mark it
-- also carries.
-- ---------------------------------------------------------------------------

do $$
begin
    perform public.set_audit_actor('system');

    insert into public.follow_up_records (lead_id, follow_up_id, kind, cause)
    select l.id,
           f.id,
           'closed_with_lead',
           case
               when l.status = 'Declined' then 'declined'
               when l.closure = 'Inactive' then 'inactive'
               else 'archived'
           end::public.follow_up_closed_cause
    from public.leads l
    cross join lateral public.open_follow_up(l.id) f
    where (l.status = 'Declined' or l.closure is not null)
      and f.id is not null;
end;
$$;
