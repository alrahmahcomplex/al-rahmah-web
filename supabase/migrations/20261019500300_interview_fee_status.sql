-- Marking the interview fee Paid or Not Paid (slice 5, #69).
--
-- Only the Accountant's permission, interview_payments.record, may change the
-- fee. Marking it Paid locks what expected_interview_amount returns at that
-- moment, so a Referral code approved or changed afterwards never rewrites
-- what the family paid. Marking it Not Paid again undoes a wrong click and
-- releases the lock; the next Paid locks the amount as it is then. The fee
-- belongs to each interview, so a retaken interview has its own.
--
-- expected_interview_amount is Wave 0's stand-in until slice 4 (#80) replaces
-- it in place with `create or replace`; this function locks whatever it
-- returns.
--
-- The interviews table already keeps an amount exactly while the fee is Paid.
-- Beside it goes whether that amount was the discounted fee, kept by the same
-- rule, so the panel never has to guess it from the amount after the fee
-- rules change. guard_interview_change leaves the fee columns free to change
-- while keeping the S/N, its year and the registration fixed. The audit
-- trigger on interviews puts every change, with the amount, who and when, in
-- the lead's history.
--
-- Refusals raise a stable code as the error message: `not_permitted`,
-- `not_found`, `lead_closed` (from assert_lead_open), `invalid_status`, or
-- `no_change` (the fee already has that status).

alter table public.interviews add column locked_discount_applied boolean;

-- A Paid interview from before this function could only have been written
-- directly, with nothing saying whether its amount was discounted. The full
-- fee was TZS 50,000 then, so a lower locked amount was the discounted one.
do $$
begin
    perform public.set_audit_actor('system');
    update public.interviews
    set locked_discount_applied = locked_amount < 50000
    where fee_status = 'Paid';
end;
$$;

alter table public.interviews
    add constraint interviews_discount_locked_while_paid
        check ((fee_status = 'Paid') = (locked_discount_applied is not null));

create function public.set_interview_fee_status(interview_id uuid, fee_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.interviews;
    expected record;
    new_amount integer;
    discounted boolean := false;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('interview_payments.record') then
        raise exception 'not_permitted';
    end if;

    select * into target from public.interviews i where i.id = set_interview_fee_status.interview_id;
    if not found then
        raise exception 'not_found';
    end if;
    -- The lead is held before the interview, in the order the other interview
    -- writes take them, so it can't be closed between the check and the
    -- change.
    perform 1 from public.leads l where l.id = target.lead for share;
    perform public.assert_lead_open(target.lead);
    -- Locked, so two clicks at once change the fee once: the second finds the
    -- status already set.
    select * into target from public.interviews i where i.id = target.id for update;

    if set_interview_fee_status.fee_status is null
       or set_interview_fee_status.fee_status not in ('Paid', 'Not Paid') then
        raise exception 'invalid_status';
    end if;
    if target.fee_status::text = set_interview_fee_status.fee_status then
        raise exception 'no_change';
    end if;

    if set_interview_fee_status.fee_status = 'Paid' then
        select e.amount, e.discount_applied into expected from public.expected_interview_amount(target.lead) e;
        new_amount := expected.amount;
        discounted := expected.discount_applied;
    end if;

    update public.interviews i
    set fee_status = set_interview_fee_status.fee_status::public.interview_fee_status,
        locked_amount = new_amount,
        locked_discount_applied = case when new_amount is null then null else discounted end
    where i.id = target.id;

    return jsonb_build_object(
        'interview_id', target.id,
        'fee_status', set_interview_fee_status.fee_status,
        'locked_amount', new_amount,
        'discount_applied', discounted
    );
end;
$$;

revoke execute on function public.set_interview_fee_status(uuid, text) from public, anon;
grant execute on function public.set_interview_fee_status(uuid, text) to authenticated;
