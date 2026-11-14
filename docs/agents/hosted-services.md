# Hosted services

Checking production, a Vercel Preview or a dashboard (GitHub, Supabase, Vercel) is the agent's job. The human has signed in to every service this project uses in the in-app browser. It keeps those sessions for every agent session, even when no tab is open, so having no tab open never blocks you:

1. Open the page's URL in the in-app browser yourself and see whether it is signed in.
2. If it isn't, try the other ways in first: reload, open the service's sign-in page (a kept session often signs straight back in), try another page of the same service, or wait and retry after a rate limit or outage. Where the task allows it, check the same fact with `gh` or an API that already has credentials.
3. Ask the human only once you have shown that they must act, for example to type a password or a 2FA code. Ask in one message (`AskUserQuestion` in Claude Code) that says what you tried, the one thing they need to do and the link. Wait until they say it is done, then open the page again.
4. Report what the page shows.

A missing session is never a reason to hand the check itself to the human. Their calls are destructive changes, and the merges [Releasing → When to merge](releasing.md#when-to-merge) leaves to them.

## Hosted setup

The hosted Supabase project is `al-rahmah-web`, linked to this repo. The human owns every change below; an agent asks for it and says why.

- **Migrations** reach the hosted database when their PR merges to `main`, through the Supabase GitHub integration. The agent confirms each version during the migration confirmation step in [Releasing](releasing.md).
- **Functions region** is `dub1` (Dublin), set by `regions` in `vercel.json`, so functions run next to the Supabase project in eu-west-1. Hobby allows one region. Check it under Vercel → Project → Settings → Functions after the deploy that adds it; a region changed in the dashboard is overridden by `vercel.json` on the next deploy.
- **Cached public pages.** `/`, `/apply` and `/login/forgot-password` are prerendered once per language state and served from Vercel's cache; rewrites in `next.config.ts` pick the copy from the `lang` cookie before any function runs ([ADR 0006](../adr/0006-public-pages-are-prerendered-per-language-state.md)). On production each answers `X-Vercel-Cache: HIT` (or `PRERENDER` on the first request after a deploy) with no `dub1` hop in `X-Vercel-Id`, with no cookie, `lang=en` and `lang=sw`. The sign-in, reset, Discount code, `/auth` and `/staff` pages render per request and answer `private, no-store`; never give them a shared cache header.
- **Web Analytics and Speed Insights** count real visitors' page views and page speed through `<VercelInsights />` in `app/layout.tsx` (`components/vercel-insights.tsx`). Both were turned on in the Vercel project on 2026-11-10 (Project → Analytics and Project → Speed Insights), and each starts recording with the first deploy after that. If one is turned off, its script request (`/_vercel/insights/script.js` or `/_vercel/speed-insights/script.js`) returns 404, which is harmless. Both send only the page's address as `lib/insights-url.ts` allows: no query string or fragment, and record ids masked as `[id]`. Query strings carry sign-in link tokens, Discount codes and the names staff search for, so keep `beforeSend` on both components. `beforeSend` can't reach the referrer, so `next.config.ts` sends `Referrer-Policy: strict-origin` on every page: the next page learns the site, never the full address.
- **Vercel** needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both Production and Preview. Next.js bakes `NEXT_PUBLIC_*` values in at build, so a changed value takes effect only after a redeploy. A Preview without them serves 500 on `/staff`, `/login` and `/auth`, and `before-and-after` then captures error pages.
- **The first staff member** is the **Super Admin** (#237). Migration `20261130990300_super_admin_role.sql` creates the role and its one holder's staff record, Al-Rahmah Complex, with no login, so no SQL step is needed; `20261204130900_super_admin_email.sql` sets its email to `marketing.alrahmah@gmail.com` (owner decision of 2026-11-09). That migration fails if an Auth user other than the holder's own login already uses that address, so check Authentication → Users before it merges. It changes only the staff record: a login already linked to the holder keeps its old address until it is changed in Authentication → Users. Invite that email under Authentication → Users; the sign-up trigger accepts it because the record is active and has no account yet. The link lands on the site root, which forwards it to `/auth/confirm`. No other role exists yet (#241). The Super Admin signs in, opens Staff and roles, creates **Admissions Manager** from its template under New role, and invites the Manager into it. They create Admissions Staff, Accountant and the other roles from their templates the same way, in any order; a role from a template joins the managed set of the role that should manage it. A second Super Admin, or a change to the holder's name or email, needs a reviewed migration that lifts the freeze triggers by name.
- **`public.rls_auto_enable()`** exists on hosted and nowhere else. Supabase made it, not a migration: it is the helper behind "enable RLS automatically on new tables", returns `event_trigger`, and the `ensure_rls` event trigger fires it. Postgres refuses a direct call to an event-trigger function. `20261208990100_advisor_tidy_ups.sql` takes its execute grant from `public`, `anon` and `authenticated` so the Security Advisor stops flagging it, and leaves the function and its trigger alone. Locally and on CI the step does nothing.
- **Staff invites** from Staff and roles need, on the hosted project: custom SMTP (Authentication → SMTP Settings, with a verified sending domain; the built-in sender reaches only the project's team), the Site URL set to production, Redirect URLs allowing `/auth/confirm` on production (see Redirect URLs below), the email templates below, and a named secret key. Vercel needs that key as `SUPABASE_SECRET_KEY`, unprefixed, in Production and Preview. Without the key the Manager's invite still creates the staff record, reports that the email wasn't sent, and offers Resend invite.
- **Agent invites** (#191) use the same key and SMTP. Redirect URLs must also allow `/discount-code/set-password` and, for every password reset, staff's and agents' (#265), `/login/reset-password`, both on production only. Supabase sends an address missing from the list to the Site URL, where the link fails.
- **Redirect URLs** (Authentication → URL Configuration) hold exact production addresses and nothing for Previews. Owner decision, 2026-11-08 (#269). Take the host from the live list:
  - `https://<production-host>/auth/confirm`
  - `https://<production-host>/discount-code/set-password`
  - `https://<production-host>/login/reset-password`

  Keep any other production entries already there. Don't add `https://*-<vercel-team>.vercel.app/**` back, or any narrower Preview wildcard. Vercel builds those addresses from the team slug and hands out unused `*.vercel.app` aliases first come, first served ([generated URLs](https://vercel.com/docs/deployments/generated-urls), [`vercel alias`](https://vercel.com/docs/cli/alias)). Nothing stops another team from taking `anything-<our-slug>.vercel.app`. In [Supabase's redirect matching](https://supabase.com/docs/guides/auth/redirect-urls) `*` matches any run of characters other than `.` and `/`, so the wildcard would accept that stranger's host. A reset link sent there hands the stranger the token, and one hand-solved CAPTCHA is enough to send one, since Supabase doesn't check which form a token came from. Reset and invite links sent from a Preview land on the Site URL and fail. Test those flows locally, where Mailpit catches the email (`e2e/staff-password-reset.spec.ts`, `e2e/agent-password-reset.spec.ts`), not on a Preview.
- **Email templates.** `supabase/templates/invite.html` (Invite user) and `supabase/templates/recovery.html` (Reset password) are the source of truth, with their subjects in `supabase/config.toml`. Each branches on `user_metadata.kind = "agent"` for the Discount code wording, Swahili first; staff wording is the default. Every link carries a `token_hash` back to the redirect it was sent with, so one wrong recovery template breaks staff and agent resets alike. Each carries a version marker on its second line (e.g. `al-rahmah-template: invite v5`; the number rises whenever the body changes). Paste both into Authentication → Email Templates whenever either changes, set the same subjects, and check the marker in the hosted editor matches the repo's.

## Auth CAPTCHA

Supabase's CAPTCHA protection (#268) asks for a Turnstile token on password sign-in (`/token` with the password grant), `/signup`, `/recover`, `/resend`, `/otp`, `/magiclink` and `/sso`. It closes the direct `/recover` call with the publishable key, which anyone could send to spend the hourly email limit or aim a reset at any address.

- **Sign-in** puts the Turnstile widget (action `sign-in`) in the `/login` form and passes its token to `signInWithPassword` as `captchaToken`. Supabase checks it, so the server doesn't call `verifyTurnstile` as well: Cloudflare accepts a token once, and a second check would refuse every sign-in. Without a token the form sends nothing and asks the person to wait. Supabase's `captcha_failed` shows "Ukaguzi wa usalama haukukamilika. Jaribu tena." with the code `captcha_failed`, never "wrong password". Supabase doesn't check a token's action or hostname, so a token earned on another of our forms passes once. Each try still costs a solved check, and the firewall key and token limiter stay.
- **Calls that skip it.** "Umesahau nenosiri?", "Tuma kiungo kipya", staff and agent invites and Send reset link all send with the secret key. Supabase skips the check for a service-role request, and the gateway turns the secret key into one. These forms already check Turnstile on our server, so nothing is checked twice. Using a link (`/verify`), setting a password (`PUT /user`), session refreshes, code exchange, sign-out and `/invite` need no token at all.
- **The secret.** `/login` uses the same Turnstile widget as the other public forms (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), so Supabase needs that widget's secret. Vercel already holds it as `TURNSTILE_SECRET_KEY`, and `lib/turnstile.ts` needs it there for the other forms. Paste that same secret into Supabase and keep it in Vercel. Never put it in the repo or a chat. Don't create a second widget for Supabase: its secret can't verify tokens from the `/login` widget, so every sign-in would fail. Locally, `supabase/config.toml` turns CAPTCHA on with Cloudflare's public always-pass test secret, and test helpers that use the publishable key send Cloudflare's dummy token `XXXX.DUMMY.TOKEN.XXXX`.
- **The app needs the widget from the moment it deploys.** `/login` sends nothing without a widget token, whatever the Supabase setting. So the widget has to load on every host people sign in on. Cloudflare's widget hostname list must include the production host. Previews use Cloudflare's always-pass test site key, whose widget gives only the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Previews share the hosted Supabase project, and with the real secret it rejects that token ("Production secret keys will reject the dummy token", [Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)). So once CAPTCHA is on, nobody can sign in on a Preview. Owner decision, 2026-11-08: accept that. Check signed-in staff and Discount code screens locally; public pages on a Preview still work. Don't put the real Turnstile keys in Vercel's Preview environment to get it back: Preview hosts aren't under one domain the widget could allow.
- **Go-live order.**
  1. The app that sends the token deploys to production. Before the deploy, check that the widget's hostname list in Cloudflare includes the production host. After it, an agent signs in on production in the signed-in in-app browser. A real sign-in has to succeed. A widget that only shows isn't enough.
  2. The owner opens Authentication → Bot and Abuse Protection, turns on Enable CAPTCHA protection, picks Turnstile, pastes the secret and saves. Turned on before step 1, it locks out every staff member and agent.
  3. An agent checks production again: sign-in works, "Umesahau nenosiri?" sends, and a direct `/recover` with the publishable key and no token gets `captcha_failed`. No hosted doc says the secret key skips the check, so this production check is what proves the reset forms still send.
- **Rollback.** Which fix works depends on how sign-in fails.
  - Sign-in fails with "Ukaguzi wa usalama haukukamilika. Jaribu tena." (`captcha_failed`) after CAPTCHA was turned on. Turn Enable CAPTCHA protection off. Supabase then ignores the token and sign-in works again.
  - The widget never gives a token, so people stay stuck on "Subiri ukaguzi wa usalama ukamilike, kisha uingie." Turning CAPTCHA off doesn't help, because the app refuses to send without a token. Fix the cause first: check the widget's hostname list in Cloudflare and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel, then redeploy. If that can't be done quickly, use Vercel Instant Rollback to the previous production deployment, or revert the PR. If Enable CAPTCHA protection is already on, turn it off first: the previous deployment sends no token, so with CAPTCHA on it would refuse every sign-in too.

## Plans, email, rate limits and logs

Checked in the signed-in in-app browser on 2026-11-05. Recheck a value in its dashboard before relying on it. Changes to these settings are the human's to approve, like everything under Hosted setup.

### Plans and accepted risks

Vercel is on Hobby. Supabase is on Free, in eu-west-1. On 2026-11-03 the owner chose to stay on the free plans and accepted these risks:

- **Hobby is for non-commercial use** under Vercel's terms, and a school's admissions site may not qualify.
- **One firewall rule.** Hobby allows one custom rule, so every public form shares `public-forms` and its single threshold. Rate limiting below has the details, including the accepted gap in the sign-in key.
- **Supabase Free pauses an inactive project.** A paused project takes the staff portal, sign-in and every form that writes down until someone restores it from the Supabase dashboard. Check that the project isn't paused before a launch step or after a quiet period.
- **No point-in-time recovery.** A bad migration or deletion can't be rolled back to a moment in time.

### Deployment limit and Previews

Hobby allows 100 deployments every 86,400 seconds ([limits](https://vercel.com/docs/limits)), Production and Preview together. Past that Vercel refuses every deployment, Production included, until the day's window passes. The commit then gets a failed `Vercel` status reading "Deployment rate limited — retry in 24 hours." On 2026-11-12 agent build threads used the whole day by midday, one Preview per push (#370).

- **Agent branches don't deploy.** `git.deploymentEnabled` in `vercel.json` sets `claude/**` and `codex/**` to `false` ([git configuration](https://vercel.com/docs/project-configuration/git-configuration)). Any branch with no rule deploys, `main` included. Vercel matches branch names with minimatch: `claude/**` matches `claude/redesign-r7-fees-seats-329` and `claude/a/b`, but not `main`, `claude`, `claudex/x` or `research/turnstile`. A branch matching a `false` rule and a `true` rule deploys. Never add a rule that could match `main`.
- **A skipped push leaves nothing behind.** It creates no deployment, no `Vercel` commit status and no PR check (checked on #370's own branch). `main` has no branch protection and the Vercel check isn't required, so the PR still merges on `CI complete`.
- **The branch needs the rule in its own tree.** Vercel reads `vercel.json` from the pushed commit. A branch cut before #370 merged keeps deploying on every push until it is rebased onto `main`.
- **A Preview on purpose.** Ask the lead first and say why local checks aren't enough, for example a Lighthouse run or behaviour only the hosted setup has. With a yes, push the commit once to a branch outside the patterns, take the evidence, then delete it:

  ```bash
  git push origin HEAD:preview/<task>
  git push origin --delete preview/<task>
  ```

  Each push to that branch spends one deployment from the shared 100. Open no PR from it. The Preview sits behind Vercel's SSO login.
- **After a merge,** check the production status on the merge commit, as [Releasing](releasing.md#merge-and-tag) says.
- **The alternative** is Vercel Pro, which allows 6,000 a day. The owner chose to stay on Hobby (above), so an agent doesn't propose the upgrade as a fix.

### SMTP

Supabase sends auth email through custom SMTP on Resend, at `smtp.resend.com` port 465.

- **Plan and caps.** resend.com timed out from the agent's machine and network on 2026-11-05, so the Resend plan wasn't seen in its dashboard. Resend's published Free caps are 100 emails a day and 3,000 a month. The day is a UTC calendar day, so it resets at 03:00 EAT. Past the cap Resend refuses the send until the reset. Every recipient counts.
- **Owner decision, 2026-11-05.** The launch sends about 20–30 agent invites, not 100+, so the Free cap is enough. Stay on Resend with no upgrade.
- **Bounces.** Supabase knows only whether Resend accepted the message. Bounces and complaints appear under Emails in the Resend dashboard, on each message. SMTP errors Supabase hits appear in its Auth logs.

### Hosted email settings

All of these live under Authentication in the Supabase dashboard.

| Setting | Where | Value |
|---|---|---|
| Email OTP expiration | Sign In / Providers → Email | 86400 s, which is 24 hours. Set 2026-11-05, was 3600 |
| Rate limit for sending emails | Rate Limits | 50 an hour. Set 2026-11-05, was 30 |
| Minimum interval per user | Rate Limits | 60 s, unchanged |
| IP address forwarding | Rate Limits | Off |

- **Expiry** applies to every email link: invites, password resets, sign-up confirmations and email changes. `otp_expiry` in `supabase/config.toml` matches it. The invite and recovery templates state the 24 hours, and so does `invite_link_lifetime()` in the database, which dates an invite as expired. Change all of them together and paste both templates again.
- **Hourly limit.** It is project-wide and counts every auth email. Keep it at 50, as decided in #268 on 2026-11-08 instead of lowering it. Our own sends add up to exactly that: a 30-invite batch (`BATCH_LIMIT`), the public password-link budget of 15 (`PUBLIC_EMAIL_HOURLY_BUDGET`) and about 5 staff invites, resends and Manager reset links, so 30 + 15 + 5 = 50. A lower limit cuts batches or resets. The outside path that used to spend it, a direct `/recover`, needs a CAPTCHA token now (Auth CAPTCHA above). Fifty is half of Resend's daily 100, so one hour can't spend the whole day. Two busy hours can, which is why agent invites also need a daily budget. Staff invites can still use up the shared hourly limit, and so can anyone spending the public hourly budget; both are accepted risks. Locally `email_sent = 2` has no effect, because Supabase applies it only with custom SMTP, and local mail goes to Mailpit.
- **Minimum interval.** Supabase refuses a second reset or confirmation email to the same address within 60 seconds. Whether it applies the gap to invites sent through the admin API hasn't been checked. Locally `max_frequency` is `1s`, so tests don't wait.

### Invite batch budgets

Agent invite batches (#192) send at most 30 (`BATCH_LIMIT` in `lib/services/agent-invite-batches.ts`), from the hourly limit above. Each batch stops itself after 45 seconds, and the Agents page sets `maxDuration` to 60 seconds. Vercel Hobby allows up to 60 seconds without Fluid compute and up to 300 with it, so 60 holds either way. Change those numbers in the code, together with this paragraph.

The daily budget is configuration. Set both variables in Vercel for Production and Preview, server-only (never `NEXT_PUBLIC_`). Until both are set, Send invites is off and says why.

| Variable | Value | Meaning |
|---|---|---|
| `EMAIL_DAILY_CAP` | 100 | Resend Free's daily cap, above. Change it if the plan changes. |
| `STAFF_INVITE_RESERVE` | 20 | Emails a day kept for staff invites and password resets. |

Agent batches send at most `EMAIL_DAILY_CAP − STAFF_INVITE_RESERVE` agent invite emails a day, 80 with these values. The count comes from the database's agent invite attempts since midnight UTC, Resend's day, which is 03:00 East Africa Time. A failed attempt doesn't count; an attempt cut off mid-send does. Single Send invite and Resend presses, and new invites an agent asks for with "Tuma kiungo kipya", count towards the day too, but only batches stop at the budget. Staff invites and resets aren't counted, which is what the reserve is for.

### Public password-link limits

"Umesahau nenosiri?" and "Tuma kiungo kipya" (#194) are public forms that can send email, so the database counts them too. Each request that passes Turnstile and the firewall goes into `agent_link_requests`, which holds only a SHA-256 hash of the email and the time, and drops rows older than an hour on every write. A request is refused when the email already has `AGENT_LINK_PER_EMAIL_LIMIT` requests in the last hour, or the whole project has `PUBLIC_EMAIL_HOURLY_BUDGET`. Both count every request, whether or not the email has an account, so the limits never tell a stranger which emails do. A repeat for the same email within 60 seconds, which Supabase's gap would refuse anyway, gets the usual reply and isn't counted. Both limits hold even when the firewall check fails open.

Set both in Vercel for Production and Preview, server-only. A missing value, or one that isn't a whole number, falls back to the default below, never to no limit.

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_LINK_PER_EMAIL_LIMIT` | 3 | Requests per email per hour. Supabase's 60-second gap per address also applies to resets. |
| `PUBLIC_EMAIL_HOURLY_BUDGET` | 15 | Public requests per hour for the whole project. With a 30-invite batch it leaves 5 of Supabase's 50 an hour for staff invites. |

Only an Approved agent who isn't switched off or retired gets an email: a reset if they have joined, a new invite if the school has invited them before and they haven't joined. Everyone else, and a send that fails, gets the same reply; the send happens after the reply, and its result is recorded in `agent_events` (kind `reset`, or `invite` with no staff member). Nothing is counted or sent while agent access is off. Two requests at the same moment can both take the last place under a limit; the hourly email limit still holds. Anyone can spend the public budget with made-up emails, which then refuses resets until the hour passes; that is the accepted risk named under Hourly limit.

### Rate limiting

**The firewall rule.** `public-forms` is under Firewall → Rules in the Vercel project. The `@vercel/firewall` condition matches rate-limit ID `public-forms`. It uses a fixed window of 600 seconds, the longest the dashboard allows. The dashboard shows the keys as "API controlled", because the app supplies them. `checkRateLimit` reports a request as limited only when the firewall answers 429 or 403.

| Setting | Value |
|---|---|
| Window | 600 seconds, fixed |
| Requests per key | **20**, decided by the owner on 2026-11-06. Was 5 |
| Action | **Deny**, decided by the owner on 2026-11-06. Was Log |

The owner makes both changes in the Vercel dashboard; until they confirm them there, the live rule is still 5 per key with Log. Under Log the firewall records requests over the limit and refuses none. Twenty in 10 minutes per key is generous on purpose, so a parent who retypes a Discount code or resends the Admission form is never blocked once the rule denies.

Because one rule has one threshold, each form gets its own allowance through its key. `lib/rate-limit.ts` builds the keys:

| Form | Key | State |
|---|---|---|
| Admission form submission | `admission:<ip>:<contact hash>` | Live |
| Discount-code check on the Admission form | `code-check:<ip>` | Live |
| Agent registration | `agent:<ip>` | Live |
| Sign-in, staff and agents (`/login`) | `sign-in:<ip>:<email hash>` | Live (#191; staff added in #264) |
| Agent reset ("Umesahau nenosiri?") | `agent-reset:<ip>:<email hash>` | Live (#194) |
| "Tuma kiungo kipya" on an expired link | `agent-new-link:<ip>:<email hash>` | Live (#194) |

A hash is the first 32 hex characters of the SHA-256 of the trimmed, lowercased value, never the value itself. The contact is the parent's phone from the Admission form, in one form however it was typed (`0700 000 900` and `+255 700 000 900` give the same hash). With it in the key, families sending the form from one shared connection each get their own 20 tries. A form whose phone can't be read falls back to `admission:<ip>`. The code check stays IP-only: a code in the key would give each code its own allowance and let one IP try every code, so it relies on the higher threshold instead.

Sign-in and agent reset keep the IP plus an email hash. Since #264 one sign-in form serves staff and agents, so both share the `sign-in` key. Sign-in is sized for shared school Wi-Fi, where many people share one IP: each person gets 20 tries in 10 minutes rather than 20 for the whole school. The same key lets one IP try any number of different addresses. #191 accepts that gap rather than adding an IP-only sign-in key, because Hobby has one rule and so one threshold, and an IP-only key at 20 would lock out a school's Wi-Fi. Supabase's token limiter (below) still bounds password guessing from Vercel as a whole, and a limited try never reaches Supabase. A limited sign-in shows "Majaribio ni mengi mno. Subiri dakika chache, kisha ujaribu tena." ("Too many attempts. Wait a few minutes, then try again."), not the wrong-password message. Reset also relies on Turnstile, Supabase's 60-second gap per address, the public reset counter and the project-wide hourly budget for public emails, so it is still limited if the firewall check fails open.

**Supabase sees Vercel's IP, not the user's.** The app calls Supabase Auth from the server, and IP address forwarding is off. On 2026-11-05 a failed sign-in on a Preview with a placeholder address reached the Auth logs from an AWS address, where Vercel runs its functions, not the tester's Tanzanian ISP address. Supabase's per-IP limits therefore count all users together, for as long as their requests leave Vercel from the same address.

The per-IP limiters, from [Supabase's rate-limit docs](https://supabase.com/docs/guides/auth/rate-limits) and the [Auth token handler](https://github.com/supabase/auth/blob/master/internal/api/token.go#L44-L63):

| Limiter | Endpoints | What the app sends there from Vercel | Limit |
|---|---|---|---|
| Token | `/token`, for password, refresh-token, ID-token and PKCE grants | Every password sign-in (`signInWithPassword`), every session refresh, and the code exchange when a reset link lands on `/auth/callback` (`exchangeCodeForSession`) | 150 per 5 minutes |
| Sign-ups and sign-ins | `/signup`, `/recover`, `/resend`, `/magiclink`, `/otp`, `PUT /user` | Setting the password when an invite or agent reset link is used (`updateUser`), and agent resets (`resetPasswordForEmail`, #194). Planned: OTP or magic-link requests | 30 per 5 minutes |
| Verification | `/verify` | Submitting the invite form on `/auth/confirm`, `/discount-code/set-password` or `/login/reset-password` (`verifyOtp`) | 30 per 5 minutes |

The docs give each of these a burst of up to 30. Each limiter is a bucket that holds 30 requests and refills at its rate, so the token bucket regains one request every 2 seconds and the other two regain one every 10 seconds. Supabase's docs list the sign-ups and sign-ins endpoints as one limiter; in the current Auth source each endpoint has its own bucket with that limit, so resets and resends don't use up each other's allowance. Session refreshes run only on the server, because the app never uses the browser client. A reset link's own `/verify` hit comes from the user's browser, so it counts against their IP. Invites go through the admin `/invite` endpoint, which has no per-IP limiter; the hourly email limit above caps them.

Thirty password sign-ins at once, at a launch meeting say, empty the token bucket. Anyone who signs in or refreshes a session in the next couple of seconds gets a 429; after that sign-ins get through at one every 2 seconds. That is enough for a 20–30 agent launch if people retry after a few seconds, but the burst has no margin: wrong passwords count too, and 30 invite acceptances use the whole Verification and `PUT /user` bursts. An attacker can block it: a burst of 30 wrong passwords, then one every 2 seconds, keeps the bucket empty, which stops every sign-in and session refresh leaving Vercel from that address, staff included. The other limiters run out sooner: 30 reset requests, 30 resends or 30 invite acceptances in a burst, then one every 10 seconds. Sign-in, reset and invite pages must show their own 429 message rather than "wrong password" or "link expired". Supabase can count the real user IP if IP address forwarding is turned on and the server's Auth calls use the secret key and forward the client's IP. That is a code change, and it hasn't been made.

### Logs

| Service | Retention on the current plan |
|---|---|
| Vercel runtime logs | 1 hour. 12 hours and 1 day need Pro; longer ranges need Observability Plus. |
| Supabase logs, including Auth | 24 hours. Longer ranges are locked on Free. |
| Resend | Not seen; see SMTP. |

Investigate a failed invite or sign-in within the hour on Vercel and within a day on Supabase. The lasting record is in the database: `audit_log`, and the agent events the launch adds.
