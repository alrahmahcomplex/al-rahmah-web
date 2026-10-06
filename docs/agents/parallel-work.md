# Parallel work

Rules for several agents building tickets at once on this machine. Each agent has its own worktree, but they all share one local Supabase, one e2e port and 7.7 GB of RAM.

## The shared lock

Take the lock before any of these, and release it straight after:

- `npm run db:reset`
- `npm run test:integration` or `npm run test:e2e`
- `npm run build`, `npm run e2e:serve`, or an evidence server

```bash
LOCK="$(git rev-parse --git-common-dir)/local-supabase.lock"
mkdir "$LOCK" && echo "<ticket> <branch>" > "$LOCK/owner"   # fails while someone else holds it
# ... work ...
rm -rf "$LOCK"
```

If `mkdir` fails, someone holds it: read `owner`, wait, and try again. Never build without the lock; two `next build` runs at once run out of memory here.

- Run `db:reset` from your own worktree, so the database holds your migrations and not another branch's.
- Never run `npm run db:stop`; it stops the database for everyone.
- Create `.env.local` with `npm run env:local` while local Supabase runs.

## Ports

- Browser tests use 3100, under the lock. Playwright reuses a server already on 3100 only when it serves this worktree's build, and fails otherwise. It also starts the same build on 3101 with a Turnstile secret that always fails, for the public forms' rejection path; stop that one too when a run leaves it behind.
- Evidence servers use 3200 plus the ticket number's last two digits: #67 uses 3267.
- Stop every server you start before you report. On Windows, stopping the shell that ran `next start` can leave the server running; check the port and stop the process that owns it:

  ```powershell
  Get-NetTCPConnection -LocalPort 3267 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
  ```

## Your own files

Each slice owns a migration timestamp range and a seed file. Use only your slice's.

| Slice | Specs | Migrations | Seed file |
|---|---|---|---|
| 3, Public Admission form | #30 | `2026101030xxxx` | `supabase/seeds/30_admission_form.sql` |
| 4, Marketing Agents | #32 | `2026101040xxxx` | `supabase/seeds/40_agents.sql` |
| 5, Interviews and interview payment | #26 | `2026101050xxxx` | `supabase/seeds/50_interviews.sql` |
| 6, Result release | #31 | `2026101060xxxx` | `supabase/seeds/60_results.sql` |
| 7, Follow-ups and the queue | #28 | `2026101070xxxx` | `supabase/seeds/70_followups.sql` |
| 8, Decline, Inactive/Archive and reopening | #27 | `2026101080xxxx` | `supabase/seeds/80_closure.sql` |
| 9, Fee schedule, payments and Enrolled | #29 | `2026101090xxxx` | `supabase/seeds/90_fees.sql` |
| 10, Dashboard | #33 | `2026101095xxxx` | `supabase/seeds/95_dashboard.sql` |

The `xxxx` is yours to number within the range. Within a slice, tickets that run one after another number upwards, so a later ticket's migration sorts after an earlier one's. Seeds load in file-name order, after `00_base.sql`, so a later slice's seed may refer to an earlier slice's rows.

**Renumber at release.** Slices merge in any order, but the hosted database applies migrations in timestamp order, and one older than its newest may never be applied. So in *Releasing* step 1, after the rebase, compare each migration the PR adds with the newest on `origin/main`. If it sorts before, rename it with `git mv`: change the eight-digit date to the day after the newest migration's date and keep the last six digits. `20261010500100` after `20261010900000` becomes `20261011500100`. Then rerun the integration tests before pushing.

- **Lead screen.** A new panel is a file in `app/staff/leads/[id]/` plus one line in `LEAD_PANELS` (`panels.tsx`). Nothing else in `page.tsx`. A closed lead shows no panel unless it sets `readOnlyWhenClosed: true`, and such a panel offers no work action while its `open` prop is false. The exceptions are slice 8's own workflow on closed leads: the closure panel's Mark inactive and Archive follow the lead's mark, since a closure mark is a change a closed lead still takes, and the Reopening requests panel offers Withdraw to the requester of a Pending request, since a request exists only for a closed lead.
- **Staff navigation.** One line in `STAFF_NAV` (`app/staff/navigation.ts`). An entry may take a list of permissions, any one of which shows it.
- **Shared service files.** One owner per file at a time. Put new modules in new files under `lib/services/`.

## Contracts

Functions other slices call already exist, so nobody creates them twice:

- `assert_lead_open(lead_id)`, raising `lead_closed`. Call it first in every write function on a lead. It is granted to no signed-in role, since write functions run as their owner.
- `lead_is_closed(lead_id)`, for staff with `leads.view` (`forbidden` otherwise). #96 may `create or replace` both, keeping their condition the same.
- A trigger refuses every update to a closed lead with `lead_closed`. A security definer function that must change one calls `set_lead_lifecycle_override(path)` first, with `close`, `reopen` or `payment_recompute`, or `re_application`, which allows only setting `returning_family_reapplied`; it lasts until the transaction ends and is granted to no signed-in role.
- `decline_lead(lead_id, reason text, explanation text)` declines an open lead: `leads.decline`, plus `academic_years.manage` for No seat available. It does no transaction control, so slice 7 calls it inside `record_follow_up`. A Declined lead must carry a `declined_reason` (a check constraint), so a seed or test that sets `status = 'Declined'` directly sets the reason too.
- `mark_lead(lead_id, mark text, reason text, note text)` puts an Inactive or Archived mark on a lead (`leads.close`), Declined leads included. A closure mark must carry a `closure_reason` (a check constraint), so a seed or test that sets `closure` directly sets the reason in the same statement; a later update to the marked lead is refused as `lead_closed`.
- `expected_interview_amount(lead_id)` returning `amount` and `discount_applied`. A stand-in at TZS 50,000 until #80 replaces it with `create or replace`.
- `enrol_from_academic_year_start(as_of date)` returning how many leads it enrolled. A stand-in that enrols nobody until #109 replaces it with `create or replace`. `set_academic_year` already calls it when a start of today or earlier is set.
- `reopening_requests`, with at most one `pending` row per lead (a partial unique index). `raise_reopening_request(lead_id, reason, source)` and `withdraw_reopening_request(request_id)` write it; `lead_reopening_requests(lead_id)` reads a lead's requests with names. Slice 7 reads approvals from the table; #100 approves and rejects. The `re_application` source exists for slice 3 to link to.
- `re_applications` and `record_re_application(lead_id, submission_key, submitted jsonb)` (#76), secret key only, returning the re-application's id; `submitted` holds `contact` and `student` in create_lead's shapes. Review (#77) sets `reviewed_at` and `reviewed_by` together through a function of its own.
- `OFFICE_PHONE` in `lib/office.ts`, server-only.
- `lead_seat_priority(lead_id)` returning `school_fee`, `total_paid`, `priority` (`seat_priority`: Deposit, First instalment, Full, or null) and `reached_on`: the Seat priority reader for #108, #111 and #118. Granted to no API role; call it from security definer functions.
- `effective_school_fee_payments(lead_id)`: a lead's payments as they count now. Payments count as recorded until #108 replaces it with `create or replace`, keeping its columns, to apply adjustments and drop voids. Every Total paid reads through it.
- `seat_check(lead_id)` (#111), for signed-in staff with `leads.view`, wrapped by `seatCheck` in `lib/services/seats.ts`: whether a lead holding no seat yet (Declined, or no Seat priority) would take one in a full class, with the class's ranking and the lead marked `this_lead` (the priority and ranking only for `payments.view`). Read-only; #103's approval step shows it. `year_seats(year)` (`getSeats`, `payments.view`) is the per-class seat count slice 10's dashboard reads.

When a ticket you build on has not merged, code against the signature its body gives. Use `create or replace` only where a ticket says to.

## Checks while you work

Follow the tiers in `AGENTS.md`. While building, run only what your change touches:

```bash
npm run lint
npm run typecheck
npx vitest run --project unit --changed origin/main
npx vitest run --project integration --changed origin/main   # under the lock
npx playwright test --only-changed=origin/main               # under the lock
```

On `AuthRetryableFetchError` under load, rerun the failed files before treating the failure as real.

## Housekeeping

- Name scratch files with your ticket number first (`67-pr-body.md`), since agents share a scratchpad.
- Claim a ticket with a comment before you start: `Claimed by claude on claude/<task>`.
- Stop after the PR is open, CI is green, code review is done and the changelog entry is under `## Unreleased`. Report the PR URL, your worktree path, and any checks the ticket says a human must make. The orchestrator runs greploop; nobody but the human merges.
