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
vi.mock("@/lib/services/sign-in", () => ({ HOME: { staff: "/staff", agent: "/discount-code/students" }, signIn: (...args: unknown[]) => stubs.signIn(...args) }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ session: "client" }) }))

import { signIn } from "@/app/login/actions"

function posted(email: string, password = "fixture-password") {
  const data = new FormData()
  data.set("email", email)
  data.set("password", password)
  return data
}

beforeEach(() => {
  stubs.limit.mockReset().mockResolvedValue("allowed")
  stubs.signIn.mockReset().mockResolvedValue({ ok: true, data: "agent" })
  stubs.redirect.mockReset()
})

describe("the one sign-in form", () => {
  it("counts the try per IP and normalised email on sign-in, then lands an agent on their students", async () => {
    await expect(signIn(null, posted("  Neema@Example.TEST "))).rejects.toThrow("NEXT_REDIRECT")

    expect(stubs.limit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "sign-in", subject: "neema@example.test" }),
    )
    expect(stubs.signIn).toHaveBeenCalledWith({ session: "client" }, "neema@example.test", "fixture-password")
    expect(stubs.redirect).toHaveBeenCalledWith("/discount-code/students")
  })

  it("answers rate-limited, not wrong password, and never tries the password, when the limit is reached", async () => {
    stubs.limit.mockResolvedValue("limited")

    expect(await signIn(null, posted("neema@example.test"))).toEqual({ error: "rate-limited" })
    expect(stubs.signIn).not.toHaveBeenCalled()
  })

  it("refuses an empty form without counting it", async () => {
    expect(await signIn(null, posted("", ""))).toEqual({ error: "invalid-credentials" })
    expect(stubs.limit).not.toHaveBeenCalled()
  })
})

describe("where the one sign-in form lands", () => {
  it("lands staff on the staff side", async () => {
    stubs.signIn.mockResolvedValue({ ok: true, data: "staff" })

    await expect(signIn(null, posted("manager@example.test"))).rejects.toThrow("NEXT_REDIRECT")
    expect(stubs.redirect).toHaveBeenCalledWith("/staff")
  })

  it("stays on the page with the refusal", async () => {
    stubs.signIn.mockResolvedValue({ ok: false, error: "deactivated" })

    expect(await signIn(null, posted("manager@example.test"))).toEqual({ error: "deactivated" })
    expect(stubs.redirect).not.toHaveBeenCalled()
  })
})
