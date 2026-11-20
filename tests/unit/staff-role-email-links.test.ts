import { beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({
  headers: new Headers(),
  inviteStaff: vi.fn(),
  resendInvite: vi.fn(),
  sendResetLink: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => stubs.headers }))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ client: true }) }))
vi.mock("@/utils/supabase/admin", () => ({
  inviteSender: () => "invite-sender",
  passwordResetSender: () => "reset-sender",
}))
vi.mock("@/lib/services/staff-admin", () => ({
  inviteStaff: (...args: unknown[]) => stubs.inviteStaff(...args),
  resendInvite: (...args: unknown[]) => stubs.resendInvite(...args),
  sendResetLink: (...args: unknown[]) => stubs.sendResetLink(...args),
}))

import { inviteStaffMember, resendStaffInvite, sendStaffResetLink } from "@/app/staff/roles/actions"

const refused = { ok: false, error: { kind: "refused", message: "No." } }

// The emails from Staff and roles link to the portal on production (#497).
describe("Staff and roles emails", () => {
  beforeEach(() => {
    stubs.headers = new Headers({ origin: "https://alrahmahcomplex.or.tz", host: "alrahmahcomplex.or.tz" })
    stubs.inviteStaff.mockReset().mockResolvedValue(refused)
    stubs.resendInvite.mockReset().mockResolvedValue(refused)
    stubs.sendResetLink.mockReset().mockResolvedValue(refused)
  })

  it("invite and resend link to the portal's /auth/confirm", async () => {
    await inviteStaffMember("role-1", "Amani Juma", "amani@example.test")
    await resendStaffInvite("staff-1")

    expect(stubs.inviteStaff.mock.calls[0][3]).toBe("https://portal.alrahmahcomplex.or.tz/auth/confirm")
    expect(stubs.resendInvite.mock.calls[0][3]).toBe("https://portal.alrahmahcomplex.or.tz/auth/confirm")
  })

  it("Send reset link links to the portal's reset page", async () => {
    await sendStaffResetLink("staff-1")

    expect(stubs.sendResetLink.mock.calls[0][4]).toBe("https://portal.alrahmahcomplex.or.tz/login/reset-password")
  })

  it("stay on a Preview", async () => {
    stubs.headers = new Headers({ origin: "https://al-rahmah-web-git-x-team.vercel.app" })

    await inviteStaffMember("role-1", "Amani Juma", "amani@example.test")

    expect(stubs.inviteStaff.mock.calls[0][3]).toBe("https://al-rahmah-web-git-x-team.vercel.app/auth/confirm")
  })
})
