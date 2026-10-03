-- Recording and correcting an interview result (slice 5, #68): one function
-- for the first recording and every correction after it.
--
-- The first recording on a lead's current interview moves the lead to
-- Interviewed. If the lead is still Applied, the same transaction first
-- records the visit on the interview date through slice 2's record_visit, so
-- the lead follows the lifecycle in order and this path needs visits.record
-- too. A correction changes only the interview row: the lead's status, the
-- S/N and the fee stay as they were. The audit trigger on interviews keeps
-- every earlier value in the lead's history.
--
-- No table or policy changes: the interviews table already refuses half a
-- result and a score out of range or finer than one decimal place, and
-- guard_interview_change already leaves the date, result and score free to
-- change while keeping the S/N, its year and the registration fixed.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `incomplete` (a missing
-- date, result or score), `score_out_of_range`, `score_too_precise`,
-- `date_in_future` (later than today in Tanzania), or
-- `date_before_registration`.

create function public.record_interview_result(
    interview_id uuid,
    interviewed_on date,
    outcome text,
    score numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    the_lead public.leads;
    current_id uuid;
    first_recording boolean;
    changed boolean;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interviews.record') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = record_interview_result.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead is locked before the interview, in the order registration
    -- takes them, so two staff recording the same first result at once move
    -- the lead once.
    select * into the_lead from public.leads l where l.id = target.lead for update;
    perform public.assert_lead_open(the_lead.id);
    select * into target from public.interviews i where i.id = target.id for update;

    if interviewed_on is null or score is null or outcome is null or outcome not in ('Passed', 'Failed') then
        raise exception 'incomplete';
    end if;
    if score < 0 or score > 100 then
        raise exception 'score_out_of_range';
    end if;
    if score <> round(score, 1) then
        raise exception 'score_too_precise';
    end if;
    if interviewed_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
    if interviewed_on < (target.registered_at at time zone 'Africa/Dar_es_Salaam')::date then
        raise exception 'date_before_registration';
    end if;

    first_recording := target.result is null;
    changed := first_recording
        or target.interview_date is distinct from interviewed_on
        or target.result::text is distinct from outcome
        or target.score is distinct from score;

    -- The lead's current interview is its newest registration.
    select i.id into current_id
    from public.interviews i
    where i.lead = the_lead.id
    order by i.registered_at desc, i.serial_number desc
    limit 1;

    if first_recording and current_id = target.id and the_lead.status in ('Applied', 'Visited') then
        if the_lead.status = 'Applied' then
            -- Checks visits.record itself, refusing with not_permitted.
            perform public.record_visit(the_lead.id, interviewed_on);
        end if;
        update public.leads l set status = 'Interviewed' where l.id = the_lead.id;
    end if;

    -- An unchanged correction writes nothing, so the history holds only real
    -- changes.
    if changed then
        update public.interviews i
        set interview_date = interviewed_on,
            result = outcome::public.interview_result,
            score = record_interview_result.score
        where i.id = target.id;
    end if;

    return jsonb_build_object(
        'interview_id', target.id,
        'first_recording', first_recording,
        'changed', changed
    );
end;
$$;

revoke execute on function public.record_interview_result(uuid, date, text, numeric) from public, anon;
grant execute on function public.record_interview_result(uuid, date, text, numeric) to authenticated;
