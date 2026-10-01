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
An `.env.local` written by `v0.1.6` may point at a per-worktree port such as 55521 and
carry an `E2E_PORT` line; replace the two values and delete that line. Then:

```bash
npm run dev
```

The Supabase CLI is a dev dependency, so every command goes through npm scripts or
`npx supabase` and everyone gets the version pinned in the lockfile. Do not install it
globally.

Every checkout and worktree shares this one local stack. `npm run db:reset` wipes its
data and `npm run db:stop` shuts it down for all of them, so check that nothing else is
using it first.

`npm run db:start` runs only Postgres, Auth, REST, Kong and Mailpit, which is all the app
uses. For Studio and the other services, run `npm run db:stop` and then
`npm run db:start:full`.

The local stack listens on 55420–55429 rather than the Supabase defaults, because
Windows reserves the 543xx range for Hyper-V. Studio (with `db:start:full`) is at
<http://127.0.0.1:55423>.

## Checks

```bash
npm run lint
npm run typecheck
npm run test              # unit
npm run test:integration  # services and SQL against local Supabase
npm run test:e2e          # browser
npm run build
```

`test:integration` and `test:e2e` need local Supabase running and a `.env.local`
(`npm run env:local` writes one from it). `test:e2e` builds and serves the app on port
3100. To rerun without building again, start `npm run e2e:serve` first: the tests reuse
that server once they've checked it serves this checkout's build. CI
(`.github/workflows/ci.yml`) runs every check on each PR.

## Staff sign-in

A person can use the staff side only while they are an active staff member. Each
staff member holds one role, and a role is a set of permissions from the fixed list in
`CONTEXT.md`. The database enforces it: `has_permission(name)` answers for the
signed-in person, row-level security checks it, and a trigger refuses to create an
account for any email without an active staff record. Every change to staff and roles
is written to the append-only `audit_log`. See `docs/adr/0003-editable-rbac-in-the-database.md`
and `docs/adr/0004-audit-history-is-one-trigger-fed-log.md`.

`supabase/seeds/00_base.sql` creates local-only fixture staff on the reserved `.test` domain, one
per role plus two deactivated members, all with the password `fixture-password`.
`tests/support/fixtures.ts` lists them. Each later slice keeps its own fixtures in its own
`supabase/seeds/NN_*.sql`; they load in file-name order. Real family and student records
never go into this repo.
