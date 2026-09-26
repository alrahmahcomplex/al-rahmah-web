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

`npm run db:start` starts this checkout's own local Supabase and writes `.env.local` for you.
It prints the dev-server port to use:

```bash
npm run dev -- -p <port it printed>
```

Every checkout gets its own stack. The main checkout uses slot 0 (the ports in
`supabase/config.toml`, dev server 3000, e2e server 3100). A git worktree takes one of
three slots, with ports shifted by 100 per slot (slot 1: API 55521, dev 3001, e2e
3101). It runs only Postgres, Auth, REST, Kong and Mailpit, about 210 MB against 2 GB
for the full stack. `npm run db:status` lists the slots, `npm run db:stop` frees
yours, and `npm run db:start -- --full` adds Studio and the other services.

The Supabase CLI is a dev dependency, so every command goes through npm scripts or
`npx supabase` and everyone gets the version pinned in the lockfile. Do not install it
globally.

The local stack listens on 55420–55429 rather than the Supabase defaults, because
Windows reserves the 543xx range for Hyper-V. Studio (with `--full`) is at
<http://127.0.0.1:55423>.

## Checks

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

`test:e2e` needs this checkout's local Supabase running. It starts its own server on
the checkout's `E2E_PORT` (3100 in the main checkout) and refuses to reuse one already
there.

One Next.js build runs at a time per machine, because two at once ran a 7.7 GB machine
out of memory. `npm run build` and `npm run test:e2e` share a lock with every other
checkout of the repo. When another checkout holds it, they print what they are waiting
for and start once it is released. `test:e2e` holds the lock for its whole run, since
its build happens inside Playwright's five-minute server timeout. Run it through npm:
`npx playwright test` still waits for the lock, but the wait counts against that
timeout.

A build that is killed mid-run leaves its lock behind, in `.git/build.lock` of the main
checkout. The next run names that folder and stops instead of waiting. Check that no
build or e2e run is going on in any checkout, delete the folder, and run the command
again.

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
