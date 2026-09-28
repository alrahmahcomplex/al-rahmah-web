# 4. Audit history is one trigger-fed log

Date: 2026-09-25

## Status

Accepted.

## Context

`CONTEXT.md` requires every edit to admissions data to keep the previous value, the new value, who made the change and when: student details, contacts, class, enrollment year, referral code, interviews, follow-ups, lifecycle status and payments. ADR 3 adds every change to a role, its permissions, or a staff member's role or active state. Records are never deleted.

Most writes come from Server Actions using the staff member's own session, so inside Postgres `auth.uid()` already names the actor. Two paths have no session: sending staff invites, which needs the secret key, and the workbook import. The public Admission form writes without any staff member at all.

## Decision

**One shared change log, `audit_log`, written by triggers.** Every audited table carries the same `after insert or update` trigger. Each row records the table, the changed row's id, the lead id when the row belongs to one lead, the action, the old and new values of only the fields that changed (as `jsonb`; the whole row on insert), the actor and the time. Records that never change after they are written (follow-ups, school-fee payments, adjustments, re-applications, reopen requests) stay ordinary rows and pass through the same trigger, so they appear in the same timeline.

**The actor.** The trigger reads `auth.uid()`. Writes made with the secret key go through a `security definer` function that takes the actor and sets it for that transaction. The log stores `actor_kind` (`staff`, `workbook_import`, `public_form`) and `actor_staff_id`, a foreign key to the staff member, filled only for `staff`. Names are looked up when the history is read, never copied, so a deactivated staff member still shows by name. The trigger refuses an audited write that has no actor.

**Nothing is deleted or rewritten.** Audited tables have no delete policy and a trigger that refuses `DELETE`, even from the secret key. `audit_log` refuses `UPDATE` and `DELETE` for everyone. A wrong audit row is corrected only by a reviewed migration.

**Action events.** Things staff do that change no row, such as sending an invite or releasing an interview result by WhatsApp or copied SMS text, are written to the same `audit_log` through one `security definer` function, `record_action(kind, lead_id, details)`. The kinds are a fixed list in migrations, starting with `invite_sent` and `result_released`. Each kind names the permission its action needs, such as administering staff for `invite_sent` and sending interview results for `result_released`. `record_action` refuses a caller who lacks that permission, and it takes the actor the same way the trigger does. It is not executable by `anon`. A secret-key call bypasses `has_permission`, so the one service that makes such a call (sending invites) checks the signed-in staff member's permission before sending the invite, and passes that staff member as the actor. Writes the database refuses are not audited: they are rolled back and changed nothing. They go to the server logs.

**Reading.** Each audited table is tagged with a scope (`lead`, `payment`, `staff_admin`). The `audit_log` read policy maps each scope to a `has_permission(...)` check, so a staff member reads the history of what they can read. There are no insert, update or delete policies; only the trigger function and `record_action` write. A lead's history screen calls one SQL function, `lead_history(lead_id)`, which returns the lead's rows plus the rows for the parent/guardian contacts linked to it, newest first. A contact shared by siblings is therefore logged once and shows on every sibling's history.

**In the app.** App code never writes row-change history. `lib/services/audit.ts` owns `getLeadHistory(leadId)` and `recordAction(kind, leadId, details)`, both returning the usual `Result`.

**Notices at sign-in.** ADR 3's "the affected Manager is told at their next sign-in" reads `audit_log`. A notice is an update to that staff member's row, made by someone else, that changed their role or their active state, and is newer than the `notices_seen_at` timestamp on their staff row. No other change to the row counts, including updates to `notices_seen_at` itself.

## Considered options

- **A history table per entity.** Typed columns, but a dozen tables to keep in step with their parents, and a lead's timeline becomes a union across all of them. Rejected.
- **Event sourcing**, deriving current state from append-only events. Too heavy for the team, and it works against PostgREST and RLS, which expect current-state tables. Rejected.
- **The app writes history from each Server Action.** Keeps logic in TypeScript, but any action that forgets to write leaves a silent gap, and secret-key or SQL-editor writes escape it. Rejected in favour of triggers.
- **Auditing refused writes.** A refusal rolls back its transaction, taking any audit row with it, and it changed nothing. Rejected.

## Consequences

Every migration that creates an audited table must attach the audit trigger, the delete-refusing trigger and a scope, in the same migration as its RLS policies.

Old and new values are `jsonb`, so a column rename leaves old entries under the old key. The history screen has to tolerate keys it no longer knows.

`audit_log` keeps copies of names and phone numbers indefinitely, including values later corrected. That follows from "records are never deleted" and is on the list for the Personal Data Protection Act 2022 compliance check planned before slice 6, which may add a retention or redaction rule.

Scope-to-permission mapping depends on the permission list, which is decided separately and may rename the scopes' checks without changing this design.

## Amendment, 2026-09-25: the permission names

The permission list in `CONTEXT.md` fixes the names this ADR described in words. The read scopes map as `lead` to `leads.view`, `payment` to `payments.view` and `staff_admin` to `staff.administer`. The action kinds need `staff.administer` for `invite_sent` and `results.send` for `result_released`.

## Amendment, 2026-09-28: the `system` actor

`actor_kind` gains a fourth value, `system`, for writes that no person or product makes: a migration, and the SQL editor when bootstrapping the first staff member. ADR 3 says the Admissions Manager role changes only through a reviewed migration, and this ADR refuses an audited write with no actor, so those writes need one. They call `set_audit_actor('system')` first, in the same transaction. Linking a new account to its staff record, which the sign-up trigger on `auth.users` does, is also recorded as `system`.

The starting roles are seeded before the audit triggers are attached, so they have no insert rows. Every later change to them is audited.
