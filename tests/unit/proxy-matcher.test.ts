// The Next.js 16 docs call this unstable_doesProxyMatch, but 16.3.6 still
// ships it under the middleware name.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { config } from "@/proxy"

function runsOn(url: string) {
  return unstable_doesMiddlewareMatch({ config, url })
}

describe("proxy matcher", () => {
  it.each([
    "/staff",
    "/staff/applications",
    "/auth",
    "/auth/confirm",
    "/auth/callback",
    "/auth/reset-password",
    "/discount-code/set-password",
    "/home",
  ])(
    "runs on the auth-bound route %s",
    (url) => {
      expect(runsOn(url)).toBe(true)
    },
  )

  // The cached forgot-password page needs no session (ADR 0006). The old
  // /login and /discount-code/students addresses redirect before the proxy runs.
  it.each(["/", "/apply", "/discount-code", "/discount-code/students", "/auth/forgot-password", "/login", "/login/reset-password", "/admissions", "/about", "/Al-Rahmah_Official_Logo.svg", "/_next/static/chunk.js"])(
    "skips the public route %s",
    (url) => {
      expect(runsOn(url)).toBe(false)
    },
  )

  it("does not catch public routes that only start with an auth word", () => {
    expect(runsOn("/staffroom-news")).toBe(false)
    expect(runsOn("/login-help")).toBe(false)
    expect(runsOn("/authors")).toBe(false)
    expect(runsOn("/homes")).toBe(false)
  })
})
