import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ signOut: vi.fn(), redirect: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    stubs.redirect(path)
    throw new Error("NEXT_REDIRECT")
  },
}))
vi.mock("@/lib/services/auth-session", () => ({ signOutSession: (...args: unknown[]) => stubs.signOut(...args) }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ session: "client" }) }))

import { signOutAndReturn } from "@/app/actions/session"

async function signOutFrom(back: string) {
  const data = new FormData()
  data.set("back", back)
  await expect(signOutAndReturn(data)).rejects.toThrow("NEXT_REDIRECT")
  return stubs.redirect.mock.calls[0][0]
}

beforeEach(() => {
  stubs.signOut.mockReset().mockResolvedValue(undefined)
  stubs.redirect.mockReset()
})

// "Sign out" on a page that refuses the other kind of session comes back to
// that page, link and all, so the link still works (#497 moved it to /auth).
describe("signing out on a page that refused the session", () => {
  it.each([
    "/auth",
    "/auth/confirm?token_hash=abc123&type=invite",
    "/auth/reset-password?token_hash=abc123&type=recovery",
    "/discount-code/set-password?token_hash=abc123&type=invite",
  ])("returns to %s", async (back) => {
    expect(await signOutFrom(back)).toBe(back)
    expect(stubs.signOut).toHaveBeenCalledOnce()
  })

  it.each(["/authors", "/auth/callback?code=xyz", "/auth/forgot-password", "/discount-code/students", "/staff", "https://example.com/auth", "//example.com/auth"])(
    "sends %s to sign-in instead",
    async (back) => {
      expect(await signOutFrom(back)).toBe("/auth")
    },
  )
})
