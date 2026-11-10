# CI time report

Work in progress on branch `claude/ci-time`, pull request #285. This file changes after every measured change.

All times are seconds unless a unit is given. "Not measured" means no number exists. Nothing here is an estimate.

## Result so far

| Event | Runs before | Dates before | Median before | p90 before | Runs after | Median after | p90 after | Ratio |
|---|---|---|---|---|---|---|---|---|
| `pull_request`, full suite | 24 | 2026-11-08 to 2026-11-10 | 1305 | 1696 | 3, change 8 | 309 | 327 | 4.2 |
| `pull_request`, all 30 runs | 30 | 2026-11-08 to 2026-11-10 | 1277 | 1539 | not measured | not measured | not measured | not measured |
| `push` to main, full suite | 28 | 2026-11-06 to 2026-11-10 | 1123.5 | 1541 | not measured | not measured | not measured | not measured |
| `push` to main, all 30 runs | 30 | 2026-11-06 to 2026-11-10 | 1120 | 1535 | not measured | not measured | not measured | not measured |
| `merge_group` | 0 | none | not measured | not measured | 0 | not measured | not measured | not measured |

The repository has no merge queue, so GitHub has never sent a `merge_group` event. Pushes to main can only be measured after the merge. The "after" row is the newest measured change and moves as the work goes on.

## Method

`scripts/ci-measure.mjs` reads the GitHub API through `gh`. It starts nothing and changes nothing.

- **Sample.** The last 30 successful runs of `.github/workflows/ci.yml` for one event. A commit under test is measured by re-running its run, and each successful attempt counts as one run.
- **Run time.** From the run's `run_started_at` to the `completed_at` of its last job.
- **Queue time.** The part of the run time when no job was running. The run was waiting for GitHub to create a job or for a runner to pick one up.
- **Runner time.** The sum of every job's own duration. Sharding raises it while it lowers run time.
- **Median.** The middle value, or the mean of the two middle values.
- **p90.** Nearest rank: the smallest value with at least 90% of the sample at or below it.
- **Re-run rate.** Of every run that finished as success or failure since the oldest sampled run, the share that needed a second attempt. Cancelled runs are left out. For a commit of this branch the rate means nothing, because I re-ran each run on purpose to get three measurements.
- **Full suite and documents only.** A run whose changes are all allowlisted Markdown skips the runtime jobs. The tables keep the two kinds apart, because a 25-second documents-only run says nothing about the test suite.

Step and job times have one-second resolution, because that is what the API returns.

### Commands

```bash
# Baseline: the last 30 successful runs of each event.
node scripts/ci-measure.mjs fetch --event pull_request --limit 30 --out docs/ci/data/baseline-pull_request.json
node scripts/ci-measure.mjs fetch --event push --branch main --limit 30 --out docs/ci/data/baseline-push-main.json
node scripts/ci-measure.mjs fetch --event merge_group --limit 30 --out docs/ci/data/baseline-merge_group.json

# One commit of the pull request, every successful attempt of its run.
node scripts/ci-measure.mjs fetch --event pull_request --sha <commit> --attempts all --out docs/ci/data/<name>.json

# Tables from saved data. Add --json for every number.
node scripts/ci-measure.mjs summary docs/ci/data/baseline-pull_request.json

# Failed and flaky tests of the last 100 finished runs, from the job logs.
node scripts/ci-flaky.mjs --limit 100 --out docs/ci/data/flaky-baseline.json
```

`ci-measure.mjs` wraps these `gh` calls:

```bash
gh api -X GET "repos/{owner}/{repo}/actions/workflows/ci.yml/runs" -f event=pull_request -f status=success -f per_page=100
gh api -X GET "repos/{owner}/{repo}/actions/runs/<run id>/attempts/<n>"
gh api -X GET "repos/{owner}/{repo}/actions/runs/<run id>/attempts/<n>/jobs" -f per_page=100
gh api -X GET "repos/{owner}/{repo}/actions/workflows/ci.yml/runs" -f event=pull_request -f status=completed -f "created=>=<oldest sample>" -f per_page=100
```

To measure a commit three times, wait for its run to finish, then run `gh run rerun <run id>` and wait again, twice.

## Baseline

Fetched 2026-11-10 from commit `516a0a5` of main. Raw data is in `docs/ci/data/baseline-*.json`.

### Pull requests

| Runs | n | First | Last | Run median | Run p90 | Min | Max | Queue median | Queue p90 | Runner median |
|---|---|---|---|---|---|---|---|---|---|---|
| All | 30 | 2026-11-08 | 2026-11-10 | 1277 | 1539 | 24 | 1759 | 9 | 33 | 1391 |
| Full suite | 24 | 2026-11-08 | 2026-11-10 | 1305 | 1696 | 1011 | 1759 | 9 | 34 | 1445.5 |
| Documents only | 6 | 2026-11-08 | 2026-11-09 | 24.5 | 30 | 24 | 30 | 6 | 7 | 18.5 |

Re-run rate: 3 of 40 finished runs needed a second attempt, 7.5%. Of those 40 runs, 10 failed. Another 14 runs were cancelled by a newer commit.

### Pushes to main

| Runs | n | First | Last | Run median | Run p90 | Min | Max | Queue median | Queue p90 | Runner median |
|---|---|---|---|---|---|---|---|---|---|---|
| All | 30 | 2026-11-06 | 2026-11-10 | 1120 | 1535 | 18 | 1746 | 9 | 10 | 1244 |
| Full suite | 28 | 2026-11-06 | 2026-11-10 | 1123.5 | 1541 | 863 | 1746 | 9 | 10 | 1266.5 |
| Documents only | 2 | 2026-11-08 | 2026-11-09 | 20.5 | 23 | 18 | 23 | 5.5 | 6 | 15 |

Re-run rate: 0 of 31 finished runs, 0%. One run failed. Two runs were cancelled, see "What the baseline shows".

### Merge queue

No runs. Not measured.

### Where the time goes

Full-suite pull request runs, n = 24. Steps under 3 s at p90 are left out.

| Job or step | Median | p90 | Min | Max |
|---|---|---|---|---|
| **Scope and document checks** | 10 | 12 | 8 | 13 |
| **Lint, typecheck and unit tests** | 151 | 166 | 95 | 171 |
| `npm ci` | 53.5 | 57 | 13 | 58 |
| `npm run lint` | 16.5 | 18 | 12 | 20 |
| `npm run typecheck` | 13 | 14 | 8 | 15 |
| `npm run test` | 58 | 71 | 36 | 77 |
| **Integration, build and browser tests** | 1280 | 1659 | 987 | 1707 |
| `npm ci` | 54 | 56 | 12 | 57 |
| Start local Supabase | 70 | 76 | 61 | 79 |
| `npm run test:integration` | 185 | 196 | 143 | 201 |
| `npm run build` | 26 | 28 | 18 | 28 |
| Install Chromium | 17 | 22 | 14 | 29 |
| `npm run test:e2e` | 897.5 | 1288 | 697 | 1316 |
| **CI complete** | 6 | 7 | 5 | 9 |

### What the baseline shows

- The browser tests are 70% of a pull request run, 897.5 of 1280 seconds in the slowest job. Everything in that job runs in one line, one step after the other.
- The browser tests grow with the product. On main the step took 505 s on 2026-11-06 and 1026 s on 2026-11-10. The run of 2026-11-10 had 388 tests on 2 workers.
- Two pushes to main lost their run. Runs `42461775959` (commit `5ef6212`) and `42462546390` (commit `bf7195d`) were cancelled on 2026-11-08 when the next merge arrived, because `cancel-in-progress` applied to main as well. The next run tested their code together with its own, but a run that tests one merge alone never finished for either.
- The runner pool is not uniform. The same `npm ci` takes 13 s on one run and 56 s on the next, with the same cache hit. Three runs cannot separate a 5% change from this noise, so small changes are judged on step times as well as on run time.

## Changes

Each change is one commit, measured on pull request #285 by three successful runs of that commit. "Before" is the change measured before it, so both numbers come from the same code and the same day.

| # | Method | Commit | Change | Runs | Run median before | Run median after | Decrease | Kept |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `d025fc3` | Cancel superseded runs on pull requests only, never on main | 3 | 1305 (baseline) | 1282 | none expected | yes, for safety |
| 2 | 2 | `9a63aa2` | Integration tests and browser tests in separate jobs | 3 | 1282 | 1052 | 230 | yes |
| 3 | 4 | `9f6b1cc` | `node_modules` from a cache that only main saves | 3 warm | 1052 | 1082 | none in run time, 47 to 65 per job in the install step | yes |
| 4 | 5 | removed | Install only Chromium's headless shell | 3 | Install Chromium step 21 | 19 | none | no |
| 5 | 6 | `65824e6` | Browser tests as four shards of equal measured time | 3 | 1082 | 568 | 514 | yes |
| 6 | 5 | `c2677f6` | Install Chromium without `apt-get`'s font packages | 3 | 568 | 406 | 162 | yes |
| 7 | 2 | `fb568ec` | Build the app and install Chromium while Supabase starts | 3 | 406 | 387 | 19 | yes |
| 8 | 6 | `5cf47d2` | Browser tests as six shards | 3 | 387 | 309 | 78 | yes |
| 9 | 6 | removed | Integration tests as two shards, without a retry | 3 | 309 | 306 | 3, inside the noise | no |
| 10 | 2 | `32a5184` | The scope job only classifies the change | 3 | 309 | 332, with change 11 | none in run time, 3 in the scope job | yes |
| 11 | 2 | removed | Pull two Supabase images beside the first ones | 3 | 309 | 332, with change 10 | none | no |
| 12 | 7 | `862665e` | Sign in once per worker in browser tests that only need a session | 5 | 309 | 303 | 6 in run time, 41.5 in each shard's test step | yes |
| 13 | 8 and 6 | `dae0684`, `5d42654`, `e66b0ae` | Retry an integration test that fails from load, then two integration shards, with the browser shards' seconds measured again | 5 | 303 | 262 | 41 | yes |

Notes on each change:

1. **Cancel on pull requests only.** Method 1 was already in place. This commit only stops main from cancelling its own runs, so it is not a speed change. Its three runs are the control for everything after it: the unchanged pipeline at 388 browser tests. Data: `change-01-cancel-pr-only.json`, runs 1245, 1282 and 1496.
2. **Separate jobs.** The slowest job went from 1249 to 1024. Runner time went from 1365 to 1574, because Supabase now starts twice. Data: `change-02-split-jobs.json`, runs 1046, 1052 and 1181. The same push carried `09ec42c` (reserve the Supabase ports) and the flaky-test scan, neither of which changes a step that takes a second.
3. **`node_modules` cache.** The run median did not go down. The browser test step alone took 903 to 979 in these runs against 849 to 933 before, which is runner noise larger than the change. The step the change touches did go down in every job: `setup-node` with its npm cache plus `npm ci` took 53 (browser), 66 (integration) and 71 (static) at the median before, and restoring `node_modules` takes 5 to 6. Against the control runs, where `npm ci` happened to be fast, it is 17 to 6. The cold run, with no cache, installed in 41 s (integration job of attempt 1). That attempt failed at Start local Supabase, so there is no cold run time yet. Data: `change-04-node-modules-cache.json`, runs 1065, 1082 and 1154.
4. **Headless shell only.** The Install Chromium step took 12, 19 and 29, against a median of 17 in the baseline and 21 in change 2. No decrease, so the commit is gone from the branch. It was measured in the same runs as change 3, on commit `5130785`.
5. **Four shards.** The browser test step went from 909 in one job to a median of 232.5 per shard, 196 to 257 over 12 shard jobs. Runner time went from 1481 to 2119. The slowest shard job took 540 at the median and the fastest 377: the tests are balanced, but Install Chromium took 13 to 191 across the shards, and the slowest shard sets the run time. Data: `change-06-four-shards.json`, runs 501, 568 and 591. The same push carried `0ec9b50` (the rename test's locator) and `a3c16f1` (try the Supabase start again), which change no step time.
6. **Chromium without `apt-get`.** `playwright install --with-deps` ran `apt-get update` and installed nine font packages for Japanese, Thai, Chinese and Cyrillic text. In one shard the mirror served them at 275 kB/s, and the step took 148 s. The step went from a median of 58 (13 to 191) to 8 (7 to 9). Every shared library Chromium needs was already on the runner image, and all 388 tests passed in each of the three runs without the fonts. Data: `change-07-chromium-without-apt.json`, runs 393, 406 and 421.
7. **Setup at the same time.** Starting Supabase, writing `.env.local`, building and installing Chromium took 77.5 + 2 + 26.5 + 8 = 114 one after the other. As one step it takes 93 (84 to 118). The build needs the `NEXT_PUBLIC_` values before Supabase is up, so `scripts/ci-build-env.mjs` writes local Supabase's fixed address and publishable key first and fails the job if the running stack reports other values. Data: `change-08-parallel-setup.json`, runs 380, 387 and 399.
8. **Six shards.** The test step went from 236.5 per shard to 151.5 (134 to 171 over 18 shard jobs). Runner time went from 1703 to 1936. The integration job, at 269, is now the slowest job. The same push carried the nightly run, this report, and the shards' seconds measured from the four-shard run's own reports. Data: `change-09-six-shards.json`, runs 299, 309 and 327. Two more attempts failed on the placement test described under "Flaky tests".
9. **Two integration shards, without a retry.** The integration jobs took 186 and 178 where the single job took 269, but the run did not get shorter, because the browser shards take as long. Two of five attempts failed: `tests/integration/leads-search.test.ts` ("pages 50 at a time") and `tests/integration/interview-release-status.test.ts` both got "unavailable" after about 10 s, in the same seconds, both times. Both create and lock leads, and Vitest's split put them in one shard. The commit is gone from the branch. Data: `change-10-integration-shards.json`, runs 299, 306 and 330.
10. **Scope job.** The helper tests and the document checks moved to a job of their own, so the job that every runtime job waits for went from a median of 11 to 8. Measured in the same runs as change 11. Data: `change-11-scope-and-early-pull.json`, runs 299, 332 and 345.
11. **Early image pull.** The Supabase CLI pulls the realtime and storage images only after the database is up (3.3 s and 10.9 s in one shard). Pulling them in the background from the start did not help: Start local Supabase took 80 in the integration job against 71 before, and the browser shards' setup step took up to 147 against 104. The commit is gone from the branch.
12. **Sign in once per worker.** Nearly every browser test began by signing in through the form: the page, Cloudflare's security check and the password check, about 390 times a run. `signInOnce` in `e2e/log-in.ts` signs in on the page the first time a worker needs an account and keeps the session cookies. A later test puts them into its own fresh browser and opens `/login`, which sends a signed-in browser home. Only helpers that sign in as setup and then expect the staff home changed, one line each in 58 files. The specs about signing in itself keep the form: `login`, `auth-captcha`, `sign-in-notices`, `staff-invites`, `staff-shell`, `super-admin` and both password-reset specs. No test is removed and no assertion changed. The test step went from 156.5 per shard to 115 (97 to 150 over 30 shard jobs), the tests' summed time from 1707 to 1391, and runner time from 1936 to 1729. All five attempts passed. The run barely moved, because the integration job, at 278, is now the slowest job. Data: `change-12-sign-in-once.json`, runs 279, 291, 303, 313 and 320.
13. **Integration retry and two integration shards.** Three commits went up together, and their effects show in different jobs. In CI, Vitest now tries a test again, up to two times, when it fails with "unavailable" or `AuthRetryableFetchError`, the two load errors seen here. Any other failure fails at once. With that in place the integration tests run as two shards again: 183 and 172 where the single job took 278. The browser shards' seconds were measured again after change 12, which had left them at 192 to 275: the slowest shard job went from 248 to 237. Runner time went from 1729 to 1837. Data: `change-13-integration-retry-and-shards.json`, runs 262, 262, 262, 274 and 300. One more attempt failed on a search test, see "Flaky tests". The retry was needed once in the six attempts: in attempt 4 the two colliding tests failed again, and `interview-release-status` passed on its first retry and `leads-search` on its second, which is the last one it gets. That run took 274.

## Status of each method

Filled in as the work goes on.

## Tests that now run only after the merge

None. Every pull request run and every push to main runs every test.

## Flaky tests

`scripts/ci-flaky.mjs` scanned the 77 finished runs from 2026-11-07 to 2026-11-10 (`docs/ci/data/flaky-baseline.json`). "Flaky" is Playwright's word for a test that failed and then passed on its retry in the same job.

| Test | Flaky | Failed after the retry | What happens |
|---|---|---|---|
| `e2e/marketing-agents.spec.ts` › the Manager confirms a Pending agent's name and code, approves them, and the Pending count drops | 16 | 0 | The test waits for the sidebar's Pending count to equal the database's. Another test that registers an agent in the same seconds makes them differ, and the page does not redraw. Not changed: a fix alters what the test asserts, which is the owner's call. |
| `e2e/turnstile-placement.spec.ts` › on a phone (390px) › a check that needs a click sits above Send on the Admission review step, in `en` and in `sw` | 3 | 3 attempts on this branch | The test read the title's, the check's and Send's positions one after the other while the page was still scrolling the question into place, so Send's reading came a frame later and a few pixels higher (805.64 where under 798.97 was expected, twice). With six shards it failed both tries in 2 of 5 attempts of run `42844460009`. Fixed in `b571cda`: one reading gives all three positions, and the assertions are the same. |
| `e2e/turnstile-placement.spec.ts`, four other tests | 0 | 1 each | Three in run `42648081424` on `claude/272-273-turnstile-followups`, the branch that was changing that screen, and one in run `42656397158` on `claude/apply-ux-concepts`. Work in progress or flaky, the logs do not say. |
| `e2e/agent-students.spec.ts` › the agent sees a card per student | 0 | 1 | Run `42773356261` on `claude/discounts-promo-import-export`. Same doubt. |
| `e2e/follow-up-needs-date.spec.ts` › the seeded reopened lead shows as Needs a follow-up date | 0 | 1 | Run `42672467539`, second attempt, on the same branch. Same doubt. |
| `e2e/staff-roles.spec.ts` › a role is renamed, retired, then reactivated | 0 | 3 of 6 attempts of run `42804913691` | New with change 2. After Save name the closing dialog's title, "Rename <new name>", also matched the heading locator. Fixed in `0ec9b50` by matching the heading exactly. |
| `e2e/record-visit.spec.ts` › a visit someone else recorded first is refused | 1 | 0 | Not analysed. |
| `e2e/admission-form-draft.spec.ts` › Forward to a question the answers no longer allow stays put | 1 | 0 | Not analysed. |
| Start local Supabase (a step, not a test) | | 4 runs | "failed to bind host port ...: address already in use" on port 55422 or 55424. See below. |

The Vitest failures in the scan were real failures of work in progress, not flaky tests: 37 tests of `tests/unit/apply-page.test.tsx` in one run, and three files in single runs.

### The Supabase port failure

Supabase binds host ports 55420 to 55429, which lie inside the range Linux gives to outgoing connections (32768 to 60999). Four runs failed there: `42460099117`, `42472165346`, `42791844494` and `42821412717`. The last one failed after the ports were reserved with `ip_local_reserved_ports`, so a connection opened before the reservation still held the port. The reservation now comes first in the job, and `scripts/ci-db-start.sh` starts Supabase again, up to three times, when the log says "address already in use". It prints the socket that holds the port, so the next occurrence names its owner.
