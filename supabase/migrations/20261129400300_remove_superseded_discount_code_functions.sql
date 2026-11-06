-- Removes the two function versions that older builds called (#196, #205).
--
-- - apply_form_discount_code(lead_id, code): the Admission form's code write
--   before #182 (PR #204) added the three-argument version that also records
--   the notice version. Every Production build since 2026-11-04 calls the
--   three-argument version.
-- - register_marketing_agent(full_name, phone, whatsapp): the Discount code
--   page's registration before #193 (PR #222) replaced it with
--   sign_up_marketing_agent, which takes an email and settles claims on an
--   existing code. No build since 2026-11-06 calls it.
--
-- Dropping a function removes its grants with it, so the API now exposes one
-- apply_form_discount_code (uuid, text, text) and no register_marketing_agent.
-- PostgREST answers PGRST202 to a call with the old argument lists.
--
-- After this migration a Vercel instant rollback to a build from before this
-- release is unsafe: such a build still calls the removed versions, so the
-- Admission form's code step and the old registration page would fail.

drop function if exists public.apply_form_discount_code(uuid, text);
drop function if exists public.register_marketing_agent(text, text, text);
