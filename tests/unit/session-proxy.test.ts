// @vitest-environment node
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { refreshSessionAndGuardStaffRoutes } from "@/utils/supabase/proxy"

type CookieOptions = {
  getAll: () => { name: string; value: string }[]
  setAll: (cookies: { name: string; value: string; options?: Record<string, unknown> }[]) => void
}

// The Supabase SDK is the only boundary faked. `getClaims` is what the token
// check answers; it receives the cookie adapter so a test can refresh the
// session the way the SDK does, by writing cookies during the check.
const sdk = vi.hoisted(() => ({
  getClaims: vi.fn<(cookies: CookieOptions) => Promise<unknown>>(),
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, { cookies }: { cookies: CookieOptions }) => ({
    auth: { getClaims: () => sdk.getClaims(cookies) },
  }),
}))

const SIGNED_IN = { data: { claims: { sub: "user-1" }, header: {}, signature: new Uint8Array() }, error: null }

function visit(path: string) {
  return refreshSessionAndGuardStaffRoutes(new NextRequest(`https://school.example${path}`))
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.example")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  sdk.getClaims.mockReset()
})

describe("the session proxy", () => {
  it("lets a verified session through to a staff page", async () => {
    sdk.getClaims.mockResolvedValue(SIGNED_IN)

    const response = await visit("/staff/leads")

    expect(response.headers.get("location")).toBeNull()
  })

  it("sends a visitor with no session from a staff page to sign-in", async () => {
    sdk.getClaims.mockResolvedValue({ data: null, error: null })

    const response = await visit("/staff/leads?q=x")

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://school.example/login")
  })

  it("sends a visitor with no session from the Discount code students page to sign-in", async () => {
    sdk.getClaims.mockResolvedValue({ data: null, error: null })

    expect((await visit("/discount-code/students")).headers.get("location")).toBe("https://school.example/login")
  })

  // A forged or expired token, a refresh the Auth server refused, an outage
  // while checking, or a token with no subject: none of them is a session.
  it("treats a token that fails its check as signed out", async () => {
    for (const answer of [
      { data: null, error: { name: "AuthInvalidJwtError", message: "Invalid JWT signature", status: 400 } },
      { data: null, error: { name: "AuthApiError", message: "Invalid Refresh Token", status: 400 } },
      { data: null, error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 } },
      { data: { claims: { sub: "" }, header: {}, signature: new Uint8Array() }, error: null },
      { data: { claims: {}, header: {}, signature: new Uint8Array() }, error: null },
    ]) {
      sdk.getClaims.mockResolvedValue(answer)

      expect((await visit("/staff")).headers.get("location")).toBe("https://school.example/login")
    }
  })

  it("treats a check that throws as signed out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    sdk.getClaims.mockRejectedValue(new TypeError("crypto failed"))

    expect((await visit("/staff")).headers.get("location")).toBe("https://school.example/login")
  })

  it("leaves the sign-in page open to a visitor with no session", async () => {
    sdk.getClaims.mockResolvedValue({ data: null, error: null })

    expect((await visit("/login")).headers.get("location")).toBeNull()
  })

  it("passes on the cookies a session refresh writes during the check", async () => {
    sdk.getClaims.mockImplementation(async (cookies) => {
      cookies.setAll([{ name: "sb-project-auth-token", value: "refreshed", options: { path: "/" } }])
      return SIGNED_IN
    })

    const response = await visit("/staff")

    expect(response.headers.get("location")).toBeNull()
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed")
  })
})
