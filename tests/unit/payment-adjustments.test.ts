import { describe, expect, it } from "vitest"

import { adjustedPaymentOutcome, adjustmentRefusal } from "@/app/staff/leads/[id]/adjustment-outcome"
import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { formatDate } from "@/lib/school-calendar"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { isAdjustmentReason, type AdjustmentError } from "@/lib/services/payment-adjustments"

describe("adjustedPaymentOutcome", () => {
  it("says whether the payment was adjusted or voided, with the new Total paid and Seat priority", () => {
    expect(adjustedPaymentOutcome({ adjustmentId: "a", totalPaid: 850_000, priority: "First instalment" }, false)).toEqual({
      status: "adjusted",
      message: "Adjustment saved. Total paid is TZS 850,000. Seat priority: First instalment.",
    })
    expect(adjustedPaymentOutcome({ adjustmentId: "a", totalPaid: 0, priority: null }, true)).toEqual({
      status: "adjusted",
      message: "Payment voided. Total paid is TZS 0. No Seat priority.",
    })
  })
})

describe("adjustmentRefusal", () => {
  const codes: AdjustmentError[] = [
    "invalid_reason",
    "void_needs_duplicate",
    "duplicate_needs_void",
    "restore_needs_correction",
    "invalid_type",
    "type_to_fee_waived",
    "type_from_fee_waived",
    "type_pre_form_one",
    "amount_not_positive",
    "amount_not_whole",
    "amount_too_large",
    "date_missing",
    "date_in_future",
    "note_too_long",
    "unchanged",
    "forbidden",
    "not_found",
    "unavailable",
  ]

  it("explains every refusal in its own plain sentence that never shows the code", () => {
    const messages = codes.map((code) => {
      const refusal = adjustmentRefusal(code)
      expect(refusal.status, code).toBe("refused")
      expect(refusal.message, code).not.toContain(code)
      expect(refusal.message, code).toMatch(/\.$/)
      return refusal.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })

  it("marks the field each input refusal is about", () => {
    expect(adjustmentRefusal("restore_needs_correction").field).toBe("reason")
    expect(adjustmentRefusal("type_pre_form_one").field).toBe("type")
    expect(adjustmentRefusal("amount_not_whole").field).toBe("amount")
    expect(adjustmentRefusal("date_in_future").field).toBe("paid_on")
    expect(adjustmentRefusal("note_too_long").field).toBe("note")
    expect(adjustmentRefusal("unchanged").field).toBeNull()
  })
})

describe("isAdjustmentReason", () => {
  it("accepts the five reasons only", () => {
    expect(isAdjustmentReason("Duplicate entry")).toBe(true)
    expect(isAdjustmentReason("Other")).toBe(false)
    expect(isAdjustmentReason(undefined)).toBe(false)
  })
})

describe("adjustments in the lead history", () => {
  const adjustment = (changes: Record<string, unknown>, id = 2): LeadHistoryEntry => ({
    id,
    at: "2026-10-08T09:00:00Z",
    actor: "Test Accountant",
    record: "payment_adjustments",
    recordId: "ad000000-0000-4000-8000-000000000001",
    action: "insert",
    changes: Object.entries(changes).map(([field, to]) => ({ field, from: null, to })),
  })

  it("lists what the payment should have said, the reason and the note", () => {
    const [entry] = describeLeadHistory(
      [
        adjustment({
          sequence: 4,
          payment_id: "fee00000-0000-4000-8000-000000000902",
          lead_id: "1ead0000-0000-4000-8000-000000000902",
          reason: "Wrong amount",
          voided: false,
          payment_type: "initial_deposit",
          amount: 350_000,
          paid_on: "2026-09-25",
          note: "Receipt says 350,000.",
          recorded_by: "a1a1a1a1-0000-4000-8000-000000000004",
          recorded_at: "2026-10-08T09:00:00Z",
          request_id: "e0000000-0000-4000-8000-000000000001",
        }),
      ],
      {},
    )
    expect(entry.summary).toBe("adjusted a school-fee payment")
    expect(entry.changes).toEqual([
      { label: "Note", from: null, to: "Receipt says 350,000." },
      { label: "Payment type", from: null, to: "Initial deposit" },
      { label: "Amount", from: null, to: "TZS 350,000" },
      { label: "Payment date", from: null, to: formatDate("2026-09-25") },
      { label: "Reason", from: null, to: "Wrong amount" },
    ])
  })

  it("says a payment was voided", () => {
    const [entry] = describeLeadHistory([adjustment({ reason: "Duplicate entry", voided: true })], {})
    expect(entry.summary).toBe("voided a school-fee payment")
    expect(entry.changes).toEqual([
      { label: "Reason", from: null, to: "Duplicate entry" },
      { label: "Void", from: null, to: "Yes" },
    ])
  })

  it("says the Seat priority changed because of the adjustment, from what to what", () => {
    const [entry] = describeLeadHistory(
      [
        {
          id: 3,
          at: "2026-10-08T09:00:00Z",
          actor: "Test Accountant",
          record: null,
          recordId: "ad000000-0000-4000-8000-000000000001",
          action: "seat_priority_changed",
          changes: [
            { field: "cause", from: null, to: "payment_adjustment" },
            { field: "priority", from: "Full", to: null },
          ],
        },
      ],
      {},
    )
    expect(entry.summary).toBe("changed the Seat priority, because a payment was adjusted")
    expect(entry.changes).toEqual([{ label: "Seat priority", from: "Full", to: "None" }])
  })
})
