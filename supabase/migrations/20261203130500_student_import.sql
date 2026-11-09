-- Staff import students from a CSV of the admissions workbook (owner
-- decisions of 2026-11-09).
--
-- - The app reads and normalises the file (lib/import, lib/student-import)
--   and sends the rows that passed the file's own checks.
--   student_import_rows re-checks every value is as the leads and contacts
--   store it, and that no two rows share a sheet row or a student (the same
--   name key with the same parent phone).
-- - student_import_verdicts is the one classification, used by the check and
--   by confirm:
--     present       the same name key and a parent phone an existing lead
--                   has, as create_lead's duplicate rule: skipped.
--     joins_family  a parent phone a known Family's contact has: created with
--                   a contact of its own carrying a pending Family match to
--                   that Family, as the Admission form does. Staff settle it
--                   on the lead screen.
--     create        anything else.
--     refused       a value the file's checks missed, with the field.
--   A code nobody holds is not a refusal: the lead keeps it, as the form
--   does, and the verdict says `unknown_code`. Rows in one file that share a
--   parent phone share one new contact, the first row's: siblings in one
--   Family, as one Admission form submission makes them. `family_row` names
--   that first row.
-- - check_student_import gives the review screen its verdicts. Saves
--   nothing.
-- - confirm_student_import is the one all-or-nothing write. Under the import
--   lock and every row's phone locks (create_lead's `lead-phone:` keys, in
--   sorted order) it re-runs the verdicts; if any differs from what staff
--   saw, it writes nothing and returns those rows. Otherwise it records the
--   batch and creates each lead with its batch, code and Visit date:
--     Applied, Visited  as they are.
--     Interviewed       with one interview, fee Not Paid, no result.
--     Enrolled          the same, then Enrolled through the `import`
--                       lifecycle override, marked enrolled_by_import.
--     Declined          reason Other, "Imported from the workbook".
--   Interview payment, result, score, comments and follow-ups are not
--   imported (owner decision 4). A status that needs a Visit date with none
--   in the file takes the import date: the records start from the import.
-- - recompute_lead_fee keeps an import's Enrolled while enrolled_by_import
--   holds: no payment yet is not a reason to take it away. The first
--   payment that qualifies clears the mark, and from then on Enrolled
--   follows the payments as for everyone. The mark also clears whenever the
--   status leaves Enrolled.
-- - leads.import_batch_id and interviews.import_batch_id are set on insert
--   and never change. So is leads.imported_as_enrolled: the workbook said
--   the student is Enrolled. Results are not imported, so the payment check
--   lets the Accountant record school-fee payments for such a lead without a
--   Passed interview, as it does after a reopening that enrols without a
--   retake.
--
-- Refusal codes: `not_permitted`, `invalid` with the field (and sheet row)
-- as JSON in the detail, `nothing_to_import`, `lead_import_locked`,
-- `enrolled_by_import_locked`, `interview_import_locked`.

select public.set_audit_actor('system');

-- ---------------------------------------------------------------------------
-- The batch kind, and who reads student batches: staff who may view leads,
-- since the lead history names the file a lead came from.
-- ---------------------------------------------------------------------------

alter table public.import_batches drop constraint import_batches_kind_check;
alter table public.import_batches add constraint import_batches_kind_check check (kind in ('agents', 'students'));

create policy "Staff who may view leads read student imports"
    on public.import_batches for select
    to authenticated
    using (kind = 'students' and (select public.has_permission('leads.view')));

create or replace function public.import_batch_importers(batch_ids uuid[])
returns table (batch_id uuid, importer_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.has_permission('leads.view') then
        raise exception 'not_permitted';
    end if;

    return query
    select b.id, s.full_name
    from public.import_batches b
    join public.staff_members s on s.id = b.imported_by
    where b.id = any (import_batch_importers.batch_ids)
      and b.kind in ('agents', 'students');
end;
$$;

revoke execute on function public.import_batch_importers(uuid[]) from public, anon;
grant execute on function public.import_batch_importers(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------------

alter table public.leads
    add column import_batch_id uuid references public.import_batches (id),
    add column enrolled_by_import boolean not null default false,
    add column imported_as_enrolled boolean not null default false,
    add constraint leads_imported_as_enrolled_needs_batch
        check (not imported_as_enrolled or import_batch_id is not null);

comment on column public.leads.imported_as_enrolled is
    'True when the workbook import created the lead as Enrolled. Set on insert, never changed. Lets school-fee payments be recorded without a Passed interview, since results are not imported.';

comment on column public.leads.enrolled_by_import is
    'True while the lead is Enrolled because the workbook import said so, with no qualifying payment recorded yet. The first qualifying payment clears it; so does leaving Enrolled.';

create index leads_import_batch_idx on public.leads (import_batch_id) where import_batch_id is not null;

alter table public.interviews
    add column import_batch_id uuid references public.import_batches (id);

create index interviews_import_batch_idx on public.interviews (import_batch_id) where import_batch_id is not null;

-- The batch never changes, and only the import sets the Enrolled mark. The
-- writer's override counts only for a privileged role, as for the other
-- lifecycle overrides.
create function public.guard_lead_import()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    importing boolean := current_user not in ('authenticated', 'anon')
        and coalesce(current_setting('app.lead_lifecycle_override', true), '') = 'import';
begin
    if tg_op = 'INSERT' then
        if new.enrolled_by_import then
            raise exception 'enrolled_by_import_locked';
        end if;
        return new;
    end if;

    if new.import_batch_id is distinct from old.import_batch_id
       or new.imported_as_enrolled is distinct from old.imported_as_enrolled then
        raise exception 'lead_import_locked';
    end if;
    if new.enrolled_by_import and not old.enrolled_by_import and not (importing and new.status = 'Enrolled') then
        raise exception 'enrolled_by_import_locked';
    end if;
    -- The mark describes an Enrolled status only.
    if new.status is distinct from 'Enrolled' then
        new.enrolled_by_import := false;
    end if;
    return new;
end;
$$;

revoke execute on function public.guard_lead_import() from public, anon, authenticated;

create trigger guard_lead_import
    before insert or update on public.leads
    for each row
    execute function public.guard_lead_import();

create function public.guard_interview_import()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.import_batch_id is distinct from old.import_batch_id then
        raise exception 'interview_import_locked';
    end if;
    return new;
end;
$$;

revoke execute on function public.guard_interview_import() from public, anon, authenticated;

create trigger guard_interview_import
    before update on public.interviews
    for each row
    execute function public.guard_interview_import();

-- ---------------------------------------------------------------------------
-- The `import` lifecycle override, and the Enrolled guard that lets it set
-- Enrolled.
-- ---------------------------------------------------------------------------

create or replace function public.set_lead_lifecycle_override(path text)
returns void
language plpgsql
set search_path = ''
as $$
begin
    if path is null or path not in ('close', 'reopen', 'payment_recompute', 're_application', 'import') then
        raise exception 'invalid';
    end if;
    -- Transaction-local: it ends with the transaction that set it.
    perform set_config('app.lead_lifecycle_override', path, true);
end;
$$;

revoke execute on function public.set_lead_lifecycle_override(text) from public, anon, authenticated, service_role;

create or replace function public.refuse_enrolled_by_hand()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.status = 'Enrolled'
       and (tg_op = 'INSERT' or old.status is distinct from 'Enrolled')
       and auth.role() is not null
       and not (
           current_user not in ('authenticated', 'anon')
           and coalesce(current_setting('app.lead_lifecycle_override', true), '') in ('payment_recompute', 'import')
       ) then
        raise exception 'enrolled_from_payments';
    end if;
    return new;
end;
$$;

revoke execute on function public.refuse_enrolled_by_hand() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- recompute_lead_fee, as 20261106901100_sibling_discount.sql made it, with
-- the import's Enrolled: while enrolled_by_import holds, a lead that does
-- not qualify stays Enrolled; the first time it qualifies, the mark clears
-- and its Enrolled is the payments' from then on.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_lead_fee(lead_id uuid, cause text, as_of date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target public.leads;
    profile public.lead_fee_profiles;
    lines record;
    start_on date;
    -- The Academic-year sweep sets its date for the transaction, so a sibling
    -- its cascade recomputes is judged on the same day.
    on_date date := coalesce(as_of, nullif(current_setting('app.recompute_as_of', true), '')::date, public.tanzania_today());
    from_start date;
    qualifies boolean := false;
    trigger_kind text;
    trigger_payment uuid;
    trigger_on date;
    before_enrolled public.lead_status;
    next_status public.lead_status;
    earlier_override text;
    locked_contact uuid;
    keeps_sibling boolean := false;
    clears_import boolean := false;
begin
    if cause is null or cause not in (
        'payment', 'payment_adjustment', 'discount', 'fee_schedule',
        'lead_details', 'family', 'academic_year_start', 'reopening',
        'sibling', 'prior_sibling'
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'cause')::text;
    end if;

    -- The Family lock first, then the row: two recomputes in one Family take
    -- turns, and the second sees what the first enrolled.
    locked_contact := public.lock_lead_family(recompute_lead_fee.lead_id);

    -- Locked, so two recomputes of one lead take turns and the second sees
    -- what the first wrote.
    select * into target from public.leads l where l.id = recompute_lead_fee.lead_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    -- Moved to another contact before the row lock was taken.
    if target.guardian_contact_id is distinct from locked_contact then
        perform public.lock_families(array[target.guardian_contact_id]);
    end if;
    -- A Declined lead keeps its payments and its status.
    if target.status = 'Declined' then
        return;
    end if;

    select * into profile from public.lead_fee_profiles p where p.lead_id = target.id;
    select * into lines from public.lead_fee_crossings(target.id);

    if lines.has_schedule and lines.payments > 0 then
        select s.academic_year_start into start_on
        from public.fee_schedules s
        where s.enrollment_year = target.enrollment_year;

        if lines.first_on is not null and start_on is not null and greatest(lines.first_on, start_on) <= on_date then
            from_start := greatest(lines.first_on, start_on);
        end if;

        if lines.full_on is not null and (from_start is null or lines.full_on <= from_start) then
            qualifies := true;
            trigger_kind := 'payment';
            trigger_payment := lines.full_payment_id;
            trigger_on := lines.full_on;
        elsif from_start is not null then
            qualifies := true;
            if start_on > lines.first_on then
                trigger_kind := 'academic_year_start';
                trigger_on := start_on;
            else
                trigger_kind := 'payment';
                trigger_payment := lines.first_payment_id;
                trigger_on := lines.first_on;
            end if;
        end if;
    end if;

    if qualifies then
        next_status := 'Enrolled';
        before_enrolled := case when target.status = 'Enrolled' then profile.status_before_enrolled else target.status end;
        clears_import := target.enrolled_by_import;
    elsif target.enrolled_by_import and target.status = 'Enrolled' then
        -- The import's Enrolled stands until a payment qualifies.
        next_status := target.status;
    elsif target.status = 'Enrolled' and profile.enrolled_trigger is not null then
        -- Interviewed when the earlier status was never kept: the status a
        -- lead holds once it may pay.
        next_status := coalesce(profile.status_before_enrolled, 'Interviewed');
    else
        next_status := target.status;
    end if;

    -- Becoming Enrolled while the Sibling discount applies makes it the
    -- lead's for good, whatever its siblings do later.
    if next_status = 'Enrolled'
       and target.status <> 'Enrolled'
       and not coalesce(profile.sibling_kept, false)
       and public.sibling_discount_applies(target.id) then
        keeps_sibling := true;
    end if;

    -- Also written, for its cause alone, when the status is about to move
    -- and the profile's cause is another one: a lead declined while Enrolled
    -- keeps its profile, and when a reopening enrols it again the history
    -- must say the reopening did it, not the payment that first did.
    if (profile.id is null and (before_enrolled is not null or trigger_kind is not null))
       or (profile.id is not null and (
           profile.status_before_enrolled,
           profile.enrolled_trigger,
           profile.enrolled_trigger_payment_id,
           profile.enrolled_on
       ) is distinct from (before_enrolled, trigger_kind, trigger_payment, trigger_on))
       or (profile.id is not null
           and next_status <> target.status
           and profile.recompute_cause is distinct from recompute_lead_fee.cause)
       or keeps_sibling then
        insert into public.lead_fee_profiles as p (
            lead_id, status_before_enrolled, enrolled_trigger, enrolled_trigger_payment_id, enrolled_on, recompute_cause,
            sibling_kept
        ) values (
            target.id, before_enrolled, trigger_kind, trigger_payment, trigger_on, recompute_lead_fee.cause, keeps_sibling
        )
        on conflict on constraint lead_fee_profiles_lead_id_key do update
        set status_before_enrolled = excluded.status_before_enrolled,
            enrolled_trigger = excluded.enrolled_trigger,
            enrolled_trigger_payment_id = excluded.enrolled_trigger_payment_id,
            enrolled_on = excluded.enrolled_on,
            recompute_cause = excluded.recompute_cause,
            sibling_kept = p.sibling_kept or excluded.sibling_kept;
    end if;

    if next_status <> target.status or clears_import then
        -- Slice 8's override lets this one update through on an Inactive or
        -- Archived lead; the caller's own override comes back after it.
        earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
        perform public.set_lead_lifecycle_override('payment_recompute');
        update public.leads l
        set status = next_status,
            enrolled_by_import = l.enrolled_by_import and not clears_import
        where l.id = target.id;
        perform set_config('app.lead_lifecycle_override', earlier_override, true);
    end if;
end;
$$;

revoke execute on function public.recompute_lead_fee(uuid, text, date) from public, anon, authenticated, service_role;

-- A yyyy-mm-dd text that is a real date, no later than today in Tanzania.
create function public.is_import_date(value text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
    return is_import_date.value::date <= public.tanzania_today();
exception when others then
    return false;
end;
$$;

revoke execute on function public.is_import_date(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_school_fee_payment, as 20261107901200_pre_form_one.sql made it, now
-- also passing a lead the import created as Enrolled whose current interview
-- has no Passed result. Every other rule is unchanged, and the preview and
-- the recording both still call it.
-- ---------------------------------------------------------------------------

create or replace function public.check_school_fee_payment(
    lead_id uuid,
    payment_type text,
    amount numeric,
    paid_on date
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
    current_result public.interview_result;
    lead_year integer;
    from_workbook boolean;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('payments.record') then
        raise exception 'not_permitted';
    end if;

    select l.enrollment_year, l.imported_as_enrolled into lead_year, from_workbook
    from public.leads l where l.id = check_school_fee_payment.lead_id;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(check_school_fee_payment.lead_id);

    select i.result into current_result
    from public.interviews i
    where i.lead = check_school_fee_payment.lead_id
    order by i.registered_at desc, i.serial_number desc
    limit 1;
    if current_result is distinct from 'Passed'
       and not public.reopened_to_enrol(check_school_fee_payment.lead_id)
       and not from_workbook then
        raise exception 'not_passed';
    end if;

    if not exists (select 1 from public.fee_schedules s where s.enrollment_year = lead_year) then
        raise exception 'no_schedule';
    end if;

    if payment_type is null or payment_type not in (
        'full_payment', 'initial_deposit', 'first_instalment', 'second_instalment', 'third_instalment', 'fee_waived',
        'pre_form_one_fee'
    ) then
        raise exception 'invalid_type';
    end if;

    if payment_type = 'pre_form_one_fee'
       and not (select p.applies from public.lead_pre_form_one(check_school_fee_payment.lead_id) p) then
        raise exception 'not_pre_form_one';
    end if;

    if payment_type = 'fee_waived' then
        if not exists (
            select 1 from public.discount_requests r
            where r.lead_id = check_school_fee_payment.lead_id and r.kind = 'qualified_orphan' and r.state = 'granted'
        ) then
            raise exception 'not_waivable';
        end if;
        if amount is not null then
            raise exception 'amount_not_allowed';
        end if;
        if exists (
            select 1 from public.effective_school_fee_payments(check_school_fee_payment.lead_id) e
            where e.payment_type = 'fee_waived'
        ) then
            raise exception 'already_waived';
        end if;
    else
        if amount is null or amount <= 0 then
            raise exception 'amount_not_positive';
        end if;
        if amount <> trunc(amount) then
            raise exception 'amount_not_whole';
        end if;
        if amount > 2147483647 then
            raise exception 'amount_too_large';
        end if;
    end if;

    if paid_on is null then
        raise exception 'date_missing';
    end if;
    if paid_on > public.tanzania_today() then
        raise exception 'date_in_future';
    end if;
end;
$$;

revoke execute on function public.check_school_fee_payment(uuid, text, numeric, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- student_import_rows: the rows the app sends, read and re-checked. Each row
-- is an object with sheet_row, student_name, class_name, pre_form_one,
-- enrollment_year, day_or_boarding, guardian_name, relationship,
-- relationship_description, phone, whatsapp, visit_date, referral_code and
-- status, every value already as the database stores it. A row whose value
-- isn't is returned with `refused` and the field; a sheet row or a student
-- two rows share is `invalid` for the whole call, since the file's own
-- checks refuse those first. Internal.
-- ---------------------------------------------------------------------------

create function public.student_import_rows(rows jsonb)
returns table (
    sheet_row integer,
    student_name text,
    name_key text,
    class_name text,
    pre_form_one boolean,
    enrollment_year integer,
    day_or_boarding text,
    guardian_name text,
    relationship text,
    relationship_description text,
    phone text,
    whatsapp text,
    visit_date date,
    referral_code text,
    status text,
    refused_field text
)
language plpgsql
stable
set search_path = ''
as $$
declare
    this_year integer := extract(year from public.tanzania_today());
begin
    if jsonb_typeof(student_import_rows.rows) is distinct from 'array'
       or jsonb_array_length(student_import_rows.rows) > 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'rows')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(student_import_rows.rows) r
        where jsonb_typeof(r) is distinct from 'object'
           or jsonb_typeof(r -> 'sheet_row') is distinct from 'number'
           or (r ->> 'sheet_row') !~ '^[0-9]{1,7}$'
           or (r ->> 'sheet_row')::integer < 2
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;
    if exists (select 1 from jsonb_array_elements(student_import_rows.rows) r group by r ->> 'sheet_row' having count(*) > 1) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'sheet_row')::text;
    end if;
    if exists (
        select 1 from jsonb_array_elements(student_import_rows.rows) r
        group by public.normalize_student_name(coalesce(r ->> 'student_name', '')), r ->> 'phone'
        having count(*) > 1
    ) then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'duplicate_student')::text;
    end if;

    return query
    with raw as (
        select (r ->> 'sheet_row')::integer as sheet_row, r
        from jsonb_array_elements(student_import_rows.rows) r
    ),
    read as (
        select raw.sheet_row,
               raw.r ->> 'student_name' as student_name,
               raw.r ->> 'class_name' as class_name,
               raw.r -> 'pre_form_one' as pre_form_one,
               raw.r ->> 'enrollment_year' as enrollment_year,
               raw.r ->> 'day_or_boarding' as day_or_boarding,
               raw.r ->> 'guardian_name' as guardian_name,
               raw.r ->> 'relationship' as relationship,
               raw.r ->> 'relationship_description' as relationship_description,
               raw.r ->> 'phone' as phone,
               raw.r ->> 'whatsapp' as whatsapp,
               raw.r ->> 'visit_date' as visit_date,
               raw.r ->> 'referral_code' as referral_code,
               raw.r ->> 'status' as status
        from raw
    ),
    checked as (
        select x.*,
            case
                when x.student_name is null or btrim(x.student_name) = ''
                     or x.student_name <> regexp_replace(btrim(x.student_name), '\s+', ' ', 'g')
                     or char_length(x.student_name) > 100 then 'student_name'
                when x.class_name is null or x.class_name not in (
                    select e.enumlabel::text from pg_catalog.pg_enum e
                    where e.enumtypid = 'public.lead_class'::regtype
                ) then 'class_name'
                when jsonb_typeof(x.pre_form_one) is distinct from 'boolean'
                     or (x.pre_form_one = 'true'::jsonb and x.class_name <> 'FORM 1') then 'pre_form_one'
                when x.enrollment_year is null or x.enrollment_year !~ '^[0-9]{4}$'
                     or x.enrollment_year::integer not between this_year - 1 and this_year + 2 then 'enrollment_year'
                when x.day_or_boarding is null or x.day_or_boarding not in ('Day', 'Boarding') then 'day_or_boarding'
                when x.guardian_name is null or btrim(x.guardian_name) = ''
                     or x.guardian_name <> regexp_replace(btrim(x.guardian_name), '\s+', ' ', 'g')
                     or char_length(x.guardian_name) > 100 then 'guardian_name'
                when x.relationship is null or x.relationship not in ('Mother', 'Father', 'Guardian', 'Other') then 'relationship'
                when (x.relationship = 'Other') <> (x.relationship_description is not null)
                     or (x.relationship_description is not null
                         and (btrim(x.relationship_description) = '' or char_length(x.relationship_description) > 100)) then 'relationship_description'
                when x.phone is null or x.phone is distinct from public.normalize_phone(x.phone) then 'phone'
                when x.whatsapp is not null and (x.whatsapp is distinct from public.normalize_phone(x.whatsapp) or x.whatsapp = x.phone) then 'whatsapp'
                when x.visit_date is not null and (
                    x.visit_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    or not public.is_import_date(x.visit_date)
                ) then 'visit_date'
                when x.referral_code is not null and x.referral_code is distinct from public.normalize_referral_code(x.referral_code) then 'referral_code'
                when x.status is null or x.status not in ('Applied', 'Visited', 'Interviewed', 'Enrolled', 'Declined') then 'status'
            end as refused_field
        from read x
    )
    select c.sheet_row,
           c.student_name,
           public.normalize_student_name(coalesce(c.student_name, '')),
           c.class_name,
           coalesce(c.pre_form_one = 'true'::jsonb, false),
           case when c.refused_field is null then c.enrollment_year::integer end,
           c.day_or_boarding,
           c.guardian_name,
           c.relationship,
           c.relationship_description,
           c.phone,
           c.whatsapp,
           case when c.refused_field is null then c.visit_date::date end,
           c.referral_code,
           c.status,
           c.refused_field
    from checked c
    order by c.sheet_row;
end;
$$;

revoke execute on function public.student_import_rows(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- student_import_verdicts: each row's verdict against the leads and contacts
-- stored now, set-based. Rows sharing a parent phone are one group: the
-- first row's verdict decides the group's contact. Internal.
-- ---------------------------------------------------------------------------

create function public.student_import_verdicts(rows jsonb)
returns table (sheet_row integer, verdict jsonb)
language sql
stable
security definer
set search_path = ''
as $$
    with r as (
        select * from public.student_import_rows(student_import_verdicts.rows)
    ),
    present as (
        select r.sheet_row, l.id, l.admission_number, l.status
        from r
        cross join lateral (
            select l.id, l.admission_number, l.status::text as status
            from public.leads l
            join public.guardian_contacts g on g.id = l.guardian_contact_id
            where r.refused_field is null
              and l.student_name_key = r.name_key
              and (g.phone in (r.phone, r.whatsapp) or g.whatsapp in (r.phone, r.whatsapp))
            order by l.created_at, l.id
            limit 1
        ) l
    ),
    -- The rows that create a lead, and the first such row for each phone.
    creating as (
        select r.*, min(r.sheet_row) over (partition by r.phone) as family_row
        from r
        where r.refused_field is null
          and not exists (select 1 from present p where p.sheet_row = r.sheet_row)
    ),
    -- A known Family for the group's first row, as create_lead picks one: a
    -- contact with children, a settled one before one still waiting on staff,
    -- then the oldest; a contact still waiting points at its Family.
    family as (
        select c.sheet_row, coalesce(m.pending_family_match_id, m.id) as contact_id
        from creating c
        cross join lateral (
            select g.id, g.pending_family_match_id
            from public.guardian_contacts g
            where (g.phone in (c.phone, c.whatsapp) or g.whatsapp in (c.phone, c.whatsapp))
              and exists (select 1 from public.leads l where l.guardian_contact_id = g.id)
            order by g.pending_family_match_id is not null, g.created_at, g.id
            limit 1
        ) m
        where c.sheet_row = c.family_row
    )
    select r.sheet_row,
        case
            when r.refused_field is not null
                then jsonb_build_object('verdict', 'refused', 'field', r.refused_field)
            when p.sheet_row is not null
                then jsonb_build_object('verdict', 'present', 'lead',
                    jsonb_build_object('id', p.id, 'admission_number', p.admission_number, 'status', p.status))
            else jsonb_build_object(
                'verdict', case when f.contact_id is not null then 'joins_family' else 'create' end,
                'family_row', case when c.family_row <> c.sheet_row then c.family_row end,
                'family', case when f.contact_id is not null then (
                    select jsonb_build_object('contact_id', g.id, 'full_name', g.full_name)
                    from public.guardian_contacts g where g.id = f.contact_id
                ) end,
                'unknown_code', r.referral_code is not null
                    and not exists (select 1 from public.code_discount(r.referral_code))
            )
        end
    from r
    left join present p on p.sheet_row = r.sheet_row
    left join creating c on c.sheet_row = r.sheet_row
    left join family f on f.sheet_row = c.family_row
    order by r.sheet_row;
$$;

revoke execute on function public.student_import_verdicts(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_student_import: the review screen's verdicts, as a JSON array of
-- {sheet_row, verdict}. Needs leads.import. Saves nothing.
-- ---------------------------------------------------------------------------

create function public.check_student_import(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.import') then
        raise exception 'not_permitted';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object('sheet_row', v.sheet_row, 'verdict', v.verdict) order by v.sheet_row), '[]'::jsonb)
        from public.student_import_verdicts(check_student_import.rows) v
    );
end;
$$;

revoke execute on function public.check_student_import(jsonb) from public, anon;
grant execute on function public.check_student_import(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_student_import: the one write. Needs leads.import.
--
-- - rows: the rows the check sent, each with `expected`, the verdict staff
--   saw. row_count: every row in the file, those the file's own checks
--   stopped included.
-- - Returns {outcome: 'changed', rows: [{sheet_row, verdict}]} with each row
--   whose verdict is no longer the one expected, having written nothing; or
--   {outcome: 'imported', batch_id, created, joined_family, skipped}.
-- ---------------------------------------------------------------------------

create function public.confirm_student_import(file_name text, row_count integer, rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    staff_id uuid;
    batch_file text := btrim(coalesce(confirm_student_import.file_name, ''));
    today date := public.tanzania_today();
    one_phone text;
    checked jsonb;
    changed jsonb;
    creates integer;
    joins integer;
    batch uuid;
    item record;
    contacts jsonb := '{}';
    contact_id uuid;
    new_lead_id uuid;
    new_number text;
    attempt integer;
    lead_status public.lead_status;
    lead_visit date;
    issued integer;
    earlier_override text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.import') then
        raise exception 'not_permitted';
    end if;
    select s.id into staff_id from public.staff_members s where s.user_id = auth.uid();
    if batch_file = '' or char_length(batch_file) > 255 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'file_name')::text;
    end if;
    if jsonb_typeof(confirm_student_import.rows) is distinct from 'array'
       or confirm_student_import.row_count is null
       or confirm_student_import.row_count not between greatest(jsonb_array_length(confirm_student_import.rows), 1) and 1000 then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'row_count')::text;
    end if;

    -- One import at a time, then every parent phone in sorted order, the
    -- keys create_lead takes: a lead created at the front desk or by the
    -- form with one of these numbers finishes first, and the verdicts below
    -- see it.
    perform pg_advisory_xact_lock(hashtextextended('student-import', 0));
    for one_phone in
        select distinct p
        from public.student_import_rows(confirm_student_import.rows) r,
             unnest(array[r.phone, r.whatsapp]) p
        where p is not null and r.refused_field is null
        order by p
    loop
        perform pg_advisory_xact_lock(hashtextextended('lead-phone:' || one_phone, 0));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
            'sheet_row', v.sheet_row,
            'verdict', v.verdict,
            'expected', e.value -> 'expected'
        ) order by v.sheet_row), '[]'::jsonb)
    into checked
    from public.student_import_verdicts(confirm_student_import.rows) v
    join jsonb_array_elements(confirm_student_import.rows) e on (e.value ->> 'sheet_row')::integer = v.sheet_row;

    select coalesce(jsonb_agg(jsonb_build_object('sheet_row', c -> 'sheet_row', 'verdict', c -> 'verdict')
               order by (c ->> 'sheet_row')::integer), '[]'::jsonb)
    into changed
    from jsonb_array_elements(checked) c
    where c -> 'verdict' is distinct from c -> 'expected';
    if jsonb_array_length(changed) > 0 then
        return jsonb_build_object('outcome', 'changed', 'rows', changed);
    end if;

    select count(*) filter (where c -> 'verdict' ->> 'verdict' = 'create'),
           count(*) filter (where c -> 'verdict' ->> 'verdict' = 'joins_family')
    into creates, joins
    from jsonb_array_elements(checked) c;
    if creates + joins = 0 then
        raise exception 'nothing_to_import';
    end if;

    insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
    values ('students', batch_file, staff_id, confirm_student_import.row_count, creates + joins, 0,
            confirm_student_import.row_count - creates - joins)
    returning id into batch;

    for item in
        select r.*, v.verdict
        from public.student_import_rows(confirm_student_import.rows) r
        join public.student_import_verdicts(confirm_student_import.rows) v on v.sheet_row = r.sheet_row
        where v.verdict ->> 'verdict' in ('create', 'joins_family')
        order by r.sheet_row
    loop
        -- One new contact per parent phone in the file, the first row's.
        contact_id := (contacts ->> item.phone)::uuid;
        if contact_id is null then
            insert into public.guardian_contacts (
                full_name, relationship, relationship_description, phone, whatsapp, origin, pending_family_match_id
            ) values (
                item.guardian_name, item.relationship::public.guardian_relationship, item.relationship_description,
                item.phone, item.whatsapp, 'front_desk',
                (item.verdict -> 'family' ->> 'contact_id')::uuid
            )
            returning id into contact_id;
            contacts := contacts || jsonb_build_object(item.phone, contact_id);
        end if;

        lead_status := case item.status when 'Enrolled' then 'Interviewed' else item.status end::public.lead_status;
        -- The import date stands in for a Visit date the file left out.
        lead_visit := case
            when item.visit_date is not null then item.visit_date
            when item.status in ('Visited', 'Interviewed', 'Enrolled') then today
        end;

        -- ADMSN- and five random digits, as create_lead draws them.
        for attempt in 1..20 loop
            new_number := 'ADMSN-' || lpad(floor(random() * 100000)::integer::text, 5, '0');
            begin
                insert into public.leads (
                    admission_number, student_name, class_name, enrollment_year, day_or_boarding,
                    status, visit_date, guardian_contact_id, returning_family_joined,
                    referral_code, import_batch_id, imported_as_enrolled,
                    declined_reason, declined_explanation, declined_at, declined_by, status_before_decline
                ) values (
                    new_number, item.student_name, item.class_name::public.lead_class, item.enrollment_year,
                    item.day_or_boarding::public.day_or_boarding,
                    lead_status, lead_visit, contact_id, item.verdict ->> 'verdict' = 'joins_family',
                    item.referral_code, batch, item.status = 'Enrolled',
                    case when item.status = 'Declined' then 'Other'::public.declined_reason end,
                    case when item.status = 'Declined' then 'Imported from the workbook' end,
                    case when item.status = 'Declined' then now() end,
                    case when item.status = 'Declined' then staff_id end,
                    case when item.status = 'Declined' then
                        case when lead_visit is null then 'Applied' else 'Visited' end::public.lead_status
                    end
                )
                returning id into new_lead_id;
                exit;
            exception when unique_violation then
                if attempt = 20 then
                    raise exception 'unavailable';
                end if;
            end;
        end loop;

        if item.pre_form_one then
            insert into public.lead_fee_profiles (lead_id, pre_form_one) values (new_lead_id, true);
        end if;

        if item.status in ('Interviewed', 'Enrolled') then
            insert into public.interview_serial_counters as c (enrollment_year, last_number)
            values (item.enrollment_year, 1)
            on conflict (enrollment_year) do update set last_number = c.last_number + 1
            returning c.last_number into issued;

            insert into public.interviews (lead, serial_number, serial_year, registered_by, registered_at, import_batch_id)
            values (new_lead_id, issued, item.enrollment_year, staff_id, clock_timestamp(), batch);
        end if;

        if item.status = 'Enrolled' then
            earlier_override := coalesce(current_setting('app.lead_lifecycle_override', true), '');
            perform public.set_lead_lifecycle_override('import');
            update public.leads l
            set status = 'Enrolled', enrolled_by_import = true
            where l.id = new_lead_id;
            perform set_config('app.lead_lifecycle_override', earlier_override, true);
        end if;
    end loop;

    return jsonb_build_object(
        'outcome', 'imported',
        'batch_id', batch,
        'created', creates,
        'joined_family', joins,
        'skipped', confirm_student_import.row_count - creates - joins
    );
end;
$$;

revoke execute on function public.confirm_student_import(text, integer, jsonb) from public, anon;
grant execute on function public.confirm_student_import(text, integer, jsonb) to authenticated;

select set_config('audit.actor_kind', '', true);
