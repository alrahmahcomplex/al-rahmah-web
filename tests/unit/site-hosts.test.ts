import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { referralLink } from "@/lib/agent-registration"
import {
  AGENT_PATHS,
  AGENTS_ORIGIN,
  agentsOrigin,
  allowsSignedInAs,
  crossHostRedirects,
  hostAudience,
  PORTAL_ORIGIN,
  portalOrigin,
  PUBLIC_ORIGIN,
  publicSiteOrigin,
  requestHostAudience,
  STAFF_PATHS,
} from "@/lib/site-hosts"
import nextConfig from "@/next.config"

// The three production hosts (#497, #539).
const PUBLIC = PUBLIC_ORIGIN
const PORTAL = PORTAL_ORIGIN
const AGENTS = AGENTS_ORIGIN

function open(url: string, options?: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  return unstable_getResponseFromNextConfig({ url, nextConfig, ...options })
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
    // An old address with its own rule moves host first, then that rule.
    "/staff/leads/42",
  ])("sends staff/auth %s to the portal, query and all", async (path) => {
    const response = await open(`${PUBLIC}${path}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}${path}`)
  })

  it.each([
    "/discount-code",
    "/discount-code?code=AJM-407",
    "/discount-code/set-password?token_hash=abc123&type=invite",
    "/home",
    "/home?step=Enrolled",
  ])("sends agent %s to the agents host, query and all", async (path) => {
    const response = await open(`${PUBLIC}${path}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}${path}`)
  })

  it("sends /discount-code/students to agents /auth?from=moved in one hop", async () => {
    const response = await open(`${PUBLIC}/discount-code/students`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}/auth?from=moved`)
  })

  // Old sign-in addresses go straight to their new address on the right host,
  // one hop, query and all.
  it.each([
    ["/login", `${PORTAL}/auth`],
    ["/login?next=%2Fstaff%2Fapplicants", `${PORTAL}/auth?next=%2Fstaff%2Fapplicants`],
    ["/login?error=not-staff", `${PORTAL}/auth?error=not-staff`],
    ["/login/forgot-password", `${PORTAL}/auth/forgot-password`],
    ["/login/reset-password?token_hash=abc123&type=recovery", `${PORTAL}/auth/reset-password?token_hash=abc123&type=recovery`],
    ["/discount-code/sign-in", `${AGENTS}/auth`],
    ["/discount-code/forgot-password", `${AGENTS}/auth/forgot-password`],
    ["/discount-code/reset-password?token_hash=abc123&type=recovery", `${AGENTS}/auth/reset-password?token_hash=abc123&type=recovery`],
  ])("sends the old %s straight to %s in one hop", async (from, to) => {
    const response = await open(`${PUBLIC}${from}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(to)
  })

  // On Vercel, `/staff/:path*` with nothing after the prefix sends /staff to
  // /staff/, and Next.js then redirects that a second time. Each bare prefix
  // has its own rule, and no rule can end in an empty `:path*`.
  it("sends each bare staff and agent prefix in one hop without trailing :path*", () => {
    const rules = crossHostRedirects()
    for (const path of STAFF_PATHS) {
      expect(rules).toContainEqual(expect.objectContaining({ source: path, destination: `${PORTAL}${path}` }))
    }
    for (const path of AGENT_PATHS) {
      expect(rules).toContainEqual(expect.objectContaining({ source: path, destination: `${AGENTS}${path}` }))
    }
    expect(rules.filter((rule) => rule.destination.endsWith(":path*"))).toEqual([])
  })

  it.each(["/", "/apply", "/apply?ref=AJM-407", "/staffroom", "/logins", "/authors", "/discount-codes", "/homes", "/api/language"])(
    "keeps %s",
    async (path) => {
      expect(getRedirectUrl(await open(`${PUBLIC}${path}`))).toBeNull()
    },
  )

  it("still serves the cached copies of / and /apply (ADR 0006)", async () => {
    expect(getRewrittenUrl(await open(`${PUBLIC}/`))).toBe(`${PUBLIC}/by-language/first`)
    expect(getRewrittenUrl(await open(`${PUBLIC}/apply?ref=AJM-407`))).toBe(`${PUBLIC}/by-language/first/apply?ref=AJM-407`)
  })

  it("keeps its own icons untouched", async () => {
    for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/icons/favicon-32.png", "/icons/icon-192.png"]) {
      expect(getRewrittenUrl(await open(`${PUBLIC}${path}`))).toBeNull()
      expect(getRedirectUrl(await open(`${PUBLIC}${path}`))).toBeNull()
    }
  })

  it("serves no manifest: only the apps install", async () => {
    const response = await open(`${PUBLIC}/manifest.webmanifest`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}/manifest.webmanifest`)
  })

  it.each([
    ["/?token_hash=abc123&type=invite", "/auth/confirm?token_hash=abc123&type=invite"],
    ["/?token_hash=abc123&type=recovery", "/auth/reset-password?token_hash=abc123&type=recovery"],
  ])("sends an email link on the root, %s, straight to the portal's page", async (from, to) => {
    const response = await open(`${PUBLIC}${from}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}${to}`)
  })
})

describe("the staff portal", () => {
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
    ["/login", `${PORTAL}/auth`],
    ["/login?next=%2Fstaff", `${PORTAL}/auth?next=%2Fstaff`],
    ["/login/forgot-password", `${PORTAL}/auth/forgot-password`],
    ["/login/reset-password?token_hash=abc123&type=recovery", `${PORTAL}/auth/reset-password?token_hash=abc123&type=recovery`],
    ["/discount-code/sign-in", `${AGENTS}/auth`],
    ["/discount-code/forgot-password", `${AGENTS}/auth/forgot-password`],
    ["/discount-code/reset-password?token_hash=abc123&type=recovery", `${AGENTS}/auth/reset-password?token_hash=abc123&type=recovery`],
  ])("sends the old %s straight to %s in one hop", async (from, to) => {
    const response = await open(`${PORTAL}${from}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(to)
  })

  it("sends /discount-code/students to agents /auth?from=moved in one hop", async () => {
    const response = await open(`${PORTAL}/discount-code/students`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}/auth?from=moved`)
  })

  it.each([
    "/discount-code",
    "/discount-code?code=AJM-407",
    "/discount-code/set-password?token_hash=abc123&type=invite",
    "/home",
    "/home?step=Enrolled",
  ])("sends agent %s to agents in one hop", async (path) => {
    const response = await open(`${PORTAL}${path}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}${path}`)
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
    "/manifest.webmanifest",
  ])("serves %s itself", async (path) => {
    expect(getRedirectUrl(await open(`${PORTAL}${path}`))).toBeNull()
  })

  it("serves the portal's cached copy of /auth/forgot-password and keeps portal icons", async () => {
    expect(getRewrittenUrl(await open(`${PORTAL}/auth/forgot-password`))).toBe(`${PORTAL}/by-language/first/auth/forgot-password`)
    expect(getRewrittenUrl(await open(`${PORTAL}/manifest.webmanifest`))).toBeNull()
    expect(getRewrittenUrl(await open(`${PORTAL}/favicon.ico`))).toBeNull()
    expect(getRewrittenUrl(await open(`${PORTAL}/icons/icon-192.png`))).toBeNull()
  })
})

describe("the agents app", () => {
  it("opens sign-in at its root", async () => {
    const response = await open(`${AGENTS}/`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}/auth`)
  })

  it("forwards root email links to the right agent pages", async () => {
    expect(getRedirectUrl(await open(`${AGENTS}/?token_hash=abc123&type=invite`))).toBe(
      `${AGENTS}/discount-code/set-password?token_hash=abc123&type=invite`,
    )
    expect(getRedirectUrl(await open(`${AGENTS}/?token_hash=abc123&type=recovery`))).toBe(
      `${AGENTS}/auth/reset-password?token_hash=abc123&type=recovery`,
    )
  })

  it.each([
    "/staff",
    "/staff/applicants/7f1c?tab=history",
    "/auth/confirm?token_hash=abc123&type=invite",
  ])("sends staff %s to the portal in one hop", async (path) => {
    const response = await open(`${AGENTS}${path}`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PORTAL}${path}`)
  })

  it("sends a Referral link to the public site's Admission form, code and all", async () => {
    const response = await open(`${AGENTS}/apply?ref=AJM-407`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${PUBLIC}/apply?ref=AJM-407`)
  })

  it("sends /discount-code/students to /home in one hop", async () => {
    const response = await open(`${AGENTS}/discount-code/students`)

    expect(response.status).toBe(307)
    expect(getRedirectUrl(response)).toBe(`${AGENTS}/home`)
  })

  it.each(["/auth", "/auth/reset-password?token_hash=a&type=recovery", "/discount-code", "/discount-code/set-password?token_hash=a&type=invite", "/home"])(
    "serves %s itself",
    async (path) => {
      expect(getRedirectUrl(await open(`${AGENTS}${path}`))).toBeNull()
    },
  )

  it("rewrites manifest, icons, favicon, apple-touch-icon and cached forgot-password to the agents copies", async () => {
    expect(getRewrittenUrl(await open(`${AGENTS}/manifest.webmanifest`))).toBe(`${AGENTS}/agents-manifest.webmanifest`)
    expect(getRewrittenUrl(await open(`${AGENTS}/favicon.ico`))).toBe(`${AGENTS}/agents/favicon.ico`)
    expect(getRewrittenUrl(await open(`${AGENTS}/apple-touch-icon.png`))).toBe(`${AGENTS}/agents/apple-touch-icon.png`)
    expect(getRewrittenUrl(await open(`${AGENTS}/icons/favicon-32.png`))).toBe(`${AGENTS}/agents/icons/favicon-32.png`)
    expect(getRewrittenUrl(await open(`${AGENTS}/icons/icon-192.png`))).toBe(`${AGENTS}/agents/icons/icon-192.png`)
    expect(getRewrittenUrl(await open(`${AGENTS}/auth/forgot-password`))).toBe(`${AGENTS}/by-language/first/agents-auth/forgot-password`)
    expect(getRewrittenUrl(await open(`${AGENTS}/auth/forgot-password`, { cookies: { lang: "en" } }))).toBe(
      `${AGENTS}/by-language/en/agents-auth/forgot-password`,
    )
    expect(getRewrittenUrl(await open(`${AGENTS}/auth/forgot-password`, { cookies: { lang: "sw" } }))).toBe(
      `${AGENTS}/by-language/sw/agents-auth/forgot-password`,
    )
    expect(getRewrittenUrl(await open(`${AGENTS}/auth/forgot-password`, { cookies: { lang: "" } }))).toBe(
      `${AGENTS}/by-language/sw/agents-auth/forgot-password`,
    )
  })
})

describe("every other host is one site", () => {
  it.each(["http://localhost:3000", "https://al-rahmah-web-git-x-team.vercel.app", "https://al-rahmah-web.vercel.app"])(
    "%s moves nothing across hosts",
    async (origin) => {
      for (const path of [
        "/staff",
        "/auth",
        "/auth/confirm?token_hash=a&type=invite",
        "/discount-code",
        "/home",
        "/apply?ref=AJM-407",
        "/manifest.webmanifest",
      ]) {
        expect(getRedirectUrl(await open(`${origin}${path}`))).toBeNull()
      }
      expect(getRewrittenUrl(await open(`${origin}/`))).toBe(`${origin}/by-language/first`)
      expect(getRewrittenUrl(await open(`${origin}/manifest.webmanifest`))).toBeNull()
      expect(getRewrittenUrl(await open(`${origin}/favicon.ico`))).toBeNull()
    },
  )

  it.each(["http://localhost:3000", "https://al-rahmah-web-git-x-team.vercel.app"])(
    "%s moves old sign-in addresses and /discount-code/students on the same host",
    async (origin) => {
      for (const [from, to] of [
        ["/login?next=%2Fstaff", "/auth?next=%2Fstaff"],
        ["/login/forgot-password", "/auth/forgot-password"],
        ["/login/reset-password?token_hash=a&type=recovery", "/auth/reset-password?token_hash=a&type=recovery"],
        ["/discount-code/sign-in", "/auth"],
        ["/discount-code/students", "/home"],
      ]) {
        const response = await open(`${origin}${from}`)
        expect(response.status).toBe(307)
        expect(getRedirectUrl(response)).toBe(`${origin}${to}`)
      }
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
    "https://agentsXalrahmahcomplex.or.tz",
    "https://agents-alrahmahcomplex-or-tz",
    "https://evil.alrahmahcomplex.or.tz",
    "https://alrahmahcomplex.or.tz.evil.example",
  ])("%s moves nothing and rewrites no app icon", async (origin) => {
    for (const path of ["/staff", "/auth", "/discount-code", "/home", "/apply?ref=AJM-407", "/"]) {
      expect(getRedirectUrl(await open(`${origin}${path}`))).toBeNull()
    }
    expect(getRewrittenUrl(await open(`${origin}/manifest.webmanifest`))).toBeNull()
    expect(getRewrittenUrl(await open(`${origin}/favicon.ico`))).toBeNull()
  })
})

describe("links the app hands out", () => {
  it("always point a Referral link at the public site from any production host", () => {
    for (const origin of [PUBLIC, PORTAL, AGENTS]) {
      expect(referralLink(origin, "AJM-407")).toBe(`${PUBLIC}/apply?ref=AJM-407`)
      expect(publicSiteOrigin(origin)).toBe(PUBLIC)
    }
  })

  it("point staff links at the portal and agent links at agents from any production host", () => {
    for (const origin of [PUBLIC, PORTAL, AGENTS]) {
      expect(portalOrigin(origin)).toBe(PORTAL)
      expect(agentsOrigin(origin)).toBe(AGENTS)
    }
  })

  it.each(["http://localhost:3282", "https://al-rahmah-web-git-x-team.vercel.app", "https://evil.alrahmahcomplex.or.tz", "not a url"])(
    "stay on %s",
    (origin) => {
      expect(publicSiteOrigin(origin)).toBe(origin)
      expect(portalOrigin(origin)).toBe(origin)
      expect(agentsOrigin(origin)).toBe(origin)
    },
  )
})

describe("host audience classification", () => {
  it("recognises portal, agents and every other host", () => {
    expect(hostAudience("portal.alrahmahcomplex.or.tz")).toBe("portal")
    expect(hostAudience("PORTAL.ALRAHMAHCOMPLEX.OR.TZ:443")).toBe("portal")
    expect(hostAudience(PORTAL)).toBe("portal")
    expect(hostAudience("agents.alrahmahcomplex.or.tz")).toBe("agents")
    expect(hostAudience(AGENTS)).toBe("agents")
    expect(hostAudience(PUBLIC)).toBe("both")
    expect(hostAudience("localhost:3000")).toBe("both")
    expect(hostAudience("evil.alrahmahcomplex.or.tz")).toBe("both")
    expect(hostAudience(null)).toBe("both")
  })

  it("prefers x-forwarded-host over host", () => {
    expect(requestHostAudience(new Headers({ "x-forwarded-host": "agents.alrahmahcomplex.or.tz", host: "localhost:3000" }))).toBe("agents")
    expect(requestHostAudience(new Headers({ host: "portal.alrahmahcomplex.or.tz" }))).toBe("portal")
    expect(requestHostAudience(new Headers({ host: "localhost:3000" }))).toBe("both")
  })

  it("checks which kind of account each host allows", () => {
    expect(allowsSignedInAs("portal", "staff")).toBe(true)
    expect(allowsSignedInAs("portal", "agent")).toBe(false)
    expect(allowsSignedInAs("agents", "agent")).toBe(true)
    expect(allowsSignedInAs("agents", "staff")).toBe(false)
    expect(allowsSignedInAs("both", "staff")).toBe(true)
    expect(allowsSignedInAs("both", "agent")).toBe(true)
  })
})
