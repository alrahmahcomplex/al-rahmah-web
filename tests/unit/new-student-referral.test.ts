import { beforeEach, describe, expect, it, vi } from "vitest"

// New Student's Referral code (#81): the action creates the lead first, then
// puts the code on it. The lead and referral modules are stubbed; the database
// rules behind them are tested in tests/integration/referral.test.ts.

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const stubs = vi.hoisted(() => ({
  createLead: vi.fn(),
  setCode: vi.fn(),
  allowed: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ signed: "in" }) }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: (...args: unknown[]) => stubs.allowed(...args) }))
vi.mock("@/lib/services/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/leads")>()),
  createLead: (...args: unknown[]) => {
    calls.order.push("createLead")
    return stubs.createLead(...args)
  },
}))
vi.mock("@/lib/services/referral", () => ({
  setLeadReferralCode: (...args: unknown[]) => {
    calls.order.push("setLeadReferralCode")
    return stubs.setCode(...args)
  },
}))

import { registerWalkIn, type WalkInForm } from "@/app/staff/check-in/actions"

const LEAD = "1ead0000-0000-4000-8000-000000000999"

function walkIn(referralCode: string | null): WalkInForm {
  return {
    guardian: { contact: { fullName: "Mwanaidi Said", relationship: "Mother", phone: "0700 000 999" } },
    student: { fullName: "Hamisi Said", className: "STD 3", enrollmentYear: 2027, dayOrBoarding: "Day" },
    visitDate: "2026-10-06",
    referralCode,
  }
}

beforeEach(() => {
  calls.order = []
  stubs.allowed.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.createLead.mockReset().mockResolvedValue({ ok: true, data: { leadId: LEAD, admissionNumber: "ADMSN-12345" } })
  stubs.setCode.mockReset().mockResolvedValue({ ok: true, data: { code: "BJN-402" } })
})

describe("registering a walk-in with a Referral code", () => {
  it("puts the code on the lead once it is created", async () => {
    const outcome = await registerWalkIn(walkIn("BJN-402"))

    expect(calls.order).toEqual(["createLead", "setLeadReferralCode"])
    expect(stubs.setCode).toHaveBeenCalledWith({ signed: "in" }, LEAD, "BJN-402")
    expect(outcome).toEqual({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "saved" })
  })

  it("still reports the lead as created when the code could not be saved", async () => {
    stubs.setCode.mockResolvedValue({ ok: false, error: "unavailable" })

    expect(await registerWalkIn(walkIn("BJN-402"))).toEqual({
      status: "created",
      leadId: LEAD,
      admissionNumber: "ADMSN-12345",
      referralCode: "not-saved",
    })
  })

  it("treats a code call that never answered as not saved", async () => {
    stubs.setCode.mockRejectedValue(new Error("fetch failed"))

    expect(await registerWalkIn(walkIn("BJN-402"))).toMatchObject({ status: "created", referralCode: "not-saved" })
  })

  it("writes no code when the student is already on file", async () => {
    stubs.createLead.mockResolvedValue({
      ok: false,
      error: { kind: "duplicate", lead: { id: LEAD, admissionNumber: "ADMSN-12345", status: "Visited", closure: null } },
    })

    expect(await registerWalkIn(walkIn("BJN-402"))).toMatchObject({ status: "duplicate" })
    expect(stubs.setCode).not.toHaveBeenCalled()
  })

  it("writes no code when the registration is refused", async () => {
    stubs.createLead.mockResolvedValue({ ok: false, error: { kind: "unavailable" } })

    expect(await registerWalkIn(walkIn("BJN-402"))).toMatchObject({ status: "refused" })
    expect(stubs.setCode).not.toHaveBeenCalled()
  })

  it("leaves the code alone when staff entered none", async () => {
    expect(await registerWalkIn(walkIn(null))).toMatchObject({ status: "created", referralCode: "none" })
    expect(await registerWalkIn(walkIn("   "))).toMatchObject({ status: "created", referralCode: "none" })
    // A page loaded before the field existed sends none at all.
    const older: WalkInForm = walkIn(null)
    delete older.referralCode
    expect(await registerWalkIn(older)).toMatchObject({ status: "created", referralCode: "none" })
    expect(stubs.setCode).not.toHaveBeenCalled()
  })

  it("refuses a code that isn't text before anything is created", async () => {
    const form = { ...walkIn(null), referralCode: 402 } as unknown as WalkInForm

    expect(await registerWalkIn(form)).toMatchObject({ status: "refused" })
    expect(stubs.createLead).not.toHaveBeenCalled()
  })
})
