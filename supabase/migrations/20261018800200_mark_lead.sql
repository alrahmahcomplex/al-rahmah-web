-- Marking a lead Inactive or Archived (slice 8, #98). Staff put a closure mark
-- on a lead with a closure reason from the fixed list and an optional note.
-- The lead keeps its status. A Declined lead can be marked, and an Inactive
-- lead can move to Archived; nothing else changes a mark until an approved
-- reopening (#99) clears it.
--
-- 1. The `closure_reason` list and, on leads, the reason, note, when and who.
--    The existing audit trigger on leads records each change, so the history
--    needs nothing extra.
-- 2. mark_lead, the one way to set a mark. It works on closed leads too, so it
--    sets the `close` lifecycle override the read-only guard (#96) allows.
-- 3. lead_closure gains the current closure mark, with the name of the staff
--    member who set it.
--
-- Refusal codes: `not_permitted`, `not_found`, and `invalid` with the
-- offending field as JSON in the detail. A move the rules don't allow (an
-- Archived lead marked again, or Inactive marked Inactive) is `invalid` on
-- the field `mark`.

create type public.closure_reason as enum (
    'Duplicate record',
    'Family requested closure',
    'Enrolled elsewhere',
    'No longer pursuing admission',
    'Record created in error',
    'Admission cycle ended'
);

alter table public.leads
    add column closure_reason public.closure_reason,
    add column closure_note text,
    add column closed_at timestamptz,
    add column closed_by uuid references public.staff_members (id);

-- Leads marked before this migration have no reason, and the check below
-- would refuse them. They get the closest reason on the list and a note
-- saying so; who marked them and when stay unknown. The closed-lead guard
-- (#96) refuses changes to a marked lead, so this sets the `close` override,
-- and the history records the change under the system actor. One block, so
-- the transaction-local actor and override cover the update.
do $$
begin
    perform public.set_audit_actor('system');
    perform public.set_lead_lifecycle_override('close');

    update public.leads
    set closure_reason = 'No longer pursuing admission',
        closure_note = 'Marked before closure reasons were recorded.'
    where closure is not null and closure_reason is null;

    perform set_config('app.lead_lifecycle_override', '', true);
end;
$$;

-- The mark's details are set together with the mark, and an approved
-- reopening clears them together.
alter table public.leads
    add constraint leads_closure_reason_check
        check ((closure is not null) = (closure_reason is not null)),
    add constraint leads_closure_note_check
        check (closure_note is null or (btrim(closure_note) <> '' and char_length(closure_note) <= 1000)),
    add constraint leads_closure_details_check
        check (closure_reason is not null or (closure_note is null and closed_at is null and closed_by is null));

-- ---------------------------------------------------------------------------
-- mark_lead(lead_id, mark, reason, note): needs leads.close. Allowed moves: no
-- mark to Inactive or Archived, and Inactive to Archived, whatever the status,
-- Declined included. The status is left as it is. The mark replaces the
-- reason and note with its own, and records who set it and when.
--
-- It sets the `close` override only for its own update, and puts back
-- whatever the transaction held before, so a caller's later statements are
-- guarded as before.
-- ---------------------------------------------------------------------------

create function public.mark_lead(lead_id uuid, mark text, reason text, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    chosen_mark public.lead_closure;
    chosen_reason public.closure_reason;
    clean_note text := nullif(btrim(coalesce(mark_lead.note, '')), '');
    staff_id uuid;
    earlier_override text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.close') then
        raise exception 'not_permitted';
    end if;

    begin
        chosen_mark := mark_lead.mark::public.lead_closure;
    exception when invalid_text_representation then
        chosen_mark := null;
    end;
    if chosen_mark is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'mark')::text;
    end if;

    begin
        chosen_reason := mark_lead.reason::public.closure_reason;
    exception when invalid_text_representation then
        chosen_reason := null;
    end;
    if chosen_reason is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'reason')::text;
    end if;
    if char_length(clean_note) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'note')::text;
    end if;

    -- Locked, so two staff marking the same lead at once are checked one
    -- after the other: whoever comes second sees the first one's mark.
    select * into target from public.leads l where l.id = mark_lead.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if not (target.closure is null or (target.closure = 'Inactive' and chosen_mark = 'Archived')) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'mark')::text;
    end if;

    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

    earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
    perform public.set_lead_lifecycle_override('close');

    update public.leads l
    set closure = chosen_mark,
        closure_reason = chosen_reason,
        closure_note = clean_note,
        closed_at = now(),
        closed_by = staff_id
    where l.id = target.id;

    perform set_config('app.lead_lifecycle_override', earlier_override, true);
end;
$$;

revoke execute on function public.mark_lead(uuid, text, text, text) from public, anon;
grant execute on function public.mark_lead(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- lead_closure(lead_id), as in 20261017800100_decline_lead.sql, plus the
-- closure mark: {"decline": ... | null, "closure": ... | null}. The closure
-- carries the mark, reason, note, when, and the name of who set it, looked up
-- now so a deactivated staff member still shows by name.
-- ---------------------------------------------------------------------------

create or replace function public.lead_closure(lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    target public.leads;
    decliner text;
    closer text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.leads l where l.id = lead_closure.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select s.full_name into decliner from public.staff_members s where s.id = target.declined_by;
    select s.full_name into closer from public.staff_members s where s.id = target.closed_by;

    return jsonb_build_object(
        'decline',
        case when target.declined_reason is null then null else jsonb_build_object(
            'reason', target.declined_reason,
            'explanation', target.declined_explanation,
            'declined_at', target.declined_at,
            'declined_by', decliner,
            'status_before', target.status_before_decline
        ) end,
        'closure',
        case when target.closure is null then null else jsonb_build_object(
            'mark', target.closure,
            'reason', target.closure_reason,
            'note', target.closure_note,
            'closed_at', target.closed_at,
            'closed_by', closer
        ) end
    );
end;
$$;

revoke execute on function public.lead_closure(uuid) from public, anon;
grant execute on function public.lead_closure(uuid) to authenticated;
