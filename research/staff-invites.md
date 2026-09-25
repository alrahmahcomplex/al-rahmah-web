# What does inviting staff from the app require?

Research for issue #8 (parent map #5). Researched 2026-09-25 against Supabase docs, the
`supabase/auth` server source and the `supabase-js` monorepo on their default branches, and
the SMTP providers' own pages. Where a claim rests on source code rather than docs, the file is
linked. Items marked **Unverified** could not be confirmed from a primary source.

Context assumed (not on `main` yet): ADR 3 replaces `allowed_admin_emails` with a staff-members
table where each staff member holds one editable role, and the Admissions Manager invites a
staff member into a role from a screen.

## Recommendation

1. **API:** `supabase.auth.admin.inviteUserByEmail(email, { redirectTo, data })`, called from a
   Server Action or Route Handler. It is still the current method: it POSTs to the Auth server's
   `/invite` endpoint, and there is no newer replacement.
2. **Key:** the `sb_secret_…` key, read from an unprefixed `SUPABASE_SECRET_KEY` env var, in a
   dedicated admin client built with plain `createClient` from `@supabase/supabase-js`
   (`persistSession: false, autoRefreshToken: false, detectSessionInUrl: false`). Keep it
   separate from the `@supabase/ssr` cookie clients and put it in a `server-only` module. The
   publishable key cannot call admin endpoints.
3. **Order of operations, and the trigger:** first check that the caller is the Admissions
   Manager, using the caller's own session client and RLS. Then insert the staff-members row
   (email, role, status "invited"). Then call `inviteUserByEmail`. The replacement
   `before insert` trigger on `auth.users` checks the staff-members table for that email, so the
   invite goes through because the row already exists. If the invite fails, delete the row or
   mark it failed. Auth creates the user and sends the email in one database transaction, so a
   failed send does not leave a stray `auth.users` row behind. Write the returned `user.id` into
   the staff-members row, or link it with an `after insert` trigger. Before the call, handle the
   "already a confirmed user" case, which Auth answers with 422 `email_exists`.
4. **Invite link handling:** invites can't use PKCE, so the default invite link returns tokens
   in the URL fragment. The existing `/auth/callback` handler reads only `?code=` and never sees
   them. Change the **Invite user** email template to link to a server route with
   `token_hash`, and have that route call `supabase.auth.verifyOtp({ token_hash, type: "invite" })`.
   Then send the new staff member to a "set your password" page that calls
   `auth.updateUser({ password })`. Invited users have no password.
5. **SMTP provider:** **Resend** (free tier of 3,000 emails a month and 100 a day, SMTP relay
   included). **Brevo** is the fallback (300 a day free, SMTP included). Either covers a school's
   staff invites many times over. Custom SMTP is required, not optional: the built-in service
   delivers only to the Supabase project's team members, at 2 emails an hour.
6. **Redirects:** set `site_url` to the production origin. Add allow-list entries for
   `https://<prod-domain>/**`, `https://*-<vercel-team-slug>.vercel.app/**` (Preview) and
   `http://localhost:3000/**` plus `http://127.0.0.1:3000/**` (local). Compute `redirectTo`
   per request from `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_VERCEL_URL`. In the invite template,
   build the link from `{{ .RedirectTo }}`, not `{{ .SiteURL }}`, so Preview invites come back
   to Preview.

## 1. Which API sends an invite?

- `auth.admin.inviteUserByEmail(email, options)` "Sends an invite link to an email address."
  Its options are `data` (custom user metadata) and `redirectTo` ("URL which will be appended to
  the email link sent to user"). It calls `POST {url}/invite`.
  Source: [auth-js `GoTrueAdminApi.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts),
  [JS reference](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
- The JSDoc says: "PKCE is not supported when using `inviteUserByEmail`", because the browser
  that sends the invite is usually not the one that accepts it. Source: same file.
- Alternative: `auth.admin.generateLink({ type: "invite", email, options: { data, redirectTo } })`
  returns the link and OTP **without sending anything**. It is meant for sending "via a custom
  email provider", which would mean our code sends the email itself. Not needed if Supabase's
  SMTP sends. Source: same file, and
  [`types.ts` (`GenerateInviteOrMagiclinkParams`)](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/types.ts).
- What the server does ([`internal/api/invite.go`](https://github.com/supabase/auth/blob/master/internal/api/invite.go)):
  - It looks up the email. **No user:** it builds a user with no password, runs the
    *before-user-created* hook, then, in one transaction, inserts the user and identity, writes an
    audit log entry and calls `sendInvite`.
  - **User exists but is unconfirmed:** it skips the insert and sends the invite again. This is
    how "resend invite" works: call the same method again.
  - **User exists and is confirmed:** it returns 422 with error code `email_exists`.
  - On success it returns the created `user`, so we get the `auth.users.id` right away.

## 2. Which key does it need?

- The admin Auth API needs an elevated key: the `service_role` key or a `sb_secret_…` key.
  Source: [JS reference, inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
- Secret keys authorize "through the built-in `service_role` Postgres role", which bypasses
  RLS. They are for "secure, developer-controlled components" only. Store the key as
  `SUPABASE_SECRET_KEY` and "Never prefix these, or your bundler will ship the key." A secret
  key sent from a browser gets HTTP 401: Supabase matches on the `User-Agent` header.
  `supabase start` prints a local secret key. Keys are created and revoked in Dashboard >
  Settings > API Keys. Source: [API keys](https://supabase.com/docs/guides/api/api-keys).
- The server-side admin client pattern is `createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`.
  The same page notes that SSR clients by default "do not permit the use of a `secret` key",
  so the admin client must be a separate client.
  Source: [Troubleshooting: administration tasks with a secret key](https://supabase.com/docs/guides/troubleshooting/performing-administration-tasks-on-the-server-side-with-the-servicerole-secret-BYM4Fa).
- supabase-js sends whatever key it was given as both `apikey` and `Authorization: Bearer`,
  whatever the key format.
  Source: [`SupabaseClient.ts`](https://github.com/supabase/supabase-js/blob/master/packages/core/supabase-js/src/SupabaseClient.ts).
  Early on, this made admin calls with the new keys fail with `bad_jwt` / "invalid JWT … invalid
  number of segments" when run against the local CLI stack. A Supabase contributor closed the
  report on 2025-10-28, saying: "This has been resolved in the latest cli release."
  Sources: [supabase-js#1568](https://github.com/supabase/supabase-js/issues/1568),
  [cli#4524](https://github.com/supabase/cli/issues/4524).
  **Unverified:** which CLI version carries the fix. This repo pins `supabase` ^2.117.0, which
  should be well past it, but check it with a local `inviteUserByEmail` call before building the
  screen on it.

## 3. How does the invite interact with a `before insert` trigger on `auth.users`?

- The invite goes through the same `signupNewUser` path as a sign-up. The insert is
  `tx.Create(user)`, and any database error there comes back as HTTP 500
  **"Database error saving new user"**. So a trigger that raises an exception blocks the invite,
  and the app receives that generic message, not the trigger's text.
  Source: [`internal/api/signup.go`](https://github.com/supabase/auth/blob/master/internal/api/signup.go).
  **Unverified:** the exact `error.code` string that supabase-js exposes for this 500. Treat any
  error from the invite as "unavailable" unless it is `email_exists` or
  `over_email_send_rate_limit`.
- The user insert and `sendInvite` run in **one transaction**. If sending fails, for example on
  the rate limit (429, code `over_email_send_rate_limit`) or an SMTP error, the `auth.users`
  insert rolls back. Sources: [`invite.go`](https://github.com/supabase/auth/blob/master/internal/api/invite.go),
  [`internal/api/mail.go` (`sendInvite`)](https://github.com/supabase/auth/blob/master/internal/api/mail.go).
- What this means for ADR 3's replacement trigger: the staff-members row must exist **before**
  the invite call, and the trigger should check it by lowercased email. A trigger that also
  writes to the staff-members table (for example setting `user_id = new.id`) should be an
  `after insert` trigger: in a `before insert` trigger the row isn't there yet, so a foreign key
  to `auth.users` would fail. ADR 1's warning still applies: the trigger blocks **every**
  account not in the staff table, which will matter if parents ever get logins.
- Alternative to a raw trigger: the **before-user-created Auth hook**. `invite.go` calls
  `triggerBeforeUserCreated` for invites. The hook can be a Postgres function or an HTTP
  endpoint. It rejects with a JSON `{ "error": { "http_code": 4xx, "message": … } }`, which gives
  a clean 4xx instead of a 500. A Postgres function needs `grant execute … to supabase_auth_admin`
  and the grant revoked from `authenticated, anon, public`.
  Source: [Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).
  **Unverified:** whether hooks can be declared in `config.toml` for local work
  (`[auth.hook.before_user_created]`), and whether this hook is available on the free plan. The
  hook page names no plan limit. A trigger needs neither check, so keeping the trigger is the
  lower-risk choice. The hook is an option if nicer error messages matter.

## 4. Built-in email limits and custom SMTP

- Built-in email service: **2 messages per hour**. It sends only to "pre-authorized addresses"
  (members of the project's team) and has "No SLA guarantee". So staff invites to real addresses
  **will not be delivered** without custom SMTP.
  Source: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- The rate limit applies per project, across "All email-sending Auth endpoints". It can be
  changed once custom SMTP or a Send Email hook is set up.
  Source: [Rate limits](https://supabase.com/docs/guides/auth/rate-limits).
  The server enforces it inside `sendEmail`, and `sendInvite` turns it into 429
  `over_email_send_rate_limit` ([`mail.go`](https://github.com/supabase/auth/blob/master/internal/api/mail.go)).
- Setting up custom SMTP needs a host, port, username, password and a From address (for example
  `no-reply@…`). After setup the limit starts at **30 messages per hour**, adjustable on the Rate
  Limits page. Supabase advises setting up SPF, DKIM and DMARC with the provider, and a separate
  domain or subdomain for auth mail. Named working providers: Resend, AWS SES, Postmark, Twilio
  SendGrid, ZeptoMail, Brevo. Source: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- Locally, `[local_smtp]` (Mailpit) catches every email, and nothing leaves the machine. Its web
  UI runs on port 55424 in this repo's `supabase/config.toml`, and `supabase start` prints a
  "Mailpit URL" ([cli output quoted in supabase-js#1568](https://github.com/supabase/supabase-js/issues/1568)).
  **Unverified:** whether the local `email_sent = 2` limit is enforced with Mailpit. The config
  comment says it "Requires auth.email.smtp to be enabled".

### Providers with a free tier

| Provider | Free tier | SMTP | Source |
|---|---|---|---|
| Resend | 3,000 emails/month, 100/day, 3 domains | Yes, on all plans. Host `smtp.resend.com`, port 465 or 587, user `resend`, password = API key | [pricing](https://resend.com/pricing), [SMTP docs](https://resend.com/docs/send-with-smtp) |
| Brevo | 300 emails/day, free forever, no card | Yes, SMTP relay on the free plan | [Free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [free SMTP](https://www.brevo.com/free-smtp-server/) |
| ZeptoMail | First credit free (1 credit = 10,000 emails, valid 6 months) | Not stated on the pricing page | [pricing](https://www.zoho.com/zeptomail/pricing.html) |
| Postmark | 100 emails/month, no expiry | Yes (Supabase lists it) | [pricing](https://postmarkapp.com/pricing) |
| Amazon SES | Up to $200 in AWS Free Tier credits for new customers, 6 months; then $0.10 per 1,000 | Yes | [pricing](https://aws.amazon.com/ses/pricing/) |

**Unverified: availability from Tanzania.** None of these pricing pages lists country
restrictions, and I found no primary source confirming or ruling out sign-up and billing from
Tanzania. Resend and Brevo don't need a card for their free tiers, which removes the
billing-country question for now. Confirm at sign-up.

## 5. How invite links are redirected in local, Preview and Production

- **Site URL** is the default redirect, and the base of `{{ .SiteURL }}` in templates. A
  `redirectTo` must match the **Redirect URLs** allow list. Globs are allowed: `*` doesn't cross
  `.` or `/`, and `**` matches anything. Supabase's documented patterns are
  `http://localhost:3000/**` for local and `https://*-<team-or-account-slug>.vercel.app/**` for
  Vercel Preview. It gives a `getURL()` helper using `NEXT_PUBLIC_SITE_URL` →
  `NEXT_PUBLIC_VERCEL_URL` → localhost. When you pass `redirectTo`, update templates to use
  `{{ .RedirectTo }}` instead of `{{ .SiteURL }}`.
  Source: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- A `redirect_to` that isn't allowed is **not an error**: the server quietly falls back to the
  Site URL. The check skips the port for loopback addresses. So a Preview invite with a
  mis-configured allow list lands on Production.
  Source: [`internal/utilities/request.go`](https://github.com/supabase/auth/blob/master/internal/utilities/request.go).
- **Why the existing `/auth/callback` won't work for invites:** for `GET /verify`, the flow is
  implicit unless the token has the PKCE prefix, and invite tokens never do. The redirect then
  carries `#access_token=…` in the URL fragment, which a Route Handler never receives.
  Source: [`internal/api/verify.go`](https://github.com/supabase/auth/blob/master/internal/api/verify.go).
  The server-side pattern is to put `{{ .TokenHash }}` in the email link and have a server
  endpoint call `verifyOtp`. The Next.js tutorial uses
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and an
  `app/auth/confirm/route.ts`. Sources:
  [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
  [Next.js tutorial](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs).
  `verifyOtp` accepts `{ token_hash, type }` with `type: "invite"`
  ([`types.ts`: `EmailOtpType`, `VerifyTokenHashParams`](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/lib/types.ts)).
- Suggested invite template link, so each environment returns to itself:
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`, with `redirectTo` set to
  `<origin>/auth/confirm`. **Unverified:** that `{{ .RedirectTo }}` is filled in for invites. The
  template docs list it for `signUp`, `signInWithOtp` "and similar". Check it in Mailpit locally.
  If it comes through empty, fall back to `{{ .SiteURL }}`, and Preview invites will then land
  on Production.
- Email link scanners can use up a single-use link before the person clicks it. Supabase
  suggests sending the user to a page with a confirm button. For invites, that page can be the
  set-password step. Source: [Email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
- **Per environment:**
  - *Local:* `supabase/config.toml` sets `site_url` and `additional_redirect_urls`. It currently
    lists exact `/auth/callback` URLs, so add `/auth/confirm` or switch to `/**`. The invite
    template goes in `[auth.email.template.invite]` with `content_path`, and templates only
    change after `supabase stop && supabase start`.
    Source: [Customizing email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates).
  - *Preview and Production:* set these in Dashboard > Authentication > URL Configuration and
    Email Templates ("for hosted projects … copy the templates into the Email Templates
    section"). Alternatively, `supabase config push` "Updates the configurations of a linked
    Supabase project with the local `supabase/config.toml` file"
    ([CLI reference](https://supabase.com/docs/reference/cli/supabase-config-push)).
    **Unverified:** exactly which auth fields `config push` covers (templates, SMTP). One
    project holds one Site URL, so if Preview and Production share a Supabase project, Preview
    relies on the allow-list glob and `{{ .RedirectTo }}`.

## Steps only the human can do

1. **Create the SMTP account** (Resend recommended). Verify a sending domain or subdomain, for
   example `mail.<school-domain>`, by adding the provider's SPF, DKIM and DMARC DNS records at
   the domain registrar. Create an API key or SMTP password.
2. **Supabase Dashboard > Authentication > SMTP Settings** (hosted project): turn on custom
   SMTP. Enter the host, port, user and password, a From address on the verified domain, and a
   sender name.
3. **Dashboard > Authentication > Rate Limits:** raise "emails sent per hour" from the default
   30 if needed. 30 is likely enough for staff invites.
4. **Dashboard > Authentication > URL Configuration:** set Site URL to the production origin.
   Add Redirect URLs for production `/**`, `https://*-<vercel-team-slug>.vercel.app/**` and
   localhost.
5. **Dashboard > Authentication > Email Templates > Invite user:** paste the `token_hash`
   template, unless it is managed with `supabase config push`.
6. **Dashboard > Settings > API Keys:** create a secret key for the app, for example
   `vercel-server`, so it can be revoked on its own.
7. **Vercel > Project > Settings > Environment Variables:** add `SUPABASE_SECRET_KEY` (no
   `NEXT_PUBLIC_` prefix) for Production and Preview. Set `NEXT_PUBLIC_SITE_URL` for
   Production.
8. **Local:** copy the secret key printed by `npm run db:start` into `.env.local`.
