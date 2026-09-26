# Agent workflow: al-rahmah-web

One Next.js app for Al-Rahmah Complex: School Landing Page, Admissions Portal, Referral Tracking System. Claude Code and Codex work here in parallel with the same skills. Skills are named bare: `/name` in Claude Code, `$name` in Codex.

## Route by size

| Work | Chain |
|---|---|
| Tweak (copy, styling) | Isolate → edit → Prove → Ship |
| Bug | Isolate → `diagnosing-bugs` → `tdd` → Prove → Ship |
| Feature | Align → Plan → Isolate → Build → Prove → Ship |
| Epic (more than one session holds) | `wayfinder`, then the Feature chain per ticket |

## Beats

0. **Align**: `grill-with-docs`; add `prototype` for unsettled UI. **Stop**: the human confirms shared understanding before Plan.
1. **Plan**: `to-spec` → `to-tickets`, labelled `ready-for-agent`. Claude Code runs Align and Plan.
2. **Isolate**: `new-feature`. Every task gets its own worktree. Claude Code: harness worktree, branch `claude/<task>`. Codex: `.worktrees/<task>` (gitignored), branch `codex/<task>`. Claim the ticket first with a comment `Claimed by <claude|codex> on <branch>`; skip tickets that already carry a claim.
3. **Build**: `implement` → `tdd`, to the invariants below.
4. **Prove**: `evidence-driven-testing`. Capture *before* while reproducing, *after* once it works.
5. **Ship**: `code-review` → cross-review (the human starts the other agent on `code-review` for the PR) → `before-and-after` (production vs PR preview) → PR → `greploop` (`greploop-apps` over the file limit) until **5/5, zero unresolved**. End by presenting the PR URL. **Stop**: merge is the human's.
6. **Release**: once the human approves the merge, merge, tag and changelog it. See *Releasing*.

End an unfinished session with `handoff`.

## What this repo holds

The repo is complete on its own: everything it needs is committed, and it holds only permanent project material (code, `CONTEXT.md`, `docs/adr/`, `docs/agents/`, agent instructions). Transient working files never reach `main`. They use the default location of the skill that makes them: `handoff` writes to the OS temp directory, and `research` and `prototype` findings go on their own throwaway branches.

## Stack and invariants

Next.js App Router (TypeScript), Tailwind v4, shadcn (`base-nova`), Supabase (database, storage, auth), Vercel, npm.

1. `code-structure`: Server Actions and route handlers orchestrate; `lib/services/*` owns Supabase and SDK calls and returns `{ ok, data } | { ok: false, error }`.
2. Every table has RLS, with its policies in the migration that creates it.
3. The Supabase service-role key lives on the server only, never in `NEXT_PUBLIC_*`.
4. Add shadcn components with its CLI into `components/ui/`.
5. `proxy.ts` runs only on the routes that read the staff session (`/staff`, `/login`, `/auth`), so public pages stay up when Supabase is down or misconfigured. A new route joins its matcher only if it needs the session.

## Data and evidence

- Schema changes are files in `supabase/migrations/`, tested against local Supabase. Hosted databases change only through the Supabase GitHub integration on merge; agents hold no hosted database credentials.
- Every checkout has its own local Supabase, so a `db reset` never touches another agent's data. `npm run db:start` gives the main checkout slot 0 and a worktree one of three slots, with its own ports and only the containers the app uses. It writes the checkout's `.env.local`, including `E2E_PORT`, and prints the dev-server port. `npm run db:reset` re-mirrors the branch's migrations before resetting. `npm run db:status` shows who holds each slot. Run `npm run db:stop` when your session ends. If every slot is taken, wait or ask the human; never stop another worktree's stack. `npm run db:start -- --full` adds Studio and the rest when you need them.
- Real family and student records stay out of git and out of evidence. Screens, recordings and tests use the seeded fixture data and the seeded test account.
- Upload images with `IMAGE_ADAPTER=gist`. Post videos through the PR comment box in the signed-in browser.

### Hosted setup

The hosted Supabase project is `al-rahmah-web`, linked to this repo. The human owns every change below; an agent asks for it and says why.

- **Migrations** reach the hosted database when their PR merges to `main`, through the Supabase GitHub integration. The human confirms the version under Database → Migrations.
- **Vercel** needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both Production and Preview. Next.js bakes `NEXT_PUBLIC_*` values in at build, so a changed value takes effect only after a redeploy. A Preview without them serves 500 on `/staff`, `/login` and `/auth`, and `before-and-after` then captures error pages.
- **The first staff member**: the `enforce_staff_allowlist` trigger refuses any auth user whose email is missing from `allowed_admin_emails`, so the order is fixed. First insert the lowercase email into `allowed_admin_emails` (SQL editor), then create or invite the user under Authentication → Users. Later staff follow the same two steps; RLS also lets a signed-in staff member insert allowlist rows, but no screen does that yet.

## Checks

`npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build`. Run all of them before opening a PR and again after rebasing.

`build` and `test:e2e` wait for a build lock that every checkout shares, so one Next.js build runs on the machine at a time. Give them room to wait, with a long timeout or a background run: a build killed mid-run leaves its lock behind. When a run reports a lock left behind, delete the folder it names once no build or e2e run is going on in any checkout; if you can't tell, ask the human.

## Multi-agent rules

- Work on your own task branch; `main` changes only by merged PR.
- Leave other agents' worktrees, branches and uncommitted work untouched.
- Before starting, scope-check open PRs (`gh pr list`, `gh pr diff <n> --name-only`). On overlap, stop and ask.
- Force-push only with `--force-with-lease`, only on your own branch.
- Regenerate lockfiles on conflict (`npm install`).
- Confirm a dev-server port answers *your* process before trusting it. Use the port `npm run db:start` printed for your checkout.
- If a conflict can't be resolved confidently, stop and report.

## Completing a task

1. Keep changes to the assigned task.
2. Run the checks.
3. Assemble before/after pairs from the evidence captured along the way.
4. Commit, rebase onto `origin/main`, rerun the checks. Add the changelog entry under `## Unreleased` (see *Releasing*).
5. `git push -u origin <branch>` (`--force-with-lease` after rebasing a pushed branch).
6. Open the PR: what changed, how it was tested (every claim backed by evidence), before/after proof, risks and follow-ups. Run the title and body through `unslop`.
7. `greploop` to 5/5 with zero unresolved comments.
8. Present the PR URL. Keep the worktree until the PR merges or closes.

## Releasing

Every merge to `main` is a release: it carries a SemVer tag and a `CHANGELOG.md` entry. A merge without both is unfinished work. Parallel PRs would all claim the same version, so a PR carries its entry under an `## Unreleased` heading at the top of `CHANGELOG.md`, and the version is settled only when the PR is about to merge. On a rebase conflict in `## Unreleased`, keep every entry.

1. Once the human approves the merge, rebase onto `origin/main` and pick the version from the latest tag. `v1.0.0` is reserved for the complete app, with the School Landing Page, Admissions Portal and Referral Tracking System all implemented, so stay in `0.x` until then. Before 1.0, a new capability bumps the minor (`v0.2.0`) and a correction to shipped behaviour bumps the patch (`v0.1.1`). After 1.0, ordinary SemVer: breaking change major, capability minor, fix patch.
2. Turn this PR's `## Unreleased` entry into a date heading carrying the version (newest at the top), commit, push, and rerun the checks. The entry has only the sections that have content: `NEW` for what a person can now do, `IMPROVED` for what already existed and got better, `FIXED` for what was broken. Write each line for someone using the app, in the plain voice the existing entries use, not as a commit subject. `unslop` applies.
3. Merge the PR with a message that says what the change does.
4. Tag the merge commit on `main`, annotated, message `<version>: <one line>`, then `git push origin <version>`.
5. Give the human the tag and the release entry alongside the merged PR URL.

## Writing for humans

Run `unslop` over text a person will read (commits, PR title and body, docs, comments, the closing reply), only on text you wrote or changed.

## Agent skills

### Issue tracker

GitHub Issues via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
