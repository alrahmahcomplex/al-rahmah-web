# Manual: short CI time for a new repository

## Rules

- Do the stages in sequence. Do not start a stage or add a tool before its trigger occurs.
- Measure before and after each change. Use the same method and a minimum of 3 runs.
- Keep a change only if all checks are green and a recorded number decreases.
- Write "not measured" if you cannot measure a number. Do not estimate.
- Run all tests for each merge to the main branch.
- Get the approval of the owner before you remove or skip a test. Get it also before you add a paid service or change a repository setting.
- Read the current documentation of the CI host before you use a feature.

## Numbers

Use the last 30 successful runs of pull requests and of merges.

- **Run time:** the time from the start of a run to the end of its last job. Record the median and the p90.
- **Queue time:** the part of the run time in which no job runs.
- **Re-run rate:** the runs with a second attempt, divided by all completed runs.
- **Step time:** the median time of one step in the slowest job.
- **Setup time:** the time of all steps before the test step.

## Stage 0: setup

1. Make one command for each check and each group of tests.
2. Write each test so that it makes its own data.
3. Make one workflow, with one job for each group of checks.
4. Add a last job that fails if a necessary job did not pass. Make it the only required check.
5. Cancel the old run when a pull request gets a new commit. Do not cancel runs on the main branch.
6. Give the workflow read permission only. Pin each action to a full commit SHA. Set a time limit for each job.
7. Commit the lock file of the dependencies.
8. Let only runs on the main branch write to caches.
9. Make the test tool write the time of each test to a report.
10. Add a script that gets the numbers of the Numbers section. Record the first numbers.

**Check:** A pull request with a failed test cannot merge.

## Stage 1: parallel jobs

**Trigger:** The median pull-request time is more than 5 minutes. One job has two independent steps of more than 60 seconds each.

1. Move each independent step to its own job.
2. Add each new job to the last job.

**Check:** The median run time decreases.

## Stage 2: caches

**Trigger:** The install step is more than 30 seconds, or the build step is more than 2 minutes.

1. Make the cache key from the lock file, the runtime version, and the runner.
2. Restore the cache in each job. Install or build only if the key does not match.
3. Save the cache only in runs on the main branch.
4. Add a nightly run of all tests without caches.

**Check:** The step time decreases in a run with a warm cache.

## Stage 3: shards

**Trigger:** One test step is more than 5 minutes.

1. Get the time of each test file from the report.
2. Divide the test files into shards of equal measured time. Run each shard in its own job.
3. In each run, fail if the shards do not contain all tests of the test tool's list.
4. Add shards until the setup time is more than half of the shard time.

**Check:** The slowest shard is not more than 1.2 times the fastest shard.

## Stage 4: setup time

**Trigger:** The setup time is more than half of the slowest job time.

1. Start independent setup steps at the same time.
2. Remove downloads that the tests do not use.

**Check:** The setup time decreases.

## Stage 5: flaky tests

**Trigger:** The re-run rate is more than 5%. Or one test fails and then passes on the same commit two times in one month.

1. Record the flaky tests in a list.
2. Find the cause and repair it.
3. Retry only the failed tests, a maximum of 2 times.

**Check:** The re-run rate decreases in the next month.

## Stage 6: slow tests

**Trigger:** Stage 3 is complete. The median pull-request time is more than 10 minutes.

1. Find work that many tests do again, for example a sign-in. Do it one time and use the result again.
2. Do not make a test examine less.

**Check:** The total test time decreases. All tests run.

## Stage 7: tests of changed code only

**Trigger:** Stages 1 to 6 are complete. The median pull-request time is more than 10 minutes. The repository has two or more parts with known dependencies.

1. On pull requests, run only the tests that depend on the changed parts.
2. Run all tests if a shared file changes.
3. Run all tests on the main branch and each night.

**Check:** No test that a pull request skipped fails on the main branch.

## Stage 8: merge queue

**Trigger:** In one month, two runs on the main branch fail after pull requests that were green.

1. Get the approval of the owner.
2. Run all tests in the merge queue.

**Check:** The failures on the main branch decrease.

**In this repository:** not possible. Its owner is a GitHub user account, and GitHub gives merge queues only to repositories that an organization owns. What stands in for it: each app PR adds its own changelog file in `changes/`, so two green PRs do not conflict; a PR behind main is rebased only when main's new commits touch what it touches ([Workflow → Behind main](../agents/workflow.md#behind-main)); and every merge runs the full suite on main.

## Stage 9: faster runners

**Trigger:** Stages 1 to 7 are complete. The median pull-request time is more than 10 minutes.

1. Get the approval of the owner.
2. Measure the slowest job on two runner types for one week.

**Check:** The median run time decreases.

## Monthly measurement

1. On the first work day of each month, run the script of stage 0.
2. Record the date and the numbers in a table.
3. Compare the numbers with the triggers of stages 1 to 9.
4. Do only the first stage whose trigger occurs.
5. If the median increases by more than 20% in one month, find the step that increased.
