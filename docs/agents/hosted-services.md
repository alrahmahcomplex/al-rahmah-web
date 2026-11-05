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
- **The first staff member** on a fresh database: the sign-up trigger refuses any auth user without an active staff record, and every write to staff members needs an audit actor, so the order is fixed. First run this in the SQL editor, with the person's name and lowercase email:

  ```sql
  begin;
  select public.set_audit_actor('system');
  insert into public.staff_members (full_name, email, role_id)
  select 'Full Name', 'person@example.com', id from public.roles where name = 'Admissions Manager';
  commit;
  ```

  Then invite the user under Authentication → Users. Their link lands on the site root, which forwards it to `/auth/confirm`. Everyone after them is invited from Staff and roles.
- **Staff invites** from Staff and roles need, on the hosted project: custom SMTP (Authentication → SMTP Settings, with a verified sending domain; the built-in sender reaches only the project's team), the Site URL set to production, Redirect URLs allowing `/auth/confirm` on production and on `https://*-<vercel-team>.vercel.app/**`, the Invite user template from `supabase/templates/invite.html`, and a named secret key. Vercel needs that key as `SUPABASE_SECRET_KEY`, unprefixed, in Production and Preview. Without the key the Manager's invite still creates the staff record, reports that the email wasn't sent, and offers Resend invite.

## Plans, email, rate limits and logs

Checked in the signed-in in-app browser on 2026-11-05. Recheck a value in its dashboard before relying on it. Changes to these settings are the human's to approve, like everything under Hosted setup.

### Plans and accepted risks

Vercel is on Hobby. Supabase is on Free, in eu-west-1. On 2026-11-03 the owner chose to stay on the free plans and accepted these risks:

- **Hobby is for non-commercial use** under Vercel's terms, and a school's admissions site may not qualify.
- **One firewall rule.** Hobby allows one custom rule, so every public form shares `public-forms` and its single threshold. Rate limiting below has the details.
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

- **Expiry** applies to every email link: invites, password resets, sign-up confirmations and email changes. `otp_expiry` in `supabase/config.toml` matches it. The invite template in `supabase/templates/invite.html` states the 24 hours, so the hosted Invite user template must be pasted again from the repo whenever either changes.
- **Hourly limit.** It is project-wide and counts every auth email. A 30-invite batch plus about 20 resends, resets and staff invites in the same hour fits under 50. Fifty is half of Resend's daily 100, so one hour can't spend the whole day. Two busy hours can, which is why agent invites also need a daily budget. Cap an invite batch at 30, so 20 an hour stay free for resets and staff invites. Staff invites can still use up the shared hourly limit, and so can anyone spending the public hourly budget; both are accepted risks. Locally `email_sent = 2` has no effect, because Supabase applies it only with custom SMTP, and local mail goes to Mailpit.
- **Minimum interval.** Supabase refuses a second reset or confirmation email to the same address within 60 seconds. Whether it applies the gap to invites sent through the admin API hasn't been checked. Locally `max_frequency` is `1s`, so tests don't wait.

### Rate limiting

**The firewall rule.** `public-forms` is under Firewall → Rules in the Vercel project. The `@vercel/firewall` condition matches rate-limit ID `public-forms`. It uses a fixed window of 600 seconds, the longest the dashboard allows, and allows 5 requests per key. The dashboard shows the keys as "API controlled", because the app supplies them. Its action is **Log**, so the firewall records requests over the limit and refuses none. `checkRateLimit` reports a request as limited only when the firewall answers 429 or 403, so under Log the app should let every request through. That hasn't been seen on a live request yet. Watch the rule's traffic before switching it to Deny. Five in 10 minutes is tight for a parent who retypes a Discount code several times.

Because one rule has one threshold, each form gets its own allowance through its key. `lib/rate-limit.ts` builds the live keys:

| Form | Key | State |
|---|---|---|
| Admission form submission | `admission:<ip>` | Live |
| Discount-code check on the Admission form | `code-check:<ip>` | Live |
| Agent registration | `agent:<ip>` | Live |
| Agent sign-in | `<form>:<ip>:<email hash>` | Planned |
| Agent reset and "Tuma kiungo kipya" | `<form>:<ip>:<email hash>` | Planned |

The email hash is a hash of the normalised email, never the email itself. Sign-in is sized for shared school Wi-Fi, where many people share one IP. With the hash in the key, each person gets 5 tries in 10 minutes rather than 5 for the whole school. The same key lets one IP try any number of different addresses, so sign-in should also count against an IP-only key on the same rule, with a higher threshold left to the app, or the gap should be accepted as a risk. #191 decides. Reset also relies on Turnstile, Supabase's 60-second gap per address, the public reset counter and the project-wide hourly budget for public emails, so it is still limited if the firewall check fails open. Staff `/login` isn't on the rule.

**Supabase sees Vercel's IP, not the user's.** The app calls Supabase Auth from the server, and IP address forwarding is off. On 2026-11-05 a failed sign-in on a Preview with a placeholder address reached the Auth logs from an AWS address, where Vercel runs its functions, not the tester's Tanzanian ISP address. Supabase's per-IP limits therefore count all users together, for as long as their requests leave Vercel from the same address.

The per-IP limiters, from [Supabase's rate-limit docs](https://supabase.com/docs/guides/auth/rate-limits) and the [Auth token handler](https://github.com/supabase/auth/blob/master/internal/api/token.go#L44-L63):

| Limiter | Endpoints | What the app sends there | Limit |
|---|---|---|---|
| Token | `/token`, for password, refresh-token, ID-token and PKCE grants | Every password sign-in (`signInWithPassword`) and every session refresh | 150 per 5 minutes |
| Sign-ups and sign-ins | `/signup`, `/recover`, `/resend`, `/magiclink`, `/otp`, `PUT /user` | Password resets, resends and email OTP or magic-link requests | 30 per 5 minutes |
| Verification | `/verify` | Opening an invite or reset link (`verifyOtp`) | 30 per 5 minutes |

The docs give each of these a burst of up to 30. Each limiter is a bucket that holds 30 requests and refills at its rate, so the token bucket regains one request every 2 seconds and the other two regain one every 10 seconds. Invites go through the admin `/invite` endpoint, which has no per-IP limiter; the hourly email limit above caps them.

Thirty password sign-ins at once, at a launch meeting say, empty the token bucket. Anyone who signs in or refreshes a session in the next few seconds gets a 429 until it refills, and after that sign-ins get through at one every 2 seconds. That is enough for a 20–30 agent launch if people retry after a few seconds. An attacker can block it: a burst of 30 wrong passwords, then one every 2 seconds, keeps the bucket empty, which stops every sign-in and session refresh leaving Vercel from that address, staff included. The email flows run out sooner: 30 reset or resend requests, or 30 opened links, in a burst, and then one every 10 seconds. Sign-in, reset and link pages must show their own 429 message rather than "wrong password" or "link expired". Supabase can count the real user IP if IP address forwarding is turned on and the server's Auth calls use the secret key and forward the client's IP. That is a code change, and it hasn't been made.

### Logs

| Service | Retention on the current plan |
|---|---|
| Vercel runtime logs | 1 hour. 12 hours and 1 day need Pro; longer ranges need Observability Plus. |
| Supabase logs, including Auth | 24 hours. Longer ranges are locked on Free. |
| Resend | Not seen; see SMTP. |

Investigate a failed invite or sign-in within the hour on Vercel and within a day on Supabase. The lasting record is in the database: `audit_log`, and the agent events the launch adds.
