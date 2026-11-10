# CI time report

Work in progress on branch `claude/ci-time`. This file changes after every measured change.

All times are seconds unless a unit is given. "Not measured" means no number exists. Nothing here is an estimate.

## Result so far

| Event | Runs before | Dates before | Median before | p90 before | Median after | p90 after | Ratio |
|---|---|---|---|---|---|---|---|
| `pull_request`, full suite | 24 | 2026-11-08 to 2026-11-10 | 1305 | 1696 | not measured | not measured | not measured |
| `pull_request`, all 30 runs | 30 | 2026-11-08 to 2026-11-10 | 1277 | 1539 | not measured | not measured | not measured |
| `push` to main, full suite | 28 | 2026-11-06 to 2026-11-10 | 1123.5 | 1541 | not measured | not measured | not measured |
| `push` to main, all 30 runs | 30 | 2026-11-06 to 2026-11-10 | 1120 | 1535 | not measured | not measured | not measured |
| `merge_group` | 0 | none | not measured | not measured | not measured | not measured | not measured |

The repository has no merge queue, so GitHub has never sent a `merge_group` event.

## Method

`scripts/ci-measure.mjs` reads the GitHub API through `gh`. It starts nothing and changes nothing.

- **Sample.** The last 30 successful runs of `.github/workflows/ci.yml` for one event. A commit under test is measured by re-running its run, and each successful attempt counts as one run.
- **Run time.** From the run's `run_started_at` to the `completed_at` of its last job.
- **Queue time.** The part of the run time when no job was running. The run was waiting for GitHub to create a job or for a runner to pick one up.
- **Runner time.** The sum of every job's own duration. Sharding raises it while it lowers run time.
- **Median.** The middle value, or the mean of the two middle values.
- **p90.** Nearest rank: the smallest value with at least 90% of the sample at or below it.
- **Re-run rate.** Of every run that finished as success or failure since the oldest sampled run, the share that needed a second attempt. Cancelled runs are left out.
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
```

The script wraps these `gh` calls:

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
- Two pushes to main lost their run. Runs `42461775959` (commit `5ef6212`) and `42462546390` (commit `bf7195d`) were cancelled on 2026-11-08 when the next merge arrived, because `cancel-in-progress` applies to main as well. The next run tested their code together with its own, but a run that tests one merge alone never finished for either.
- The runner pool is not uniform. The same `npm ci` takes 34 s on one run and 56 s on the next. Three runs cannot separate a 5% change from this noise, so small changes are judged on step times as well as on run time.

## Changes

None measured yet.

## Status of each method

Filled in as the work goes on.

## Tests that now run only after the merge

None. Every pull request run and every push to main runs every test.

## Flaky tests

Not analysed yet.
