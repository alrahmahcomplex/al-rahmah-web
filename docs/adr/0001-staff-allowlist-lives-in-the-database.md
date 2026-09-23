# 1. The staff allowlist lives in the database

Date: 2026-09-22

## Status

Accepted

## Context

Only named staff may reach the staff side of the app. Supabase Auth is reachable
directly from any browser holding the public publishable key, so a rule enforced only in
the Next.js app would not hold: anyone could call the Auth API and the PostgREST
API without going through our pages.

Access also has to be revocable. A staff member who leaves keeps a working
password until something checks, on every request, whether they are still staff.

## Decision

The allowlist is the `allowed_admin_emails` table, and the database enforces it:

- `public.is_admin()`, a `security definer` function with an empty `search_path`,
  answers whether the caller's email is on the list.
- Row-level security on `allowed_admin_emails` uses that function, so only staff
  can read or change the list.
- A `before insert` trigger on `auth.users` refuses to create an account for an
  email that is not on the list.
- Public sign-up is off (`enable_signup = false` in `supabase/config.toml`), and
  email confirmation is on. Because the allowlist authorizes by email address, an
  open sign-up endpoint would let whoever registers first claim an allowlisted
  address that has no account yet and choose its password. Staff accounts are
  created by invitation instead.

The app then checks the same function rather than trusting a session: `signInStaff`
drops a session whose email is not allowlisted, and `getStaffUser` rechecks on every
staff page render. `proxy.ts` only refreshes the session and redirects visitors with
no session at all — Next.js documents Proxy as an optimistic check, not an
authorization boundary.

## Consequences

Removing a row revokes access on the staff member's next request, with no
deployment and no session surgery.

Adding a staff member takes two steps, not one: insert the email, then invite the
account. An email on the allowlist with no account behind it grants nothing.

Note that `[auth.email] enable_signup` is a different lever and stays `true`. It
turns the whole email provider on or off, so setting it to `false` also stops
existing staff signing in with a password.

The `auth.users` trigger blocks **every** account whose email is not on the staff
allowlist. That is right while staff are the only account holders. If the admissions
portal later gives parents or applicants their own logins, this trigger must be
revisited in the migration that introduces them: either widen it to consult a wider
set of account tables, or drop it and rely on `is_admin()` plus RLS, which already
distinguish staff from other signed-in users.
