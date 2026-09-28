# Changelog

Every release is tagged with [Semantic Versioning](https://semver.org). `v1.0.0` is
reserved for the complete Al-Rahmah web app, with the School Landing Page, Admissions
Portal and Referral Tracking System all implemented. Releases before that milestone
stay in the `0.x` range.

## Unreleased

### NEW

- Admissions Managers have a Staff and roles screen, linked from the staff navigation.
  It lists every role with how many active staff hold it and what it allows, and the
  people in each role.
- From that screen a Manager can move someone to another role, deactivate or
  reactivate them, and correct their name. Moving or deactivating another Manager asks
  for confirmation first.
- A History section on the screen lists every change to staff and roles, newest
  first, with who made it and the old and new values.
- Staff whose role doesn't include a page now see a page saying so, instead of the
  page itself.

## September 28, 2026 `v0.2.0`

### NEW

- Staff now have roles. Each staff member holds one of Admissions Manager, Admissions
  Staff or Accountant, and every staff page shows their name and role at the top.
- Every change to a staff member or a role is kept in a history that nobody can edit
  or delete, with who made the change and when.

### IMPROVED

- Everyone who could sign in before keeps their access as an Admissions Manager, named
  after the first part of their email address until someone corrects it.
- A deactivated staff member who tries to sign in is told their account is
  deactivated, instead of a general refusal. Someone deactivated while signed in is
  sent back to sign-in on their next click.

## September 28, 2026 `v0.1.7`

### IMPROVED

- Nothing in the app changes in this release. The separate local database for each
  copy of the project, added in `v0.1.6`, is gone. It slowed down the developer's
  machine. Every copy shares one local database again, as it did in `v0.1.5`, and it
  starts only the parts the app uses.

## September 26, 2026 `v0.1.6`

### IMPROVED

- Nothing in the app changes in this release. Each copy of the project on a
  developer's machine now gets its own local database, so several people or agents
  can work side by side without wiping each other's data.

## September 25, 2026 `v0.1.5`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now settle
  the rest of the Admissions Portal before it is built: the Swahili WhatsApp and SMS
  result messages, how a reopening request is approved, how the front desk checks a
  family in and finds siblings, how school fees, discounts and seat priority decide
  when a student counts as enrolled, and which periods the dashboard reports by.

## September 25, 2026 `v0.1.4`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now list
  every permission a staff role can hold and what the Admissions Staff, Admissions
  Manager and Accountant roles start with. Only the Accountant marks the interview fee
  as paid, and all three roles can see school-fee payments.

## September 25, 2026 `v0.1.3`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now say how
  the Admissions Portal keeps its history: every change to a lead, payment, role or
  staff member records who made it, what it was before and what it became, and the
  history can never be edited or deleted.

## September 25, 2026 `v0.1.2`

### IMPROVED

- Nothing in the app changes in this release. The project's written rules now describe
  what comes next: parents applying online and getting an Admission Number, Marketing
  Agents and the discount codes parents enter, and staff roles the Admissions Manager
  can edit. Building starts from these.

## September 23, 2026 `v0.1.1`

### FIXED

- Fixed every page, the home page included, showing "Internal Server Error" since the
  first release.
- Fixed the home page and other public pages going down along with staff sign-in.
  When sign-in is misconfigured or down, only the staff pages are affected.

## September 22, 2026 `v0.1.0`

### NEW

- Added staff sign-in at `/login`, carrying the Al-Rahmah logo, palette and password
  visibility toggle across from the archived photo matcher.
- Added a staff allowlist. Only an email listed in `allowed_admin_emails` can sign in,
  the database refuses to create an account for any other address, and removing an
  email revokes access on that person's next request.
- Added a staff area at `/staff` that names the signed-in person and can sign them out.
- Added a public placeholder at `/` linking to staff sign-in, until the school landing
  page is built.
- Added the checks every later change runs against: `lint`, `typecheck`, `test`
  (Vitest), `test:e2e` (Playwright) and `build`.
- Added local Supabase through the CLI as a dev dependency, so the database, its
  migration and the fixture accounts come up with `npm run db:start` on the version
  pinned in the lockfile.

### IMPROVED

- Moved the app to Next.js 16 with the App Router, Tailwind v4 and shadcn `base-nova`.
  The archived repo mixed Next 15 with version 16 of its lint config.
- Left the photo matcher behind: Gemini, Firebase tools, IndexedDB, spreadsheet and
  archive handling, and the batch, student and dashboard screens are all gone.
- Session refresh now runs in `proxy.ts`, following the Next.js 16 rename of
  middleware, and authorization sits in the services and the database where it holds.

### FIXED

- Fixed the sign-in link handler sending people to another site. A crafted `next`
  parameter such as `?next=@evil.example` was treated as a destination; only paths on
  this site are followed now.
- Fixed an allowlisted email being claimable by a stranger. Public sign-up was open,
  so whoever registered a staff address first chose its password and was let in.
  Sign-up is off and staff accounts are created by invitation.
- Fixed sign-in blaming the password when the service was unreachable. An outage now
  says so instead of telling staff their password is wrong.
