-- Two reads for the Sibling screens on the lead record (#310).
--
-- 1. sibling_full_payer_tie(lead_id): for the group's full payer, whether
--    another member ranked for the place has the same School fee before
--    discount. The full payer is then the one that joined first (the tie
--    break orders by created_at), and the screen says "The fees are equal,
--    and this student came first". Ranked for the place means what
--    explain_sibling_group's highest_fee compares against: counting, open,
--    not yet Enrolled, not set by hand, nothing fixed at enrolment, and no
--    granted Staff child or Qualified orphan discount. Needs leads.view;
--    null without payments.view, and for a lead that isn't its group's full
--    payer.
--
-- 2. preview_sibling_grant(request_id): what granting a Pending Sibling
--    request would do, saving nothing. It runs the grant's own steps
--    (decide_discount) and rolls them back, as preview_sibling_fee_edit does
--    for the fee edit, so it raises what the grant would raise: not_found,
--    not_pending, lead_closed, invalid with `stale` or `refused_request`.
--    Needs discounts.approve. Returns
--      {"explanation": explain_sibling_group(the request's lead) after the
--                      grant, plus "full_payer_tie" for its full payer,
--       "changes": [{"lead_id", "before", "after"}] whose School fee moves,
--                  or null without payments.view}
--
-- Rollback: drop both functions. Nothing else uses them.

create function public.sibling_full_payer_tie(lead_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
    own_group uuid;
    payer uuid;
    mine integer;
    best integer;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;
    if not public.has_permission('payments.view') then
        return null;
    end if;

    own_group := public.lead_sibling_group(sibling_full_payer_tie.lead_id);
    if own_group is null then
        return null;
    end if;
    select g.full_payer_lead_id into payer from public.sibling_groups g where g.id = own_group;
    if payer is distinct from sibling_full_payer_tie.lead_id then
        return null;
    end if;

    select f.band_fee into mine from public.lead_fee_amounts(sibling_full_payer_tie.lead_id) f;
    -- The members explain_sibling_group's highest_fee compares against.
    select max(fee.band_fee) into best
    from public.sibling_group_members o
    join public.leads s on s.id = o.lead_id
    left join public.lead_sibling_results rs on rs.lead_id = s.id
    cross join lateral public.lead_fee_amounts(s.id) fee
    where o.group_id = own_group and o.lead_id <> sibling_full_payer_tie.lead_id
      and (o.legacy or public.sibling_basis_counts(o.basis))
      and s.status not in ('Enrolled', 'Declined') and s.closure is null
      and coalesce(rs.source::text, 'auto') <> 'manual'
      and rs.locked_result is null
      and not exists (
          select 1 from public.discount_requests d
          where d.lead_id = s.id and d.state = 'granted' and d.kind in ('staff_child', 'qualified_orphan')
      );

    return mine is not null and best is not null and mine = best;
end;
$fn$;

revoke execute on function public.sibling_full_payer_tie(uuid) from public, anon;
grant execute on function public.sibling_full_payer_tie(uuid) to authenticated;

create function public.preview_sibling_grant(request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
    request public.discount_requests;
    fees_visible boolean;
    reach uuid[];
    fees_before jsonb;
    fees_after jsonb;
    explanation jsonb;
    changes jsonb;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('discounts.approve') then
        raise exception 'not_permitted';
    end if;
    select * into request
    from public.discount_requests r
    where r.id = preview_sibling_grant.request_id and r.kind = 'sibling';
    if not found then
        raise exception 'not_found';
    end if;
    fees_visible := public.has_permission('payments.view');

    -- The grant's own steps, rolled back: what this returns is what the
    -- grant would do from the same state. Variables keep their values after
    -- the rollback; the rows don't.
    begin
        -- The grant's locks first, so the fees read before it are the ones
        -- it starts from.
        perform public.lock_lead_families(array_remove(array[request.lead_id, request.sibling_of_lead_id], null));
        reach := public.sibling_fee_edit_reach(request.lead_id);
        if request.sibling_of_lead_id is not null then
            reach := array(select distinct x from unnest(reach || public.sibling_fee_edit_reach(request.sibling_of_lead_id)) x);
        end if;
        fees_before := public.sibling_fee_edit_fees(reach);

        perform public.decide_discount(request.id, 'grant', null);

        reach := array(select distinct x from unnest(reach || public.sibling_fee_edit_reach(request.lead_id)) x);
        fees_after := public.sibling_fee_edit_fees(reach);
        explanation := public.explain_sibling_group(request.lead_id);
        explanation := explanation || jsonb_build_object(
            'full_payer_tie',
            case when explanation ->> 'full_payer_lead_id' is null then null
                 else public.sibling_full_payer_tie((explanation ->> 'full_payer_lead_id')::uuid) end
        );

        if fees_visible then
            select coalesce(jsonb_agg(jsonb_build_object(
                       'lead_id', x,
                       'before', (fees_before -> x::text ->> 'school_fee')::integer,
                       'after', (fees_after -> x::text ->> 'school_fee')::integer
                   ) order by x), '[]'::jsonb)
            into changes
            from unnest(reach) x
            where (fees_before -> x::text ->> 'school_fee') is distinct from (fees_after -> x::text ->> 'school_fee');
        end if;

        raise exception using errcode = 'P0116', message = 'sibling_grant_preview';
    exception when sqlstate 'P0116' then
        null;
    end;

    return jsonb_build_object('explanation', explanation, 'changes', changes);
end;
$fn$;

revoke execute on function public.preview_sibling_grant(uuid) from public, anon;
grant execute on function public.preview_sibling_grant(uuid) to authenticated;
