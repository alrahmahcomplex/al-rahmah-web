-- The Discount code on the Admission form (slice 4, #83): the form's estimate
-- of a code, and the writes that put a submitted code on the leads the form
-- created. All are for the public form's Server Actions, which hold the
-- secret key; no signed-in role and no anonymous visitor may call them.
--
-- Refusal codes: `not_permitted`, `not_found`, `lead_closed` (from
-- assert_lead_open), and `invalid` with `{"field": "discount_code"}` in the
-- detail.

-- ---------------------------------------------------------------------------
-- discount_code_estimate: what a typed code means for the interview fee, for
-- the form's review step. `state` is `approved` (an Approved agent's code),
-- `pending` (a Pending agent's) or `unknown` (no agent's, or not a code), and
-- `amount` the interview fee per child in whole TZS, from interview_fee(), the
-- same function expected_interview_amount reads. Only an Approved agent's code
-- brings it down.
-- ---------------------------------------------------------------------------

create function public.discount_code_estimate(code text, out state text, out amount integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    agent_status public.marketing_agent_status;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;

    select a.status into agent_status
    from public.marketing_agents a
    where a.code = public.normalize_referral_code(discount_code_estimate.code);

    state := case agent_status when 'Approved' then 'approved' when 'Pending' then 'pending' else 'unknown' end;
    amount := public.interview_fee(agent_status is not distinct from 'Approved');
end;
$$;

revoke execute on function public.discount_code_estimate(text) from public, anon, authenticated;
grant execute on function public.discount_code_estimate(text) to service_role;

-- ---------------------------------------------------------------------------
-- apply_form_discount_code: puts the code the Admission form sent on a lead
-- it created, recognised or not, so the agent is credited and staff can fix a
-- typo from the lead's Referral code panel. It writes only into an empty
-- code: a lead that already carries one (from an earlier call, or set by
-- staff in between) keeps it, and nothing is written, so no history either.
-- That lets the form's retry path call it again safely. A value that isn't a
-- code is `invalid`. Runs as the Admission form in the lead's history.
-- Returns the code the lead now carries.
-- ---------------------------------------------------------------------------

create function public.apply_form_discount_code(lead_id uuid, code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_code text;
    current_code text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    new_code := public.normalize_referral_code(apply_form_discount_code.code);
    if new_code is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'discount_code')::text;
    end if;

    -- Locked, so a staff edit at the same moment is either seen here or made
    -- after this write.
    select l.referral_code into current_code
    from public.leads l
    where l.id = apply_form_discount_code.lead_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    if current_code is not null then
        return current_code;
    end if;
    perform public.assert_lead_open(apply_form_discount_code.lead_id);

    update public.leads l
    set referral_code = new_code
    where l.id = apply_form_discount_code.lead_id;

    return new_code;
end;
$$;

revoke execute on function public.apply_form_discount_code(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_form_discount_code(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- apply_form_discount_code_to_sent: the same write for every lead an earlier
-- send of the form created, for a retry the parent edited. Such a retry
-- creates nothing (the submission key is answered `submission_key_reused`),
-- so a code step the earlier send never finished would otherwise stay
-- undone. The code is the one the parent sends now. As above, it goes only
-- into an empty code on an open lead, never onto a child already on file
-- (a Re-application), and a repeat writes nothing. Returns how many leads it
-- gave the code.
-- ---------------------------------------------------------------------------

create function public.apply_form_discount_code_to_sent(submission_key uuid, code text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_code text;
    target uuid;
    changed integer;
    applied integer := 0;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    perform public.set_audit_actor('public_form', null);

    new_code := public.normalize_referral_code(apply_form_discount_code_to_sent.code);
    if new_code is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'discount_code')::text;
    end if;

    for target in
        select (o.value ->> 'lead_id')::uuid
        from public.admission_submissions s, jsonb_each(s.outcomes) o
        where s.submission_key = apply_form_discount_code_to_sent.submission_key
          and o.value ->> 'result' = 'created'
        order by o.key::integer
    loop
        -- Open is assert_lead_open's condition; a closed lead is skipped, as
        -- the per-lead path leaves one.
        update public.leads l
        set referral_code = new_code
        where l.id = target
          and l.referral_code is null
          and l.status <> 'Declined'
          and l.closure is null;
        get diagnostics changed = row_count;
        applied := applied + changed;
    end loop;

    return applied;
end;
$$;

revoke execute on function public.apply_form_discount_code_to_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_form_discount_code_to_sent(uuid, text) to service_role;
