-- The code-holder notice's second Admission form version (#282): `form_v2`
-- says the code holder sees each student on the form, since a form can now
-- carry several (#277). `form_v1`, the one-child wording, stays allowed and
-- keeps its meaning for the leads that recorded it; no row is rewritten.
--
-- apply_form_discount_code accepts both form versions. The hosted migration
-- and the Vercel deploy don't switch over at the same moment, so a page from
-- the build before #282 may still send `form_v1` after this runs, and that
-- page really did show the form_v1 words. The app itself sends only the
-- version it shows (lib/referral-notice.ts).

alter table public.leads
    drop constraint leads_referral_notice_version_known,
    add constraint leads_referral_notice_version_known
        check (referral_notice_version in ('form_v1', 'form_v2', 'staff_reminder'));

comment on column public.leads.referral_notice_version is
    'Which version of the code-holder notice accompanied the lead''s Referral code: form_v1 (the Admission form''s one-child wording, until #282), form_v2 (the Admission form''s wording for each student on the form) or staff_reminder (staff reminded to tell the family). Null means no notice was shown: no code, a code from before the notice, or an import.';

-- ---------------------------------------------------------------------------
-- apply_form_discount_code(lead_id, code, notice_version): as
-- 20261116400200_referral_notice_version.sql left it, except that the form
-- may send `form_v1` or `form_v2`. Anything else is still `invalid` with
-- `{"field": "notice_version"}` in the detail.
-- ---------------------------------------------------------------------------

create or replace function public.apply_form_discount_code(lead_id uuid, code text, notice_version text)
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
        and apply_form_discount_code.notice_version not in ('form_v1', 'form_v2') then
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
