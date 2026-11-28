import type { NextConfig } from "next"
import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { DESIGN_COOKIE } from "@/lib/design-site/cookie"
import { designToken } from "@/lib/design-site/token"
import { AGENTS_ORIGIN, DESIGN_ORIGIN, designRewrites, PORTAL_ORIGIN, PUBLIC_ORIGIN } from "@/lib/site-hosts"
import nextConfig from "@/next.config"

// design.alrahmahcomplex.or.tz (design site, prototype v6): its addresses,
// the password gate in front of the design pages, and the kit page's move
// from /staff/kit. The real config is built without DESIGN_SITE_PASSWORD
// here, so it locks every design page; a config with a password is built
// from the same rules for the open cases.

const DESIGN = DESIGN_ORIGIN
const LOCAL = "http://localhost:3000"
const PASSWORD = "sample-password"
const TOKEN = designToken(PASSWORD)

const withPassword: NextConfig = {
  ...nextConfig,
  async rewrites() {
    return { beforeFiles: designRewrites(TOKEN), afterFiles: [], fallback: [] }
  },
}

function open(url: string, options?: { cookies?: Record<string, string> }, config: NextConfig = nextConfig) {
  return unstable_getResponseFromNextConfig({ url, nextConfig: config, ...options })
}

describe("design.alrahmahcomplex.or.tz", () => {
  it("serves the design pages at its root, llms.txt and the MCP server beside them", async () => {
    const opened = { cookies: { [DESIGN_COOKIE]: TOKEN } }
    expect(getRewrittenUrl(await open(`${DESIGN}/`, opened, withPassword))).toBe(`${DESIGN}/design`)
    expect(getRewrittenUrl(await open(`${DESIGN}/connect`, opened, withPassword))).toBe(`${DESIGN}/design/connect`)
    expect(getRewrittenUrl(await open(`${DESIGN}/llms.txt?key=x`, undefined, withPassword))).toBe(`${DESIGN}/design-api/llms?key=x`)
    expect(getRewrittenUrl(await open(`${DESIGN}/mcp`, undefined, withPassword))).toBe(`${DESIGN}/design-api/mcp`)
  })

  it("shows the lock screen at the same address to a browser without the password's cookie", async () => {
    for (const cookies of [undefined, { [DESIGN_COOKIE]: "not-the-token" }, { [DESIGN_COOKIE]: designToken("an-old-password") }]) {
      expect(getRewrittenUrl(await open(`${DESIGN}/`, { cookies }, withPassword))).toBe(`${DESIGN}/design-unlock`)
      expect(getRewrittenUrl(await open(`${DESIGN}/connect`, { cookies }, withPassword))).toBe(`${DESIGN}/design-unlock`)
    }
  })

  it("keeps llms.txt and the MCP server outside the cookie gate: they check the password themselves", async () => {
    expect(getRewrittenUrl(await open(`${DESIGN}/llms.txt`, undefined, withPassword))).toBe(`${DESIGN}/design-api/llms`)
    expect(getRewrittenUrl(await open(`${DESIGN}/mcp`, undefined, withPassword))).toBe(`${DESIGN}/design-api/mcp`)
  })

  it("locks every design page when no password is set", async () => {
    expect(getRewrittenUrl(await open(`${DESIGN}/`, { cookies: { [DESIGN_COOKIE]: TOKEN } }))).toBe(`${DESIGN}/design-unlock`)
    expect(getRewrittenUrl(await open(`${LOCAL}/design/connect`, { cookies: { [DESIGN_COOKIE]: TOKEN } }))).toBe(`${LOCAL}/design-unlock`)
  })

  it("sends the design pages' app addresses to their root addresses", async () => {
    for (const [from, to] of [
      ["/design", "/"],
      ["/design/connect", "/connect"],
      ["/design-unlock", "/"],
    ]) {
      const response = await open(`${DESIGN}${from}`)
      expect(response.status, from).toBe(307)
      expect(getRedirectUrl(response), from).toBe(`${DESIGN}${to}`)
    }
  })

  it("serves nothing else: staff, agent and Admission form pages go to their hosts", async () => {
    expect(getRedirectUrl(await open(`${DESIGN}/staff/applicants`))).toBe(`${PORTAL_ORIGIN}/staff/applicants`)
    expect(getRedirectUrl(await open(`${DESIGN}/auth`))).toBe(`${PORTAL_ORIGIN}/auth`)
    expect(getRedirectUrl(await open(`${DESIGN}/home`))).toBe(`${AGENTS_ORIGIN}/home`)
    expect(getRedirectUrl(await open(`${DESIGN}/apply?ref=AJM-407`))).toBe(`${PUBLIC_ORIGIN}/apply?ref=AJM-407`)
  })

  it("is kept out of search results", async () => {
    const response = await open(`${DESIGN}/`)
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect((await open(`${PUBLIC_ORIGIN}/`)).headers.get("x-robots-tag")).toBeNull()
  })
})

describe("the kit page's move from /staff/kit", () => {
  it("takes every production host to design. in one hop", async () => {
    for (const origin of [PUBLIC_ORIGIN, PORTAL_ORIGIN, AGENTS_ORIGIN, DESIGN]) {
      for (const path of ["/staff/kit", "/staff/kit?tab=interview"]) {
        const response = await open(`${origin}${path}`)
        expect(response.status, `${origin}${path}`).toBe(307)
        expect(getRedirectUrl(response), `${origin}${path}`).toMatch(new RegExp(`^${DESIGN.replaceAll(".", "\\.")}/(\\?|$)`))
      }
    }
  })

  it("opens /design on localhost and Previews", async () => {
    expect(getRedirectUrl(await open(`${LOCAL}/staff/kit`))).toBe(`${LOCAL}/design`)
  })

  it("sends the design pages on the other production hosts to design.", async () => {
    expect(getRedirectUrl(await open(`${PORTAL_ORIGIN}/design`))).toBe(`${DESIGN}/`)
    expect(getRedirectUrl(await open(`${PUBLIC_ORIGIN}/design/connect`))).toBe(`${DESIGN}/connect`)
    expect(getRedirectUrl(await open(`${AGENTS_ORIGIN}/design-unlock`))).toBe(`${DESIGN}/`)
  })
})
