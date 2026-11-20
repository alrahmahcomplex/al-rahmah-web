import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { referralLink } from "@/lib/agent-registration"
import { portalOrigin, publicSiteOrigin } from "@/lib/site-hosts"
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
    "/login",
    "/login/forgot-password",
    "/login/reset-password?token_hash=abc123&type=recovery",
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

  it.each(["/", "/apply", "/apply?ref=AJM-407", "/staffroom", "/logins", "/discount-codes", "/api/language"])(
    "keeps %s",
    async (path) => {
      expect(getRedirectUrl(await open(`${PUBLIC}${path}`))).toBeNull()
    },
  )

  it("still serves the cached copies of / and /apply (ADR 0006)", async () => {
    expect(getRewrittenUrl(await open(`${PUBLIC}/`))).toBe(`${PUBLIC}/by-language/first`)
    expect(getRewrittenUrl(await open(`${PUBLIC}/apply?ref=AJM-407`))).toBe(`${PUBLIC}/by-language/first/apply?ref=AJM-407`)
  })

  it("forwards an invite or reset link on the root to its page, which then moves to the portal", async () => {
    const invite = await open(`${PUBLIC}/?token_hash=abc123&type=invite`)
    expect(getRedirectUrl(invite)).toBe(`${PUBLIC}/auth/confirm?token_hash=abc123&type=invite`)
    expect(getRedirectUrl(await open(getRedirectUrl(invite)!))).toBe(`${PORTAL}/auth/confirm?token_hash=abc123&type=invite`)

    const reset = await open(`${PUBLIC}/?token_hash=abc123&type=recovery`)
    expect(getRedirectUrl(reset)).toBe(`${PUBLIC}/login/reset-password?token_hash=abc123&type=recovery`)
    expect(getRedirectUrl(await open(getRedirectUrl(reset)!))).toBe(`${PORTAL}/login/reset-password?token_hash=abc123&type=recovery`)
  })
})

describe("the portal", () => {
  it("opens sign-in at its root", async () => {
    const response = await open(`${PORTAL}/`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}/login`)
  })

  it("forwards an invite or reset link on its root to its page", async () => {
    expect(getRedirectUrl(await open(`${PORTAL}/?token_hash=abc123&type=invite`))).toBe(
      `${PORTAL}/auth/confirm?token_hash=abc123&type=invite`,
    )
    expect(getRedirectUrl(await open(`${PORTAL}/?token_hash=abc123&type=recovery`))).toBe(
      `${PORTAL}/login/reset-password?token_hash=abc123&type=recovery`,
    )
  })

  it("sends a Referral link to the public site's Admission form, code and all", async () => {
    const response = await open(`${PORTAL}/apply?ref=AJM-407`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PUBLIC}/apply?ref=AJM-407`)
  })

  it.each(["/staff", "/login", "/auth/confirm?token_hash=a&type=invite", "/discount-code", "/discount-code/students"])(
    "serves %s itself",
    async (path) => {
      expect(getRedirectUrl(await open(`${PORTAL}${path}`))).toBeNull()
    },
  )

  it("serves the cached copy of /login/forgot-password", async () => {
    expect(getRewrittenUrl(await open(`${PORTAL}/login/forgot-password`))).toBe(`${PORTAL}/by-language/first/login/forgot-password`)
  })
})

describe("every other host is one site", () => {
  it.each(["http://localhost:3000", "https://al-rahmah-web-git-x-team.vercel.app", "https://al-rahmah-web.vercel.app"])(
    "%s moves nothing",
    async (origin) => {
      for (const path of ["/staff", "/login", "/auth/confirm?token_hash=a&type=invite", "/discount-code", "/apply?ref=AJM-407"]) {
        expect(getRedirectUrl(await open(`${origin}${path}`))).toBeNull()
      }
      expect(getRewrittenUrl(await open(`${origin}/`))).toBe(`${origin}/by-language/first`)
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
    for (const path of ["/staff", "/login", "/discount-code", "/apply?ref=AJM-407", "/"]) {
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
