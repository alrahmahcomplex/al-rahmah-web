import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  redirect: vi.fn(),
  signOut: vi.fn(),
  sendSelfConfirmInvite: vi.fn(),
  saveResetPassword: vi.fn(),
  resetPasswordFromLink: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: async () => stubs.headers,
  cookies: async () => stubs.cookies,
}))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    stubs.redirect(path)
    throw new Error("NEXT_REDIRECT")
  },
}))
vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: stubs.signOut } }),
}))
vi.mock("@/utils/supabase/sms", () => ({ smsClient: () => ({ secret: "sms" }) }))
vi.mock("@/utils/supabase/admin", () => ({ agentInviteSender: () => "invite-sender" }))
vi.mock("@/app/discount-code/self-confirm-browser", () => ({ browserToken: async () => "browser-tok" }))
vi.mock("@/lib/services/agent-self-confirm", () => ({
  checkConfirmationNumber: vi.fn(),
  createPhoneLogin: vi.fn(),
  selfConfirmSms: vi.fn(),
  sendConfirmationNumber: vi.fn(),
  sendSelfConfirmInvite: (...args: unknown[]) => stubs.sendSelfConfirmInvite(...args),
  setNewAgentEmail: vi.fn(),
}))
vi.mock("@/lib/services/sms-reset", () => ({
  checkResetNumber: vi.fn(),
  confirmResetSession: vi.fn(),
  requestResetSms: vi.fn(),
  saveResetPassword: (...args: unknown[]) => stubs.saveResetPassword(...args),
  sessionProvedBy: vi.fn(),
}))
vi.mock("@/lib/services/password-reset", () => ({
  resetPasswordFromLink: (...args: unknown[]) => stubs.resetPasswordFromLink(...args),
}))

import { generateViewport as authViewport } from "@/app/auth/layout"
import { resetPassword } from "@/app/auth/reset-password/actions"
import { saveSmsResetPassword } from "@/app/auth/sms-reset-actions"
import { sendSelfConfirmEmail } from "@/app/discount-code/self-confirm-actions"

beforeEach(() => {
  stubs.headers = new Headers({ host: "agents.alrahmahcomplex.or.tz", "x-forwarded-proto": "https" })
  stubs.cookies.get.mockReset()
  stubs.cookies.set.mockReset()
  stubs.cookies.delete.mockReset()
  stubs.redirect.mockReset()
  stubs.signOut.mockReset().mockResolvedValue({ error: null })
  stubs.sendSelfConfirmInvite.mockReset().mockResolvedValue({ ok: true, data: { kind: "sent", email: "neema@example.test" } })
  stubs.saveResetPassword.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.resetPasswordFromLink.mockReset().mockResolvedValue({ ok: true, data: "agent" })
})

describe("self-confirm email link origin (#539)", () => {
  it.each(["alrahmahcomplex.or.tz", "portal.alrahmahcomplex.or.tz", "agents.alrahmahcomplex.or.tz"])(
    "points set-password to agents from production host %s",
    async (host) => {
      stubs.headers = new Headers({ host, "x-forwarded-proto": "https" })
      expect(await sendSelfConfirmEmail("attempt-1", "neema@example.test")).toEqual({ status: "sent", email: "neema@example.test" })
      expect(stubs.sendSelfConfirmInvite.mock.calls[0][3]).toBe("https://agents.alrahmahcomplex.or.tz/discount-code/set-password")
    },
  )

  it("stays on localhost or Preview", async () => {
    stubs.headers = new Headers({ host: "localhost:3100", "x-forwarded-proto": "http" })
    await sendSelfConfirmEmail("attempt-1", "neema@example.test")
    expect(stubs.sendSelfConfirmInvite.mock.calls[0][3]).toBe("http://localhost:3100/discount-code/set-password")
  })
})

describe("SMS reset password save on each host (#539)", () => {
  function form() {
    const data = new FormData()
    data.set("password", "new-strong-password")
    data.set("confirm", "new-strong-password")
    data.set("proven", "user-1")
    return data
  }

  it("redirects to /home on agents and localhost without signing out", async () => {
    stubs.cookies.get.mockReturnValue({ value: "user-1" })
    for (const host of ["agents.alrahmahcomplex.or.tz", "localhost:3000"]) {
      stubs.headers = new Headers({ host })
      stubs.redirect.mockReset()
      stubs.signOut.mockReset()
      await expect(saveSmsResetPassword(null, form())).rejects.toThrow("NEXT_REDIRECT")
      expect(stubs.redirect).toHaveBeenCalledWith("/home")
      expect(stubs.signOut).not.toHaveBeenCalled()
    }
  })

  it("signs out locally and sends the agent to agents /auth when completed on portal", async () => {
    stubs.headers = new Headers({ host: "portal.alrahmahcomplex.or.tz" })
    stubs.cookies.get.mockReturnValue({ value: "user-1" })
    await expect(saveSmsResetPassword(null, form())).rejects.toThrow("NEXT_REDIRECT")
    expect(stubs.cookies.delete).toHaveBeenCalledWith({ name: "sms-reset-proven", path: "/auth" })
    expect(stubs.signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(stubs.redirect).toHaveBeenCalledWith("https://agents.alrahmahcomplex.or.tz/auth")
  })
})

describe("reset-password action host audience (#539)", () => {
  it("passes host audience and clears retry cookie on wrong-host", async () => {
    stubs.headers = new Headers({ host: "portal.alrahmahcomplex.or.tz" })
    stubs.cookies.get.mockReturnValue({ value: "tok-1 user-1" })
    stubs.resetPasswordFromLink.mockResolvedValue({ ok: false, error: "wrong-host", expected: "agents" })
    const data = new FormData()
    data.set("token_hash", "tok-1")
    data.set("password", "new-strong-password")
    data.set("confirm", "new-strong-password")

    expect(await resetPassword(null, data)).toEqual({ error: "no-account" })
    expect(stubs.resetPasswordFromLink).toHaveBeenCalledWith(
      expect.anything(),
      "tok-1",
      "new-strong-password",
      { verifiedUserId: "user-1", audience: "portal" },
    )
    expect(stubs.cookies.delete).toHaveBeenCalledWith({ name: "reset-link-verified", path: "/auth/reset-password" })
  })
})

describe("/auth layout viewport theme colour (#539)", () => {
  it("returns indigo on agents and orange on portal or localhost", async () => {
    stubs.headers = new Headers({ host: "agents.alrahmahcomplex.or.tz" })
    expect(await authViewport()).toEqual({ themeColor: "#2408B2" })

    stubs.headers = new Headers({ host: "portal.alrahmahcomplex.or.tz" })
    expect(await authViewport()).toEqual({ themeColor: "#ee7300" })

    stubs.headers = new Headers({ host: "localhost:3000" })
    expect(await authViewport()).toEqual({ themeColor: "#ee7300" })
  })
})
