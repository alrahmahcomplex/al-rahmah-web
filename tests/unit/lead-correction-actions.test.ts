import { beforeEach, describe, expect, it, vi } from "vitest"

// The lead record's corrections take only the fields that changed (#512): the
// Family page sends one answer at a time, so an answer it read earlier never
// overwrites a newer change. The record's forms still send every field. The
// services are stubbed.

const stubs = vi.hoisted(() => ({ allowed: vi.fn(), staff: vi.fn(), details: vi.fn(), contact: vi.fn(), school: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ signed: "in" }) }))
vi.mock("@/lib/services/staff-auth", () => ({
  requirePermission: (...args: unknown[]) => stubs.allowed(...args),
  getStaffUser: (...args: unknown[]) => stubs.staff(...args),
}))
vi.mock("@/lib/services/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/leads")>()),
  updateLeadDetails: (...args: unknown[]) => stubs.details(...args),
  updateGuardianContact: (...args: unknown[]) => stubs.contact(...args),
}))
vi.mock("@/lib/services/lead-details", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/lead-details")>()),
  correctPreviousSchool: (...args: unknown[]) => stubs.school(...args),
}))

import { correctContact, correctStudent } from "@/app/staff/applicants/[id]/actions"
import { savePreviousSchool } from "@/app/staff/applicants/[id]/sibling-actions"

const LEAD = "11111111-1111-4111-8111-111111111111"
const CONTACT = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  stubs.allowed.mockReset().mockResolvedValue({ ok: true, data: { id: "s", permissions: ["leads.edit"] } })
  stubs.staff.mockReset().mockResolvedValue({ ok: true, data: { id: "s", permissions: ["leads.edit"] } })
  stubs.details.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.contact.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.school.mockReset().mockResolvedValue({ ok: true, data: null })
})

describe("correctStudent", () => {
  it("sends only the class when only the class changes", async () => {
    expect(await correctStudent(LEAD, { className: "STD 6" })).toEqual({ status: "saved" })
    expect(stubs.details).toHaveBeenCalledWith(expect.anything(), LEAD, {
      fullName: undefined,
      className: "STD 6",
      enrollmentYear: undefined,
      dayOrBoarding: undefined,
    })
  })

  it("still takes every field, as the record's form sends them", async () => {
    await correctStudent(LEAD, { fullName: "NEEMA JUMA MRISHO", className: "STD 5", enrollmentYear: 2027, dayOrBoarding: "Day" })
    expect(stubs.details).toHaveBeenCalledWith(expect.anything(), LEAD, {
      fullName: "NEEMA JUMA MRISHO",
      className: "STD 5",
      enrollmentYear: 2027,
      dayOrBoarding: "Day",
    })
  })

  it("sends nameParts with lastNameFrom through updateLeadDetails", async () => {
    const nameParts = { firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO", lastNameFrom: "father_middle" as const }
    expect(await correctStudent(LEAD, { nameParts })).toEqual({ status: "saved" })
    expect(stubs.details).toHaveBeenCalledWith(expect.anything(), LEAD, {
      fullName: undefined,
      nameParts,
      className: undefined,
      enrollmentYear: undefined,
      dayOrBoarding: undefined,
    })
  })

  it("refuses a last-name choice without all four name parts, or mixed with fullName", async () => {
    expect((await correctStudent(LEAD, { lastNameFrom: "father_middle" } as never)).status).toBe("refused")
    expect((await correctStudent(LEAD, { fullName: "NEEMA JUMA SALIM", lastNameFrom: "father_middle" } as never)).status).toBe("refused")
    expect(
      (
        await correctStudent(LEAD, {
          nameParts: { firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "  ", fatherLast: "MRISHO", lastNameFrom: "father_middle" },
        })
      ).status,
    ).toBe("refused")
    expect(
      (
        await correctStudent(LEAD, {
          nameParts: { firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO", lastNameFrom: "mother" as never },
        })
      ).status,
    ).toBe("refused")
    expect(
      (
        await correctStudent(LEAD, {
          fullName: "NEEMA JUMA SALIM",
          nameParts: { firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO", lastNameFrom: "father_middle" },
        })
      ).status,
    ).toBe("refused")
    expect(stubs.details).not.toHaveBeenCalled()
  })

  it("refuses no change at all, or a field it can't read, before the database", async () => {
    expect((await correctStudent(LEAD, {})).status).toBe("refused")
    expect((await correctStudent(LEAD, { className: "STD 9" as never })).status).toBe("refused")
    expect((await correctStudent(LEAD, { dayOrBoarding: "Weekly" as never })).status).toBe("refused")
    expect((await correctStudent(LEAD, { fullName: 7 as never })).status).toBe("refused")
    expect(stubs.details).not.toHaveBeenCalled()
  })
})

describe("correctContact", () => {
  it("sends only the WhatsApp number when only it changes", async () => {
    expect(await correctContact(CONTACT, { whatsapp: "0712345678" }, [LEAD], LEAD)).toEqual({ status: "saved" })
    expect(stubs.contact).toHaveBeenCalledWith(
      expect.anything(),
      CONTACT,
      { fullName: undefined, relationship: undefined, relationshipDescription: undefined, phone: undefined, whatsapp: "0712345678" },
      [LEAD],
      undefined,
      LEAD,
    )
  })

  it("clears the WhatsApp number with null, and sends a description only with its relationship", async () => {
    await correctContact(CONTACT, { whatsapp: null }, [LEAD], LEAD)
    expect(stubs.contact.mock.calls[0][2]).toMatchObject({ whatsapp: null, relationshipDescription: undefined })

    await correctContact(CONTACT, { relationship: "Other", relationshipDescription: "AUNT" }, [LEAD], LEAD)
    expect(stubs.contact.mock.calls[1][2]).toMatchObject({ relationship: "Other", relationshipDescription: "AUNT", whatsapp: undefined })
  })

  it("refuses no change at all, or a relationship it can't read, before the database", async () => {
    expect((await correctContact(CONTACT, {}, [LEAD], LEAD)).status).toBe("refused")
    expect((await correctContact(CONTACT, { relationship: "Uncle" as never }, [LEAD], LEAD)).status).toBe("refused")
    expect(stubs.contact).not.toHaveBeenCalled()
  })
})

describe("savePreviousSchool", () => {
  it("sends the canonical country for a school Outside Tanzania", async () => {
    expect(
      await savePreviousSchool(LEAD, { kind: "school", name: "  GREEN HILLS  ", type: "private", region: "Outside Tanzania", country: "  kenya " }),
    ).toEqual({ status: "saved" })
    expect(stubs.school).toHaveBeenCalledWith(expect.anything(), LEAD, {
      kind: "school",
      name: "GREEN HILLS",
      type: "private",
      region: "Outside Tanzania",
      country: "Kenya",
    })
  })

  it("refuses an unknown country, an empty country string, or a country beside a Tanzanian region", async () => {
    expect((await savePreviousSchool(LEAD, { kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "Atlantis" })).status).toBe("refused")
    expect((await savePreviousSchool(LEAD, { kind: "school", name: "GREEN HILLS", type: "private", region: "Outside Tanzania", country: "" })).status).toBe("refused")
    expect((await savePreviousSchool(LEAD, { kind: "school", name: "GREEN HILLS", type: "private", region: "Arusha", country: "Kenya" })).status).toBe("refused")
    expect(stubs.school).not.toHaveBeenCalled()
  })
})
