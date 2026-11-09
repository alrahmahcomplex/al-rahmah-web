-- How many children families have sent through the Admission form this year
-- (concept C redesign). The public form says "we already have N
-- applications", and N comes from here, not from copy.
--
-- It counts every child outcome stored on an Admission form submission whose
-- created_at falls in the current calendar year in Tanzania time: a form with
-- two children counts two, and a child already on file who re-applied counts
-- too, since the family sent them. A submission with no outcome yet counts
-- nothing.
--
-- It returns one aggregate integer and nothing else: no row, key, name or
-- Admission Number ever leaves. Only the secret key may call it. The public
-- route /api/apply/live reads it on the server and hands visitors the
-- number; anonymous visitors and signed-in staff are refused, so the table
-- stays out of the API as before.

create function public.admission_form_application_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with this_year as (
        select (date_trunc('year', now() at time zone 'Africa/Dar_es_Salaam')
                    at time zone 'Africa/Dar_es_Salaam') as starts
    )
    select coalesce(sum((select count(*) from jsonb_object_keys(s.outcomes))), 0)::integer
    from public.admission_submissions s, this_year y
    where s.created_at >= y.starts
      and s.created_at < (((y.starts at time zone 'Africa/Dar_es_Salaam') + interval '1 year')
                              at time zone 'Africa/Dar_es_Salaam');
$$;

revoke all on function public.admission_form_application_count() from public, anon, authenticated;
grant execute on function public.admission_form_application_count() to service_role;
