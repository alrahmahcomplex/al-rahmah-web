// The three production hosts (#497, #539). The public site keeps the landing
// page and the Admission form; the Admissions Portal (staff) lives on portal.;
// Discount code holders have their own address and installable app on agents.
// One Next.js app serves all three.
//
// Every other host (localhost, Previews, the production deployment's own
// vercel.app address) is one site serving every page, as before. No rule
// below matches it, and links built for it stay on it.
//
// next.config.ts imports this file, so it uses relative imports only.

import { LANGUAGE_STATE_PREFIX, languageRewritesFor, type LanguageRewrite } from "./language-state"

export const PUBLIC_HOST = "alrahmahcomplex.or.tz"
export const PORTAL_HOST = "portal.alrahmahcomplex.or.tz"
export const AGENTS_HOST = "agents.alrahmahcomplex.or.tz"

export const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`
export const PORTAL_ORIGIN = `https://${PORTAL_HOST}`
export const AGENTS_ORIGIN = `https://${AGENTS_HOST}`

// The staff portal's pages: staff screens and sign-in (/auth is shared with
// agents., except /auth/confirm which belongs to staff).
export const STAFF_PATHS = ["/staff", "/auth"] as const
// The agents app's pages: sign-up, set password, and the dashboard at /home.
export const AGENT_PATHS = ["/discount-code", "/home"] as const

// Old addresses of sign-in and its reset pages: /login until #497 slice C
// (staff), and the Discount code pages before one sign-in page for everyone
// (#264, #265; agents). Each goes to its new address on the right host, query
// and all, in one hop, so bookmarks and links in old emails keep working.
const STAFF_MOVED_SIGN_IN_PATHS = [
  { from: "/login", to: "/auth" },
  { from: "/login/forgot-password", to: "/auth/forgot-password" },
  { from: "/login/reset-password", to: "/auth/reset-password" },
] as const

const AGENT_MOVED_SIGN_IN_PATHS = [
  { from: "/discount-code/sign-in", to: "/auth" },
  { from: "/discount-code/forgot-password", to: "/auth/forgot-password" },
  { from: "/discount-code/reset-password", to: "/auth/reset-password" },
] as const

export const MOVED_SIGN_IN_PATHS = [...STAFF_MOVED_SIGN_IN_PATHS, ...AGENT_MOVED_SIGN_IN_PATHS] as const

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
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

function onProductionHost(origin: string): boolean {
  const host = hostOf(origin)
  return host === PUBLIC_HOST || host === PORTAL_HOST || host === AGENTS_HOST
}

// Which kind of sign-in a host serves (#539): portal takes staff only, agents
// takes Discount code holders only, and every other host serves both.
export type HostAudience = "portal" | "agents" | "both"

export function hostAudience(hostOrOrigin: string | null | undefined): HostAudience {
  if (!hostOrOrigin) return "both"
  const raw = hostOrOrigin.split(",")[0]?.trim().toLowerCase() ?? ""
  if (!raw) return "both"
  const host = raw.includes("://") ? hostOf(raw) : raw.replace(/:\d+$/, "")
  if (host === PORTAL_HOST) return "portal"
  if (host === AGENTS_HOST) return "agents"
  return "both"
}

export function requestHostAudience(headers: Pick<Headers, "get">): HostAudience {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  return hostAudience(forwarded || headers.get("host"))
}

export function allowsSignedInAs(audience: HostAudience, as: "staff" | "agent"): boolean {
  if (audience === "both") return true
  return audience === "portal" ? as === "staff" : as === "agent"
}

// Where a Referral link and its share text point: the Admission form on the
// public site, whichever production host the request came in on. Elsewhere
// the request's own origin, so a Preview hands out Preview links.
export function publicSiteOrigin(requestOrigin: string): string {
  return onProductionHost(requestOrigin) ? PUBLIC_ORIGIN : requestOrigin
}

// Where staff invite and reset links point: the portal, whichever production
// host the request came in on. Elsewhere the request's own origin.
export function portalOrigin(requestOrigin: string): string {
  return onProductionHost(requestOrigin) ? PORTAL_ORIGIN : requestOrigin
}

// Where Discount code invite, set-password, reset and self-confirm links
// point: the agents host from any production host, or the request's own
// origin elsewhere (#539).
export function agentsOrigin(requestOrigin: string): string {
  return onProductionHost(requestOrigin) ? AGENTS_ORIGIN : requestOrigin
}

type HostCondition = { type: "host"; value: string }
type Condition = HostCondition | { type: "query"; key: string; value?: string }

type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: Condition[]
}

// Next.js reads a `has` value as a whole-value regular expression.
function onHost(host: string): HostCondition[] {
  return [{ type: "host", value: host.replaceAll(".", "\\.") }]
}

function emailLinkOf(type: string): Condition[] {
  return [
    { type: "query", key: "type", value: type },
    { type: "query", key: "token_hash" },
  ]
}

function prefixRedirects(host: string, origin: string, paths: readonly string[]): Redirect[] {
  return paths.flatMap((path) => [
    { source: path, has: onHost(host), destination: `${origin}${path}`, permanent: false },
    { source: `${path}/:path+`, has: onHost(host), destination: `${origin}${path}/:path+`, permanent: false },
  ])
}

// Checked before every other redirect, and before proxy.ts runs, so each host
// never runs the proxy for another host's paths. Next.js passes the query on
// to the destination, so links in emails sent before a move keep their
// token_hash. Temporary (307): a browser doesn't remember them, which leaves
// a rollback open.
//
// Each old address takes one hop. The bare prefix has its own rule, because
// `:path*` with nothing after the prefix gives /staff/, which Next.js then
// sends on to /staff with a second redirect. Specific moved paths (old
// sign-in addresses, /discount-code/students, root email links) come before
// the general prefix rules so they reach their final address in one hop.
export function crossHostRedirects(): Redirect[] {
  return [
    // Public host: root email links, old sign-in addresses, old students page,
    // then staff paths to portal and agent paths to agents.
    ...ROOT_EMAIL_LINKS.map(({ type, to }) => ({
      source: "/",
      has: [...onHost(PUBLIC_HOST), ...emailLinkOf(type)],
      destination: `${PORTAL_ORIGIN}${to}`,
      permanent: false,
    })),
    ...STAFF_MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({
      source: from,
      has: onHost(PUBLIC_HOST),
      destination: `${PORTAL_ORIGIN}${to}`,
      permanent: false,
    })),
    ...AGENT_MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({
      source: from,
      has: onHost(PUBLIC_HOST),
      destination: `${AGENTS_ORIGIN}${to}`,
      permanent: false,
    })),
    { source: "/discount-code/students", has: onHost(PUBLIC_HOST), destination: `${AGENTS_ORIGIN}/auth?from=moved`, permanent: false },
    ...prefixRedirects(PUBLIC_HOST, PORTAL_ORIGIN, STAFF_PATHS),
    ...prefixRedirects(PUBLIC_HOST, AGENTS_ORIGIN, AGENT_PATHS),
    // Only portal and agents install as apps (lib/portal-app.ts), so the
    // public site serves no manifest of its own.
    { source: "/manifest.webmanifest", has: onHost(PUBLIC_HOST), destination: `${PORTAL_ORIGIN}/manifest.webmanifest`, permanent: false },

    // Portal host: agent paths move to agents in one hop; Referral links go
    // to the public site.
    ...AGENT_MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({
      source: from,
      has: onHost(PORTAL_HOST),
      destination: `${AGENTS_ORIGIN}${to}`,
      permanent: false,
    })),
    { source: "/discount-code/students", has: onHost(PORTAL_HOST), destination: `${AGENTS_ORIGIN}/auth?from=moved`, permanent: false },
    ...prefixRedirects(PORTAL_HOST, AGENTS_ORIGIN, AGENT_PATHS),
    { source: "/apply", has: onHost(PORTAL_HOST), destination: `${PUBLIC_ORIGIN}/apply`, permanent: false },

    // Agents host: staff paths and staff invite confirmation go to portal;
    // Referral links go to the public site; an invite token on root opens the
    // agent set-password page.
    ...prefixRedirects(AGENTS_HOST, PORTAL_ORIGIN, ["/staff", "/auth/confirm"]),
    { source: "/apply", has: onHost(AGENTS_HOST), destination: `${PUBLIC_ORIGIN}/apply`, permanent: false },
    {
      source: "/",
      has: [...onHost(AGENTS_HOST), ...emailLinkOf("invite")],
      destination: "/discount-code/set-password",
      permanent: false,
    },
  ]
}

// The old sign-in addresses on every host where crossHostRedirects didn't
// already move them (the right production host, localhost and Previews).
// Temporary, like the rules above: a browser that remembered a permanent one
// would keep asking for /auth after a rollback to an app without it.
export function movedSignInRedirects(): Redirect[] {
  return MOVED_SIGN_IN_PATHS.map(({ from, to }) => ({ source: from, destination: to, permanent: false }))
}

// The agent dashboard moved from /discount-code/students to /home (#539).
// Portal and public already sent it to agents /auth?from=moved above; on
// agents, localhost and Previews it lands on /home in one hop.
export function movedAgentStudentsRedirect(): Redirect {
  return { source: "/discount-code/students", destination: "/home", permanent: false }
}

// An email link on the root of every other host goes on to its page there.
export function rootEmailLinkRedirects(): Redirect[] {
  return ROOT_EMAIL_LINKS.map(({ type, to }) => ({ source: "/", has: emailLinkOf(type), destination: to, permanent: false }))
}

// Both app hosts open sign-in at their root. Placed after rootEmailLinkRedirects
// in next.config.ts, so an invite or reset link on the root still reaches its
// page first.
export function appRootRedirects(): Redirect[] {
  return [
    { source: "/", has: onHost(PORTAL_HOST), destination: "/auth", permanent: false },
    { source: "/", has: onHost(AGENTS_HOST), destination: "/auth", permanent: false },
  ]
}

// Per-host manifest, icons and cached /auth/forgot-password theme on
// agents.alrahmahcomplex.or.tz (#539). Placed before languageStateRewrites in
// next.config.ts beforeFiles so the public site and staff portal keep their
// own icons and manifest unchanged, and /auth/forgot-password stays static
// (ADR 0006).
export function agentsHostRewrites(): LanguageRewrite[] {
  const agents = onHost(AGENTS_HOST)
  return [
    { source: "/manifest.webmanifest", has: agents, destination: "/agents-manifest.webmanifest" },
    { source: "/favicon.ico", has: agents, destination: "/agents/favicon.ico" },
    { source: "/apple-touch-icon.png", has: agents, destination: "/agents/apple-touch-icon.png" },
    { source: "/icons/:path+", has: agents, destination: "/agents/icons/:path+" },
    ...languageRewritesFor("/auth/forgot-password", (state) => `${LANGUAGE_STATE_PREFIX}/${state}/agents-auth/forgot-password`, agents),
  ]
}
