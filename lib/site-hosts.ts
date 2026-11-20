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

// Sign-in and its reset pages moved from /login to /auth (#497 slice C).
// Each old address goes to its new one, query and all, on every host, so
// bookmarks and links in emails sent before the move keep working.
export const MOVED_SIGN_IN_PATHS = [
  { from: "/login", to: "/auth" },
  { from: "/login/forgot-password", to: "/auth/forgot-password" },
  { from: "/login/reset-password", to: "/auth/reset-password" },
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

type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: { type: "host"; value: string }[]
}

// Next.js reads a `has` value as a whole-value regular expression.
function onHost(host: string) {
  return [{ type: "host" as const, value: host.replaceAll(".", "\\.") }]
}

// Checked before every other redirect, and before proxy.ts runs, so the
// public site never runs the proxy for a portal path. Next.js passes the
// query on to the destination, so links in emails sent before the move keep
// their token_hash. Temporary (307): a browser doesn't remember them, which
// leaves a rollback open.
//
// Each old address takes one hop. The bare prefix has its own rule, because
// `:path*` with nothing after the prefix gives /staff/, which Next.js then
// sends on to /staff with a second redirect. An old /login address goes
// straight to its new portal address.
export function crossHostRedirects(): Redirect[] {
  return [
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

// The old /login addresses on every other host: the portal, localhost and
// Previews. After crossHostRedirects, so the public site has already sent
// them to the portal's new address.
export function movedSignInRedirects(): Redirect[] {
  return MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({ source: from, destination: to, permanent: false }))
}

// The portal's root opens sign-in. It comes after the site-root rules in
// next.config.ts, so an invite or reset link that lands on the root still
// reaches its page first.
export function portalRootRedirect(): Redirect {
  return { source: "/", has: onHost(PORTAL_HOST), destination: "/auth", permanent: false }
}
