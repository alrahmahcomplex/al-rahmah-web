import { beforeEach, describe, expect, it, vi } from "vitest"

// Check-in's server action (#309): it takes input from anyone who can post to
// it, so it checks the shape and the check-in permissions before the
// database does. The services are stubbed.

const stubs = vi.hoisted(() => ({ allowed: vi.fn(), complete: vi.fn(), group: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ signed: "in" }) }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: (...args: unknown[]) => stubs.allowed(...args) }))
vi.mock("@/lib/services/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/leads")>()),
  completeAdmissionVisit: (...args: unknown[]) => stubs.complete(...args),
}))
vi.mock("@/lib/services/sibling-counts", () => ({ explainSiblingGroup: (...args: unknown[]) => stubs.group(...args) }))

import { completeVisit, type CompleteVisitForm } from "@/app/staff/check-in/[id]/actions"

const LEAD = "11111111-1111-4111-8111-111111111111"
const ALL = ["visits.record", "leads.edit", "leads.view", "payments.view"]

const form = (student: Record<string, unknown> = {}): CompleteVisitForm =>
  ({
    visitDate: "2026-11-19",
    people: [{ contactId: "c0a70000-0000-4000-8000-000000000309" }],
    students: [
      {
        leadId: LEAD,
        firstName: "YUSUF",
        fatherFirst: "ALI",
        fatherMiddle: "OMARI",
        fatherLast: "HASSAN",
        gender: "Boy",
        custodian: { person: 1, relationship: "Mother" },
        previousSchool: { notKnown: true },
        ...student,
      },
    ],
  }) as CompleteVisitForm

const staff = (permissions: string[]) => ({ ok: true, data: { id: "s", permissions } })

beforeEach(() => {
  stubs.allowed.mockReset()
  stubs.complete.mockReset()
  stubs.group.mockReset()
  stubs.complete.mockResolvedValue({ ok: true, data: { kind: "completed", students: [{ student: 1, leadId: LEAD, admissionNumber: "ADMSN-90005", sibling: null }] } })
})

describe("completeVisit", () => {
  it.each(ALL.filter((p) => p !== "visits.record"))("refuses a role without %s and saves nothing", async (missing) => {
    stubs.allowed.mockResolvedValue(staff(ALL.filter((p) => p !== missing)))
    expect(await completeVisit(form())).toEqual({ status: "forbidden" })
    expect(stubs.complete).not.toHaveBeenCalled()
  })

  it("records the visit for a role with all four permissions", async () => {
    stubs.allowed.mockResolvedValue(staff(ALL))
    expect(await completeVisit(form())).toEqual({
      status: "completed",
      students: [{ student: 1, leadId: LEAD, admissionNumber: "ADMSN-90005" }],
      ten: 0,
      requests: 0,
    })
    expect(stubs.complete).toHaveBeenCalledWith({ signed: "in" }, form())
  })

  it.each([["className", "FORM 1"], ["enrollmentYear", 2028], ["dayOrBoarding", "Boarding"]])("refuses %s, which stays as the family gave it", async (field, value) => {
    stubs.allowed.mockResolvedValue(staff(ALL))
    expect(await completeVisit(form({ [field]: value }))).toEqual({ status: "refused", field: null })
    expect(stubs.complete).not.toHaveBeenCalled()
  })

  it.each([["leadId", "not-a-lead"], ["custodian", null], ["previousSchool", null]])("refuses %s posted as %s, without throwing", async (field, value) => {
    stubs.allowed.mockResolvedValue(staff(ALL))
    expect(await completeVisit(form({ [field]: value }))).toEqual({ status: "refused", field: null })
  })

  it("passes on a visit recorded meanwhile, by its student", async () => {
    stubs.allowed.mockResolvedValue(staff(ALL))
    stubs.complete.mockResolvedValue({ ok: false, error: { kind: "not-applied", student: 1 } })
    expect(await completeVisit(form())).toEqual({ status: "not-applied", student: 1 })
  })
})
