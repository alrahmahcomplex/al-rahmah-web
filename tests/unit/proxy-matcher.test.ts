// The Next.js 16 docs call this unstable_doesProxyMatch, but 16.3.6 still
// ships it under the middleware name.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { config } from "@/proxy"

function runsOn(url: string) {
  return unstable_doesMiddlewareMatch({ config, url })
}

describe("proxy matcher", () => {
  it.each(["/staff", "/staff/applications", "/login", "/auth/callback"])(
    "runs on the auth-bound route %s",
    (url) => {
      expect(runsOn(url)).toBe(true)
    },
  )

  it.each(["/", "/admissions", "/about", "/Al-Rahmah_Official_Logo.svg", "/_next/static/chunk.js"])(
    "skips the public route %s",
    (url) => {
      expect(runsOn(url)).toBe(false)
    },
  )

  it("does not catch public routes that only start with an auth word", () => {
    expect(runsOn("/staffroom-news")).toBe(false)
    expect(runsOn("/login-help")).toBe(false)
    expect(runsOn("/authors")).toBe(false)
  })
})
