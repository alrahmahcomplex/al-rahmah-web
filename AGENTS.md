# Agent workflow: al-rahmah-web

One Next.js app for Al-Rahmah Complex: School Landing Page, Admissions Portal, Referral Tracking System. Claude Code and Codex work here in parallel. Skills use bare names: `/name` in Claude Code, `$name` in Codex.

## Choose the work by risk

State the tier and reason in one sentence, then proceed within the requested scope. Choose by affected behavior, consequences, uncertainty and recovery difficulty. Escalate when discoveries change the risk. A small diff can be sensitive.

| Tier | Applies to | Required approach |
|---|---|---|
| Editorial | Prose, comments or links with no behavior, executable example, policy or permission change | Edit and check the document. No application tests or independent review required. |
| Routine | Bounded UI, bug or feature following established patterns, with easy recovery | Short acceptance criteria, affected checks and one independent review. |
| Sensitive | Auth, RLS, payments, student/family data, migrations, shared contracts, secrets/deployment, CI gates or agent authority | Explicit invariants and failure cases, focused independent review and relevant security/data/policy checks. |
| Architectural | Unsettled design, broad system changes or difficult recovery | Agreed brief and design review before implementation; verify the affected system. |

The tier governs planning, skill use, local checks, evidence, review and completion. The procedures in [Workflow](docs/agents/workflow.md) are authoritative for those stages. Generic skill recipes do not add universal tests, recordings, approval gates or perfect-score loops. Explicit human instructions still take precedence. Runtime CI selection and app release eligibility are separate from the review tier.

## Start and finish

1. **Isolate before editing:** use `new-feature`. Scope-check open PRs with `gh pr list` and `gh pr diff <n> --name-only`; ask on overlapping files. Use your own worktree: Codex `.worktrees/<task>` on `codex/<task>`, Claude's harness worktree on `claude/<task>`. If a ticket exists, claim it with `Claimed by <claude|codex> on <branch>`; skip claimed tickets. A direct human request does not need a new ticket.
2. **Build and verify:** read [Workflow](docs/agents/workflow.md) for the chosen tier. Continue routine implementation and repair without repeated approval. Ask when a product decision or material scope change needs the human.
3. **Complete:** follow Workflow's completion checklist through a reviewed PR with the applicable CI green. Present the PR URL and retain the worktree. Merge remains the human's decision.
4. **On "merge":** follow [Releasing](docs/agents/releasing.md) through merge and housekeeping. App releases also get a changelog entry and tag. Internal maintenance can merge without an app version.

Use `handoff` for an unfinished session, with the tier, current commit, evidence and remaining work.

## Invariants

Next.js App Router with TypeScript, Tailwind v4, shadcn `base-nova`, Supabase, Vercel and npm.

- Server Actions and route handlers orchestrate. `lib/services/*` owns Supabase/SDK calls and returns `{ ok, data } | { ok: false, error }`; use `code-structure` when changing these boundaries.
- Every table has RLS and policies in its creating migration. Schema changes live in `supabase/migrations/` and are tested against local Supabase. Hosted migrations arrive only through the GitHub integration on merge; agents hold no hosted database credentials.
- Service-role and secret keys stay server-only, never in `NEXT_PUBLIC_*`.
- Add shadcn components through its CLI into `components/ui/`.
- `proxy.ts` matches only routes reading the staff session: `/staff`, `/login`, `/auth`. Add a route only if it needs that session, so public pages stay up when Supabase is down or misconfigured.
- Real family/student data stays out of Git and evidence. Use seeded fixture data and the seeded test account.
- PR evidence is uploaded through the PR's comment box in the signed-in in-app browser, never pushed to a branch, a gist or another file host ([Workflow → Attaching evidence](docs/agents/workflow.md#attaching-evidence-to-a-pr)). If that browser isn't signed in to GitHub or isn't available, ask the human to sign in and wait.
- Worktrees share one local Supabase and limited memory. Before database resets, integration/e2e tests, builds or evidence servers, take the shared lock described in [Parallel work](docs/agents/parallel-work.md). Confirm a reused port serves your process. Stop the database only when no other session uses it.
- Leave other agents' branches, worktrees and uncommitted changes untouched. Release housekeeping may remove merged work only after its safety checks. Force-push only your own branch with `--force-with-lease`; regenerate conflicting lockfiles with `npm install`. Stop on a conflict you cannot resolve confidently.

## Read only what the task needs

- **Planning, verification or PR preparation:** [Workflow](docs/agents/workflow.md).
- **Release or merge:** [Releasing](docs/agents/releasing.md).
- **Local database, shared resources or parallel feature slices:** [Parallel work](docs/agents/parallel-work.md).
- **Production, Preview, hosted dashboards or service setup:** [Hosted services](docs/agents/hosted-services.md). Check the signed-in in-app browser yourself; request sign-in if needed.
- **Business behavior or terminology:** relevant sections of [CONTEXT.md](CONTEXT.md), relevant [ADRs](docs/adr/), and [domain guidance](docs/agents/domain.md).
- **Tickets or triage:** [Issue tracker](docs/agents/issue-tracker.md) and [triage labels](docs/agents/triage-labels.md).

Keep only permanent project material on `main`. Research and prototype findings stay on their own throwaway branches; handoffs use the skill's OS-temp location. EGM briefs and reports go under `.artifacts/egm/<feature>/`; pass that path as `EGM artifact directory` to EGM. Apply `unslop` to human-facing text you write or change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
