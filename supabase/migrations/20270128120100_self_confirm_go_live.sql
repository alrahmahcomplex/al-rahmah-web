-- Self-confirm goes live (#503 slice 4c): agents on record with an Approved
-- code join from the Discount code page by mobile or email, with no Manager
-- wait. Merged only on the lead's go, after the owner's real SMS reset on
-- Production proved the signed Send SMS hook end to end.
--
-- The switch stays the owner's to turn off again at any time:
--   select public.set_audit_actor('system');
--   select public.set_agent_self_confirm(false);
-- Off stops new starts, numbers and emails at once (links already sent
-- work until they expire). It is on only while Agent access is on too.
--
-- Rollback: the two lines above, in the SQL editor or a migration.

do $$
begin
    perform public.set_audit_actor('system');
    perform public.set_agent_self_confirm(true);
end;
$$;
