# Workflow

Use the risk tier in [AGENTS.md](../../AGENTS.md) throughout the task. Planning, verification, evidence and review have different purposes; choose each by what the change needs. A sensitive one-line RLS fix needs authorization tests and focused review, but not a design workshop if the intended behavior is already agreed.

## Planning and building

For editorial work, the requested edit is the plan. For routine work, record a few observable acceptance criteria in the task or PR. Reuse established design decisions. Neither requires a brief, ticket breakdown or a planning approval gate. The exception is a UI or UX change, which first goes through [UI and UX changes](#ui-and-ux-changes).

For sensitive work, identify the invariants, failure cases and recovery approach in the task or PR before editing. Agent-policy changes require examples showing how the rule applies to ordinary and sensitive tasks. Ask about unresolved authority or product decisions; proceed when the human has already settled them.

For architectural work, follow the design sequence below. An epic may use `wayfinder` to split work into independently verifiable tasks. Child tickets inherit approved decisions; they do not repeat the architecture review unless their scope changes those decisions.

1. **Align:** use `grill-with-docs`, adding a [UI and UX prototype](#ui-and-ux-changes) for unsettled UI. Record the problem, scope, constraints, alternatives and decisions in `align_brief.md`. The human confirms the brief and readiness for review.
2. **Goldfish review:** read `egm-brainstorm` and its harness integration guide. Follow only Goldfish Review & Synthesis, with `Mode: BRAINSTORM` and the alignment brief as the hypothesis. Run six independent lenses: necessity/complexity, cost/quotas, usability, migration/compatibility, observability and maintenance. Each starts fresh with the brief and selected references. The main agent retains discussion context and resolves findings with the human. `grill-with-docs` owns further questions; skip EGM's questioning and handoff stages. Record resolutions and accepted risks in the alignment brief and regenerated `concepts_brief.md`. Rerun review when clarification changes the hypothesis. All lenses must report, and the human approves the revised concepts brief before planning.
3. **Plan:** Claude Code uses `to-spec` then `to-tickets` on the approved concepts brief, marking actionable tickets `ready-for-agent`.

Keep EGM files under `.artifacts/egm/<feature>/`. Pass that path as `EGM artifact directory`.

Use `diagnosing-bugs` when diagnosing a defect and `tdd` for meaningful behavior regressions or new logic. Use `implement` when following an implementation ticket. These skills follow the selected tier. A reversible copy edit does not need a test that repeats its text. New logic needs tests that would fail for a plausible wrong implementation.

## UI and UX changes

A UI or UX change gets a prototype, and nothing else, until the owner explicitly approves building it. The owner set this rule; it holds over the autonomy and auto-merge rules and over any skill that would build the UI directly.

1. **Prototype:** make an interactive HTML prototype the owner can click through, covering every screen and state the change touches, with fixture data only. Claude Code publishes it with the Artifact tool. Codex, or any agent without that tool, writes one self-contained HTML file to the OS temp folder, outside the repo and off every branch, and gives the owner its absolute path. Neither uses the `prototype` skill's UI branch, which builds an app route on a branch.
2. **Stop:** give the owner the link or path and wait. Write no app code, make no commits and open no PR for the change. A sub-agent returns the link to its parent, which passes it on. A parent passes approval down by quoting the owner's words; without that quote, a sub-agent stops here.
3. **Build on approval:** build only after the owner explicitly approves building, such as "build it" or "build concept C". Silence, praise for one part, a ticket marked `ready-for-agent`, and the general autonomy and auto-merge rules are not approval. A requested change means a new prototype version, then wait again. Build only what the approved prototype shows; a new UI decision it did not show goes back to step 1, even inside an approved ticket.

This covers anything a person sees or uses: layout, styling, flows, forms, messages and copy. Copy changes are covered even when the owner supplied the exact words. It does not cover backend-only work or bug fixes with no visible change.

One exception: a live bug that blocks parents may be fixed before any prototype when the fix only puts the screen back to the look and behaviour it had before the bug. Ship it through the normal workflow, then tell the owner what changed. If the fix needs anything new on screen, prototype it first.

## Checks

Read the available commands from `package.json`. Run affected checks locally and report their actual results; CI provides the full application suite. Once relevant checks pass, repeat or broaden them only after changes, failures or unresolved concerns justify it. Documentation-only work uses Git and Node for document checks; it does not require installing application dependencies or starting Supabase.

| Change | Local checks | CI |
|---|---|---|
| Prose or documentation | Diff, accuracy, affected links and document checks | Document checks for the documented path allowlist |
| Agent instructions, security policy or operational documentation | Document checks plus independent consistency/authority review and representative scenarios | Document checks; a Markdown filename does not waive policy review |
| Application code | Lint, typecheck and affected unit tests; integration/browser checks where the behavior needs them | Full application suite |
| Database schema or permissions | Local Supabase migration and relevant integration tests, including denial paths; affected app checks | Full application suite |
| CI, dependencies, configuration or internal executable tools | Tests for the changed mechanism and applicable static checks | Full application suite |

For local application checks, use an explicit comparison base, such as `origin/main`:

```bash
npm run lint
npm run typecheck
npx vitest run --project unit --changed origin/main
npx vitest run --project integration --project integration-serial --changed origin/main
npx playwright test --only-changed=origin/main
```

Changed-file selection is a starting point: SQL, permissions, configuration and indirect dependencies may require explicitly named tests even when automatic selection finds none. Local browser tests build the app when needed; avoid a duplicate standalone build for the same unchanged inputs.

CI is not a test loop. Before every push, run the test files you added or changed and see them pass locally: `npx vitest run <file>` for a unit or integration file, `npx playwright test <spec>` for a browser spec, one file at a time under the shared lock, never the whole suite. A PR's own new or changed tests failing was the largest cause of red PR runs on 11 and 12 November (about 10 of 26). If a file cannot run on this machine, say so in the PR instead of pushing to find out.

Before opening a PR, complete the local checks relevant to the changed behavior. A full local suite is not a universal prerequisite. CI must pass on the PR's final head before merge.

The CI workflow always runs its scope job, its helper and document checks, and the final `CI complete` gate. Its link checks cover all tracked, allowlisted documents, so deleting or renaming a guide also checks incoming links. On a pull request, only allowlisted Markdown files can skip runtime jobs; unknown paths, mixed changes, dependencies, configuration and workflows receive the full suite. A push to main always runs the full suite, documents-only merges included. Policy documents take the document path because runtime tests do not check their meaning; their review tier still applies. Missing or invalid comparison data must require the full suite. The gate checks upstream outcomes, including failures, cancellations and unexpected skips. If configuring required checks, require `CI complete`; the workflow itself must remain unfiltered by file paths.

The full suite runs as parallel jobs:

- **Browser shards.** `e2e/shards.json` holds the number of shards and each spec file's measured seconds, and `scripts/e2e-shards.mjs` gives every spec file on disk to exactly one shard. A new spec file needs no entry. After each green run on main, the `Browser shard seconds` workflow saves that run's seconds to the Actions cache; pull requests and main plan their shards from the newest entry, and the nightly run from the committed file. CI fails if Playwright lists a test no shard holds, if a shard ran anything but its own files, or if a browser test was skipped: `test.skip` and `test.fixme` fail the shard. To change the number of shards, change `shards` in that file and the `browser` matrix in the workflow together; a test keeps them equal.
- **Sign-in in browser tests.** A test that signs in only to reach a screen uses `signInOnce` from `e2e/log-in.ts`, which signs in on the page once per worker and reuses the session. A test about signing in itself uses `logIn`.
- **What a browser test checks.** What the screen does: what staff or a parent can reach, do and read. Not how it looks. No pixel sizes or positions, no "fits the screen", no colours or fonts, no animation timings. Screenshots attached to the PR prove the look ([Evidence](#evidence)). When a look check sits inside a test of behaviour, write the behaviour and leave the look check out.
- **Axe scans.** A test tagged `@nightly` runs only in the nightly run and in a run started by hand, where `E2E_NIGHTLY` is set. Every axe scan carries the tag, so a pull request never waits on one.
- **Retries.** In CI, Playwright retries a failed test once, and Vitest retries an integration test up to two times when it fails with `unavailable` or `AuthRetryableFetchError`. Any other integration failure fails at once.
- **Caches.** Only the `caches` job, on a push to main, saves to the Actions cache. Every other job restores. A nightly run repeats the full suite with no cache restored.
- **Migration-day tests that lock tables.** A test that replays a migration and, to do it, locks or alters whole tables stays out of the suite: a block that takes `lock table`, an `alter table` to stage old data, a backfill run again. It holds the busiest tables while the tests beside it run, and they deadlock. Run it on the branch, put its output in the PR as evidence, and delete it before merge. A test that runs part of a migration again without locking or altering a table may stay. So do tests of what the migration leaves behind: the rule, the permission, the shape of the data.
- **No whole-table locks in integration tests.** Four test files run at once against one database, so no test takes `lock table`, runs `alter table` or holds a table to keep a count still. A test that compares counts reads them in one snapshot (`inOneSnapshot` in `tests/support/db.ts`), or reads the database's answer before and after the service's (`whileUnchanged`). A test that truncates or writes rows other tests use goes through `withoutLockWaits`. To switch a trigger off, use `set local session_replication_role = replica`. A test that changes something the whole database shares, such as the Sibling kill switch, goes in `tests/integration/serial/`, which runs alone after the other files. `tests/unit/integration-table-locks.test.ts` fails when a parallel file has `lock table`, `alter table`, a truncate outside `withoutLockWaits`, or the kill switch.

[The CI report](../ci/REPORT.md) has the measurements and the commands, and [the manual](../ci/MANUAL.md) the monthly check that says when to change any of this.

## Evidence

Choose evidence that demonstrates the acceptance criteria:

- **Appearance:** inspect relevant viewport sizes and attach screenshots. Use `before-and-after` for a production/Preview pair when comparison makes the change assessable. Agent branches get no Preview, so compare against a local build, or ask the lead for one ([Hosted services → Deployment limit and Previews](hosted-services.md#deployment-limit-and-previews)); a focused screenshot can be enough for a small styling change.
- **Interaction:** exercise the changed user journey, including relevant failure paths. Use `evidence-driven-testing` when a recording explains a sequence better than test results or screenshots. UI work still requires hands-on inspection.
- **Bug:** capture the failing behavior or regression test before fixing it, then the passing result. Existing reliable reproduction evidence may serve as the before state.
- **Data or permissions:** provide migration/integration results and negative authorization checks, using fixtures.
- **Documentation or workflow policy:** show the diff, checked links and scenario outcomes. Browser recordings and production comparisons are unnecessary unless the change affects a UI.

Evidence need not be duplicated across local runs and Preview. Record which environment and revision each artifact proves. Use [Hosted services](hosted-services.md) when checking a hosted page.

### Attaching evidence to a PR

Screenshots, recordings and report files (such as Lighthouse HTML and JSON) go into the PR through GitHub's own uploader, which stores them as `https://github.com/user-attachments/...` links:

1. In the signed-in in-app browser, open the PR and give the files to its comment box's file input (`#fc-new_comment_field`), at most 20 per upload.
2. Wait until every `Uploading …` placeholder has become a link. Put those links in the PR description, then empty the comment box and check that no comment was posted.
3. If uploads start failing, GitHub's upload rate limit (HTTP 429) is the usual cause. Wait for it to reset and carry on. A file GitHub refuses for its size is trimmed, re-encoded (a video with `ffmpeg`, for example) or split; a file type it refuses is zipped.

This is the only way to attach evidence. Never push it to a branch (no `evidence/*` branches and no screenshots committed to any branch), never use a gist or `IMAGE_ADAPTER=gist`, never link files as `blob/...?raw=true`, and never use a third-party file host. `before-and-after` and `evidence-driven-testing` are for capturing only: skip their upload steps (`upload-and-copy.sh` with any adapter, 0x0.st included) and attach their files as above. Vercel builds every pushed branch outside `claude/**` and `codex/**`, so each push to an evidence branch also spends one of the day's deployments, fails a Preview build and emails the owner.

If the in-app browser is not signed in to GitHub, or no in-app browser is available, ask the human to sign in or open one (`AskUserQuestion` in Claude Code), wait until they say it is done, then upload. A sub-agent that cannot ask the human reports the missing sign-in to its parent as a blocker. Do not switch to another way of hosting the files while you wait.

## Review and acceptance

Editorial work needs the author's diff/accuracy check. Every other tier needs one independent review of the final substantive change, using `code-review` or an equivalent repository-aware reviewer. The reviewer is a fresh agent, different from the one that built or fixed the change, at high reasoning effort; the implementing agent's own reread is not independent. By default the reviewer's model comes from a different provider than the implementer's, so one provider's model reviews the other's work. The lead or the owner picks the reviewer's model when they brief the thread; the task agent picks a fallback (below). The task agent arranges the review without making the human relay routine requests.

**Fallback reviewer.** When the default reviewer can't run (no connection, the service is down, or its usage limit is reached), the review doesn't wait for it. The task agent picks a fallback itself, without waiting for the lead: a model from a provider other than the implementer's if one is reachable, otherwise one from the implementer's own provider. A fallback from the implementer's provider always reviews as an adversarial critic: it assumes the change is wrong until the diff, the tests and the repository show otherwise, gives no benefit of the doubt, looks for what the implementer would have missed, and checks each claim in the PR against the diff. State the reviewer used and the reason in the PR body. The fallback's READY counts like the default's. Later rounds may stay with the fallback or return to the default; either way the Rounds rules below apply, including asking for a stronger reviewer. If no fallback can run either, stop and report to the lead, or the owner if there is no lead: the PR does not merge without READY.

Sensitive work focuses that review on the affected trust boundary, data rule, workflow authority or release behavior. Add another specialist only for an uncovered concern. Architectural work also includes the approved design review; it does not automatically multiply implementation reviews.

**Rounds.** Fix the verified findings and send the new head for review again until the reviewer says READY. Ask the lead, or the owner if there is no lead, for a stronger reviewer when NOT READY keeps coming back round after round, or when the implementer was moved to a stronger model. Stop and report to the lead, or the owner if there is no lead, instead of widening the PR when a round brings a finding outside the PR's scope or the same kind of finding comes back. File the outside finding as a ticket; the lead or the owner then decides whether the PR merges with that ticket open. Recheck only the changed areas when the fixes leave the rest of the reviewed scope alone.

Resolve verified blocking defects and unmet acceptance criteria. Record accepted non-blocking tradeoffs with reasons. A known correctness or security defect cannot be dismissed solely to finish quickly. Ask the human to accept material unresolved risk; do not invent acceptance on their behalf. Style preferences remain non-blocking.

**Greptile.** A Routine, Sensitive or Architectural PR that changes anything besides allowlisted Markdown needs Greptile at 5/5 with no unresolved comment on its final head. A PR of allowlisted Markdown only (the CI document path) does not wait for Greptile. Judge its findings by the same criteria: fix them, or answer one you judge wrong with the reason. If it stays below 5/5 on findings you judged wrong, or cannot run, report to the lead or the owner, who decides whether it merges. A failing CI check is always a blocker.

## Complete the task

1. Confirm scope and acceptance criteria, finish applicable local checks, and assemble only relevant evidence. Classify whether this is an app release under [Releasing](releasing.md); add a changelog file in `changes/` only for an app release.
2. Inspect the diff, apply `unslop` to changed prose and commit. Fetch, and rebase onto `origin/main` only under [Behind main](#behind-main).
3. Push your branch, using `--force-with-lease` only when rebasing your own pushed branch. Open the PR with its tier/reason, behavior changed, actual verification results, relevant evidence, release classification and risks.
4. Complete the independent review where required and resolve findings. Wait for the final head's applicable CI to pass. When fixes change the head, update evidence and review only the affected scope.
5. Present the PR URL, any material limitations and the worktree path. Keep the worktree until the PR merges or closes. Then merge under [Releasing → When to merge](releasing.md#when-to-merge), or wait for the owner when it does not hold.

### Behind main

A PR behind `origin/main` is rebased only when main's new commits interact with it: shared services, migrations, seeds, configuration, or files the PR also changes. Otherwise leave it; the push to main tests every merge, and changelog files never conflict. After a rebase, read the incoming changes and rerun the checks they affect, broader ones for incoming migrations, seeds, shared services or configuration, and wait for CI on the new head. A PR adding a migration is behind on a migration whenever main has one newer than the PR's: rebase and renumber it under [Parallel work → Migration order](parallel-work.md#migration-order) before merge. Resolve only conflicts you understand.

## Policy examples

Use these cases when changing this workflow; they are checks of the rules, not reasons to run the application:

| Example | Expected result |
|---|---|
| Correct a README typo | Editorial; document checks; no independent review, browser evidence or app version |
| Change which actions an agent can authorize | Sensitive; policy scenarios and independent review; no runtime tests for Markdown alone; no app version |
| Change one button's spacing | Prototype first and stop. After the owner says to build it: Routine; relevant static checks, hands-on visual inspection and one review; full CI; app release |
| Replace a label with words the owner supplied | Prototype first and stop, even for copy only |
| Restore a broken Submit button that blocks parents to how it was before the bug | Fix through the normal workflow without a prototype, then tell the owner |
| Build an approved concept that needs a screen the prototype did not show | Build the approved parts; prototype the new screen and stop |
| Speed up a query behind an unchanged screen | Not a UI change; no prototype |
| Fix a one-line RLS predicate | Sensitive; migration, allow/deny tests and focused review; full CI; app release |
| Change CI filtering or a release script | Sensitive; routing/release regression tests and focused review; full CI; internal maintenance unless deployed app behavior changes |
| Finish a docs-only change to agent rules | Sensitive; independent review READY and green CI, then merge without the owner; no Greptile wait; no app version |
| Finish an app PR whose migration is older than one main got since | Rebase, renumber the migration, rerun its tests; then review READY, Greptile 5/5 and green CI on the new head, and merge |
| The default reviewer hits its usage limit or can't be reached | Pick a fallback reviewer now, from another provider if one is reachable; one from the implementer's provider reviews as an adversarial critic; state the reviewer and the reason in the PR body. If none can run, stop and report |
| Review finds a new kind of issue each round, all inside the PR | Fix and re-review until READY; when NOT READY keeps coming back, ask the lead for a stronger reviewer |
| A review round finds a defect outside the PR, or the same kind of finding again | Stop; file the outside finding and report to the lead, who decides whether the PR merges with the ticket open |
| Add an unresolved cross-system admissions workflow | Architectural; approved design sequence, system verification and app release |
