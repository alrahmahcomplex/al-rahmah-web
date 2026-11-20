// The two production hosts (#497). The public site keeps the landing page and
// the Admission form; the Admissions Portal (staff and Discount code agents)
// lives on its own subdomain. One app serves both, and paths keep their names:
// only the host changes.
//
// Every other host (localhost, Previews, the production deployment's own
// vercel.app address) is one site serving every page, as before. No rule
// below matches it, and links built for it stay on it.
//
// next.config.ts imports this file, so it uses relative imports only.

export const PUBLIC_HOST = "alrahmahcomplex.or.tz"
export const PORTAL_HOST = "portal.alrahmahcomplex.or.tz"

const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`
const PORTAL_ORIGIN = `https://${PORTAL_HOST}`

// The portal's pages: staff, sign-in with its reset pages and the invite
// landing page (all under /auth), and everything a Discount code agent uses
// (sign-up, set password, their students).
export const PORTAL_PATHS = ["/staff", "/auth", "/discount-code"] as const

// Old addresses of sign-in and its reset pages: /login until #497 slice C,
// and the Discount code pages before one sign-in page for everyone (#264,
// #265). Each goes to its new address, query and all, on every host, so
// bookmarks and links in emails sent before a move keep working.
export const MOVED_SIGN_IN_PATHS = [
  { from: "/login", to: "/auth" },
  { from: "/login/forgot-password", to: "/auth/forgot-password" },
  { from: "/login/reset-password", to: "/auth/reset-password" },
  { from: "/discount-code/sign-in", to: "/auth" },
  { from: "/discount-code/forgot-password", to: "/auth/forgot-password" },
  { from: "/discount-code/reset-password", to: "/auth/reset-password" },
] as const

// An invite or reset link that lands on the site root: one sent with no
// redirect (from the Supabase dashboard, for the first staff member) or
// with one the redirect allow-list refused. Supabase then fills the
// template's {{ .RedirectTo }} with the Site URL. Each goes on to its page,
// query and all, so the home page never reads it.
const ROOT_EMAIL_LINKS = [
  { type: "invite", to: "/auth/confirm" },
  { type: "recovery", to: "/auth/reset-password" },
] as const

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

function onProductionHost(origin: string): boolean {
  const host = hostOf(origin)
  return host === PUBLIC_HOST || host === PORTAL_HOST
}

// Where a Referral link and its share text point: the Admission form on the
// public site, whichever production host the agent is using. Elsewhere the
// request's own origin, so a Preview hands out Preview links.
export function publicSiteOrigin(requestOrigin: string): string {
  return onProductionHost(requestOrigin) ? PUBLIC_ORIGIN : requestOrigin
}

// Where invite, set-password and reset links point: the portal, whichever
// production host the request came in on. Elsewhere the request's own origin.
export function portalOrigin(requestOrigin: string): string {
  return onProductionHost(requestOrigin) ? PORTAL_ORIGIN : requestOrigin
}

type Condition = { type: "host"; value: string } | { type: "query"; key: string; value?: string }

type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: Condition[]
}

// Next.js reads a `has` value as a whole-value regular expression.
function onHost(host: string): Condition[] {
  return [{ type: "host", value: host.replaceAll(".", "\\.") }]
}

function emailLinkOf(type: string): Condition[] {
  return [
    { type: "query", key: "type", value: type },
    { type: "query", key: "token_hash" },
  ]
}

// Checked before every other redirect, and before proxy.ts runs, so the
// public site never runs the proxy for a portal path. Next.js passes the
// query on to the destination, so links in emails sent before the move keep
// their token_hash. Temporary (307): a browser doesn't remember them, which
// leaves a rollback open.
//
// Each old address takes one hop. The bare prefix has its own rule, because
// `:path*` with nothing after the prefix gives /staff/, which Next.js then
// sends on to /staff with a second redirect. An old sign-in address, and an
// email link on the root, go straight to their page on the portal.
export function crossHostRedirects(): Redirect[] {
  return [
    ...ROOT_EMAIL_LINKS.map(({ type, to }) => ({
      source: "/",
      has: [...onHost(PUBLIC_HOST), ...emailLinkOf(type)],
      destination: `${PORTAL_ORIGIN}${to}`,
      permanent: false,
    })),
    ...MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({
      source: from,
      has: onHost(PUBLIC_HOST),
      destination: `${PORTAL_ORIGIN}${to}`,
      permanent: false,
    })),
    ...PORTAL_PATHS.flatMap((path) => [
      { source: path, has: onHost(PUBLIC_HOST), destination: `${PORTAL_ORIGIN}${path}`, permanent: false },
      { source: `${path}/:path+`, has: onHost(PUBLIC_HOST), destination: `${PORTAL_ORIGIN}${path}/:path+`, permanent: false },
    ]),
    // Only the portal installs as an app (lib/portal-app.ts), so the public
    // site serves no manifest of its own.
    { source: "/manifest.webmanifest", has: onHost(PUBLIC_HOST), destination: `${PORTAL_ORIGIN}/manifest.webmanifest`, permanent: false },
    // A Referral link opened on the portal, ?ref= and all.
    { source: "/apply", has: onHost(PORTAL_HOST), destination: `${PUBLIC_ORIGIN}/apply`, permanent: false },
  ]
}

// The old sign-in addresses on every other host: the portal, localhost and
// Previews. After crossHostRedirects, so the public site has already sent
// them to the portal's new address. Temporary, like the rules above: a
// browser that remembered a permanent one would keep asking for /auth after
// a rollback to an app without it.
export function movedSignInRedirects(): Redirect[] {
  return MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({ source: from, destination: to, permanent: false }))
}

// An email link on the root of every other host goes on to its page there.
export function rootEmailLinkRedirects(): Redirect[] {
  return ROOT_EMAIL_LINKS.map(({ type, to }) => ({ source: "/", has: emailLinkOf(type), destination: to, permanent: false }))
}

// The portal's root opens sign-in. It comes after the site-root rules in
// next.config.ts, so an invite or reset link that lands on the root still
// reaches its page first.
export function portalRootRedirect(): Redirect {
  return { source: "/", has: onHost(PORTAL_HOST), destination: "/auth", permanent: false }
}
