-- The counts behind Home's chart card (#405): this year's applications per
-- month, per class and per source. Read-only: nothing here writes a row.
--
-- An application is a lead created in the calendar year, in Tanzania time,
-- whatever its status or closure mark now. Leads brought in by a student
-- import are left out: they were not applications that year, as Home's
-- "Applied this week" leaves them out. Each counts once in each dimension,
-- so the three totals are the same:
--
--   month   '01' to '12', by the month it was created;
--   class   its current class;
--   source  promo_code      its code is a Promo code;
--           agent_code      any other code, an agent's Discount code;
--           admission_form  no code, and the public Admission form created it;
--           walk_in         no code, and staff created it at the desk.
--
-- Whether the form or staff created a lead is recorded only in the lead's
-- insert row in audit_log, which only the Super Admin may read. So this
-- function is security definer: it refuses anyone without leads.view with
-- `forbidden`, and hands back counts only, never a row, a name or an id.
-- A month, class or source with none is left out.

create function public.home_chart_counts(year integer)
returns table (dimension text, bucket text, application_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;
    if home_chart_counts.year is null then
        raise exception 'invalid';
    end if;

    return query
        with applications as (
            select
                l.class_name,
                extract(month from l.created_at at time zone 'Africa/Dar_es_Salaam')::integer as created_month,
                case
                    when l.referral_code is not null
                         and exists (select 1 from public.promo_codes p where p.code = l.referral_code)
                        then 'promo_code'
                    when l.referral_code is not null
                        then 'agent_code'
                    when exists (
                        select 1 from public.audit_log a
                        where a.table_name = 'leads'
                          and a.row_id = l.id
                          and a.action = 'insert'
                          and a.actor_kind = 'public_form')
                        then 'admission_form'
                    else 'walk_in'
                end as source
            from public.leads l
            where l.import_batch_id is null
              and l.created_at >= make_timestamptz(home_chart_counts.year, 1, 1, 0, 0, 0, 'Africa/Dar_es_Salaam')
              and l.created_at < make_timestamptz(home_chart_counts.year + 1, 1, 1, 0, 0, 0, 'Africa/Dar_es_Salaam')
        )
        select 'month', lpad(a.created_month::text, 2, '0'), count(*) from applications a group by a.created_month
        union all
        select 'class', a.class_name::text, count(*) from applications a group by a.class_name
        union all
        select 'source', a.source, count(*) from applications a group by a.source;
end;
$$;

revoke execute on function public.home_chart_counts(integer) from public, anon;
grant execute on function public.home_chart_counts(integer) to authenticated;
