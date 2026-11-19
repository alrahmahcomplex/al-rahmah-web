-- The student export gets a "Boy or girl" column (#449, slice 6; the owner's
-- answer Q13). It holds the child's answer, Boy or Girl, and is empty for a
-- child with none: one from before the question, or from the workbook
-- import. A view column, like Day or boarding: any staff member who may
-- export the list may have it. The import is unchanged.
--
-- export_column_tier, as 20261204130600 made it, knows `gender`.
-- export_leads, as 20261229100300 made it, answers it. Same signatures and
-- grants; nothing else in either changes.
--
-- One `do` block: the Supabase CLI runs a file's statements one by one,
-- outside a transaction, and the two functions must change together. With
-- only the first, the column would be known and answered empty.
--
-- Rollback: a new migration putting both functions back as those two
-- migrations made them.

do $migration$
begin
    create or replace function public.export_column_tier(column_name text)
    returns text
    language sql
    immutable
    set search_path = ''
    as $fn$
        select case
            when export_column_tier.column_name in (
                'admission_number', 'student_name', 'class_name', 'enrollment_year', 'day_or_boarding', 'gender', 'status',
                'status_since', 'visit_date', 'discount_code', 'discount_holder', 'pre_form_one', 'imported'
            ) then 'view'
            when export_column_tier.column_name in ('guardian_name', 'relationship', 'guardian_phone', 'guardian_whatsapp') then 'contact'
            when export_column_tier.column_name in (
                'interview_fee_status', 'interview_fee_amount', 'interview_result', 'interview_score', 'school_fee',
                'school_fee_paid', 'school_fee_discount', 'follow_up_notes', 'declined_reason', 'declined_explanation',
                'closure', 'history_count'
            ) then 'full'
        end;
    $fn$;

    revoke execute on function public.export_column_tier(text) from public, anon, authenticated, service_role;

    create or replace function public.export_leads(filters jsonb, columns text[])
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $fn$
    declare
        staff_id uuid;
        filter_set jsonb := coalesce(export_leads.filters, '{}'::jsonb);
        unknown text;
        tiers text[];
        query_text text;
        admission text;
        status_filter public.lead_status;
        closure_filter text;
        class_filter public.lead_class;
        year_filter integer;
        link_year integer;
        batch_filter uuid;
        found_ids uuid[];
        found_count integer;
        answer jsonb;
    begin
        if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.view') then
            raise exception 'not_permitted';
        end if;
        select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();

        -- The columns: known, each once, every tier held.
        if export_leads.columns is null or cardinality(export_leads.columns) = 0 then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns')::text;
        end if;
        select c into unknown from unnest(export_leads.columns) c where public.export_column_tier(c) is null limit 1;
        if found or exists (select 1 from unnest(export_leads.columns) c where c is null) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns', 'column', unknown)::text;
        end if;
        if (select count(distinct c) from unnest(export_leads.columns) c) <> cardinality(export_leads.columns) then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'columns')::text;
        end if;
        tiers := array(select distinct public.export_column_tier(c) from unnest(export_leads.columns) c);
        if ('contact' = any (tiers) and not public.has_permission('leads.export'))
           or ('full' = any (tiers) and not public.is_super_admin()) then
            raise exception 'not_permitted';
        end if;

        -- The filters.
        if jsonb_typeof(filter_set) is distinct from 'object' then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end if;
        begin
            query_text := nullif(btrim(coalesce(filter_set ->> 'query', '')), '');
            status_filter := (filter_set ->> 'status')::public.lead_status;
            closure_filter := coalesce(filter_set ->> 'closure', 'open');
            class_filter := (filter_set ->> 'class_name')::public.lead_class;
            year_filter := (filter_set ->> 'enrollment_year')::integer;
            link_year := (filter_set ->> 'earlier_link_year')::integer;
            batch_filter := (filter_set ->> 'import_batch_id')::uuid;
        exception when others then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end;
        if closure_filter not in ('open', 'all', 'Inactive', 'Archived') then
            raise exception 'invalid' using detail = jsonb_build_object('field', 'filters')::text;
        end if;
        admission := case when query_text ~* '^(ADMSN-)?[0-9]{5}$'
            then 'ADMSN-' || substring(query_text from '([0-9]{5})$') end;

        -- The leads, in the screen's order.
        select coalesce(array_agg(l.id order by
                   case when query_text is not null and admission is null then l.closure is not null end,
                   case when query_text is not null and admission is null then l.student_name_key end,
                   case when query_text is null then l.created_at end desc,
                   l.id desc), '{}')
        into found_ids
        from public.leads l
        where (admission is null or l.admission_number = admission)
          and (query_text is null or admission is not null
               or strpos(l.student_name_key, public.normalize_student_name(query_text)) > 0)
          and (query_text is not null or status_filter is null or l.status = status_filter)
          and (query_text is not null
               or closure_filter = 'all'
               or (closure_filter = 'open' and l.closure is null)
               or l.closure::text = closure_filter)
          and (query_text is not null or link_year is null
               or l.id in (select e.id from public.leads_with_earlier_group_link(link_year) e))
          and (class_filter is null or l.class_name = class_filter)
          and (year_filter is null or l.enrollment_year = year_filter)
          and (batch_filter is null or l.import_batch_id = batch_filter);

        found_count := cardinality(found_ids);
        if found_count > 5000 then
            raise exception 'too_many' using detail = jsonb_build_object('row_count', found_count)::text;
        end if;

        with picked as (
            select l.*, ordinal
            from unnest(found_ids) with ordinality as f (id, ordinal)
            join public.leads l on l.id = f.id
        ),
        values_by_lead as (
            select p.ordinal,
                jsonb_build_object(
                    'admission_number', p.admission_number,
                    'student_name', p.student_name,
                    'class_name', p.class_name::text,
                    'enrollment_year', p.enrollment_year,
                    'day_or_boarding', p.day_or_boarding::text,
                    'gender', p.gender::text,
                    'status', p.status::text,
                    'status_since', coalesce((
                        select max(a.created_at) from public.audit_log a
                        where a.table_name = 'leads' and a.row_id = p.id and a.new_values ? 'status'
                    ), p.created_at),
                    'visit_date', p.visit_date,
                    'discount_code', p.referral_code,
                    'discount_holder', (select d.holder_name from public.code_discount(p.referral_code) d),
                    'pre_form_one', coalesce((select f.pre_form_one from public.lead_fee_profiles f where f.lead_id = p.id), false),
                    'imported', p.import_batch_id is not null
                )
                || case when 'contact' = any (tiers) then (
                    select jsonb_build_object(
                        'guardian_name', g.full_name,
                        'relationship', case when g.relationship = 'Other' then g.relationship_description else g.relationship::text end,
                        'guardian_phone', g.phone,
                        'guardian_whatsapp', g.whatsapp
                    )
                    from public.guardian_contacts g where g.id = p.guardian_contact_id
                ) else '{}'::jsonb end
                || case when 'full' = any (tiers) then (
                    select jsonb_build_object(
                        'interview_fee_status', i.fee_status::text,
                        'interview_fee_amount', case
                            when i.id is null then null
                            when i.fee_status = 'Paid' then i.locked_amount
                            else public.interview_fee(false) - coalesce((select d.amount_off from public.lead_code_discount(p.referral_code, p.created_at, p.import_batch_id is not null) d), 0)
                        end,
                        'interview_result', i.result::text,
                        'interview_score', i.score,
                        'school_fee', fee.school_fee,
                        'school_fee_paid', (select c.total_paid from public.lead_fee_crossings(p.id) c),
                        'school_fee_discount', case when fee.discount is not null then fee.discount || ' ' || fee.discount_percent || '%' end,
                        'follow_up_notes', (
                            select string_agg(n.comment, ' | ' order by n.entered_at desc)
                            from (
                                select r.comment, r.entered_at from public.follow_up_records r
                                where r.lead_id = p.id and r.comment is not null
                                order by r.entered_at desc limit 5
                            ) n
                        ),
                        'declined_reason', p.declined_reason::text,
                        'declined_explanation', p.declined_explanation,
                        'closure', p.closure::text,
                        'history_count', (select count(*) from public.audit_log a where a.lead_id = p.id)
                    )
                    from (select 1) one
                    left join lateral (
                        select * from public.interviews iv where iv.lead = p.id
                        order by iv.registered_at desc, iv.serial_number desc limit 1
                    ) i on true
                    cross join lateral public.lead_fee_amounts(p.id) fee
                ) else '{}'::jsonb end as all_values
            from picked p
        )
        select coalesce(jsonb_agg((
                   select jsonb_object_agg(c, v.all_values -> c) from unnest(export_leads.columns) c
               ) order by v.ordinal), '[]'::jsonb)
        into answer
        from values_by_lead v;

        insert into public.export_log (exported_by, kind, columns, row_count, filters)
        values (staff_id, 'students', export_leads.columns, found_count, filter_set);

        return jsonb_build_object('rows', answer, 'row_count', found_count);
    end;
    $fn$;

    revoke execute on function public.export_leads(jsonb, text[]) from public, anon;
    grant execute on function public.export_leads(jsonb, text[]) to authenticated;
end;
$migration$;
