-- agent_access_settings had the delete refusal but not the truncate refusal
-- every other audited table carries (ADR 4). The permanent trigger test,
-- tests/integration/refusal-triggers.test.ts, checks both, so it gets the
-- second one here. Its own migration, so that the hosted reset migration
-- before it (#197) changes no schema and stays a pure data migration.
create trigger refuse_truncate
    before truncate on public.agent_access_settings
    for each statement
    execute function public.refuse_delete();
