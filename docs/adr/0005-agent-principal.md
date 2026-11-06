# 5. Marketing Agents sign in as a separate principal

Date: 2026-11-05

## Status

Accepted. Amends ADR 1 (who may get an account) and ADR 4 (who writes audited rows).

## Context

Marketing Agents are getting their own logins (spec #178) so they can see the students who used their Discount code. Until now every Supabase Auth user was a staff member: the sign-up trigger accepted only an active staff record, and every permission check asked "which staff record has this `auth.uid()`?".

An agent login must never reach staff functions or staff tables. Admissions staff may not also be agents (owner decision 32), so one email belongs to one login: staff or agent, never both. Agent access also has to be switchable off for everyone at once, before go-live and as the rollback.

## Decision

**No accounts table.** Emails stay on `staff_members.email` and `marketing_agents.email`, and logins on their `user_id` columns. An accounts table would repeat uniqueness Supabase Auth already enforces, and break the seeds and CI.

**One email, one login.** A `before insert or update` trigger on both tables, `guard_login`, takes a transaction lock on the lowercased email (`lock_login_email`). It refuses an email held in the other table, by a current agent or any staff record, or by an auth user that isn't the same person's login. A duplicate within one table still meets that table's unique index: the staff email is unique, the agent email is unique among records that aren't retired. The trigger also refuses a `user_id` the other table holds.

**`current_principal()`.** It answers who is signed in: `staff` with the staff id, `agent` with the agent id, or nothing. Only the base checks read through it: `has_permission`, `is_active_staff`, `current_staff_member`, `audit_actor`, and `current_staff_id()`. Other staff lookups by `auth.uid()` stay as they are, because an agent's id never matches a staff row. Agent functions, starting with the agent view (#195), find the agent through it. No API role can call it directly.

**Who may get a login.** The two `auth.users` triggers accept exactly one of:

- an active staff member with no login yet;
- an Approved, switched-on, non-retired agent with no login yet and a confirmed email, while agent access is on. An email stored on an agent record is confirmed by whoever stored it.

`user_metadata.kind` chooses email wording only. The triggers never read it, and it never grants access.

**Agents write nothing.** An agent session has no audit actor, even when the transaction sets one, so the audit trigger refuses any audited write it would make. There is no `agent` actor kind.

**The access switch.** `agent_access_settings` holds one row, off from setup and audited in `staff_admin`. `agent_access()` is its one reader: every agent sign-up, claim, sign-in, invite, reset and portal read checks it. Only the database owner changes it, through `set_agent_access(enabled)` in the SQL editor or a migration, after naming the actor with `set_audit_actor`. Fees never read it. The Agents screen shows its state and who last changed it.

**A retired agent's login is closed.** Retiring an agent detaches their login (#189). The detached auth user is then banned, signed out, and given the address `<user id>@retired.invalid`, so the email is free in Supabase Auth for a corrected record. Recreate moves the login to the new record instead.

**A permanent grant test.** `tests/integration/api-surface.test.ts` reads every function, table privilege and policy the `anon` and `authenticated` roles can reach in the exposed schemas, and fails on anything missing from the checked-in list in `tests/integration/api-surface.ts`, or on entries that no longer exist. The seeded agent calls every function with valid sample arguments and reads every table. Each answer must match the recorded one: a refusal, false, zero or no rows.

## Considered options

- **Agent RLS policies on the staff tables.** Rejected: one wrong policy would leak a family's data. Agents read through security-definer functions only.
- **An `accounts` table.** Rejected, as above.
- **Trusting `user_metadata.kind`.** Rejected: anyone with a session can change their own user metadata.
- **A Vercel flag for the switch.** Rejected: the database must refuse agents itself, so the switch lives there.

## Consequences

Every new function or table the API roles can reach needs an entry in the grant list, which makes its reviewer state what an agent gets.

The base checks now do two lookups by `user_id` instead of one, both on unique indexes.

Turning agent access on or off is an owner step in the SQL editor until a screen exists for it.

## Amendment, 2026-11-06: an agent may change their own sign-in email

The owner decided that an agent may change their own sign-in email, so they keep access if they lose the original inbox. Email isn't how an agent is identified: the agent record and its Discount code are, and the agent can never change either. The change happens in Supabase Auth (`updateUser`, confirmed from both inboxes), not in the app's tables. The server's `reconcile_agent_emails`, run with the secret key, then copies the new address into the record and appends an `agent_events` row with the old and new email and `changed_by = 'agent'`; a Manager's change is recorded with `changed_by = 'staff'`. An address a staff member or another current agent holds is put back. Agent sessions still write nothing to the app's tables, and `actor_kind` has no `agent` value.
