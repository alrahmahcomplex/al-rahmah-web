import { describe, expect, it } from "vitest"

import { designPassword, designToken, isDesignPassword } from "@/lib/design-site/token"
import { MAX_TRIES, TRY_WINDOW_MS, tryLimiter } from "@/lib/design-site/tries"

// The design site's password and its cookie token (lib/design-site/token.ts),
// and the wrong-try limit the lock screen, llms.txt and the MCP server share.

describe("the design site password", () => {
  it("is read from DESIGN_SITE_PASSWORD, trimmed; none means the site stays locked", () => {
    expect(designPassword({ DESIGN_SITE_PASSWORD: "  open sesame " })).toBe("open sesame")
    expect(designPassword({ DESIGN_SITE_PASSWORD: "   " })).toBeNull()
    expect(designPassword({})).toBeNull()
  })

  it("makes the same 64-character token for the same password, and another for another", () => {
    const token = designToken("sample-password")
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(designToken("sample-password")).toBe(token)
    expect(designToken("sample-password2")).not.toBe(token)
    // The token is never the password itself.
    expect(token).not.toContain("sample-password")
  })

  it("accepts only the password itself", () => {
    expect(isDesignPassword("sample-password", "sample-password")).toBe(true)
    expect(isDesignPassword("sample-passwor", "sample-password")).toBe(false)
    expect(isDesignPassword("Sample-password", "sample-password")).toBe(false)
    expect(isDesignPassword("", "sample-password")).toBe(false)
    expect(isDesignPassword(null, "sample-password")).toBe(false)
    expect(isDesignPassword("anything", null)).toBe(false)
  })
})

describe("the wrong-try limit", () => {
  it("lets an address try five wrong passwords, then makes it wait ten minutes", () => {
    const limiter = tryLimiter()
    const start = 1_000_000
    for (let i = 0; i < MAX_TRIES - 1; i++) limiter.wrong("1.2.3.4", start + i)
    expect(limiter.blocked("1.2.3.4", start + 10)).toBe(false)
    limiter.wrong("1.2.3.4", start + 10)
    expect(limiter.blocked("1.2.3.4", start + 11)).toBe(true)
    // Another address is not held up.
    expect(limiter.blocked("5.6.7.8", start + 11)).toBe(false)
    // Ten minutes after the first wrong try, the address may try again.
    expect(limiter.blocked("1.2.3.4", start + TRY_WINDOW_MS)).toBe(false)
  })

  it("clears the count after the right password", () => {
    const limiter = tryLimiter()
    for (let i = 0; i < MAX_TRIES - 1; i++) limiter.wrong("1.2.3.4", 0)
    limiter.clear("1.2.3.4")
    limiter.wrong("1.2.3.4", 1)
    expect(limiter.blocked("1.2.3.4", 2)).toBe(false)
  })
})
