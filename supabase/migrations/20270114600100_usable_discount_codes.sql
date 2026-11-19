-- The Discount code list on Register Students (owner, 2026-11-19): every
-- code that takes money off today, for staff to pick from instead of typing.
--
-- usable_discount_codes() lists each Promo code whose state is active and
-- each current agent record whose code is approved and not switched off, as
-- code_discount judges them, so the list and the code check never disagree.
-- Paused, ended and expired Promo codes, pending and switched-off agents and
-- retired records are left out. Each row carries the holder's name (the
-- agent's, or the Promo code's own name) and what it takes off the interview
-- fee now. Promo codes come first, then agent codes, each in code order.
--
-- Staff who may put a code on an application (leads.edit). find_discount_code
-- already names the holder of one typed code to staff who may view leads;
-- this lists them all, so it asks for the permission that enters codes.

create function public.usable_discount_codes()
returns table (
    kind text,
    code text,
    holder_name text,
    amount_off integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    return query
    with codes as (
        select p.code from public.promo_codes p
        union
        select a.code from public.marketing_agents a where a.retired_at is null
    )
    select d.kind, d.code, d.holder_name, d.amount_off
    from codes c
    cross join lateral public.code_discount(c.code) d
    where (d.kind = 'promo' and d.state = 'active')
       or (d.kind = 'agent' and d.state = 'approved')
    order by d.kind = 'agent', d.code;
end;
$$;

revoke execute on function public.usable_discount_codes() from public, anon, authenticated, service_role;
grant execute on function public.usable_discount_codes() to authenticated;
