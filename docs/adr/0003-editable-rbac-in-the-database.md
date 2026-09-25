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
