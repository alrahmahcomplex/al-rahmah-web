import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { paymentRefusal, recordedPaymentOutcome } from "@/app/staff/leads/[id]/payment-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { isPaymentType, type PaymentError } from "@/lib/services/school-fee-payments"

describe("recordedPaymentOutcome", () => {
  it("states the new Total paid and Seat priority", () => {
    expect(recordedPaymentOutcome({ paymentId: "p", totalPaid: 1_100_000, priority: "First instalment" })).toEqual({
      status: "recorded",
      message: "Payment recorded. Total paid is TZS 1,100,000. Seat priority: First instalment.",
    })
    expect(recordedPaymentOutcome({ paymentId: "p", totalPaid: 5_000, priority: null })).toEqual({
      status: "recorded",
      message: "Payment recorded. Total paid is TZS 5,000. No Seat priority yet.",
    })
  })
})

describe("paymentRefusal", () => {
  const codes: PaymentError[] = [
    "lead_closed",
    "not_passed",
    "no_schedule",
    "invalid_type",
    "amount_not_positive",
    "amount_not_whole",
    "amount_too_large",
    "date_missing",
    "date_in_future",
    "forbidden",
    "not_found",
    "unavailable",
  ]

  it("explains every refusal in its own plain sentence that never shows the code", () => {
    const messages = codes.map((code) => {
      const refusal = paymentRefusal(code, "recorded")
      expect(refusal.status, code).toBe("refused")
      expect(refusal.message, code).not.toContain(code)
      expect(refusal.message, code).toMatch(/\.$/)
      return refusal.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })

  it("says a closed lead needs a reopening", () => {
    expect(paymentRefusal("lead_closed", "checked").message).toMatch(/Reopening request/)
  })

  it("marks the field each input refusal is about", () => {
    expect(paymentRefusal("invalid_type", "checked").field).toBe("type")
    expect(paymentRefusal("amount_not_positive", "checked").field).toBe("amount")
    expect(paymentRefusal("amount_not_whole", "checked").field).toBe("amount")
    expect(paymentRefusal("date_in_future", "checked").field).toBe("paid_on")
    expect(paymentRefusal("not_passed", "checked").field).toBeNull()
  })

  it("says whether the database was out of reach while checking or recording", () => {
    expect(paymentRefusal("unavailable", "checked").message).toMatch(/could not be checked/)
    expect(paymentRefusal("unavailable", "recorded").message).toMatch(/could not be recorded/)
  })
})

describe("isPaymentType", () => {
  it("accepts the five school-fee types only", () => {
    for (const type of ["full_payment", "initial_deposit", "first_instalment", "second_instalment", "third_instalment"]) {
      expect(isPaymentType(type), type).toBe(true)
    }
    for (const type of ["fee_waived", "pre_form_one_fee", "Full payment", "", null, 5]) {
      expect(isPaymentType(type), String(type)).toBe(false)
    }
  })
})

describe("a payment in the lead's history", () => {
  const entry: LeadHistoryEntry = {
    id: 1,
    at: "2026-09-25T07:00:00Z",
    actor: "Test Accountant",
    record: "school_fee_payments",
    recordId: "fee00000-0000-4000-8000-000000000902",
    action: "insert",
    changes: [
      { field: "lead_id", from: null, to: "1ead0000-0000-4000-8000-000000000902" },
      { field: "payment_type", from: null, to: "initial_deposit" },
      { field: "amount", from: null, to: 300000 },
      { field: "paid_on", from: null, to: "2026-09-25" },
      { field: "recorded_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000004" },
      { field: "recorded_at", from: null, to: "2026-09-25T07:00:00Z" },
      // The form's retry id is bookkeeping, never shown.
      { field: "request_id", from: null, to: "0b5e0000-0000-4000-8000-000000000001" },
    ],
  }

  it("reads as a recorded payment with its type, amount and date in plain words", () => {
    expect(describeLeadHistory([entry], {})).toEqual([
      {
        id: 1,
        at: "2026-09-25T07:00:00Z",
        actor: "Test Accountant",
        summary: "recorded a school-fee payment",
        changes: [
          { label: "Payment type", from: null, to: "Initial deposit" },
          { label: "Amount", from: null, to: "TZS 300,000" },
          { label: "Payment date", from: null, to: "25 Sept 2026" },
        ],
      },
    ])
  })
})
