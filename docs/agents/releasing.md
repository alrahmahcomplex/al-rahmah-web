# Releasing

The human's instruction to "merge" authorizes this procedure through housekeeping. Preparing a PR does not authorize merging it. CI and reviews must cover the final revision according to [Workflow](workflow.md).

## Decide whether this changes the app

App releases change deployed behavior, appearance, schema, runtime dependencies or deployment configuration. They carry a SemVer tag and release notes: a GitHub Release from v0.108.0 on, and before that an entry in [CHANGELOG.md](../../CHANGELOG.md). A correction to shipped behavior or appearance is a patch; a new capability is a minor before 1.0. After 1.0, breaking changes are major, new capabilities minor and fixes patch. `v1.0.0` is reserved for the completed School Landing Page, Admissions Portal and Referral Tracking System.

Internal maintenance limited to documentation, tests, agent workflows, CI or developer tools does not need an app version or changelog entry when deployed app behavior is unchanged. State `Release: none (internal maintenance)` in the PR. This is independent of risk: a release-script or agent-permission change still needs sensitive review. Mixed PRs that change the app follow the app release path.

## Prepare an app release

An app PR carries its user-facing entry as a file of its own, `changes/<branch>.md`: the branch name without `claude/` or `codex/`, any other `/` turned into `-`, no folders,, never as an edit to CHANGELOG.md. The file holds `bump: patch` (a correction to shipped behavior or appearance) or `bump: minor` (a new capability) and the entry, in sections with content only: `NEW` for a new capability, `IMPROVED` for an existing capability made better, and `FIXED` for broken behavior. [changes/README.md](../../changes/README.md) has the format, and CI's `node scripts/release-notes.mjs check` refuses a wrong one, or an Unreleased entry in CHANGELOG.md. Write for someone using the app and apply `unslop`.

Before merge:

1. If the PR is behind `origin/main`, decide whether incoming changes interact with it: shared services, migrations, seeds, configuration, or files the PR also changes. If they do, fetch, rebase, apply the relevant rebase checks from Workflow and wait for CI on the rebased revision. For migrations, follow the timestamp ordering rule in [Parallel work](parallel-work.md) and rerun affected migration/integration tests if any version changes. A PR that is behind only on unrelated files needs no rebase; the push to main tests every merge.
2. Wait for CI on the exact final revision and resolve any outstanding review findings.

Internal maintenance adds no changelog file. Otherwise it follows the same steps.

## Merge and tag

1. Verify the PR's head SHA, applicable green CI and completed review. Merge the authorized PR with a message describing the change, matching the inspected head so a concurrent push cannot slip into the merge. Obtain the actual merge commit SHA from GitHub; do not assume a local branch tip is the merge commit.
2. For an app release, the `Release` workflow runs on the merge (`release-notes.mjs release`). It takes every file in `changes/` added since the last tag, picks the next version from the newest tag and the larger bump, and tags the merge commit itself with an annotated tag. It then publishes the files' entries as that version's GitHub Release, dated in Tanzania's timezone. It commits nothing to main, so it starts no CI run and no deployment. Releases run one at a time, and two merges close together may share one release. Check that the run succeeded and the tag exists: `gh run list --workflow release.yml --limit 3`, then `gh release view <version>`. A merge with no release after a failed run is unfinished. Re-run that failed run: on a commit it already tagged, it pushes the same tag and publishes the same release. If you can't, report it.
3. For internal maintenance there is no release run or tag. A successful maintenance merge is complete once applicable migration checks and housekeeping are done.
4. The v1.0.0 complete-app milestone is prepared by hand on its PR, with no file in `changes/`: write an Unreleased entry at the top of CHANGELOG.md, run `node scripts/release.mjs prepare --bump major --complete-app --date <date>` to turn it into the dated heading before pushing, then after merge `node scripts/release.mjs tag --commit <merge-sha>` and `git push origin v1.0.0`.
5. Check the production deployment with `gh api repos/alrahmahcomplex/al-rahmah-web/commits/<merge-sha>/status`. A `Vercel` status of `success` means the merge is live. While it is `pending`, or before it appears, check again every few minutes; if it hasn't finished after 30 minutes, report production as unconfirmed. A `failure` reading "Deployment rate limited" means the day's 100 deployments are spent ([Hosted services](hosted-services.md#deployment-limit-and-previews)): say so in the release report, and don't retry it or push to `main` to force it. The next production deployment that succeeds carries the merge. Any other failure is a broken production build; report it to the human.

## Confirm hosted migrations

If the PR added migrations, confirm each version after merge. Hosted changes arrive through the Supabase GitHub integration only; agents look but do not apply them through a dashboard.

1. Wait for the Supabase integration's check on the merge commit using `gh api repos/alrahmahcomplex/al-rahmah-web/commits/<sha>/check-runs`.
2. In the signed-in in-app browser, open project `al-rahmah-web`, Database > Migrations, and read the list with the browser's page-text tool. Every version added by the PR must be present. Follow [Hosted services](hosted-services.md) if sign-in is needed.
3. Spot-check the new schema under Database > Tables, Functions or Extensions. If a version is missing or the integration failed, report it with a screenshot and hold further migration merges for the human's production decision.

## Housekeep

The main checkout ends on `main`, clean and at `origin/main` after `git pull --ff-only`. Inspect its status first. Never discard its uncommitted changes; stop and report them.

Remove worktrees and local/remote branches whose PRs merged, including earlier completed tasks, only after all four checks pass:

- `gh pr view <branch> --json state,headRefOid` reports a merged PR.
- The local branch tip equals the PR's `headRefOid`, proving every local commit reached GitHub. Squash merges make `git branch --merged` insufficient.
- The worktree's `git status --porcelain` is empty.
- Nothing needed exists only in ignored files. Evidence has been uploaded; `.env.local` can be recreated from `.env.example`.

Keep and report anything that fails a check. On Windows, resolve and verify absolute paths within the intended worktree directory before removal; use Git worktree removal or native PowerShell file operations. Never delete another agent's unfinished work. Finish with `git worktree prune` and `git fetch --prune`, and remove this task's disposable scratch copies outside the repo.

Report the merged PR, app tag and release entry if applicable, whether production deployed, migration versions confirmed or missing, and what housekeeping removed or retained with the reason. For internal maintenance, say that no app version was needed.
