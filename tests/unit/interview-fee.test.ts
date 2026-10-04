import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { feeChangedOutcome, feeOutcome } from "@/app/staff/leads/[id]/interview-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { FeeStatusError } from "@/lib/services/interviews"

describe("feeChangedOutcome", () => {
  it("names the locked amount when the fee is marked Paid", () => {
    expect(feeChangedOutcome({ feeStatus: "Paid", lockedAmount: 30000, discountApplied: true })).toEqual({
      status: "saved",
      message: "Marked Paid. TZS 30,000 is locked as the amount paid.",
    })
  })

  it("says the lock is released when the fee goes back to Not Paid", () => {
    expect(feeChangedOutcome({ feeStatus: "Not Paid", lockedAmount: null, discountApplied: false })).toEqual({
      status: "saved",
      message: "Marked Not Paid. The amount is no longer locked.",
    })
  })
})

describe("feeOutcome", () => {
  it("explains every refusal in its own plain sentence that never shows the code", () => {
    const codes: FeeStatusError[] = ["no_change", "lead_closed", "forbidden", "not_found", "unavailable"]
    const messages = codes.map((code) => {
      const outcome = feeOutcome(code)
      expect(outcome.status, code).toBe("refused")
      expect(outcome.message, code).not.toContain(code)
      expect(outcome.message, code).toMatch(/\.$/)
      return outcome.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })
})

describe("the interview fee in the lead's history", () => {
  const base: LeadHistoryEntry = {
    id: 12,
    at: "2026-10-03T09:00:00Z",
    actor: "Test Accountant",
    record: "interviews",
    recordId: "44444444-4444-4444-8444-444444444444",
    action: "update",
    changes: [],
  }

  it("reads marking it Paid with the amount locked", () => {
    const [described] = describeLeadHistory(
      [
        {
          ...base,
          changes: [
            { field: "locked_amount", from: null, to: 50000 },
            { field: "fee_status", from: "Not Paid", to: "Paid" },
          ],
        },
      ],
      {},
    )
    expect(described).toMatchObject({ actor: "Test Accountant", at: base.at, summary: "marked the interview fee Paid" })
    expect(described.changes).toEqual([
      { label: "Interview fee", from: "Not Paid", to: "Paid" },
      { label: "Amount paid", from: "None", to: "TZS 50,000" },
    ])
  })

  it("reads marking it Not Paid with the amount released", () => {
    const [described] = describeLeadHistory(
      [
        {
          ...base,
          changes: [
            { field: "fee_status", from: "Paid", to: "Not Paid" },
            { field: "locked_amount", from: 30000, to: null },
          ],
        },
      ],
      {},
    )
    expect(described.summary).toBe("marked the interview fee Not Paid")
    expect(described.changes).toEqual([
      { label: "Interview fee", from: "Paid", to: "Not Paid" },
      { label: "Amount paid", from: "TZS 30,000", to: "None" },
    ])
  })
})
