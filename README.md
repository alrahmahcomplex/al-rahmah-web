# al-rahmah-web

One Next.js app for Al-Rahmah Complex: School Landing Page, Admissions Portal and
Referral Tracking System. Agent workflow lives in [AGENTS.md](AGENTS.md); the domain
language lives in [CONTEXT.md](CONTEXT.md).

## Releases

Each release is tagged with [Semantic Versioning](https://semver.org) and written up
in [CHANGELOG.md](CHANGELOG.md). `v1.0.0` is reserved for the complete app, with all
three products implemented, so releases before that stay in the `0.x` range. The
current release is `v0.1.1`, which brings the site back up after `v0.1.0` and keeps
the public pages up when staff sign-in is misconfigured.

## Requirements

- Node 24 or newer
- Docker, running, for local Supabase

## Setup

```bash
npm install
npm run db:start
```

`npm run db:start` prints `API_URL` and `PUBLISHABLE_KEY`. Copy `.env.example` to `.env.local`
and paste them in as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
Then:

```bash
npm run dev
```

The Supabase CLI is a dev dependency, so every command goes through npm scripts or
`npx supabase` and everyone gets the version pinned in the lockfile. Do not install it
globally.

The local stack listens on 55420–55429 rather than the Supabase defaults, because
Windows reserves the 543xx range for Hyper-V. Studio is at <http://127.0.0.1:55423>.

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

`test:e2e` needs local Supabase running; it starts its own server on port 3100 and
refuses to reuse one already there.

## Staff sign-in

Only emails in the `allowed_admin_emails` table can sign in. The table is created by
`supabase/migrations/20260922000000_allowed_admin_emails.sql` with row-level security,
and a trigger refuses to create an account for any other email.

Adding a staff member takes two steps: insert their email into the allowlist, then
invite the account from the Supabase dashboard. Public sign-up is off, so an
allowlisted email with no account behind it grants nothing and cannot be claimed by
someone else registering it. See `docs/adr/0001-staff-allowlist-lives-in-the-database.md`.

`supabase/seed.sql` creates local-only fixture accounts on the reserved `.test` domain:
`staff@example.test` (allowlisted) and `former-staff@example.test` (removed from the
allowlist), both with the password `fixture-password`. Real family and student records
never go into this repo.
