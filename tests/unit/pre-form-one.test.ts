import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { paymentRefusal, recordedPaymentOutcome } from "@/app/staff/leads/[id]/payment-outcome"
import { preFormOneOutcome } from "@/app/staff/leads/[id]/pre-form-one-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { SetPreFormOneError } from "@/lib/services/pre-form-one"
import { PAYMENT_TYPE_NAMES } from "@/lib/services/school-fee-payments"

// The Pre-Form One programme's words (#114): the tick's refusals, the
// payment's refusal and confirmation, and its entries in the lead history.

const LEAD = "11111111-1111-4111-8111-111111111111"
const PROFILE = "22222222-2222-4222-8222-222222222222"
const PAYMENT = "33333333-3333-4333-8333-333333333333"

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })

function entry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-10-10T07:15:00Z",
    actor: "Test Admissions",
    record: "lead_fee_profiles",
    recordId: PROFILE,
    action: "update",
    changes: [],
    ...overrides,
  }
}

describe("the Pre-Form One tick's refusals", () => {
  it("has words for every refusal", () => {
    const errors: SetPreFormOneError[] = ["forbidden", "not-found", "lead-closed", "not-form-one", "unavailable"]
    for (const error of errors) {
      const outcome = preFormOneOutcome(error)
      expect(outcome.status, error).toBe("refused")
      expect(outcome.status === "refused" && outcome.message.length, error).toBeGreaterThan(0)
    }
    expect(preFormOneOutcome("not-form-one")).toMatchObject({ message: expect.stringContaining("FORM 1") })
  })
})

describe("a Pre-Form One fee payment", () => {
  it("is named, refused without the tick on a FORM 1 lead, and confirmed without the School fee", () => {
    expect(PAYMENT_TYPE_NAMES.pre_form_one_fee).toBe("Pre-Form One fee")
    expect(paymentRefusal("not_pre_form_one", "checked")).toMatchObject({
      field: "type",
      message: expect.stringContaining("Pre-Form One programme is ticked on a FORM 1 lead"),
    })
    expect(recordedPaymentOutcome({ paymentId: PAYMENT, totalPaid: 300_000, priority: "Deposit" }, "pre_form_one_fee")).toEqual({
      status: "recorded",
      message: "Pre-Form One fee recorded. It doesn't count toward the School fee or Seat priority.",
    })
    expect(recordedPaymentOutcome({ paymentId: PAYMENT, totalPaid: 300_000, priority: "Deposit" }, "initial_deposit")).toEqual({
      status: "recorded",
      message: "Payment recorded. Total paid is TZS 300,000. Seat priority: Deposit.",
    })
  })
})

describe("the Pre-Form One programme in the lead history", () => {
  it("says staff ticked it on a new profile", () => {
    const [described] = describeLeadHistory(
      [
        entry({
          action: "insert",
          changes: [
            change("lead_id", null, LEAD),
            change("pre_form_one", null, true),
            change("prior_sibling", null, false),
            change("sibling_kept", null, false),
          ],
        }),
      ],
      {},
    )
    expect(described).toMatchObject({
      summary: "ticked the Pre-Form One programme",
      changes: [{ label: "Pre-Form One programme", from: null, to: "Yes" }],
    })
  })

  it("says staff cleared it", () => {
    const [described] = describeLeadHistory([entry({ changes: [change("pre_form_one", true, false)] })], {})
    expect(described).toMatchObject({
      summary: "cleared the Pre-Form One programme",
      changes: [{ label: "Pre-Form One programme", from: "Yes", to: "No" }],
    })
  })

  it("names a Pre-Form One fee payment apart from a school-fee payment", () => {
    const payment = (type: string, id: number) =>
      entry({
        id,
        actor: "Test Accountant",
        record: "school_fee_payments",
        recordId: PAYMENT,
        action: "insert",
        changes: [change("payment_type", null, type), change("amount", null, 200_000)],
      })
    const [programme, schoolFee] = describeLeadHistory([payment("pre_form_one_fee", 2), payment("initial_deposit", 1)], {})
    expect(programme.summary).toBe("recorded a Pre-Form One fee payment")
    expect(schoolFee.summary).toBe("recorded a school-fee payment")
  })
})
