import { describe, expect, it } from "vitest"

import {
  canDecideDiscount,
  canRequestDiscount,
  decideOutcome,
  discountLabel,
  requestOutcome,
} from "@/app/staff/leads/[id]/discount-outcome"
import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { paymentRefusal } from "@/app/staff/leads/[id]/payment-outcome"
import { dayOf } from "@/app/staff/leads/[id]/reopening-outcome"
import { navFor } from "@/app/staff/navigation"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { isDiscountKind, type DecideDiscountError, type RequestDiscountError } from "@/lib/services/discounts"
import { isRecordablePaymentType } from "@/lib/services/school-fee-payments"

describe("who may do what with discounts", () => {
  it("requesting needs leads.edit, deciding needs discounts.approve", () => {
    expect(canRequestDiscount(["leads.view", "leads.edit"])).toBe(true)
    expect(canRequestDiscount(["leads.view", "payments.record"])).toBe(false)
    expect(canDecideDiscount(["discounts.approve"])).toBe(true)
    expect(canDecideDiscount(["leads.view", "leads.edit"])).toBe(false)
  })

  it("shows Discount requests in the navigation to discounts.approve holders only", () => {
    const labels = (permissions: Parameters<typeof navFor>[0]) => navFor(permissions).map((entry) => entry.label)
    expect(labels(["leads.view", "discounts.approve"])).toContain("Discount requests")
    expect(labels(["leads.view", "leads.edit", "payments.view"])).not.toContain("Discount requests")
  })
})

describe("the discount kinds", () => {
  it("are Staff child and Qualified orphan, with what each takes off", () => {
    expect(discountLabel("staff_child")).toBe("Staff child (25% off)")
    expect(discountLabel("qualified_orphan")).toBe("Qualified orphan (100% off)")
    expect(isDiscountKind("staff_child")).toBe(true)
    expect(isDiscountKind("sibling")).toBe(false)
    expect(isDiscountKind(undefined)).toBe(false)
  })

  it("let Fee waived and the Pre-Form One fee be recorded", () => {
    expect(isRecordablePaymentType("fee_waived")).toBe(true)
    expect(isRecordablePaymentType("pre_form_one_fee")).toBe(true)
    expect(isRecordablePaymentType("pre_form_one")).toBe(false)
  })
})

describe("what the screens say", () => {
  it("has words for every refusal of a request", () => {
    const errors: RequestDiscountError[] = [
      { kind: "forbidden" },
      { kind: "not-found" },
      { kind: "unavailable" },
      { kind: "invalid", field: "kind" },
      { kind: "invalid", field: "note" },
      { kind: "lead-closed" },
      { kind: "already-pending", requestedBy: "Test Admissions", requestedAt: "2026-09-28T06:00:00Z" },
      { kind: "already-granted" },
    ]
    for (const error of errors) {
      const outcome = requestOutcome(error)
      expect(outcome.status).toBe("refused")
      expect(outcome.status === "refused" && outcome.message, error.kind).not.toMatch(/_|-pending|already-/)
    }
    expect(requestOutcome(errors[6])).toEqual({
      status: "refused",
      message: `A discount was already requested by Test Admissions on ${dayOf("2026-09-28T06:00:00Z")}. Nothing new was sent.`,
    })
  })

  it("has words for every refusal of a decision", () => {
    const errors: DecideDiscountError[] = ["forbidden", "not-found", "unavailable", "invalid", "lead-closed", "not-pending"]
    for (const error of errors) {
      expect(decideOutcome(error, "grant").status).toBe("refused")
    }
    expect(decideOutcome("unavailable", "refuse")).toEqual({
      status: "refused",
      message: "The request could not be refused. Nothing was changed. Try again in a moment.",
    })
  })

  it("explains each Fee waived refusal", () => {
    expect(paymentRefusal("not_waivable", "checked")).toMatchObject({ field: "type", message: expect.stringContaining("Qualified orphan") })
    expect(paymentRefusal("amount_not_allowed", "checked")).toMatchObject({ field: "amount" })
    expect(paymentRefusal("already_waived", "recorded")).toMatchObject({ message: "This lead's fee is already waived." })
  })
})

describe("discount requests in the lead history", () => {
  const entry = (overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry => ({
    id: 1,
    at: "2026-09-28T06:00:00Z",
    actor: "Test Admissions",
    record: "discount_requests",
    recordId: "d15c0000-0000-4000-8000-000000000907",
    action: "insert",
    changes: [],
    ...overrides,
  })

  it("labels a request with its note and discount, and hides who and when", () => {
    const [described] = describeLeadHistory(
      [
        entry({
          changes: [
            { field: "lead_id", from: null, to: "1ead0000-0000-4000-8000-000000000907" },
            { field: "kind", from: null, to: "qualified_orphan" },
            { field: "note", from: null, to: "Both parents have died." },
            { field: "state", from: null, to: "pending" },
            { field: "requested_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
            { field: "request_id", from: null, to: "0b0b0b0b-0000-4000-8000-000000000001" },
          ],
        }),
      ],
      {},
    )
    expect(described.summary).toBe("requested a Qualified orphan discount")
    expect(described.changes).toEqual([
      { label: "Note for the Manager", from: null, to: "Both parents have died." },
      { label: "Discount", from: null, to: "Qualified orphan" },
      { label: "Request", from: null, to: "Pending" },
    ])
  })

  it("labels a grant and a refusal with its reason", () => {
    const [granted, refused] = describeLeadHistory(
      [
        entry({ id: 3, action: "update", actor: "Test Manager", changes: [{ field: "state", from: "pending", to: "granted" }] }),
        entry({
          id: 2,
          action: "update",
          actor: "Test Manager",
          changes: [
            { field: "state", from: "pending", to: "refused" },
            { field: "refusal_reason", from: null, to: "Not school staff." },
            { field: "decided_at", from: null, to: "2026-09-29T06:00:00Z" },
          ],
        }),
      ],
      {},
    )
    expect(granted.summary).toBe("granted the discount request")
    expect(granted.changes).toEqual([{ label: "Request", from: "Pending", to: "Granted" }])
    expect(refused.summary).toBe("refused the discount request")
    expect(refused.changes).toEqual([
      { label: "Request", from: "Pending", to: "Refused" },
      { label: "Reason for refusing", from: "None", to: "Not school staff." },
    ])
  })
})
