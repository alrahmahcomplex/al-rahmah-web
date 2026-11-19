import { beforeEach, describe, expect, it, vi } from "vitest"

// Register students' server action (#308): it takes input from anyone who can
// post to it, so it checks the shape and the owner's permission rule itself
// before the database does. The services are stubbed.

const stubs = vi.hoisted(() => ({ allowed: vi.fn(), register: vi.fn(), fee: vi.fn(), group: vi.fn(), fathers: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ signed: "in" }) }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: (...args: unknown[]) => stubs.allowed(...args) }))
vi.mock("@/lib/services/leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/leads")>()),
  registerStudents: (...args: unknown[]) => stubs.register(...args),
  getFathersOfLeads: (...args: unknown[]) => stubs.fathers(...args),
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
        gender: "Girl",
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
  stubs.fathers.mockReset()
  stubs.register.mockResolvedValue({ ok: true, data: { kind: "created", students: [{ student: 1, leadId: "L", admissionNumber: "ADMSN-1", sibling: null }] } })
})

describe("registerFamily", () => {
  it.each([["payments.view"], ["leads.edit"]])("refuses a role without %s, as the page does, and saves nothing", async (missing) => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record", "payments.view", "leads.edit"].filter((p) => p !== missing)))
    expect(await registerFamily(form())).toEqual({ status: "forbidden" })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it("saves for a role with all four permissions", async () => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record", "payments.view", "leads.edit"]))
    expect(await registerFamily(form())).toMatchObject({ status: "created", students: [{ admissionNumber: "ADMSN-1" }] })
  })

  it.each([["previousSchool"], ["siblingOf"], ["nameAnswer"], ["broughtBy"], ["custodian"]])("refuses %s posted as null, without throwing", async (field) => {
    stubs.allowed.mockResolvedValue(staff(["leads.create", "visits.record", "payments.view", "leads.edit"]))
    expect(await registerFamily(form({ [field]: null }))).toEqual({ status: "refused", field: null })
    expect(stubs.register).not.toHaveBeenCalled()
  })
})

describe("readOnFileSibling", () => {
  const LEAD = "11111111-1111-4111-8111-111111111111"
  const OTHER = "22222222-2222-4222-8222-222222222222"
  const THIRD = "33333333-3333-4333-8333-333333333333"
  const SALIM = "JUMA SALIM MRISHO"
  const OMARI = "OMARI JUMA HASSAN"
  const member = (leadId: string, studentName: string, more: Record<string, unknown> = {}) => ({
    leadId,
    studentName,
    className: "STD 4",
    status: "Visited",
    result: "none",
    source: "auto",
    lockedResult: null,
    largerDiscount: null,
    leadOpen: true,
    legacy: false,
    basis: null,
    ...more,
  })
  const self = (more: Record<string, unknown> = {}) => member(LEAD, "SALMA JUMA MRISHO", more)
  const explained = (members: unknown[], groupId: string | null = null) => ({ ok: true, data: { groupId, members, anchors: [], fullPayerLeadId: null } })
  const fee = { ok: true, data: { kind: "fee", bandFee: 1_300_000, schoolFee: 1_300_000 } }
  const read = async () => {
    const out = await readOnFileSibling(LEAD)
    if (out.status !== "read") throw new Error("not read")
    return out.fee
  }

  beforeEach(() => {
    stubs.allowed.mockResolvedValue(staff(["leads.view"]))
    stubs.group.mockResolvedValue(explained([self()]))
    stubs.fee.mockResolvedValue(fee)
    stubs.fathers.mockResolvedValue({ ok: true, data: { [LEAD]: SALIM, [OTHER]: OMARI, [THIRD]: OMARI } })
  })

  it("gives the child's fee and group: in no group, the child itself is compared and may pay full", async () => {
    expect(await readOnFileSibling(LEAD)).toEqual({
      status: "read",
      fee: {
        leadId: LEAD,
        name: "SALMA JUMA MRISHO",
        className: "STD 4",
        status: "Visited",
        fee: 1_300_000,
        pays: 1_300_000,
        anchorName: null,
        fullPayerName: null,
        groupId: null,
        father: SALIM,
        counted: [],
        selfCounts: true,
        mayPayFull: true,
        unranked: false,
        manual: false,
      },
    })
  })

  it("a child waiting on a Sibling request is not compared: the names are those its group counts by, lowest lead id first", async () => {
    const waiting = "44444444-4444-4444-8444-444444444444"
    const refused = "55555555-5555-4555-8555-555555555555"
    stubs.fathers.mockResolvedValue({ ok: true, data: { [LEAD]: SALIM, [OTHER]: OMARI, [THIRD]: OMARI, [waiting]: SALIM, [refused]: SALIM } })
    stubs.group.mockResolvedValue(
      explained(
        [
          member(THIRD, "ZUHURA OMARI HASSAN", { basis: "granted" }),
          self({ basis: "request_needed" }),
          member(waiting, "AMINA JUMA MRISHO", { basis: "request_needed" }),
          member(refused, "BAKARI JUMA MRISHO", { basis: "refused" }),
          member(OTHER, "REHEMA OMARI HASSAN", { basis: "matched" }),
        ],
        "G",
      ),
    )
    expect(await read()).toMatchObject({
      groupId: "G",
      father: SALIM,
      counted: [
        { leadId: OTHER, name: "REHEMA OMARI HASSAN", father: OMARI },
        { leadId: THIRD, name: "ZUHURA OMARI HASSAN", father: OMARI },
      ],
      selfCounts: false,
      // Not counted, it is not ranked for the full payer either.
      mayPayFull: false,
      // That is this group's doing: in a group that counts it, the database would rank it.
      unranked: false,
    })
  })

  it("a child its group counts is compared too", async () => {
    stubs.group.mockResolvedValue(explained([self({ basis: "typo_confirmed" }), member(OTHER, "REHEMA OMARI HASSAN", { basis: "matched" })], "G"))
    expect(await read()).toMatchObject({ counted: [{ leadId: OTHER }], selfCounts: true, mayPayFull: true })
  })

  it("a child under the old family rule counts unless its group counts by another father's name", async () => {
    stubs.group.mockResolvedValue(explained([self({ legacy: true }), member(OTHER, "REHEMA OMARI HASSAN", { legacy: true })], "G"))
    expect(await read()).toMatchObject({ counted: [], selfCounts: true })
    stubs.group.mockResolvedValue(explained([self({ legacy: true }), member(OTHER, "REHEMA OMARI HASSAN", { basis: "matched" })], "G"))
    expect(await read()).toMatchObject({ counted: [{ leadId: OTHER }], selfCounts: false })
    stubs.fathers.mockResolvedValue({ ok: true, data: { [LEAD]: SALIM, [OTHER]: "Juma Salim Mrisho" } })
    expect(await read()).toMatchObject({ selfCounts: true })
  })

  it.each([
    ["holds a Staff child discount", { largerDiscount: "staff_child" }],
    ["holds a Qualified orphan discount", { largerDiscount: "qualified_orphan" }],
    ["has a fee the Accountant set by hand", { source: "manual", result: "full" }],
    ["has a result fixed at an earlier enrolment", { lockedResult: "ten", result: "ten", source: "locked" }],
    ["is Enrolled", { status: "Enrolled", result: "ten" }],
    ["is closed", { leadOpen: false }],
  ])("a child that %s may not be the full payer", async (_why, more) => {
    stubs.group.mockResolvedValue(explained([self(more)]))
    expect(await read()).toMatchObject({ selfCounts: true, mayPayFull: false, unranked: true })
  })

  it("says when the child's Sibling discount was set by hand, which check-in keeps (#309)", async () => {
    stubs.group.mockResolvedValue(explained([self({ source: "manual", result: "ten" })]))
    expect(await read()).toMatchObject({ manual: true })
  })

  it("reads a year with no Fee schedule as no fee, not as a failure", async () => {
    stubs.fee.mockResolvedValue({ ok: true, data: { kind: "no-schedule", year: 2027 } })
    expect(await readOnFileSibling(LEAD)).toMatchObject({ status: "read", fee: { fee: null, pays: null } })
  })

  it("says so when the fee can't be read, rather than giving a child with no fee", async () => {
    stubs.fee.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
  })

  it("says so when the group or its fathers' names can't be read, or the role may not look", async () => {
    stubs.fathers.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
    stubs.fathers.mockResolvedValue({ ok: true, data: { [LEAD]: SALIM } })
    stubs.group.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
    stubs.group.mockResolvedValue(explained([self()]))
    stubs.allowed.mockResolvedValue({ ok: false, error: "forbidden" })
    expect(await readOnFileSibling(LEAD)).toEqual({ status: "unavailable" })
  })
})
