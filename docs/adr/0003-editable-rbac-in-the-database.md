# 3. Editable role-based access control in the database

Date: 2026-09-23

## Status

Accepted. Supersedes the allowlist table of ADR 1; its principle, that the database enforces access, stands.

## Context

The staff side needs three starting roles (Admissions Manager, Admissions Staff, Accountant), and the school wants to create roles and change what each one can do without a developer. The allowlist from ADR 1 answers only "is this person staff".

## Decision

- Permissions are a fixed list defined in migrations. Roles are data: a role is a named set of permissions, edited on a staff screen. RLS policies and the app check a permission (`has_permission('<name>')`, a `security definer` function in the style of `is_admin()`), never a role name, so renaming or reshaping a role cannot silently break a policy.
- Each staff member holds exactly one role.
- The Admissions Manager role is seeded with the permission to administer staff and roles. There is no separate Administrator role.

Because whoever administers roles could otherwise grant themselves anything, the database enforces these guardrails, not just the screen:

1. Nobody can change their own role, edit the role they hold, or deactivate themselves. The block applies to every holder of a role, so two Managers sharing the Admissions Manager role cannot edit it for each other: that role's permissions change only through a reviewed migration. One Manager may reassign or deactivate another; that is confirmed on screen, audited, and shown to the affected Manager at their next sign-in.
2. No change may leave zero active staff members holding the administer permission. This covers deactivation, reassignment, and editing or retiring a role.
3. Staff members are deactivated, never deleted, so their names stay on the audit history. A role still held by an active staff member cannot be retired; deactivated members do not count, and one whose role was retired needs a current role before reactivation.
4. Every change to a role, its permissions, or a staff member's role or active state is audited.

## Considered options

- **Roles as fixed code, checked by name.** Simpler, but any change to a role needs a developer. Rejected, because the school wants to edit roles itself.
- **Several roles per account.** Would let one person cover two jobs, but it blurs who acted in which capacity. Rejected: one role per account.
- **A separate Administrator role.** Would separate granting powers from running admissions. Rejected: the Admissions Manager administers. Guardrail 1 closes most of the self-escalation risk that the separate role would have addressed.

## Consequences

The Admissions Manager role's permissions are frozen except through a reviewed migration, however many Managers exist. That is intended: changing the administrators' own powers should be rare and reviewed. A two-person approval flow was considered and rejected as work guarding something that almost never happens.

The screen greys out actions it can already see are blocked (your own role, your own account, a role with active holders) and says why inline. The database remains the authority, and refusals only it can detect, such as a change that would leave no administrator, are explained after the attempt.

The `enforce_staff_allowlist` trigger on `auth.users` from ADR 1 must be replaced in the same migration that introduces staff members. The replacement consults the staff table instead. Account creation by invitation stays, as does `enable_signup = false`.

## Amendment, 2026-09-29: roles that administer staff are frozen

Guardrail 1 stops a Manager editing the role they hold, but on its own it does not keep the promise above that the Admissions Manager role changes only through a reviewed migration. A Manager could tick "Administer staff and roles" on another role, and that role's holders could then edit the Admissions Manager role, since they don't hold it.

So the database adds a rule, `administer_role_frozen`. Nobody edits, renames or retires a role that holds `staff.administer` through the app, and nobody grants or removes `staff.administer` on any role. The screen shows the "Administer staff and roles" checkbox on every role but never lets it be ticked or unticked. Those roles, and the permission itself, change only through a reviewed migration.

A side effect: a role edit made in the app can never be the change that leaves no administrator, because no role edit there touches a role that administers. Guardrail 2 still covers the SQL editor and the secret key.

## Amendment, 2026-11-07: the Super Admin, a role that is not data

Owner decision 43 (2026-11-06, #237) adds one role that migrations alone create and change. After the hosted reset (#197) nobody can sign in; the Super Admin is the first account, and invites everyone else.

- Migration `20261130990300_super_admin_role.sql` inserts the role under a fixed id and its one holder's staff record. The role carries no permissions of its own: `has_permission()` answers true for its active holder whatever the name, so a permission a later migration adds needs no grant. `current_staff_member()` lists every permission for the holder.
- Named triggers freeze it for every database role: `refuse_super_admin_role_change` refuses any update of the role row, and `refuse_super_admin_holder_change` refuses a second holder, a move into or out of the role, and any change to the holder's active state, name or email. The holder's row still takes its first login and its notices time. Deletes were already refused for both tables. Only a migration that disables a trigger by name can change the role or the holder.
- The role is invisible: row security hides it from every reader and hides the holder from administrators, and the staff write functions treat both as not found for anyone else. The holder's name still shows wherever they acted.
- The Super Admin holds `staff.administer` like any administrator and counts toward guardrail 2 once joined (both superseded by the amendment below). Guardrail 1 applies to them. `administer_role_frozen` applies too (decision 1): the Admissions Manager role still changes only through a migration.
- **Audit visibility.** A new permission, `audit.view`, gates every audit read: the `audit_log` read policy, `lead_history()`, the Staff and roles history, every release of an interview (`result_releases()`), the `agent_status_changes` table and the new `audit_entries()` behind the Audit screen. Screens that need one fact read a narrow reader instead: `latest_result_release()` (the newest release and the count the send guard compares), `marketing_agent_status_notes()` (an agent's newest status change) and `lead_status_since()`. `refuse_audit_view_grant` refuses any role that lists it, so only the Super Admin holds it. This replaces ADR 4's scope-to-permission read mapping. Everyone else keeps the per-screen facts in `CONTEXT.md` (Audit history).

## Amendment, 2026-11-07: roles from templates, managed sets, and the Super Admin alone changes roles

Owner decision 44 (#241). With the Super Admin as a permanent administrator, the rules that assumed a Manager administers roles stopped fitting. Migration `20261130990500_roles_from_templates.sql` makes these changes.

- **Roles are the Super Admin's data.** `create_role`, `rename_role`, `set_role_permission`, `retire_role`, the new `reactivate_role` and the new `set_role_manages` refuse everyone but the Super Admin with `forbidden`. The Admissions Manager role is ordinary data the Super Admin edits.
- **Templates in code.** `lib/role-templates.ts` defines five: Admissions Staff, Admissions Manager, Accountant, Head Accountant and Administrator. `create_role` takes the name, permissions, the roles it manages and the roles that manage it in one call, so a role from a template is made in one step. Nothing in the database remembers the template. The migration deletes the three seeded role rows when no staff record references them; locally `supabase/seeds/00_base.sql` recreates them from the templates under fixed ids.
- **Managed sets replace `staff.administer`.** A new table, `role_managed_roles`, records which roles a role's holders manage (audited, deletes and truncates refused, no API writes, never naming the Super Admin role). The staff write functions check the target's role against the caller's set and refuse anything outside it with `forbidden`; a caller who manages nobody keeps `not_permitted`. `staff_members` row security and `invited_staff_members()` follow the same set. The `staff.administer` permission is retired: keeping it would leave two switches that must agree, and its label promised role editing nobody but the Super Admin has. `invite_sent` now names no permission, and `record_action` accepts it from anyone who manages staff.
- **Guardrail 2 and `administer_role_frozen` go.** `refuse_no_administrator_left` and `administrator_count()` are dropped: the Super Admin is always there, frozen by the triggers of the amendment above, so no change can leave the school without someone who manages staff. `administer_role_frozen` existed to stop holders of `staff.administer` editing each other's role; only the Super Admin edits roles now, so the rule has nothing left to guard. Guardrails 1, 3 and 4 stand.
