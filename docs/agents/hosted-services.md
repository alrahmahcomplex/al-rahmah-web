# Hosted services

Checking production, a Vercel Preview or a dashboard (GitHub, Supabase, Vercel) is the agent's job. The in-app browser holds the human's sessions and shares them across agent sessions, so:

1. Open the page in the in-app browser and see whether it is signed in.
2. If it shows a sign-in page, ask the human to sign in to that service or site (`AskUserQuestion` in Claude Code), wait for their answer that they are done, then open it again.
3. Report what the page shows.

A missing session is a sign-in to ask for, never a reason to hand the check to the human. Their calls are merges and destructive changes.

## Hosted setup

The hosted Supabase project is `al-rahmah-web`, linked to this repo. The human owns every change below; an agent asks for it and says why.

- **Migrations** reach the hosted database when their PR merges to `main`, through the Supabase GitHub integration. The agent confirms each version during the migration confirmation step in [Releasing](releasing.md).
- **Vercel** needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both Production and Preview. Next.js bakes `NEXT_PUBLIC_*` values in at build, so a changed value takes effect only after a redeploy. A Preview without them serves 500 on `/staff`, `/login` and `/auth`, and `before-and-after` then captures error pages.
- **The first staff member** is the **Super Admin** (#237). Migration `20261130990300_super_admin_role.sql` creates the role and its one holder's staff record, `alrahmahcomplex.tz@gmail.com`, with no login, so no SQL step is needed. Invite that email under Authentication → Users; the sign-up trigger accepts it because the record is active and has no account yet. The link lands on the site root, which forwards it to `/auth/confirm`. No other role exists yet (#241). The Super Admin signs in, opens Staff and roles, creates **Admissions Manager** from its template under New role, and invites the Manager into it. They create Admissions Staff, Accountant and the other roles from their templates the same way, in any order; a role from a template joins the managed set of the role that should manage it. A second Super Admin, or a change to the holder's name or email, needs a reviewed migration that lifts the freeze triggers by name.
- **Staff invites** from Staff and roles need, on the hosted project: custom SMTP (Authentication → SMTP Settings, with a verified sending domain; the built-in sender reaches only the project's team), the Site URL set to production, Redirect URLs allowing `/auth/confirm` on production and on `https://*-<vercel-team>.vercel.app/**`, the email templates below, and a named secret key. Vercel needs that key as `SUPABASE_SECRET_KEY`, unprefixed, in Production and Preview. Without the key the Manager's invite still creates the staff record, reports that the email wasn't sent, and offers Resend invite.
- **Agent invites** (#191) use the same key and SMTP. Redirect URLs must also allow `/discount-code/set-password` and, for every password reset, staff's and agents' (#265), `/login/reset-password` on production and on the Preview pattern above; Supabase sends an address missing from the list to the Site URL, where the link fails.
- **Email templates.** `supabase/templates/invite.html` (Invite user) and `supabase/templates/recovery.html` (Reset password) are the source of truth, with their subjects in `supabase/config.toml`. Each branches on `user_metadata.kind = "agent"` for the Discount code wording, Swahili first; staff wording is the default. Every link carries a `token_hash` back to the redirect it was sent with, so one wrong recovery template breaks staff and agent resets alike. Each carries a version marker on its second line (`al-rahmah-template: invite v4`). Paste both into Authentication → Email Templates whenever either changes, set the same subjects, and check the marker in the hosted editor matches the repo's.

## Plans, email, rate limits and logs

Checked in the signed-in in-app browser on 2026-11-05. Recheck a value in its dashboard before relying on it. Changes to these settings are the human's to approve, like everything under Hosted setup.

### Plans and accepted risks

Vercel is on Hobby. Supabase is on Free, in eu-west-1. On 2026-11-03 the owner chose to stay on the free plans and accepted these risks:

- **Hobby is for non-commercial use** under Vercel's terms, and a school's admissions site may not qualify.
- **One firewall rule.** Hobby allows one custom rule, so every public form shares `public-forms` and its single threshold. Rate limiting below has the details, including the accepted gap in the sign-in key.
- **Supabase Free pauses an inactive project.** A paused project takes the staff portal, sign-in and every form that writes down until someone restores it from the Supabase dashboard. Check that the project isn't paused before a launch step or after a quiet period.
- **No point-in-time recovery.** A bad migration or deletion can't be rolled back to a moment in time.

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
- **Hourly limit.** It is project-wide and counts every auth email. A 30-invite batch plus about 20 resends, resets and staff invites in the same hour fits under 50. Fifty is half of Resend's daily 100, so one hour can't spend the whole day. Two busy hours can, which is why agent invites also need a daily budget. Cap an invite batch at 30, so 20 an hour stay free for resets and staff invites. Staff invites can still use up the shared hourly limit, and so can anyone spending the public hourly budget; both are accepted risks. Locally `email_sent = 2` has no effect, because Supabase applies it only with custom SMTP, and local mail goes to Mailpit.
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
