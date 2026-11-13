# CI time report

Branch `claude/ci-time`, pull request #285, measured on 2026-11-10 and merged that day as commit `ff7e8fd` of main. Commit hashes in this file are of that branch unless the text says main.

All times are seconds unless a unit is given. "Not measured" means no number exists. Nothing here is an estimate.

## Result

| Event | Runs before | Dates before | Median before | p90 before | Runs after | Date after | Median after | p90 after | Ratio, median | Ratio, p90 |
|---|---|---|---|---|---|---|---|---|---|---|
| `pull_request`, full suite, warm cache | 24 | 2026-11-08 to 2026-11-10 | 1305 | 1696 | 10 | 2026-11-10 | 236 | 246 | 5.5 | 6.9 |
| `pull_request`, full suite, cold cache | 24 | 2026-11-08 to 2026-11-10 | 1305 | 1696 | 3 | 2026-11-10 | 297 | 300 | 4.4 | 5.7 |
| `pull_request`, documents only | 6 | 2026-11-08 to 2026-11-09 | 24.5 | 30 | not measured | | not measured | not measured | not measured | not measured |
| `push` to main, full suite, warm cache | 28 | 2026-11-06 to 2026-11-10 | 1123.5 | 1541 | 10 | 2026-11-10 | 234.5 | 240 | 4.8 | 6.4 |
| `push` to main, full suite, cold cache | 28 | 2026-11-06 to 2026-11-10 | 1123.5 | 1541 | 1 | 2026-11-10 | 301 | not measured | 3.7 | not measured |
| `merge_group` | 0 | none | not measured | not measured | 0 | | not measured | not measured | not measured | not measured |

- The repository has no merge queue, so GitHub has never sent a `merge_group` event.
- Main's numbers are the eleven attempts of the merge's own run. The first attempt found no cache and saved one. One run has no p90. "Main after the merge" below has the details.
- No documents-only pull request ran on this branch, so that path has no "after" number. It now runs three jobs where it ran two: the helper tests moved to a job of their own.
- The baseline's runs restored npm's download cache, apart from the first run after a lockfile change, so the warm row is the like-for-like one.

## Final numbers

Warm cache: 10 successful runs of commit `c2000ee`, run `42872902972`. Cold cache: 3 successful runs of commit `7411e32`, run `42882655848`, where no cache matched the new key and every job installed its dependencies from the registry. Data: `data/final-warm.json` and `data/final-cold.json`.

| | Runs | Median | p90 | Min | Max | Queue median | Queue p90 | Runner median |
|---|---|---|---|---|---|---|---|---|
| Baseline, pull request, full suite | 24 | 1305 | 1696 | 1011 | 1759 | 9 | 34 | 1445.5 |
| Final, warm cache | 10 | 236 | 246 | 227 | 259 | 9 | 11 | 2050.5 |
| Final, cold cache | 3 | 297 | 300 | 282 | 300 | 11 | 12 | 2653 |

The ten warm runs took 227, 235, 235, 236, 236, 236, 239, 239, 246 and 259. The three cold runs took 282, 297 and 300.

Where a warm run's 236 goes, at the median:

| Job | Median | What is in it |
|---|---|---|
| Scope | 7 | Every runtime job waits for it. |
| Browser shard, the slowest of eight | 206 | Setup 92 (Supabase, build and Chromium at once), tests 92.5, `node_modules` 5. |
| Integration shard, the slower of two | 186 | Supabase 71.5, tests 96.5. |
| Lint, typecheck and unit tests | 111.5 | Lint 18.5, typecheck 13, unit tests 64. |
| Repository helpers and documents | 9.5 | Beside the scope job. |
| CI complete | 7 | After the last test job. |

The warm runs measured `c2000ee`. The commits after it add two things, and only the second touches the time of a pull request run:

- The review fixes: `package.json` in the cache key, a skipped browser test fails its shard, every push to main runs the full suite.
- A 400 ms wait at the end of a unit test file that rendered the guided form (`bb7b1fb`, narrowed to those files in `b2810f3`). When every file still waited, the unit step took 67 in the cold runs against 64 in the warm ones. It is in the job that takes 111.5, not in the slowest one.

The commits after `7411e32` are not in either measurement. They add the `caches` job to the gate's list and change the two measuring scripts and the unit test setup. None adds a step to a pull request run.

Re-run rate after: not measured. Every run of this branch, and the merge's run on main, was re-run on purpose to measure it. The baseline's 7.5% for pull requests and 0% for main are the numbers to compare against after a month of normal use.

### Main after the merge

Pull request #285 merged on 2026-11-10 at 20:04 UTC as commit `ff7e8fd` of main. Its push run, `42891666899`, was re-run until it had eleven attempts. All eleven passed. Data: `data/after-push-main.json`.

| | Runs | Median | p90 | Min | Max | Queue median | Queue p90 | Runner median |
|---|---|---|---|---|---|---|---|---|
| Baseline, push to main, full suite | 28 | 1123.5 | 1541 | 863 | 1746 | 9 | 10 | 1266.5 |
| Main, warm cache | 10 | 234.5 | 240 | 225 | 240 | 8 | 10 | 2041.5 |
| Main, cold cache | 1 | 301 | not measured | 301 | 301 | 6 | not measured | 2761 |

The ten warm runs took 225, 225, 230, 233, 233, 236, 237, 240, 240 and 240.

- **The cold run** is the first attempt. No cache held the key, so the twelve jobs that need `node_modules` installed from the registry, in 50 to 70 each. The `caches` job installed in 54, saved `node_modules` in 5 and took 64 in all.
- **The warm runs** restored that cache in 4 at the median, 3 to 7 over 110 jobs. The `caches` job found the cache in place and took 7.
- **Jobs at the median, warm:** the browser shards 179.5 to 203 by shard (setup 91, tests 91), the integration shards 171.5 and 177 (Supabase 72, tests 88.5), lint, typecheck and unit tests 116 (unit tests 69), scope 6.5 and the gate 6.5. The slowest job of a run was a browser shard every time, 210 at the median.
- **Queue time** stayed at 8 at the median and 10 at the most with thirteen jobs. No other CI run overlapped these, so they do not answer the question under change 14.
- **Retries.** `node scripts/ci-flaky.mjs --limit 1 --out docs/ci/data/flaky-after-main.json` read every job log of the eleven attempts. Three browser tests passed only on their retry, once each. No test failed after its retry, and no integration test needed Vitest's retry. "Flaky tests" has the three.

**The run with no cache.** The nightly run was due at 01:17 UTC on 2026-11-11. At 03:21 UTC GitHub had started no scheduled run, and why is not known. So I started the same path by hand at 03:14 UTC: run `42951457909`, a `workflow_dispatch` run of `ff7e8fd`. Every job skipped the restore step and installed from the registry in 39 to 69. The `caches` job was skipped, and the gate passed. The run took 292. Data: `data/after-manual-main.json`. Check after a week that scheduled runs exist: `gh run list --workflow ci.yml --event schedule`.

Still open: the re-run rate and queue time in normal use, and a documents-only pull request. After 30 pushes or a month:

```bash
node scripts/ci-measure.mjs fetch --event push --branch main --limit 30 --out docs/ci/data/monthly-push-main.json
node scripts/ci-measure.mjs fetch --event pull_request --limit 30 --out docs/ci/data/monthly-pull_request.json
node scripts/ci-measure.mjs summary docs/ci/data/monthly-push-main.json docs/ci/data/monthly-pull_request.json
node scripts/ci-flaky.mjs --limit 100 --out docs/ci/data/flaky-monthly.json
```

The shards' seconds stay fresh without anyone doing it (#388). After each green run on main, the `Browser shard seconds` workflow saves that run's seconds to the Actions cache, and the next pull request and main runs plan from them. The seconds committed in `e2e/shards.json` are the fallback and what the nightly run uses. To refresh the committed seconds by hand, download the reports of a run on main and let the script rewrite the file:

```bash
gh run download <run id of a push to main> -p "e2e-results-*" -D /tmp/e2e-results
node scripts/e2e-shards.mjs timings /tmp/e2e-results/*/e2e-results.json
node scripts/e2e-shards.mjs plan
```

## Method

`scripts/ci-measure.mjs` reads the GitHub API through `gh`. It starts nothing and changes nothing.

- **Sample.** The last 30 successful runs of `.github/workflows/ci.yml` for one event. A commit under test is measured by re-running its run, and each successful attempt counts as one run.
- **Run time.** From the run's `run_started_at` to the `completed_at` of its last job.
- **Queue time.** The part of the run time when no job was running. The run was waiting for GitHub to create a job or for a runner to pick one up.
- **Runner time.** The sum of every job's own duration. Sharding raises it while it lowers run time.
- **Median.** The middle value, or the mean of the two middle values.
- **p90.** Nearest rank: the smallest value with at least 90% of the sample at or below it.
- **Re-run rate.** Of every run that finished as success or failure since the oldest sampled run, the share that needed a second attempt. Cancelled runs are left out. For a commit of this branch the rate means nothing, because I re-ran each run on purpose to get three or more measurements.
- **Full suite and documents only.** A pull request whose changes are all allowlisted Markdown skips the runtime jobs. In the baseline a push to main did so too. The tables keep the two kinds apart, because a 25-second documents-only run says nothing about the test suite.

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

# The changed files of the last 60 merged pull requests, for method 10.
gh pr list --state merged --base main --limit 60 --json number,mergedAt,files \
  --jq '[.[] | {number, mergedAt, files: [.files[].path]}]' > docs/ci/data/merged-pr-files.json
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

Each change is one commit, measured on pull request #285 by three or five successful runs of that commit. "Before" is the change measured before it, so both numbers come from the same code and the same day. Where two changes went up in one push, they touch different jobs or steps, and each is judged on its own.

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
| 14 | 6 | `bde05b6` | Browser tests as eight shards | 5 | 262 | 247 | 15 | yes |

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
11. **Early image pull.** The Supabase CLI pulls the realtime and storage images only after the database is up (3.3 s and 10.9 s in one shard of run `42831286387`). Pulling them in the background from the start did not help: Start local Supabase took 80 in the integration job against 71 before, and the browser shards' setup step took up to 147 against 104. The commit is gone from the branch.
12. **Sign in once per worker.** Nearly every browser test began by signing in through the form: the page, Cloudflare's security check and the password check, about 390 times a run. `signInOnce` in `e2e/log-in.ts` signs in on the page the first time a worker needs an account and keeps the session cookies. A later test puts them into its own fresh browser and opens `/login`, which sends a signed-in browser home. Only helpers that sign in as setup and then expect the staff home changed, one line each in 58 files. The specs about signing in itself keep the form: `login`, `auth-captcha`, `sign-in-notices`, `staff-invites`, `staff-shell`, `super-admin` and both password-reset specs. No test is removed and no assertion changed. The test step went from 156.5 per shard to 115 (97 to 150 over 30 shard jobs), the tests' summed time from 1707 to 1391, and runner time from 1936 to 1729. All five attempts passed. The run barely moved, because the integration job, at 278, is now the slowest job. Data: `change-12-sign-in-once.json`, runs 279, 291, 303, 313 and 320.
13. **Integration retry and two integration shards.** Three commits went up together, and their effects show in different jobs. In CI, Vitest now tries a test again, up to two times, when it fails with "unavailable" or `AuthRetryableFetchError`, the two load errors seen here. Any other failure fails at once. With that in place the integration tests run as two shards again: 183 and 172 where the single job took 278. The browser shards' seconds were measured again after change 12, which had left them at 192 to 275: the slowest shard job went from 248 to 237. Runner time went from 1729 to 1837. Data: `change-13-integration-retry-and-shards.json`, runs 262, 262, 262, 274 and 300. One more attempt failed on a search test, see "Flaky tests". The retry was needed once in the six attempts: in attempt 4 the two colliding tests failed again, and `interview-release-status` passed on its first retry and `leads-search` on its second, which is the last one it gets. That run took 274.
14. **Eight shards.** The test step went from 118 per shard to 94 (71 to 103 over 40 shard jobs), with 92 of setup before it. Setup is now half of a shard job, so more shards would buy little. Runner time went from 1837 to 2053. All five attempts passed. Data: `change-14-eight-shards.json`, runs 234, 238, 247, 247 and 295. The 295 had a Supabase start of 157 in one integration shard. The same push carried `cc6fc9d`, the search test's fix. One thing these runs cannot show: a run now starts 12 jobs at once, 13 on main, and GitHub runs 20 at a time for this account. Two runs that overlap will queue. In the baseline, 18 of 87 runs started within 250 s of the run before. If queue time grows in the monthly numbers, go back to six shards: set `shards` to 6 in `e2e/shards.json` and the `browser` matrix to match.

## Changes after the merge

Pull request #391, measured on 2026-11-13. "Before" is three warm attempts (2 to 4) of run `43488526078`, the push run of main's commit `8dc42e5`. Its first attempt missed the `node_modules` cache and is left out. "After" is three attempts of one pull request run per commit. A push run has one job more than a pull request run, the `caches` job, which takes 5 to 9 when the cache is in place and runs beside the tests.

Run time moved with how late GitHub started some jobs, which these runs did not control: before, one attempt took 425 with the same jobs as one that took 257. The slowest job is the steadier number, so each change is judged on it.

| # | Method | Commit | Change | Runs | Slowest job, median before | After | Run median before | After | Kept |
|---|---|---|---|---|---|---|---|---|---|
| 15 | 2 | `a7e8115` | Start Supabase in CI without setting up Storage and Realtime | 3 | 218 | 189 | 348 | 233 | yes |
| 16 | 6 | reverted in `d306af5` | Integration tests as three shards | 3 | 189 | 187 | 233 | 221 | no |

15. **Supabase without Storage and Realtime.** `npm run db:start` already left both containers out with `-x`. The CLI still pulled both images and ran their schema migrations while it set up the database, because `supabase/config.toml` has them enabled: "Initialising schema" took 29 s in run `43488526078`. No migration, seed or test uses either, so `scripts/ci-db-start.sh` sets `SUPABASE_REALTIME_ENABLED=false` and `SUPABASE_STORAGE_ENABLED=false`. The CLI reads them over `config.toml`, so local starts in the worktrees stay as they were. "Initialising schema" now takes 0.5 s. Start local Supabase went from 79 (70 to 90 over 6 integration jobs) to 42.5 (41 to 45). The browser shards' setup step, where the start runs beside the build, went from 94 (72 to 102 over 24 jobs) to 60.5 (52 to 70). Runner time went from 2214 to 1820. Mailpit stays, because the invite, password-reset, CAPTCHA and agent-import tests read it. `scripts/ci-workflow.test.mjs` fails when a migration, seed or test starts using Storage or Realtime, and the start script warns if the CLI pulls either image again. Runs: 204, 295 and 233, run `43497018079`. Before: 257, 425 and 348. Data: `change-15-before-main-8dc42e5.json` and `change-15-supabase-without-storage-realtime.json`.
16. **Three integration shards.** After change 15 the slower integration shard was the slowest job in two of three runs, by 3 and 8 s over the slowest browser shard. The other integration shard finished 20 to 31 s sooner in each run. With three shards the slowest integration job went from 180 to 149, but a browser shard was then the slowest job in every run, and the slowest job went from 189 to 187, inside the noise. The fastest run went from 204 to 212, and runner time from 1820 to 1927. The run median fell from 233 to 221 only because one two-shard run had late job starts (295). A third shard would also put a pull request run at 13 jobs against GitHub's 20 for this account. The commit is reverted. Runs: 225, 212 and 221, run `43499343938`. Data: `change-16-integration-three-shards.json`.

Four more changes of 13 November changed what CI runs or how it splits it. Their pull requests measured them as below. None was measured by the method of this table.

| # | Pull request | Change | Measured |
|---|---|---|---|
| 17 | #382 | Browser tests stop checking looks; the 6 axe scans run only nightly (`@nightly`) | 462 browser tests on a pull request before, 414 after, 420 in the nightly run. The eight browser jobs took 1,589 s together in its own run against 1,683 s on main. |
| 18 | #383 | 14 migration-day integration tests that lock or alter whole tables are deleted | Red runs on `deadlock detected`: 8 of 40 before, 0 of 20 after. Test time per run 867 s before, 826 s after, inside the run-to-run spread of about 90 s. |
| 19 | #387 | No whole-table locks in integration tests; the Sibling kill switch tests run alone in a serial project | 0 red in 20 runs, test time per run 820 s. Run time not measured. |
| 20 | #388 | Browser shards plan from main's newest measured seconds, saved to the Actions cache | The plan for run `43479796993` went from 151 to 247 s of test time per shard to 180 to 182 s. Run time after the merge not measured. |

A cache of the Docker images was not tried. After change 15 the CLI pulls five images, all at once, in 13 s (run `43497018079`, integration shard 1). Restoring them from the Actions cache and loading them into Docker would have to beat that, and only the `caches` job could save them. Not measured.

## Status of each method

| # | Method | Status | Reason |
|---|---|---|---|
| 1 | Cancel old runs when there is a new commit | DONE | It was in place before this work. Change 1 keeps it for pull requests and stops it for main, where it had cancelled two merges' runs. |
| 2 | Run independent jobs in parallel | DONE | Changes 2, 7 and 10. Change 11, an early image pull, gave no decrease and is gone. |
| 3 | Shallow checkout or partial clone | NOT APPLICABLE | Every test job already checks out one commit, in 1 to 2 s. The scope job needs the full history for the merge-base, and its diff looks for renames by reading file contents, which a clone without file contents would fetch one at a time. Its checkout takes 2 s at the median in the baseline. |
| 4a | Cache for dependencies | DONE | Change 3. Only the `caches` job, on a push to main, saves it. The key holds `package.json`, the lockfile, `.npmrc`, the Node version and the runner. |
| 4b | Cache for build output | NOT APPLICABLE | Since change 7 the build runs while Supabase starts, and the start is the longer of the two: 77.5 against 26.5 at the median in change 6's runs. A faster build cannot shorten the job. Not measured. |
| 4c | Cache for Docker layers | NOT APPLICABLE | The repository builds no image. The only Docker work is pulling Supabase's seven published images, which took 24.6 s of a 79 s start in one shard of run `42831286387` (10.4 + 3.3 + 10.9). The rest is the database starting and its migrations. Since change 15 two of those images are no longer pulled, and the other five take 13 s at once. A cache of pulled images was not tried. |
| 5 | Faster tools with the same build output | NOT APPLICABLE | Change 4, the headless shell alone, gave no decrease and is gone. The other candidates sit in a job that is not the slowest: lint takes 18.5, typecheck 13 and the unit tests 64 in a job of 111.5, against 186 and 206 for the slowest integration and browser shards. Dependencies install in 5 from the cache, and another package manager is a build-system change. |
| 6 | Shards of equal measured time | DONE | Changes 5, 8, 13 and 14. Change 16, a third integration shard, gave no decrease and is reverted. `scripts/e2e-shards.mjs` plans the browser shards from measured seconds. Vitest splits the integration files itself. |
| 7 | Decrease the time of the slowest tests | DONE | Change 12. No single test was slow: the slowest took 34.7 s of 1735. The repeated sign-in was. |
| 8 | Find flaky tests, retry only the failed tests | DONE | See "Flaky tests". Three tests and the Supabase start are fixed, and the unit tests wait out a stray timer. Playwright already retried a failed test once and still does. Vitest now retries an integration test up to two times for the two load errors only. |
| 9 | Remote build cache | APPROVAL NECESSARY | It needs a build tool that has one, such as Turborepo or Nx, which changes the build system. The gain would be small here for the reason given in 4b: one package, a 26.5 s build that runs beside a longer step. Not measured. |
| 10 | On pull requests, test only what depends on the changed files | NOT APPLICABLE | The documents-only path already exists and stays. Beyond it there is one app and one database, and every browser and integration test depends on both. Of the last 60 merged pull requests, 53 changed app or database code, 3 only documents, 3 only tests and 1 only CI tools (`data/merged-pr-files.json`). A path rule for the 3 would not move the median. |
| 11 | Merge queue | NOT APPLICABLE | GitHub gives merge queues only to repositories owned by an organization, and this one is owned by a personal account. The manual's stage 8 names what stands in for it. The workflow would need `merge_group` as a trigger, which `scripts/ci-scope.mjs` already treats as a full-suite run. |
| 12 | Faster runners | APPROVAL NECESSARY | The repository is public, so it already gets GitHub's 4-CPU standard runner for free. Larger GitHub runners need an organization on a paid plan, and other runner services are new paid or third-party services. Not measured. |
| Added | Install Chromium without `apt-get`'s font packages | DONE | Change 6. Source: Playwright's command line reference, where `--with-deps` is an option of `playwright install`. |
| Added | Start Supabase again when a port is taken | DONE | See "The Supabase port failure". It lowers the re-run rate, not the run time. |
| Added | A nightly run of all tests without caches | DONE | Pull requests with only documents run no runtime test, and every other run now restores a cache. The nightly run and the manual run restore none. The manual run passed on main on 2026-11-11 in 292. GitHub had started no scheduled run by then, see "Main after the merge". |

## Tests that now run only after the merge

None. A pull request runs every test unless it changes only allowlisted Markdown, as before. Every push to main runs every test, since `246c21e` also when the merge changed only documents: before, such a push ran none.

## Flaky tests

`scripts/ci-flaky.mjs` scanned the 77 finished runs from 2026-11-07 to 2026-11-10 (`docs/ci/data/flaky-baseline.json`). "Flaky" is Playwright's word for a test that failed and then passed on its retry in the same job.

| Test | Flaky | Failed after the retry | What happens |
|---|---|---|---|
| `e2e/marketing-agents.spec.ts` › the Manager confirms a Pending agent's name and code, approves them, and the Pending count drops | 16 | 0 | The test waits for the sidebar's Pending count to equal the database's. Another test that registers an agent in the same seconds makes them differ, and the page does not redraw. Not changed: a fix alters what the test asserts, which is the owner's call. On main after the merge it was flaky in 1 of the eleven attempts of run `42891666899`. |
| `e2e/turnstile-placement.spec.ts` › on a phone (390px) › a check that needs a click sits above Send on the Admission review step, in `en` and in `sw` | 3 | 3 attempts on this branch | The test read the title's, the check's and Send's positions one after the other while the page was still scrolling the question into place, so Send's reading came a frame later and a few pixels higher (805.64 where under 798.97 was expected, twice). With six shards it failed both tries in 2 of 5 attempts of run `42844460009`. Fixed in `b571cda`: one reading gives all three positions, and the assertions are the same. |
| `e2e/turnstile-placement.spec.ts`, four other tests | 0 | 1 each | Three in run `42648081424` on `claude/272-273-turnstile-followups`, the branch that was changing that screen, and one in run `42656397158` on `claude/apply-ux-concepts`. Work in progress or flaky, the logs do not say. |
| `e2e/agent-students.spec.ts` › the agent sees a card per student | 0 | 1 | Run `42773356261` on `claude/discounts-promo-import-export`. Same doubt. |
| `e2e/follow-up-needs-date.spec.ts` › the seeded reopened lead shows as Needs a follow-up date | 0 | 1 | Run `42672467539`, second attempt, on the same branch. Same doubt. |
| `e2e/staff-roles.spec.ts` › a role is renamed, retired, then reactivated | 0 | 3 of 6 attempts of run `42804913691` | New with change 2. After Save name the closing dialog's title, "Rename <new name>", also matched the heading locator. Fixed in `0ec9b50` by matching the heading exactly. |
| `e2e/record-visit.spec.ts` › a visit someone else recorded first is refused | 1 | 0 | Not analysed. |
| `e2e/admission-form-draft.spec.ts` › Forward to a question the answers no longer allow stays put | 1 | 0 | Not analysed. |
| The Admission form's next question, in two tests on main: `e2e/turnstile-placement.spec.ts` › on a phone (390px) › a check that needs a click sits above Send on the Admission review step, in `en`, and `e2e/admission-form-draft.spec.ts` › switching language on a later question keeps the form's Back in history | 1 each in the eleven attempts of run `42891666899` | 0 | In both, a helper in `e2e/admission-form.ts` waited 5 s for the next question to open and it did not: line 142 after the student's name, line 109 after a language switch. Both passed on the retry. This is not the position reading that `b571cda` fixed. The job keeps no trace of a test that passes on its retry, so the cause is not known. Not changed. |
| `tests/integration/leads-search.test.ts` › pages 50 at a time, and `tests/integration/interview-release-status.test.ts` › a result never sent | 1 attempt, passed on a retry | 2 attempts, before the retry existed | Both create and lock leads. In the same seconds they fill the connection pool, and each gets "unavailable" after about 10 s. Seen only with two integration shards, where Vitest puts both files in one shard. Vitest now retries these load errors, change 13. The contention itself is not fixed. |
| `tests/integration/leads-search.test.ts` › finds a Declined lead, and a number that matches nothing finds nothing | 0 | 1 attempt of run `42863416438` | It searched for `ADMSN-00000` and expected no lead, but Admission Numbers are random and another test's lead held it. Fixed in `cc6fc9d`: it asks `unusedAdmissionNumber` for a free one. |
| Unit tests, an error with no failed test | | 3 attempts: `42697498569` on main, and attempts 1 and 10 of `42872902972` | "ReferenceError: window is not defined" at `components/guided-form/stack.tsx:196`. A timer the guided form sets fires after the test's browser environment is gone. Every test passes and Vitest still fails the run. It came from `tests/unit/apply-page.test.tsx` once and `tests/unit/discount-code-page.test.tsx` twice, the second time in attempt 10 of the same run. `revealStep` sets a 340 ms timer that nothing cancels. Since `bb7b1fb` a unit test file that rendered a guided step waits 400 ms before its environment goes, and the three runs after it passed. The timer itself is application code and is not changed. |
| Start local Supabase (a step, not a test) | | 4 runs | "failed to bind host port ...: address already in use" on port 55422 or 55424. See below. |

The Vitest failures in the scan were real failures of work in progress, not flaky tests: 37 tests of `tests/unit/apply-page.test.tsx` in one run, and three files in single runs. The one exception is run `42697498569` in the table above.

### The Supabase port failure

Supabase binds host ports 55420 to 55429, which lie inside the range Linux gives to outgoing connections (32768 to 60999). Four runs failed there: `42460099117`, `42472165346`, `42791844494` and `42821412717`. The last one failed after the ports were reserved with `ip_local_reserved_ports`, so a connection opened before the reservation still held the port. The reservation now comes first in the job, and `scripts/ci-db-start.sh` starts Supabase again, up to three times, when the log says "address already in use". It prints the socket that holds the port, so the next occurrence names its owner.

It has not happened again on this branch since, so the retry itself has not run yet.

## Review

A separate agent reviewed commit `c2000ee` against main, read-only, and returned NOT READY with three blocking points. All three are fixed, and its re-check of commits `c2000ee..7411e32` returned READY.

| Finding | Fix |
|---|---|
| The `node_modules` cache key left out `package.json`. A pull request that changed it and not the lockfile would restore main's `node_modules` and skip the `npm ci` that refuses the mismatch. | `36de9b6`: the key holds `package.json` and `.npmrc` too, and a test checks that every job uses the same key. |
| The check after a shard took any result as proof that a test ran, and Playwright gives a skipped test a result. | `2cfde5f`: a skipped browser test fails its shard. None is skipped today. |
| A push to main that changed only allowlisted Markdown ran no runtime test. This is older than the branch. | `246c21e`: every push to main runs the full suite. The documents-only path stays for pull requests. |
| Note: the flaky scan stopped at 100 runs whatever `--limit` said. | `be2da2f`: it reads pages until it has the limit. |

One suggestion was not taken: to compare each shard's tests by name with Playwright's list, not only its files. In one environment the list and the run collect the same tests, and a collected test that did not run has no result, which the check catches. The reviewer agreed for today's suite and added the limit: a test that is defined only under some condition of the environment would escape a comparison by file.

Greptile then reviewed commit `126624b` and scored it 4 of 5 with four findings. All four are fixed:

| Finding | Fix |
|---|---|
| `CI complete` did not wait for the `caches` job, so that job could fail on main while the gate passed. | `db90658`: the gate needs it. It must succeed on a push to main and be skipped for every other event. |
| `ci-measure.mjs --attempts all` lost a run's earlier successful attempts when its newest attempt failed. Every measurement in this report ended on a success, so none was affected. | `40abcc4`: it lists completed runs and keeps each successful attempt. |
| `ci-flaky.mjs` dropped a job whose log could not be read, failed jobs included, without saying so. | `95347cb`: it names those jobs in its output. |
| Every unit test file waited 400 ms, also the ones that never render the guided form. | `b2810f3`: only a file that rendered a guided step waits. |

## Decisions for the owner

- **Sign-in reuse, change 12. Decided on 2026-11-11: the owner keeps it.** It touches 58 spec files in one commit, `862665e`. It took 41.5 s off each shard's test step when there were six shards.
- **Eight shards, change 14.** A run starts 12 jobs at once, 13 on main, against GitHub's 20 for this account. Two runs that overlap will queue. Six shards is `shards` in `e2e/shards.json` and the `browser` matrix.
- **Skipped browser tests fail CI.** This follows the rule that no test is skipped without approval. To allow a skip, change `verifyErrors` in `scripts/e2e-shards.mjs`.
- **Documents-only merges now run the full suite on main.** That run takes about four minutes where it took 20 s. Nothing waits for it.
- **`revealStep`'s timer.** Cancelling it on unmount in `components/guided-form/stack.tsx` is the real fix for the unit-test error. The 400 ms wait in `tests/unit/setup.ts` can go after that.
- **Two integration test files collide.** `leads-search` and `interview-release-status` create and lock leads in the same seconds. The retry gets past it, once on its last try. Since #387 no integration test locks a whole table, `leads-search` included.
- **The Pending count test.** `e2e/marketing-agents.spec.ts` passed only on its retry in 16 of 77 runs. Fixing it changes what it asserts.
- **The Admission form's next question.** On main, two browser tests each waited 5 s once for the next question to open and passed on the retry. The cause is not known.
- **The nightly run.** GitHub had started none by 03:21 UTC on 2026-11-11. If there is still none after a week, the schedule needs a look.
- **Approval needed:** a remote build cache, faster runners. The status table has the reason for each.
