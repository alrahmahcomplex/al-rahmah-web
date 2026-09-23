# Changelog

Every release is tagged with [Semantic Versioning](https://semver.org). `v1.0.0` is
reserved for the complete Al-Rahmah web app, with the School Landing Page, Admissions
Portal and Referral Tracking System all implemented. Releases before that milestone
stay in the `0.x` range.

## September 23, 2026 `v0.1.1`

### FIXED

- Fixed every page, the home page included, showing "Internal Server Error" since the
  first release. The app now reads the Supabase key under the name Vercel holds.
- The home page and other public pages stay up when the staff sign-in service is
  misconfigured or down. Only the staff pages depend on it.

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
