-- Home's chart counts by admission year, imported records included (#518).
-- Read-only: nothing here writes a row.
--
-- Owner decisions of 2026-11-21 and 2026-11-26: Home counts every applicant,
-- those from the Admission form, the desk, agents' codes and student imports,
-- by the year they enrol in, with no line drawn between imported records and
-- the rest. Home opens on the current admission year (currentAdmissionYear in
-- lib/school-calendar.ts) and lists every other year that has an applicant
-- (home_admission_years) to switch to.
--
-- An application is a lead whose enrollment_year is the year asked for,
-- whatever its status or closure mark now. Each counts once in each
-- dimension, so the four totals are the same:
--
--   month   'YYYY-MM' of its own date in Tanzania time: the day it was
--           created, or for an imported record its Visit date from the file
--           (the import day only when the file gave none), so an import
--           never piles up in the month it ran;
--   class   its current class;
--   status  its current status (Applied, Visited, Interviewed, Enrolled,
--           Declined), imported or not;
--   source  promo_code      its code is a Promo code;
--           agent_code      any other code, an agent's Discount code;
--           admission_form  no code, and the public Admission form created it;
--           walk_in         no code otherwise: staff created it at the desk,
--                           or a student import brought it in.
--
-- Whether the form or staff created a lead is recorded only in the lead's
-- insert row in audit_log, which only the Super Admin may read. So this
-- function is security definer: it refuses anyone without leads.view with
-- `forbidden`, and hands back counts only, never a row, a name or an id.
-- A month, class or source with none is left out.

create or replace function public.home_chart_counts(year integer)
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
                l.status,
                to_char(
                    case
                        when l.import_batch_id is not null and l.visit_date is not null then l.visit_date
                        else (l.created_at at time zone 'Africa/Dar_es_Salaam')::date
                    end,
                    'YYYY-MM') as applied_month,
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
            where l.enrollment_year = home_chart_counts.year
        )
        select 'month', a.applied_month, count(*) from applications a group by a.applied_month
        union all
        select 'class', a.class_name::text, count(*) from applications a group by a.class_name
        union all
        select 'status', a.status::text, count(*) from applications a group by a.status
        union all
        select 'source', a.source, count(*) from applications a group by a.source;
end;
$$;

-- The admission years Home's year list offers: every year with at least one
-- applicant, newest first. Home adds the current admission year when it has
-- none yet. Same guard as home_chart_counts; years only, never a row.
create or replace function public.home_admission_years()
returns table (year integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'forbidden';
    end if;

    return query
        select distinct l.enrollment_year
        from public.leads l
        where l.enrollment_year is not null
        order by l.enrollment_year desc;
end;
$$;

revoke all on function public.home_admission_years() from public, anon;
grant execute on function public.home_admission_years() to authenticated;
