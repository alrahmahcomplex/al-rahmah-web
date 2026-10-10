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

- **Lead screen.** A new panel is a file in `app/staff/leads/[id]/` plus one line in `LEAD_PANELS` (`panels.tsx`). Nothing else in `page.tsx`. A closed lead shows no panel unless it sets `readOnlyWhenClosed: true`, and such a panel offers no work action while its `open` prop is false. The exceptions are slice 8's own workflow on closed leads: the closure panel's Mark inactive and Archive follow the lead's mark, since a closure mark is a change a closed lead still takes, and the Reopening requests panel offers Withdraw to the requester of a Pending request and Approve and Reject to approvers, since a request exists only for a closed lead. Slice 9's School fee panel also keeps Adjust on each payment for staff with `payments.record`, since a payment adjustment corrects history rather than continuing work (`CONTEXT.md`); Record payment still waits for a reopening.
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
- `enrol_from_academic_year_start(as_of date)` returning how many leads it enrolled (#109): recomputes, through `recompute_lead_fee` with the cause `academic_year_start`, every First instalment lead not yet Enrolled in every year whose start is on or before `as_of`. The caller names the audit actor. `set_academic_year` calls it when a start of today or earlier is set, and the pg_cron job `enrol-on-academic-year-start` (21:05 UTC, just after midnight in Tanzania) calls it through `enrol_on_academic_year_start_daily()` as `system`. A test that calls either does so in a rolled-back transaction, since the sweep reaches every year, the seeded 2027 included.
- `reopening_requests`, with at most one `pending` row per lead (a partial unique index). `raise_reopening_request(lead_id, reason, source)` and `withdraw_reopening_request(request_id)` write it; `lead_reopening_requests(lead_id)` reads a lead's requests with names. Slice 7 reads approvals from the table. `approve_reopening_request(request_id, enrol_without_retake)` and `reject_reopening_request(request_id, reason)` (#101, `reopenings.approve`) decide one: approval restores a Declined lead to its status before decline (Interviewed in place of Enrolled), clears any closure mark, sets `leads.initially_declined`, and records `lead_was_declined`, `restored_status` and the retake choice on the request. It calls nothing in slice 9; #115's trigger recomputes Enrolled as the status leaves Declined. The `re_application` source exists for slice 3 to link to.
- `re_applications` and `record_re_application(lead_id, submission_key, submitted jsonb)` (#76), secret key only, returning the re-application's id; `submitted` holds `contact` and `student` in create_lead's shapes. Review (#77) sets `reviewed_at` and `reviewed_by` together through a function of its own.
- `OFFICE_PHONE` in `lib/office.ts`, server-only.
- `lead_seat_priority(lead_id)` returning `school_fee`, `total_paid`, `priority` (`seat_priority`: Deposit, First instalment, Full, or null) and `reached_on`: the Seat priority reader for #108, #111 and #118. Granted to no API role; call it from security definer functions.
- `effective_school_fee_payments(lead_id)`: a lead's payments as they count now: each with its newest payment adjustment applied, and voided payments left out (#110). Every Total paid reads through it.
- `adjust_school_fee_payment(payment_id, reason, voided, payment_type, amount, paid_on, note, request_id)` (#110, `payments.record`), wrapped by `adjustPayment` in `lib/services/payment-adjustments.ts`. It never calls `assert_lead_open`, recomputes the lead with the cause `payment_adjustment`, and writes a `seat_priority_changed` history entry when the Seat priority moves. The type rules for `fee_waived` and `pre_form_one_fee` already hold, in the function and in a trigger on `payment_adjustments`, so #112 and #114 only add the recording side.
- `discount_requests` (#112), at most one `pending` row per lead and one `granted` row per lead and kind (partial unique indexes). `request_discount(lead_id, kind, note, request_id)` (`leads.edit`) and `decide_discount(request_id, decision, reason)` (`discounts.approve`; a grant needs an open lead and recomputes it with the cause `discount`), wrapped in `lib/services/discounts.ts`. `lead_discount(lead_id)` returns the one discount the School fee carries, the largest granted, with its percentage; #113 adds Sibling there with `create or replace`. `lead_fee_amounts` takes it off the band fee, so every School fee reader follows. `check_school_fee_payment` accepts `fee_waived` with no amount, once, while a Qualified orphan discount is granted; #114 adds `pre_form_one_fee` there.
- The Sibling discount (#113): `lead_discount` now also returns `sibling` (10%) when `sibling_discount_applies(lead_id)`: a confirmed Family (the guardian contact has no pending match) and another Enrolled lead on the contact (for a lead not yet Enrolled), the prior-sibling tick, or `sibling_kept`. `set_prior_sibling(lead_id, sibling_name, sibling_class)` (`leads.edit`), wrapped by `setPriorSibling` in `lib/services/sibling-discount.ts`. Triggers recompute the Family's not-yet-Enrolled leads (`recompute_family`) when a status enters or leaves Enrolled (cause `sibling`) or a lead changes guardian contact (`family`), and every lead on a contact whose pending match changes (`family`).
- The Pre-Form One programme (#114): `set_pre_form_one(lead_id, ticked)` (`leads.edit`, ticking only on a FORM 1 lead), wrapped by `setPreFormOne` in `lib/services/pre-form-one.ts`. `lead_pre_form_one(lead_id)` returns the tick, whether it applies (ticked on a FORM 1 lead), the fee for the lead's Day or boarding and the effective Pre-Form One fee paid; it is granted to no API role. `check_school_fee_payment` takes `pre_form_one_fee` only while the tick applies, and `lead_school_fee` returns the programme's fee, paid and balance.
- **Lock order for anything that recomputes a lead's fee.** Take, in this order and never the other way: (1) `hashtext('enrol_from_academic_year_start')` when enrolling from or changing the Academic-year start; (2) the Family locks, `lock_lead_family(lead_id)` or `lock_families(contact_ids)` (two-key transaction advisory locks, several always through `lock_families`, which sorts them); (3) lead rows. `recompute_lead_fee` takes the Family lock itself, but a function that locks a lead row and then recomputes must call `lock_lead_family` before its row lock, as recording and adjusting payments, deciding discounts, the prior-sibling tick and settling a Family match do. Lead corrections, declining and reopening approval still lock the row first; a payment in the same Family at that moment can deadlock, and Postgres then rolls one back.
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
