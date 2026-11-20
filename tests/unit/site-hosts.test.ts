import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { referralLink } from "@/lib/agent-registration"
import { crossHostRedirects, PORTAL_PATHS, portalOrigin, publicSiteOrigin } from "@/lib/site-hosts"
import nextConfig from "@/next.config"

// The Admissions Portal on its own host (#497).
const PUBLIC = "https://alrahmahcomplex.or.tz"
const PORTAL = "https://portal.alrahmahcomplex.or.tz"

function open(url: string) {
  return unstable_getResponseFromNextConfig({ url, nextConfig })
}

describe("the public site", () => {
  it.each([
    "/staff",
    "/staff/applicants/7f1c?tab=history",
    "/auth",
    "/auth?error=not-staff",
    "/auth/forgot-password",
    "/auth/reset-password?token_hash=abc123&type=recovery",
    "/auth/confirm?token_hash=abc123&type=invite",
    "/auth/callback?code=xyz&next=%2Fstaff",
    "/discount-code",
    "/discount-code?code=AJM-407",
    "/discount-code/set-password?token_hash=abc123&type=invite",
    "/discount-code/students",
    // Old addresses keep working: they move host first, then their own rule.
    "/discount-code/reset-password?token_hash=abc123&type=recovery",
    "/staff/leads/42",
  ])("sends %s to the portal, query and all", async (path) => {
    const response = await open(`${PUBLIC}${path}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}${path}`)
  })

  // Sign-in moved from /login to /auth (slice C): an old address goes
  // straight to its new portal address, one hop, query and all.
  it.each([
    ["/login", "/auth"],
    ["/login?next=%2Fstaff%2Fapplicants", "/auth?next=%2Fstaff%2Fapplicants"],
    ["/login?error=not-staff", "/auth?error=not-staff"],
    ["/login/forgot-password", "/auth/forgot-password"],
    ["/login/reset-password?token_hash=abc123&type=recovery", "/auth/reset-password?token_hash=abc123&type=recovery"],
  ])("sends the old %s to the portal's %s", async (from, to) => {
    const response = await open(`${PUBLIC}${from}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}${to}`)
  })

  // On Vercel, `/staff/:path*` with nothing after the prefix sends /staff to
  // /staff/, and Next.js then redirects that a second time. The test helper
  // doesn't show the slash, so this reads the rules: each bare prefix has its
  // own rule, and no rule can end in an empty `:path*`.
  it.each(PORTAL_PATHS)("sends the bare %s to the portal in one hop", (path) => {
    const rules = crossHostRedirects()
    expect(rules).toContainEqual(expect.objectContaining({ source: path, destination: `${PORTAL}${path}` }))
    expect(rules.filter((rule) => rule.destination.endsWith(":path*"))).toEqual([])
  })

  it.each(["/", "/apply", "/apply?ref=AJM-407", "/staffroom", "/logins", "/authors", "/discount-codes", "/api/language"])(
    "keeps %s",
    async (path) => {
      expect(getRedirectUrl(await open(`${PUBLIC}${path}`))).toBeNull()
    },
  )

  it("still serves the cached copies of / and /apply (ADR 0006)", async () => {
    expect(getRewrittenUrl(await open(`${PUBLIC}/`))).toBe(`${PUBLIC}/by-language/first`)
    expect(getRewrittenUrl(await open(`${PUBLIC}/apply?ref=AJM-407`))).toBe(`${PUBLIC}/by-language/first/apply?ref=AJM-407`)
  })

  it("serves no manifest: only the portal installs as an app", async () => {
    const response = await open(`${PUBLIC}/manifest.webmanifest`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}/manifest.webmanifest`)
  })

  it("forwards an invite or reset link on the root to its page, which then moves to the portal", async () => {
    const invite = await open(`${PUBLIC}/?token_hash=abc123&type=invite`)
    expect(getRedirectUrl(invite)).toBe(`${PUBLIC}/auth/confirm?token_hash=abc123&type=invite`)
    expect(getRedirectUrl(await open(getRedirectUrl(invite)!))).toBe(`${PORTAL}/auth/confirm?token_hash=abc123&type=invite`)

    const reset = await open(`${PUBLIC}/?token_hash=abc123&type=recovery`)
    expect(getRedirectUrl(reset)).toBe(`${PUBLIC}/auth/reset-password?token_hash=abc123&type=recovery`)
    expect(getRedirectUrl(await open(getRedirectUrl(reset)!))).toBe(`${PORTAL}/auth/reset-password?token_hash=abc123&type=recovery`)
  })
})

describe("the portal", () => {
  it("opens sign-in at its root", async () => {
    const response = await open(`${PORTAL}/`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}/auth`)
  })

  it("forwards an invite or reset link on its root to its page", async () => {
    expect(getRedirectUrl(await open(`${PORTAL}/?token_hash=abc123&type=invite`))).toBe(
      `${PORTAL}/auth/confirm?token_hash=abc123&type=invite`,
    )
    expect(getRedirectUrl(await open(`${PORTAL}/?token_hash=abc123&type=recovery`))).toBe(
      `${PORTAL}/auth/reset-password?token_hash=abc123&type=recovery`,
    )
  })

  it.each([
    ["/login", "/auth"],
    ["/login?next=%2Fstaff", "/auth?next=%2Fstaff"],
    ["/login/forgot-password", "/auth/forgot-password"],
    ["/login/reset-password?token_hash=abc123&type=recovery", "/auth/reset-password?token_hash=abc123&type=recovery"],
    ["/discount-code/sign-in", "/auth"],
  ])("sends the old %s to %s", async (from, to) => {
    expect(getRedirectUrl(await open(`${PORTAL}${from}`))).toBe(`${PORTAL}${to}`)
  })

  it("sends a Referral link to the public site's Admission form, code and all", async () => {
    const response = await open(`${PORTAL}/apply?ref=AJM-407`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PUBLIC}/apply?ref=AJM-407`)
  })

  it.each([
    "/staff",
    "/auth",
    "/auth/confirm?token_hash=a&type=invite",
    "/auth/callback?code=xyz",
    "/auth/reset-password?token_hash=a&type=recovery",
    "/discount-code",
    "/discount-code/students",
    "/manifest.webmanifest",
  ])(
    "serves %s itself",
    async (path) => {
      expect(getRedirectUrl(await open(`${PORTAL}${path}`))).toBeNull()
    },
  )

  it("serves the cached copy of /auth/forgot-password", async () => {
    expect(getRewrittenUrl(await open(`${PORTAL}/auth/forgot-password`))).toBe(`${PORTAL}/by-language/first/auth/forgot-password`)
  })
})

describe("every other host is one site", () => {
  it.each(["http://localhost:3000", "https://al-rahmah-web-git-x-team.vercel.app", "https://al-rahmah-web.vercel.app"])(
    "%s moves nothing",
    async (origin) => {
      for (const path of [
        "/staff",
        "/auth",
        "/auth/confirm?token_hash=a&type=invite",
        "/discount-code",
        "/apply?ref=AJM-407",
        "/manifest.webmanifest",
      ]) {
        expect(getRedirectUrl(await open(`${origin}${path}`))).toBeNull()
      }
      expect(getRewrittenUrl(await open(`${origin}/`))).toBe(`${origin}/by-language/first`)
      // Only the move to /auth: same host, query and all.
      expect(getRedirectUrl(await open(`${origin}/login?next=%2Fstaff`))).toBe(`${origin}/auth?next=%2Fstaff`)
    },
  )
})

// Next.js reads a host condition as a regular expression, so an unescaped dot
// would match any character.
describe("hosts that only look like ours", () => {
  it.each([
    "https://alrahmahcomplexXorXtz",
    "https://alrahmahcomplex-or-tz",
    "https://portalXalrahmahcomplex.or.tz",
    "https://portal-alrahmahcomplex-or-tz",
    "https://evil.alrahmahcomplex.or.tz",
    "https://alrahmahcomplex.or.tz.evil.example",
  ])("%s moves nothing", async (origin) => {
    for (const path of ["/staff", "/auth", "/discount-code", "/apply?ref=AJM-407", "/"]) {
      expect(getRedirectUrl(await open(`${origin}${path}`))).toBeNull()
    }
  })
})

describe("links the app hands out", () => {
  it("point a Referral link at the public site from either production host", () => {
    expect(referralLink(PORTAL, "AJM-407")).toBe(`${PUBLIC}/apply?ref=AJM-407`)
    expect(referralLink(PUBLIC, "AJM-407")).toBe(`${PUBLIC}/apply?ref=AJM-407`)
    expect(publicSiteOrigin(PORTAL)).toBe(PUBLIC)
  })

  it("point invite and reset links at the portal from either production host", () => {
    expect(portalOrigin(PUBLIC)).toBe(PORTAL)
    expect(portalOrigin(PORTAL)).toBe(PORTAL)
  })

  it.each(["http://localhost:3282", "https://al-rahmah-web-git-x-team.vercel.app", "https://evil.alrahmahcomplex.or.tz", "not a url"])(
    "stay on %s",
    (origin) => {
      expect(publicSiteOrigin(origin)).toBe(origin)
      expect(portalOrigin(origin)).toBe(origin)
    },
  )
})
