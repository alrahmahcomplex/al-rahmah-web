import { describe, expect, it } from "vitest"

import { enrolledBy } from "@/app/staff/leads/[id]/enrolment-text"
import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { formatDate } from "@/lib/school-calendar"
import type { LeadHistoryEntry } from "@/lib/services/audit"

const LEAD = "11111111-1111-4111-8111-111111111111"
const PROFILE = "22222222-2222-4222-8222-222222222222"
const PAYMENT = "33333333-3333-4333-8333-333333333333"

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })

function entry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-10-05T07:15:00Z",
    actor: "Test Accountant",
    record: "lead",
    recordId: LEAD,
    action: "update",
    changes: [],
    ...overrides,
  }
}

// One recompute's two rows: the profile, then the status. The audit log
// stamps each row with the clock, so the status comes a moment later.
const later = (at: string) => at.replace("Z", ".004Z")

function enrolledBy_(at: string, firstId: number) {
  return [
    entry({ id: firstId + 1, at: later(at), changes: [change("status", "Interviewed", "Enrolled")] }),
    entry({
      id: firstId,
      at,
      record: "lead_fee_profiles",
      recordId: PROFILE,
      action: "insert",
      changes: [
        change("lead_id", null, LEAD),
        change("pre_form_one", null, false),
        change("status_before_enrolled", null, "Interviewed"),
        change("enrolled_trigger", null, "payment"),
        change("enrolled_trigger_payment_id", null, PAYMENT),
        change("enrolled_on", null, "2026-10-04"),
        change("recompute_cause", null, "payment"),
      ],
    }),
  ]
}

describe("Enrolled in the lead's history", () => {
  it("says the lead was enrolled, why, and what enrolled it", () => {
    const [status, profile] = describeLeadHistory(enrolledBy_("2026-10-05T07:15:00Z", 10), {})
    expect(status).toMatchObject({
      actor: "Test Accountant",
      summary: "enrolled the lead, because a school-fee payment was recorded",
      changes: [{ label: "Status", from: "Interviewed", to: "Enrolled" }],
    })
    expect(profile).toMatchObject({
      summary: "recorded what enrolled the lead",
      changes: [
        { label: "Enrolled by", from: null, to: "A school-fee payment" },
        { label: "Enrolled on", from: null, to: formatDate("2026-10-04") },
        { label: "Status before Enrolled", from: null, to: "Interviewed" },
        { label: "Because", from: null, to: "A school-fee payment was recorded" },
      ],
    })
  })

  it("says the lead was taken out of Enrolled, and why", () => {
    const at = "2026-10-06T09:00:00Z"
    const described = describeLeadHistory(
      [
        entry({ id: 21, at: later(at), changes: [change("status", "Enrolled", "Interviewed")] }),
        entry({
          id: 20,
          at,
          record: "lead_fee_profiles",
          recordId: PROFILE,
          changes: [
            change("status_before_enrolled", "Interviewed", null),
            change("enrolled_trigger", "payment", null),
            change("enrolled_trigger_payment_id", PAYMENT, null),
            change("enrolled_on", "2026-10-04", null),
            change("recompute_cause", "payment", "fee_schedule"),
          ],
        }),
        ...enrolledBy_("2026-10-05T07:15:00Z", 10),
      ],
      {},
    )
    expect(described[0].summary).toBe("took the lead out of Enrolled, because the Fee schedule changed")
    expect(described[1]).toMatchObject({
      summary: "cleared what enrolled the lead",
      changes: [
        { label: "Enrolled by", from: "A school-fee payment", to: "None" },
        { label: "Enrolled on", from: formatDate("2026-10-04"), to: "None" },
        { label: "Status before Enrolled", from: "Interviewed", to: "None" },
        { label: "Because", from: "A school-fee payment was recorded", to: "The Fee schedule changed" },
      ],
    })
  })

  it("carries the cause forward when a recompute's cause is the same as the last one", () => {
    const at = "2026-10-07T09:00:00Z"
    const described = describeLeadHistory(
      [
        // Only the date moved; the cause is still a payment.
        entry({
          id: 30,
          at,
          record: "lead_fee_profiles",
          recordId: PROFILE,
          changes: [change("enrolled_on", "2026-10-04", "2026-10-03")],
        }),
        ...enrolledBy_("2026-10-05T07:15:00Z", 10),
      ],
      {},
    )
    expect(described[0]).toMatchObject({
      summary: "updated what enrolled the lead",
      changes: [{ label: "Enrolled on", from: formatDate("2026-10-04"), to: formatDate("2026-10-03") }],
    })
  })

  it("leaves declining an Enrolled lead to read as a decline", () => {
    const [described] = describeLeadHistory(
      [entry({ changes: [change("status", "Enrolled", "Declined"), change("declined_reason", null, "Family changed plans")] })],
      {},
    )
    expect(described.summary).toBe("declined the lead")
  })
})

describe("what enrolled a lead, on the School fee section", () => {
  it("names the payment with its amount, or the Academic-year start", () => {
    expect(enrolledBy({ on: "2026-10-04", by: { kind: "payment", type: "full_payment", amount: 2_000_000 } })).toBe(
      "By the Full payment of TZS 2,000,000",
    )
    expect(enrolledBy({ on: "2026-10-04", by: { kind: "payment", type: "fee_waived", amount: null } })).toBe("By Fee waived")
    expect(enrolledBy({ on: "2027-01-11", by: { kind: "academic-year-start" } })).toBe("By the Academic-year start")
  })
})
