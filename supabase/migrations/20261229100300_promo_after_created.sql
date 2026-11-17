-- Promo codes count only on applications sent after the code was created
-- (#471, owner 2026-11-17).
--
-- - An application from the Admission form or the Register students form
--   gets a Promo code's discount only when it was sent after the code was
--   created: the lead's created_at later than the code's. One sent earlier,
--   which typed the code before it was announced, never gets it, now or on
--   any later read, whatever the code's state.
-- - An imported record (import_batch_id set) keeps the rule it had: the
--   code applies whenever it was imported. The import is a family's record,
--   not a new application.
-- - Agent codes are not touched.
-- - Both times never change: guard_promo_code_change keeps created_at, and
--   no API role writes leads. So the rule adds no lock to the fee writers.
--
-- lead_code_discount(code, sent_at, imported) is code_discount for one
-- lead: a Promo code the lead doesn't qualify for takes nothing off, and
-- says so in sent_before_code. lead_interview_discount, the fee
-- (expected_interview_amount) and the export's interview fee read it.
-- unpaid_promo_leads(promo) is the leads a Promo code change moves:
-- create_promo_code's back-fill now reaches imported records only, and the
-- impact preview and the edit and state counts leave out early leads.
-- list_promo_codes still counts every lead carrying the code.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- The rule.
-- ---------------------------------------------------------------------------

-- Whether a Promo code created at promo_created_at gives its discount to a
-- lead sent at sent_at, imported or not.
create function public.promo_counts_for_lead(promo_created_at timestamptz, sent_at timestamptz, imported boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select coalesce(promo_counts_for_lead.imported, false) or promo_counts_for_lead.sent_at > promo_counts_for_lead.promo_created_at;
$$;

revoke execute on function public.promo_counts_for_lead(timestamptz, timestamptz, boolean) from public, anon, authenticated, service_role;

-- code_discount for one lead: its code, when it was sent and whether it was
-- imported. A Promo code the lead doesn't qualify for keeps its holder and
-- state but takes nothing off, with sent_before_code true. Internal.
create function public.lead_code_discount(lead_code text, sent_at timestamptz, imported boolean)
returns table (
    kind text,
    code text,
    agent_id uuid,
    promo_code_id uuid,
    holder_name text,
    state text,
    amount_off integer,
    sent_before_code boolean
)
language sql
stable
security definer
set search_path = ''
as $$
    select d.kind, d.code, d.agent_id, d.promo_code_id, d.holder_name, d.state,
           case when early.before then 0 else d.amount_off end,
           early.before
    from public.code_discount(lead_code_discount.lead_code) d
    left join public.promo_codes p on p.id = d.promo_code_id
    cross join lateral (
        select p.id is not null
           and not public.promo_counts_for_lead(p.created_at, lead_code_discount.sent_at, lead_code_discount.imported) as before
    ) early;
$$;

revoke execute on function public.lead_code_discount(text, timestamptz, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lead_interview_discount, as 20261204130200_discount_amounts_and_promo_codes.sql
-- made it, through lead_code_discount and with sent_before_code. Dropped
-- first, since its columns change; the grants are as before.
-- ---------------------------------------------------------------------------

drop function public.lead_interview_discount(uuid);

create function public.lead_interview_discount(lead_id uuid)
returns table (
    kind text,
    code text,
    agent_id uuid,
    promo_code_id uuid,
    holder_name text,
    state text,
    amount_off integer,
    sent_before_code boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_code text;
    sent timestamptz;
    imported boolean;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;

    select l.referral_code, l.created_at, l.import_batch_id is not null into lead_code, sent, imported
    from public.leads l where l.id = lead_interview_discount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    return query
    select coalesce(d.kind, 'none'),
           lead_code,
           d.agent_id,
           d.promo_code_id,
           d.holder_name,
           case when lead_code is null then null else coalesce(d.state, 'unrecognised') end,
           coalesce(d.amount_off, 0),
           coalesce(d.sent_before_code, false)
    from (select 1) one
    left join lateral public.lead_code_discount(lead_code, sent, imported) d on true;
end;
$$;

revoke execute on function public.lead_interview_discount(uuid) from public, anon;
grant execute on function public.lead_interview_discount(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- expected_interview_amount, as 20261204130200_discount_amounts_and_promo_codes.sql
-- made it, through lead_code_discount. Same signature and grants.
-- ---------------------------------------------------------------------------

create or replace function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    lead_code text;
    sent timestamptz;
    imported boolean;
    off integer;
begin
    if not public.has_permission('leads.view') and auth.role() is distinct from 'service_role' then
        raise exception 'forbidden';
    end if;

    select l.referral_code, l.created_at, l.import_batch_id is not null into lead_code, sent, imported
    from public.leads l where l.id = expected_interview_amount.lead_id;
    if not found then
        raise exception 'not_found';
    end if;

    select coalesce(max(d.amount_off), 0) into off from public.lead_code_discount(lead_code, sent, imported) d;
    discount_applied := off > 0;
    amount := public.interview_fee(false) - off;
end;
$$;

-- ---------------------------------------------------------------------------
-- The leads a Promo code change moves: those carrying the code, their fee
-- not yet Paid, that the code gives its discount to.
-- ---------------------------------------------------------------------------

create function public.unpaid_promo_leads(promo public.promo_codes)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(l.id order by l.id), '{}')
    from public.leads l
    where l.id = any (public.unpaid_leads_for_codes(array[promo.code]))
      and public.promo_counts_for_lead(promo.created_at, l.created_at, l.import_batch_id is not null);
$$;

revoke execute on function public.unpaid_promo_leads(public.promo_codes) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_promo_code, as 20261229100100_promo_any_format_agent_code_shape.sql
-- made it, with the back-fill through unpaid_promo_leads: only imported
-- records carrying the code take its discount.
-- ---------------------------------------------------------------------------

create or replace function public.create_promo_code(name text, code text, amount integer, ends_on date, note text)
returns public.promo_codes
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    clean_name text := public.promo_code_name(create_promo_code.name);
    clean_note text := public.promo_code_note(create_promo_code.note);
    clean_code text := public.normalize_referral_code(coalesce(create_promo_code.code, ''));
    made public.promo_codes;
    moved uuid[];
begin
    if clean_code is null
       or char_length(clean_code) > 15
       or clean_code ~ '^[A-Z]{3}-{2,}' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'code')::text;
    end if;
    perform public.check_discount_amount(create_promo_code.amount);
    if create_promo_code.ends_on is not null and create_promo_code.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;

    -- refuse_promo_code_taken checks agent records under the key's lock;
    -- the unique indexes catch another Promo code with the code or its key.
    begin
        insert into public.promo_codes (code, name, note, amount, ends_on, created_by)
        values (clean_code, clean_name, clean_note, create_promo_code.amount, create_promo_code.ends_on, staff_id)
        returning * into made;
    exception when unique_violation then
        raise exception 'code_taken' using detail = clean_code;
    end;

    -- Imported records that already carry the code take its discount on
    -- every fee not yet Paid. An application that typed it before now never
    -- does (#471).
    moved := case when public.promo_amount_off(made.amount, made.state, made.ends_on) > 0
        then public.unpaid_promo_leads(made) else '{}'::uuid[] end;

    insert into public.discount_amount_changes (kind, promo_code_id, new_value, changed_by, student_count, lead_ids)
    values ('promo_created', made.id, made.amount::text, staff_id, cardinality(moved), moved);

    return made;
end;
$$;

-- ---------------------------------------------------------------------------
-- promo_code_fee_impact, update_promo_code and set_promo_code_state, as
-- 20261204130300_discount_code_writes.sql made them, counting and listing
-- through unpaid_promo_leads. Same signatures and grants.
-- ---------------------------------------------------------------------------

create or replace function public.promo_code_fee_impact(id uuid, amount integer, state text, ends_on date, ends_on_given boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    promo public.promo_codes;
    off_now integer;
    off_after integer;
begin
    perform public.require_discount_codes_manager();
    if promo_code_fee_impact.amount is not null then
        perform public.check_discount_amount(promo_code_fee_impact.amount);
    end if;
    if promo_code_fee_impact.state is not null and promo_code_fee_impact.state not in ('active', 'paused', 'ended') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'state')::text;
    end if;
    select * into promo from public.promo_codes p where p.id = promo_code_fee_impact.id;
    if not found then
        raise exception 'not_found';
    end if;
    -- A new last day already past is refused as update_promo_code refuses
    -- it, so the preview never lists a change the save won't make.
    if promo_code_fee_impact.ends_on_given
       and promo_code_fee_impact.ends_on is distinct from promo.ends_on
       and promo_code_fee_impact.ends_on is not null
       and promo_code_fee_impact.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;

    off_now := public.promo_amount_off(promo.amount, promo.state, promo.ends_on);
    off_after := public.promo_amount_off(
        coalesce(promo_code_fee_impact.amount, promo.amount),
        coalesce(promo_code_fee_impact.state, promo.state),
        case when promo_code_fee_impact.ends_on_given then promo_code_fee_impact.ends_on else promo.ends_on end
    );
    return public.fee_impact_families(
        public.unpaid_promo_leads(promo),
        public.interview_fee(false) - off_now,
        public.interview_fee(false) - off_after
    );
end;
$$;

create or replace function public.update_promo_code(id uuid, name text, amount integer, ends_on date, note text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    clean_name text := public.promo_code_name(update_promo_code.name);
    clean_note text := public.promo_code_note(update_promo_code.note);
    why text;
    promo public.promo_codes;
    moved uuid[] := '{}';
    fee_count integer;
begin
    perform public.check_discount_amount(update_promo_code.amount);

    select * into promo from public.promo_codes p where p.id = update_promo_code.id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if promo.state = 'ended' then
        raise exception 'ended';
    end if;
    if update_promo_code.ends_on is distinct from promo.ends_on
       and update_promo_code.ends_on is not null
       and update_promo_code.ends_on < public.tanzania_today() then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'ends_on')::text;
    end if;
    if (clean_name, clean_note, update_promo_code.amount, update_promo_code.ends_on)
       is not distinct from (promo.name, promo.note, promo.amount, promo.ends_on) then
        raise exception 'no_change';
    end if;
    if update_promo_code.amount is distinct from promo.amount or update_promo_code.ends_on is distinct from promo.ends_on then
        why := public.discount_change_reason(update_promo_code.reason);
    end if;

    if public.promo_amount_off(promo.amount, promo.state, promo.ends_on)
       is distinct from public.promo_amount_off(update_promo_code.amount, promo.state, update_promo_code.ends_on) then
        moved := public.unpaid_promo_leads(promo);
    end if;
    fee_count := cardinality(moved);

    update public.promo_codes p
    set name = clean_name, note = clean_note, amount = update_promo_code.amount,
        ends_on = update_promo_code.ends_on, updated_at = now()
    where p.id = promo.id;

    -- One history row per amount change, the fee count on the first.
    if update_promo_code.amount is distinct from promo.amount then
        insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
        values ('promo_amount', promo.id, promo.amount::text, update_promo_code.amount::text, why, staff_id, cardinality(moved), moved);
        moved := '{}';
    end if;
    if update_promo_code.ends_on is distinct from promo.ends_on then
        insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
        values ('promo_ends', promo.id, promo.ends_on::text, update_promo_code.ends_on::text, why, staff_id, cardinality(moved), moved);
    end if;

    return jsonb_build_object('fee_change_count', fee_count);
end;
$$;

create or replace function public.set_promo_code_state(id uuid, state text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid := public.require_discount_codes_manager();
    why text;
    promo public.promo_codes;
    moved uuid[] := '{}';
begin
    if set_promo_code_state.state is null or set_promo_code_state.state not in ('active', 'paused', 'ended') then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'state')::text;
    end if;
    why := public.discount_change_reason(set_promo_code_state.reason);

    select * into promo from public.promo_codes p where p.id = set_promo_code_state.id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if promo.state = 'ended' then
        raise exception 'ended';
    end if;
    if promo.state = set_promo_code_state.state then
        raise exception 'no_change';
    end if;

    if public.promo_amount_off(promo.amount, promo.state, promo.ends_on)
       is distinct from public.promo_amount_off(promo.amount, set_promo_code_state.state, promo.ends_on) then
        moved := public.unpaid_promo_leads(promo);
    end if;

    update public.promo_codes p
    set state = set_promo_code_state.state, updated_at = now()
    where p.id = promo.id;

    insert into public.discount_amount_changes (kind, promo_code_id, old_value, new_value, reason, changed_by, student_count, lead_ids)
    values ('promo_state', promo.id, promo.state, set_promo_code_state.state, why, staff_id, cardinality(moved), moved);

    return jsonb_build_object('fee_change_count', cardinality(moved));
end;
$$;

-- ---------------------------------------------------------------------------
-- export_leads, as 20261204130600_student_export.sql made it, with the
-- unpaid interview fee through lead_code_discount. Same signature and
-- grants.
-- ---------------------------------------------------------------------------

create or replace function public.export_leads(filters jsonb, columns text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.export_leads(jsonb, text[]) from public, anon;
grant execute on function public.export_leads(jsonb, text[]) to authenticated;

select set_config('audit.actor_kind', '', true);
