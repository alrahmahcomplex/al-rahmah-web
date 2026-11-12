# Releasing

The human's instruction to "merge" authorizes this procedure through housekeeping. Preparing a PR does not authorize merging it. CI and reviews must cover the final revision according to [Workflow](workflow.md).

## Decide whether this changes the app

App releases change deployed behavior, appearance, schema, runtime dependencies or deployment configuration. They carry a SemVer tag and an entry in [CHANGELOG.md](../../CHANGELOG.md). A correction to shipped behavior or appearance is a patch; a new capability is a minor before 1.0. After 1.0, breaking changes are major, new capabilities minor and fixes patch. `v1.0.0` is reserved for the completed School Landing Page, Admissions Portal and Referral Tracking System.

Internal maintenance limited to documentation, tests, agent workflows, CI or developer tools does not need an app version or changelog entry when deployed app behavior is unchanged. State `Release: none (internal maintenance)` in the PR. This is independent of risk: a release-script or agent-permission change still needs sensitive review. Mixed PRs that change the app follow the app release path.

## Prepare an app release

Before opening an app PR, add its user-facing entry under `## Unreleased` at the top of CHANGELOG.md. On rebase conflicts, preserve every entry. Use only sections with content: `NEW` for a new capability, `IMPROVED` for an existing capability made better, and `FIXED` for broken behavior. Write for someone using the app and apply `unslop`.

When the human authorizes merge:

1. Fetch `origin` and tags, then rebase the task branch onto `origin/main`. Inspect incoming changes and apply the relevant rebase checks from Workflow. For migrations, follow the timestamp ordering rule in [Parallel work](parallel-work.md) and rerun affected migration/integration tests if any version changes.
2. Choose the version bump and the release date in the human's timezone. Run the helper, replacing the example date with the actual release date:

   ```bash
   node scripts/release.mjs prepare --bump patch --date 2026-11-03
   ```

   It derives the version from stable tags reachable from `origin/main` and turns the top Unreleased entry into the existing dated heading format. It preserves old releases and refuses inherited Unreleased notes instead of assigning someone else's entry to this release. Resolve that ownership explicitly before proceeding. For an approved complete-app milestone only, use `--bump major --complete-app` to reach 1.0.0. The helper edits the changelog; the agent remains responsible for reviewing its wording and scope.
3. Commit the prepared entry and push the branch. Wait for CI on that exact final revision and resolve any outstanding review findings. A release-only follow-up commit does not require repeating unchanged local app tests. If a rebase or code fix changes behavior, verify the affected paths again. If another app release merges after preparation, restore only this PR's prepared heading to Unreleased, rebase while preserving the newer release, and rerun preparation to choose the next version.

For internal maintenance, skip the app entry and version preparation. Fetch, rebase, verify affected changes, push and wait for final CI in the same way.

## Merge and tag

1. Verify the PR's head SHA, applicable green CI and completed review. Merge the authorized PR with a message describing the change, matching the inspected head so a concurrent push cannot slip into the merge. Obtain the actual merge commit SHA from GitHub; do not assume a local branch tip is the merge commit.
2. Fetch `origin/main`. For an app release, create the annotated local tag on that merge commit:

   ```bash
   node scripts/release.mjs tag --commit <full-merge-commit-sha>
   git push origin <version>
   ```

   The helper reads the committed release entry, verifies that the commit is on fetched `origin/main`, and rejects conflicting tags. Repeating the same completed tagging operation is safe. It does not merge, fetch or push. An app merge without its published tag is unfinished; complete or report the failure before starting another app release.
3. For internal maintenance, skip tagging. A successful maintenance merge is complete once applicable migration checks and housekeeping are done.
4. Check the production deployment with `gh api repos/alrahmahcomplex/al-rahmah-web/commits/<merge-sha>/status`. A `Vercel` status of `success` means the merge is live. While it is `pending`, or before it appears, check again every few minutes; if it hasn't finished after 30 minutes, report production as unconfirmed. A `failure` reading "Deployment rate limited" means the day's 100 deployments are spent ([Hosted services](hosted-services.md#deployment-limit-and-previews)): say so in the release report, and don't retry it or push to `main` to force it. The next production deployment that succeeds carries the merge. Any other failure is a broken production build; report it to the human.

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
