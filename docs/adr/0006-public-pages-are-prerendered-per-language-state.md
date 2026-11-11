# 6. Public pages are prerendered once per language state

Date: 2026-11-11

## Status

Accepted

## Context

Every public page read the `lang` cookie with `cookies()` (`getLanguage()`), and in
Next.js 16 one such read makes the whole route render on demand. Functions run in
Dublin (`dub1`), so a parent in Tanzania waited for a round trip to Europe before
the landing page or the Admission form appeared: 0.5 to 0.7 s to first byte, with
`X-Vercel-Cache: MISS` on every visit (#286).

The page still has to arrive in the visitor's language from the first byte, the
switch on `/` has to work without JavaScript, and switching on `/apply` must not
lose what a parent typed. Picking the language in the browser would flash Swahili
at English readers and break the no-JavaScript switch. `cacheComponents` would
leave an almost empty static shell, since language decides the whole page, and it
changes the staff side too. Language in the address (`/en/apply`) would change
links already shared on WhatsApp.

## Decision

`/`, `/apply` and `/login/forgot-password` live under
`app/by-language/[state]/`, built at deploy time for three states with
`generateStaticParams` and `dynamicParams = false`:

| State | `lang` cookie | Page |
|---|---|---|
| `first` | none | Swahili, with the first-visit language card |
| `en` | `en` | English |
| `sw` | any other value, empty included | Swahili, no card |

The pages take the state from the route parameter and read nothing from the
request. `beforeFiles` rewrites in `next.config.ts` (`languageStateRewrites()` in
`lib/language-state.ts`) send the public address to the copy for the visitor's
cookie with `has` and `missing` conditions, so Vercel's CDN serves the copy with no
function run and the address bar keeps the public address. A redirect sends a
direct visit to `/by-language/...` back to the public address.

The language switch on these pages:

- **Without JavaScript**, posts `setLanguage` with the page's public address as
  `return_to`. The action sets the cookie and redirects there (replacing the
  history entry), and the new cookie picks the other copy. Only the cached public
  addresses are accepted.
- **With JavaScript on `/`**, does the same; the page has no entries to keep.
- **With JavaScript on `/apply` and `/login/forgot-password`**, sets the cookie
  with a plain POST to `/api/language` and then changes the words in the
  browser (`components/page-language.tsx`). Not the Server Action: an action
  that sets a cookie makes Next.js render the page again, and that render is
  the copy for the cookie the request carried, which can be a different copy
  from the one on screen and would remount the form. The first-visit card on
  these pages uses the same POST. The page's words come from a
  client-side language that starts as the copy's and follows the switch, so the
  form never remounts. The value lives in the root layout, so a copy brought back
  from the router's cache shows the language the cookie now holds.

Nothing in a cached copy belongs to one visitor. On `/apply` the form reads `?ref=`
and the `discount_code` cookie in the browser after it loads. The admission years
are the build's in the HTML; the form works them out again from the browser's clock
as it opens, and a refused year comes back with the server's years, so the year
tiles change in place without a fresh render.

The sign-in, reset and Discount code pages keep reading the cookie per request:
they read the session, the Standard discount or a one-time link token.

## Consequences

- A new public page that should be cached goes under `app/by-language/[state]/`
  and into `CACHED_PUBLIC_PATHS`; its words come from the route parameter, and a
  form on it uses the in-place switch.
- The proxy matcher doesn't change: rewrites run no app code.
- `has` and `missing` cookie conditions treat an empty `lang=` as no cookie.
  A `header` condition on the raw Cookie header catches it before the
  `missing` rule, so an empty value is Swahili with no card, as it was for
  `getLanguage()` (#292).
- If the visitor changes language in one tab, another tab already open keeps its
  language until it loads a page.
