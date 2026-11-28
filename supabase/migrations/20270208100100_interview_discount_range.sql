-- The range of savings on the public Admission form's price box (owner,
-- 2026-11-28, prototype WhJUMnd7XoaPF4XBmGcJja v3).
--
-- Before a parent checks a code, the box shows what the codes that work
-- today take off the interview fee: the smallest and the largest saving,
-- such as 10,000–20,000. Working codes are the ones usable_discount_codes()
-- lists, judged by code_discount like the code check itself, so the box and
-- the check never disagree: active Promo codes, and current agent records
-- that are Approved and switched on. A code that takes nothing off is left
-- out. With no such code, both figures are 0.
--
-- Two numbers and nothing else: no code, holder or count. The secret key
-- only; /api/apply/live reads it on the server for anonymous visitors.

create function public.interview_discount_range(out lowest integer, out highest integer)
language sql
stable
security definer
set search_path = ''
as $$
    with codes as (
        select p.code from public.promo_codes p
        union
        select a.code from public.marketing_agents a where a.retired_at is null
    ),
    savings as (
        select d.amount_off
        from codes c
        cross join lateral public.code_discount(c.code) d
        where ((d.kind = 'promo' and d.state = 'active') or (d.kind = 'agent' and d.state = 'approved'))
          and d.amount_off > 0
    )
    select coalesce(min(s.amount_off), 0), coalesce(max(s.amount_off), 0) from savings s;
$$;

revoke execute on function public.interview_discount_range() from public, anon, authenticated, service_role;
grant execute on function public.interview_discount_range() to service_role;
