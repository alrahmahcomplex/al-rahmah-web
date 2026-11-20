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

// The portal's pages: staff, sign-in and its reset pages, the invite landing
// page, and everything a Discount code agent uses (sign-up, set password,
// their students).
export const PORTAL_PATHS = ["/staff", "/login", "/auth", "/discount-code"] as const

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
export function crossHostRedirects(): Redirect[] {
  return [
    ...PORTAL_PATHS.map((path) => ({
      // `:path*` also matches the bare prefix, so /staff goes too.
      source: `${path}/:path*`,
      has: onHost(PUBLIC_HOST),
      destination: `${PORTAL_ORIGIN}${path}/:path*`,
      permanent: false,
    })),
    // Only the portal installs as an app (lib/portal-app.ts), so the public
    // site serves no manifest of its own.
    { source: "/manifest.webmanifest", has: onHost(PUBLIC_HOST), destination: `${PORTAL_ORIGIN}/manifest.webmanifest`, permanent: false },
    // A Referral link opened on the portal, ?ref= and all.
    { source: "/apply", has: onHost(PORTAL_HOST), destination: `${PUBLIC_ORIGIN}/apply`, permanent: false },
  ]
}

// The portal's root opens sign-in. It comes after the site-root rules in
// next.config.ts, so an invite or reset link that lands on the root still
// reaches its page first.
export function portalRootRedirect(): Redirect {
  return { source: "/", has: onHost(PORTAL_HOST), destination: "/login", permanent: false }
}
