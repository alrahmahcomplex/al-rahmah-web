-- Two reads for the Sibling screens on Applicants and Reports (#311).
-- Read-only: nothing here writes a fee, a result, a request or a status.
--
-- 1. sibling_list_tags(lead_ids): for each listed lead in a Sibling group or
--    with the prior-sibling tick, its own member entry from
--    explain_sibling_group (reason, result, status, notes, larger_discount,
--    ...) plus the group's grants_paused, keyed by lead id. A lead in no
--    group and without the tick is left out: it has no Sibling discount to
--    show. One group is explained once, however many of its members the
--    page lists. At most 100 ids. Needs leads.view, as
--    explain_sibling_group does.
--
-- 2. leads_for_sibling_follow_up(kind): the leads behind one of the Sibling
--    follow-up counts, as leads rows, so the Applicants list filters and
--    pages them like any other list. The ids come from the count readers
--    themselves (#306), so a list never disagrees with its count:
--      not_known        sibling_lead_counts: Previous school not known yet
--      missing          sibling_lead_counts: Previous school missing
--      kept_ten         sibling_fee_counts: kept the 10% leaving legacy
--      no_full          sibling_fee_counts: Enrolled at 10%, nobody at full
--      fee_edit_needed  sibling_fee_counts: Granted: fee edit needed
--    The readers check their own permission (leads.view, payments.view) and
--    raise not_permitted. Runs as the caller, so the leads policies decide
--    which rows show.
--
-- Rollback: drop both functions. Nothing else uses them.

create function public.sibling_list_tags(lead_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
    answer jsonb := '{}'::jsonb;
    wanted uuid;
    explained jsonb;
    member jsonb;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if cardinality(sibling_list_tags.lead_ids) > 100 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'lead_ids')::text;
    end if;

    foreach wanted in array coalesce(sibling_list_tags.lead_ids, '{}'::uuid[]) loop
        -- Already answered by an earlier member's group.
        continue when answer ? wanted::text;
        continue when not exists (select 1 from public.leads l where l.id = wanted);
        continue when public.lead_sibling_group(wanted) is null
            and not exists (select 1 from public.lead_fee_profiles p where p.lead_id = wanted and p.prior_sibling);

        explained := public.explain_sibling_group(wanted);
        for member in select * from jsonb_array_elements(explained -> 'members') loop
            if (member ->> 'lead_id')::uuid = any (sibling_list_tags.lead_ids) then
                answer := answer || jsonb_build_object(
                    member ->> 'lead_id',
                    member || jsonb_build_object('grants_paused', explained -> 'grants_paused')
                );
            end if;
        end loop;
    end loop;

    return answer;
end;
$fn$;

revoke execute on function public.sibling_list_tags(uuid[]) from public, anon;
grant execute on function public.sibling_list_tags(uuid[]) to authenticated;

create function public.leads_for_sibling_follow_up(kind text)
returns setof public.leads
language plpgsql
stable
set search_path = ''
as $fn$
declare
    ids jsonb;
begin
    case leads_for_sibling_follow_up.kind
        when 'not_known' then
            ids := public.sibling_lead_counts(null) #> '{previous_school,not_known_lead_ids}';
        when 'missing' then
            ids := public.sibling_lead_counts(null) #> '{previous_school,missing_lead_ids}';
        when 'kept_ten' then
            ids := public.sibling_fee_counts(null) #> '{kept_ten,lead_ids}';
        when 'no_full' then
            ids := public.sibling_fee_counts(null) #> '{enrolled_ten_no_full,lead_ids}';
        when 'fee_edit_needed' then
            ids := (
                select coalesce(jsonb_agg(r ->> 'lead_id'), '[]'::jsonb)
                from jsonb_array_elements(public.sibling_fee_counts(null) #> '{fee_edit_needed,requests}') r
            );
        else
            raise exception 'invalid' using detail = jsonb_build_object('field', 'kind')::text;
    end case;

    return query
        select l.*
        from public.leads l
        where l.id in (select x::uuid from jsonb_array_elements_text(coalesce(ids, '[]'::jsonb)) x);
end;
$fn$;

revoke execute on function public.leads_for_sibling_follow_up(text) from public, anon;
grant execute on function public.leads_for_sibling_follow_up(text) to authenticated;
