import { beforeEach, describe, expect, it, vi } from "vitest"

// Register students' server action (#308): it takes input from anyone who can
// post to it, so it checks the shape and the owner's permission rule itself
// before the database does. The services are stubbed.

const stubs = vi.hoisted(() => ({ allowed: vi.fn(), register: vi.fn(), fee: vi.fn(), group: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ signed: "in" }) }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: (...args: unknown[]) => stubs.allowed(...args) }))
vi.mock("@/lib/services/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/leads")>()),
  registerStudents: (...args: unknown[]) => stubs.register(...args),
}))

vi.mock("@/lib/services/lead-fees", () => ({ getLeadFee: (...args: unknown[]) => stubs.fee(...args) }))
vi.mock("@/lib/services/sibling-counts", () => ({ explainSiblingGroup: (...args: unknown[]) => stubs.group(...args) }))

import { readOnFileSibling, registerFamily, type RegisterFamilyForm } from "@/app/staff/check-in/new/actions"

const form = (student: Record<string, unknown> = {}): RegisterFamilyForm =>
  ({
    visitDate: "2026-11-17",
    people: [{ phone: "0712345678" }],
    students: [
      {
        firstName: "NEEMA",
        fatherFirst: "JUMA",
        fatherMiddle: "SALIM",
        fatherLast: "MRISHO",
        className: "FORM 1",
        enrollmentYear: 2027,
        dayOrBoarding: "Day",
        custodian: { person: 1, father: true },
        ...student,
      },
    ],
    code: null,
  }) as RegisterFamilyForm

const staff = (permissions: string[]) => ({ ok: true, data: { id: "s", permissions } })

beforeEach(() => {
  stubs.allowed.mockReset()
  stubs.register.mockReset()
  stubs.fee.mockReset()
  stubs.group.mockReset()
  stubs.register.mockResolvedValue({ ok: true, data: { kind: "created", students: [{ student: 1, leadId: "L", admissionNumber: "ADMSN-1", sibling: null }] } })
})

describe("registerFamily", () => {
  it("refuses a role without payments.view, as the page does, and saves nothing", async () => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record"]))
    expect(await registerFamily(form())).toEqual({ status: "forbidden" })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it("saves for a role with all three permissions", async () => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record", "payments.view"]))
    expect(await registerFamily(form())).toMatchObject({ status: "created", students: [{ admissionNumber: "ADMSN-1" }] })
  })

  it.each([["previousSchool"], ["siblingOf"], ["nameAnswer"], ["broughtBy"], ["custodian"]])("refuses %s posted as null, without throwing", async (field) => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record", "payments.view"]))
    expect(await registerFamily(form({ [field]: null }))).toEqual({ status: "refused", field: null })
    expect(stubs.register).not.toHaveBeenCalled()
  })
})

describe("readOnFileSibling", () => {
  const LEAD = "11111111-1111-4111-8111-111111111111"
  const group = { ok: true, data: { members: [{ leadId: LEAD, studentName: "SALMA JUMA MRISHO", className: "STD 4", status: "Visited", result: "none", leadOpen: true }], anchors: [], fullPayerLeadId: null } }
  const fee = { ok: true, data: { kind: "fee", bandFee: 1_300_000, schoolFee: 1_300_000 } }

  beforeEach(() => {
    stubs.allowed.mockResolvedValue(staff(["leads.view"]))
    stubs.group.mockResolvedValue(group)
    stubs.fee.mockResolvedValue(fee)
  })

  it("gives the child's fee and group", async () => {
    expect(await readOnFileSibling(LEAD)).toEqual({
      status: "read",
      fee: { leadId: LEAD, name: "SALMA JUMA MRISHO", className: "STD 4", status: "Visited", fee: 1_300_000, pays: 1_300_000, anchorName: null, fullPayerName: null },
    })
  })

  it("reads a year with no Fee schedule as no fee, not as a failure", async () => {
    stubs.fee.mockResolvedValue({ ok: true, data: { kind: "no-schedule", year: 2027 } })
    expect(await readOnFileSibling(LEAD)).toMatchObject({ status: "read", fee: { fee: null, pays: null } })
  })

  it("says so when the fee can't be read, rather than giving a child with no fee", async () => {
    stubs.fee.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
  })

  it("says so when the group can't be read, or the role may not look", async () => {
    stubs.group.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
    stubs.group.mockResolvedValue(group)
    stubs.allowed.mockResolvedValue({ ok: false, error: "forbidden" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
  })
})
