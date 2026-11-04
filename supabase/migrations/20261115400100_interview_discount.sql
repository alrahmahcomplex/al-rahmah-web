-- The agent interview discount drops to TZS 10,000 (slice 4, #181): a family
-- whose lead carries an Approved agent's code now pays TZS 40,000 for the
-- interview instead of TZS 50,000. It was TZS 30,000.
--
-- interview_fee() is still the only place the two amounts are written down,
-- so expected_interview_amount, discount_code_estimate and the Paid lock all
-- follow without change, and keep their return shapes. A fee already Paid
-- keeps its locked_amount: nothing here touches interviews. A fee not yet
-- Paid reads the new amount at once, and the Accountant marks it Paid only
-- once the full amount is in, so a family who pays TZS 30,000 stays Not Paid.
--
-- interview_discount() is the one figure every screen and piece of copy
-- states, so no amount is hard-coded anywhere else.

-- ---------------------------------------------------------------------------
-- interview_fee: now stable rather than immutable, since the amounts are
-- policy that a later migration may change, and an immutable result can be
-- folded into plans and indexes. Same signature, same grants: internal only.
-- ---------------------------------------------------------------------------

create or replace function public.interview_fee(discounted boolean)
returns integer
language sql
stable
strict
parallel safe
set search_path = ''
as $$
    select case when interview_fee.discounted then 40000 else 50000 end;
$$;

revoke execute on function public.interview_fee(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- interview_discount: how much an Approved agent's code takes off the
-- interview fee, in whole TZS. For the Admission form, the Discount code page
-- and the staff Referral code panel. Every signed-in staff member and the
-- secret key may read it; anonymous visitors may not, so public pages read
-- it on the server with the secret key.
-- ---------------------------------------------------------------------------

create function public.interview_discount()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select public.interview_fee(false) - public.interview_fee(true);
$$;

revoke execute on function public.interview_discount() from public, anon;
grant execute on function public.interview_discount() to authenticated, service_role;
