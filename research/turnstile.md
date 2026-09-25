# Turnstile on a public Server Action (Next.js 16 on Vercel)

Research for issue #9 (map #5). It covers the public Admission form (slice 3) and Marketing Agent registration (slice 4).

- Versions checked against `package.json` on `main`: `next` 16.3.6, `react` 19.2.8, `@supabase/supabase-js` ^2.117.0.
- `node_modules/next/dist/docs/` wasn't available in this worktree, so the Next.js claims come from nextjs.org. Every page cited reports `version: 16.3.6` in its frontmatter, which matches the pinned version.
- Sources were read on 2026-09-25. Anything not stated by a source is marked **Inference** or **Unverified**.

## Recommendation

| Decision | Choice |
|---|---|
| Widget mode | **Managed**, rendered explicitly inside the form's Client Component |
| Where `siteverify` runs | In the Server Action, via a `server-only` module, before any validation result is returned and before any database write |
| Env vars | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public, inlined at build) and `TURNSTILE_SECRET_KEY` (server-only, no prefix) |
| Local runs and e2e | Site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` (always pass). Use the always-fail pair for negative tests |
| Failure behaviour | **Fail closed.** No token, a failed check, a timeout or a network error rejects the submission with a "try again" message. The form keeps what the parent typed and resets the widget |
| Rate limiting | Vercel WAF rate limiting, called from code with `@vercel/firewall` `checkRateLimit()`. Both actions share one rule (Hobby allows one), with a composite key such as `admission:<ip>` or `agent:<ip>` |

### Why each choice

**Managed mode.** Cloudflare recommends it. It "automatically chooses between non-interactive or checkbox challenge based on visitor risk level", with "no images or text to decipher" ([widget modes](https://developers.cloudflare.com/turnstile/concepts/widget/)). Invisible mode would also work, but it requires the privacy policy to reference Cloudflare's Turnstile Privacy Addendum ([same page](https://developers.cloudflare.com/turnstile/concepts/widget/)). Managed avoids that extra step and shows parents that a check is happening.

**Explicit rendering.** Implicit rendering scans the HTML for `.cf-turnstile` elements once at page load. Cloudflare recommends explicit rendering (`?render=explicit` plus `turnstile.render()`) for SPAs and for forms that appear after the first load ([client-side rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)). The Admission form uses a step-by-step layout (prototype variant B), so the widget mounts late. Load `https://challenges.cloudflare.com/turnstile/v0/api.js` from that exact URL. Cloudflare warns that "Proxying or caching this file will cause Turnstile to fail when future updates are released" ([same page](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)). The widget adds a hidden `cf-turnstile-response` field to the form, so the token reaches the Server Action through `FormData` with no extra wiring.

**`siteverify` in the Server Action.** A Server Action "runs as a POST request against the page that invokes it … the route is reachable to anyone who can send the same POST. Treat every action as an untrusted entry point" ([Server Actions guide](https://nextjs.org/docs/app/guides/server-actions#security)). Rendering the widget does nothing on its own. Cloudflare states that "Server-side validation is mandatory" ([get started](https://developers.cloudflare.com/turnstile/get-started/)), and that exposing the secret to call `siteverify` from the client lets attackers bypass the check ([server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)). The Next.js data-security guide suggests keeping `process.env` access in a Data Access Layer marked `import 'server-only'`, which fails the build if a client module imports it ([data security](https://nextjs.org/docs/app/guides/data-security#preventing-client-side-execution-of-server-only-code)).

**Env var naming.** Variables without the `NEXT_PUBLIC_` prefix "are only available in the Node.js environment". Variables with the prefix are inlined into the client bundle at `next build` ([environment variables](https://nextjs.org/docs/app/guides/environment-variables#bundling-environment-variables-for-the-browser)). So the site key needs the prefix and the secret must not have it. Because the site key is inlined at build time, the Playwright `webServer` has to set it before `npm run build` (see [Testing](#test-keys-local-runs-and-playwright)).

## 1. Widget setup

- Modes: **Managed** (recommended; asks for a checkbox only when needed), **Non-Interactive** (a visible spinner, never asks the visitor to interact), **Invisible** (nothing visible; needs the Privacy Addendum in the privacy policy) ([widget modes](https://developers.cloudflare.com/turnstile/concepts/widget/)).
- The widget is created in the dashboard with a name, hostnames, a mode and optional pre-clearance. The dashboard shows a site key and a secret key: "store the secret key securely" ([dashboard widget management](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)).
- A hostname covers "that exact hostname and all of its subdomains". Wildcards such as `*` are not supported ([hostname management](https://developers.cloudflare.com/turnstile/concepts/hostname-management/)).
- Render options: `sitekey`, `theme` (`auto`/`light`/`dark`), `size` (`normal`/`flexible`/`compact`), `callback`, `error-callback`, `expired-callback`, `execution` (`render`/`execute`), `appearance` (`always`/`execute`/`interaction-only`). API methods: `turnstile.render`, `reset`, `remove`, `getResponse` ([client-side rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)).
- **Inference:** `size: "flexible"` suits the mobile-first form. `theme: "auto"` follows the device setting.
- **Unverified:** Cloudflare's docs don't cover `lang`/Swahili localisation of the widget, and I didn't check it. Check the widget's language options before finishing the bilingual copy in slice 3.
- **Unverified:** Cloudflare publishes no React component. Community wrappers exist, but they are not primary sources. A small `useEffect` that calls `turnstile.render()` and `turnstile.remove()` on unmount follows the documented API directly.

## 2. Server-side verification inside a Server Action

The facts come from [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/):

- `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, sent as form-urlencoded or JSON. Parameters: `secret` (required), `response` (required, the token), `remoteip` (optional), `idempotency_key` (optional UUID for safe retries).
- The response includes `success`, `challenge_ts`, `hostname`, `action`, `cdata` and `error-codes`.
- Error codes: `missing-input-secret`, `invalid-input-secret`, `missing-input-response`, `invalid-input-response`, `bad-request`, `timeout-or-duplicate`, `internal-error`.
- A token is valid for **five minutes** and can be validated **once**. A replayed token returns `timeout-or-duplicate`. Tokens are at most 2048 characters.
- Cloudflare advises: "Validate the action and hostname when specified", "Set reasonable timeouts", retry with exponential backoff on network errors, and "Have fallback behavior for API failures". The example code uses a 10-second timeout.

How this maps onto Next.js 16:

- Read the token from `FormData` as `formData.get("cf-turnstile-response")`. Forms pass `FormData` to the action, and `useActionState` changes the signature to `(prevState, formData)` ([forms guide](https://nextjs.org/docs/app/guides/forms)). This matches the existing `app/login/actions.ts`.
- For `remoteip`, read the client IP with `(await headers()).get("x-real-ip")`. `headers()` is async in 16 ([headers](https://nextjs.org/docs/app/api-reference/functions/headers)). On Vercel, `x-real-ip` and `x-forwarded-for` hold the client's public IP, and Vercel overwrites `X-Forwarded-For` "to prevent IP spoofing" ([Vercel request headers](https://vercel.com/docs/headers/request-headers#x-forwarded-for)).
- Check `hostname` against the production domain. **Inference:** skip this check when running with test keys, since dummy responses won't carry the real hostname (unverified what they return).
- **Inference, from the single-use rule:** a token is spent even when the rest of the form then fails validation. After any server response that doesn't complete the submission, the client must call `turnstile.reset()` to get a fresh token. The five-minute expiry also matters for a step-by-step form: render the widget on the final step, or rely on the `expired-callback` and reset.
- Suggested order inside each action: rate limit, then `siteverify`, then schema validation, then the database write. Return a small, stable result object, not raw errors ([Server Actions guide](https://nextjs.org/docs/app/guides/server-actions#security)).
- Next.js also rejects cross-origin action POSTs (`Origin` vs `Host`) and caps bodies at 1MB by default ([Server Actions guide](https://nextjs.org/docs/app/guides/server-actions#security)). These don't stop bots posting from a script, which is why Turnstile is still needed.

## 3. Free-tier limits

From [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/):

- Free: up to **20 widgets**, **10 hostnames per widget**, **unlimited challenges** (traffic or verification requests), analytics kept for 7 days.
- Not available on Free: the "any hostname" widget, Ephemeral IDs, and removing Cloudflare branding.

One widget (production domain plus `localhost` if wanted) covers both public forms. A second widget for previews is optional (see human steps). The free tier doesn't limit this project in practice.

## Test keys (local runs and Playwright)

From [Turnstile testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/):

| Site key | Behaviour |
|---|---|
| `1x00000000000000000000AA` | Always passes (visible) |
| `2x00000000000000000000AB` | Always fails (visible) |
| `1x00000000000000000000BB` | Always passes (invisible) |
| `2x00000000000000000000BB` | Always fails (invisible) |
| `3x00000000000000000000FF` | Forces an interactive challenge (visible) |

| Secret key | Behaviour |
|---|---|
| `1x0000000000000000000000000000000AA` | Always passes |
| `2x0000000000000000000000000000000AA` | Always fails |
| `3x0000000000000000000000000000000AA` | Returns "token already spent" |

- Test site keys produce the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Production secrets reject it, so test site keys must be paired with test secrets.
- Cloudflare warns that Playwright and similar tools "are detected as bots by Turnstile". Test keys are the supported way to run e2e tests, and they work on `localhost`.

Repo-specific notes (**Inference** from `playwright.config.ts` and the Next.js env docs):

- `playwright.config.ts` loads `.env.local` and runs `npm run build && npx next start`. `NEXT_PUBLIC_*` values are frozen at build time ([environment variables](https://nextjs.org/docs/app/guides/environment-variables#bundling-environment-variables-for-the-browser)). Set the test keys in the `webServer.env` block, or commit them in `.env.example` as the local defaults. Don't rely on each developer's `.env.local`.
- The test keys are public values from Cloudflare's docs, so committing them isn't a leak.
- Negative e2e case: the always-fail secret `2x…AA` with the passing site key makes the server reject the form, which tests the fail-closed path without mocking.
- Unit tests (vitest) can stub `fetch` for `siteverify` to cover the timeout and `internal-error` branches.

## What happens when Cloudflare is unreachable

- **Client side.** Turnstile "will automatically retry upon encountering a problem". The retry behaviour can be tuned with `retry: 'never'`, `retry-interval` and `turnstile.reset()` in `error-callback`. Cloudflare's suggested message for the 300xxx/600xxx error families is "Security check failed. Please try refreshing or using a different browser." ([client-side errors](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/)). If `api.js` never loads, no token is produced. The action then sees an empty `cf-turnstile-response`, which is `missing-input-response` (**Inference**).
- **Server side.** Cloudflare says to set timeouts, retry with backoff (an `idempotency_key` makes the retry safe), and "Have fallback behavior for API failures" ([server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)). **Cloudflare doesn't say whether the fallback should accept or reject**, so that's a project decision.
- **Recommended: fail closed**, with a short timeout (about 5 s, then one retry with the same `idempotency_key`). Return a neutral "We couldn't check the form, please try again" state. Keep the parent's entries in the client state so nothing needs retyping. Log the error code. Failing open would let bots in during exactly the window an attacker can cause or wait for. Admission applications aren't so urgent that a short outage outweighs that risk.

## Supabase's built-in Turnstile support

- Supabase Auth supports hCaptcha and Turnstile "for your sign-in, sign-up, and password reset forms". The token is passed as `options: { captchaToken }` on the auth call ([Supabase auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)). Supabase also recommends it for anonymous sign-ins, which have an IP rate limit of 30 per hour by default ([anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)).
- **It only covers Auth endpoints.** The docs don't say anything about database or PostgREST writes (Unverified whether any such option exists; none is documented on that page).
- **Not relevant to slices 3 and 4.** The Admission form creates *Applied* leads, not auth users. Map #5 puts Marketing Agent accounts out of scope, so agent registration doesn't call `auth.signUp` either.
- **Warning (Inference):** turning on Supabase's CAPTCHA setting applies to **sign-in** too. That would break the existing staff `signInWithPassword` in `lib/services/staff-auth.ts` until the login form also sends a `captchaToken`. Leave it off. Also, since a token can be validated only once, one token can't satisfy both our `siteverify` and Supabase's check.

## Pairing Turnstile with rate limiting on Vercel

Turnstile shows a human was present. It doesn't stop one human, or a solver farm, from submitting hundreds of times. The Next.js docs recommend code-level rate limiting for expensive operations and suggest also enabling "any rate limiting features provided by your host" ([data security](https://nextjs.org/docs/app/guides/data-security#rate-limiting), [backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend#rate-limiting)).

**Vercel WAF rate limiting** ([rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)):

| | Hobby | Pro | Enterprise |
|---|---|---|---|
| Counting keys | IP, JA4 digest | IP, JA4 digest | + User Agent, arbitrary headers |
| Algorithm | Fixed window | Fixed window | Fixed window, token bucket |
| Window | 10 s to 10 min | 10 s to 10 min | 10 s to 1 hr |
| Rate-limit rules | **1 per project** | 40 per project | 1000 per project |
| Included requests | 1,000,000 allowed | Usage-based | Custom |

- The default is 100 requests per 60 s. Actions are Default (429), Log, Deny or Challenge. Counters are **per region**. Hobby also allows up to 3 custom firewall rules in total ([rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), [Hobby plan](https://vercel.com/docs/plans/hobby)).
- **Plan note:** "the Hobby plan restricts users to non-commercial, personal use only" ([Hobby plan](https://vercel.com/docs/plans/hobby)). A school's admissions portal probably counts as commercial, so check which plan the project is on. This is an account question for the human.

**Mechanism: the `@vercel/firewall` SDK called inside the action** ([rate limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk), [`checkRateLimit` reference](https://github.com/vercel/vercel/blob/main/packages/firewall/docs/functions/checkRateLimit.md)):

- Create one dashboard rule whose condition is `@vercel/firewall` with a Rate limit ID, for example `public-forms`. Then call `checkRateLimit('public-forms', { headers, rateLimitKey })`. It returns `{ rateLimited: boolean, error?: 'not-found' | 'blocked' }`.
- The options are `request`, `headers`, `rateLimitKey` (defaults to the client IP) and `firewallHostForDevelopment`. A Server Action has no `Request` object, so pass `headers: await headers()`. **Unverified:** the docs list `headers` as an option but only show `request` examples. Confirm on a preview deployment.
- A custom `rateLimitKey` "replaces the default client-IP bucket entirely". Compose the key with the IP, such as `admission:${ip}` and `agent:${ip}`. That gives each form its own per-IP bucket under the single Hobby rule.
- Preview deployments need Protection Bypass for Automation and exposed System Environment Variables for the SDK to work ([rate limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk#test-in-a-preview-deployment)).
- **Unverified:** the docs don't say what `checkRateLimit` does in `next dev`, in `next start` under Playwright, or when the rule ID is missing (`error: 'not-found'`). **Recommendation:** treat `error` as not rate-limited (fail open) and log it, since Turnstile is still enforced. Put the call behind a small wrapper so tests can stub it.
- **Why not a dashboard-only rule on the path:** a Server Action POSTs to the page's own URL ([Server Actions guide](https://nextjs.org/docs/app/guides/server-actions#security)). A path rule would also count ordinary page loads unless it matches only POSTs. The SDK counts exactly the action calls and keeps the logic in code, where it is reviewed and tested.
- **Not recommended:** in-memory counters. Some hosts run Route Handlers as lambdas that "cannot share data between requests" ([backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend#deployment-environment)), so an in-process counter doesn't hold across instances.
- Suggested starting limit (**Inference**, not from a source): about 5 submissions per IP per 10 minutes on each form. Families often share one phone or a school Wi-Fi IP during a visit, so start with **Log** to watch real traffic, then switch to Deny/429.

## Steps only the human can do

1. **Cloudflare:** sign in to or create the Cloudflare account, then go to Turnstile and **Add widget**. Name it "Al-Rahmah public forms", choose **Managed** mode, and add the production hostname(s). Add `localhost` only if you want to test with real keys locally; the test keys don't need it.
2. **Previews (optional):** hostnames can't use wildcards ([hostname management](https://developers.cloudflare.com/turnstile/concepts/hostname-management/)). A hostname covers its subdomains, but adding `vercel.app` itself isn't something the docs cover (**Unverified**). The simplest option is to keep previews on the test keys.
3. **Copy the site key and secret key.** Keep the secret in a password manager. Never paste it into an issue, a chat or the repo.
4. **Vercel, Environment Variables:** set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Use the real keys for Production. Use the test keys `1x00000000000000000000AA` and `1x0000000000000000000000000000000AA` for Preview and Development. Mark the secret as sensitive. Redeploy afterwards, because the site key is inlined at build.
5. **Vercel Firewall:** open **Firewall**, then **Configure**, then **+ New Rule**. Set the condition to `@vercel/firewall` with Rate limit ID `public-forms`, choose Fixed Window, and start with the **Log** action. Review the changes, then publish.
6. **Vercel plan:** confirm whether the project is on Hobby or Pro, given the non-commercial rule on Hobby and the one-rate-limit-rule cap.
7. **Privacy policy:** needed only if the team later switches to Invisible mode. It must then reference Cloudflare's Turnstile Privacy Addendum.
8. **Supabase:** leave Auth CAPTCHA protection **off** (see above).

## Could not verify

- Whether the widget renders its own text in Swahili.
- What dummy `siteverify` responses return for `hostname` and `action`.
- Whether `checkRateLimit({ headers })` behaves correctly inside a Server Action, and what it does outside Vercel or when the rule ID is missing.
- Whether a Turnstile widget can list `vercel.app` for preview domains.
- Whether Supabase offers any CAPTCHA for PostgREST writes (none is documented).
