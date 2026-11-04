-- The code-holder notice (#182): which version of the notice a lead's family
-- saw with its Discount code, as the school's PDPA 2022 evidence that parents
-- were told the person who gave them the code sees their child's admission
-- progress.
--
-- `form_v1` is the notice under the Admission form's Discount code field;
-- `staff_reminder` is the reminder staff see when they enter a code for a
-- walk-in family. The app lists the same versions in lib/referral-notice.ts.
--
-- The Admission form passes its version to a new three-argument
-- apply_form_discount_code. The two-argument version stays, unchanged, while
-- builds from before this migration may still call it (PostgREST picks by the
-- argument names sent, and the new argument has no default, so the two never
-- clash). #205 removes it once no build from before this migration can be live.

alter table public.leads
    add column referral_notice_version text
        constraint leads_referral_notice_version_known
            check (referral_notice_version in ('form_v1', 'staff_reminder')),
    -- A notice goes with a code: a version on a lead with no code would claim
    -- a notice about nothing.
    add constraint leads_referral_notice_version_needs_code
        check (referral_notice_version is null or referral_code is not null);

comment on column public.leads.referral_notice_version is
    'Which version of the code-holder notice accompanied the lead''s Referral code: form_v1 (shown under the Admission form''s Discount code field) or staff_reminder (staff reminded to tell the family). Null means no notice was shown: no code, a code from before the notice, or an import.';

-- ---------------------------------------------------------------------------
-- apply_form_discount_code(lead_id, code, notice_version): as the two-argument
-- version, and also records the notice version the form showed. It writes
-- only into an empty code, so a retry, or a lead staff gave a code in between,
-- keeps the code and version it has. A null version means the page showed no
-- notice. The form may send only an Admission form version; anything else is
-- `invalid` with `{"field": "notice_version"}` in the detail.
-- ---------------------------------------------------------------------------

create function public.apply_form_discount_code(lead_id uuid, code text, notice_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_code text;
    current_code text;
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'not_permitted';
    end if;
    -- Each RPC is its own transaction, so the actor is set here.
    perform public.set_audit_actor('public_form', null);

    new_code := public.normalize_referral_code(apply_form_discount_code.code);
    if new_code is null then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'discount_code')::text;
    end if;
    if apply_form_discount_code.notice_version is not null
        and apply_form_discount_code.notice_version is distinct from 'form_v1' then
        raise exception 'invalid' using detail = jsonb_build_object('field', 'notice_version')::text;
    end if;

    -- Locked, so a staff edit at the same moment is either seen here or made
    -- after this write.
    select l.referral_code into current_code
    from public.leads l
    where l.id = apply_form_discount_code.lead_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    if current_code is not null then
        return current_code;
    end if;
    perform public.assert_lead_open(apply_form_discount_code.lead_id);

    update public.leads l
    set referral_code = new_code,
        referral_notice_version = apply_form_discount_code.notice_version
    where l.id = apply_form_discount_code.lead_id;

    return new_code;
end;
$$;

revoke execute on function public.apply_form_discount_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_form_discount_code(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- set_lead_referral_code: as 20261112120100_agent_for_code left it, except
-- that a code staff set records `staff_reminder`, since the Referral code
-- editor and the front desk's Referral code field show staff the reminder,
-- and clearing the code clears the version.
-- ---------------------------------------------------------------------------

create or replace function public.set_lead_referral_code(lead_id uuid, code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_code text;
    new_code text;
begin
    if auth.role() is distinct from 'authenticated' or not public.has_permission('leads.edit') then
        raise exception 'not_permitted';
    end if;

    -- Locked, so two corrections made at once never both pass the
    -- no_change check against the same old value.
    select l.referral_code into current_code
    from public.leads l
    where l.id = set_lead_referral_code.lead_id
    for update;
    if not found then
        raise exception 'not_found';
    end if;
    perform public.assert_lead_open(set_lead_referral_code.lead_id);

    if set_lead_referral_code.code is not null then
        new_code := public.normalize_referral_code(set_lead_referral_code.code);
        if new_code is null then
            raise exception 'unknown_code';
        end if;
        if not exists (select 1 from public.agent_for_code(new_code)) then
            if public.agent_code_issued(new_code) then
                raise exception 'retired_code';
            end if;
            raise exception 'unknown_code';
        end if;
    end if;

    if new_code is not distinct from current_code then
        raise exception 'no_change';
    end if;

    update public.leads l
    set referral_code = new_code,
        referral_notice_version = case when new_code is null then null else 'staff_reminder' end
    where l.id = set_lead_referral_code.lead_id;

    return new_code;
end;
$$;
