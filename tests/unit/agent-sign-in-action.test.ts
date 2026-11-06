import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ limit: vi.fn(), signIn: vi.fn(), redirect: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7", host: "alrahmah.example" }),
}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    stubs.redirect(path)
    throw new Error("NEXT_REDIRECT")
  },
}))
vi.mock("@/lib/rate-limit", () => ({ checkPublicFormLimit: (input: unknown) => stubs.limit(input) }))
vi.mock("@/lib/services/agent-auth", () => ({ signInAgent: (...args: unknown[]) => stubs.signIn(...args) }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ session: "client" }) }))

import { signInToDiscountCode } from "@/app/discount-code/sign-in/actions"

function posted(email: string, password = "fixture-password") {
  const data = new FormData()
  data.set("email", email)
  data.set("password", password)
  return data
}

beforeEach(() => {
  stubs.limit.mockReset().mockResolvedValue("allowed")
  stubs.signIn.mockReset().mockResolvedValue({ ok: true, data: { fullName: "Neema Fixture", code: "NEF-101" } })
  stubs.redirect.mockReset()
})

describe("signing in to the Discount code pages", () => {
  it("counts the try per IP and normalised email on agent-sign-in, then signs in", async () => {
    await expect(signInToDiscountCode(null, posted("  Neema@Example.TEST "))).rejects.toThrow("NEXT_REDIRECT")

    expect(stubs.limit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "agent-sign-in", subject: "neema@example.test" }),
    )
    expect(stubs.signIn).toHaveBeenCalledWith({ session: "client" }, "neema@example.test", "fixture-password")
    expect(stubs.redirect).toHaveBeenCalledWith("/discount-code/students")
  })

  it("answers rate-limited, not wrong password, and never tries the password, when the limit is reached", async () => {
    stubs.limit.mockResolvedValue("limited")

    expect(await signInToDiscountCode(null, posted("neema@example.test"))).toEqual({ error: "rate-limited" })
    expect(stubs.signIn).not.toHaveBeenCalled()
  })

  it("refuses an empty form without counting it", async () => {
    expect(await signInToDiscountCode(null, posted("", ""))).toEqual({ error: "invalid-credentials" })
    expect(stubs.limit).not.toHaveBeenCalled()
  })
})
