import { describe, expect, it } from "vitest"

import { declineOutcome } from "@/app/staff/leads/[id]/decline-outcome"
import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { DECLINED_REASONS, declinedReasonsFor, isDeclinedReason, type DeclineError } from "@/lib/services/lead-closure"
import { PERMISSIONS } from "@/lib/permissions"

describe("declinedReasonsFor", () => {
  it("offers No seat available only to staff who may set the seats", () => {
    const staff = declinedReasonsFor(["leads.view", "leads.decline"])
    expect(staff).not.toContain("No seat available")
    expect(staff).toHaveLength(DECLINED_REASONS.length - 1)
    expect(declinedReasonsFor(["leads.decline", "academic_years.manage"])).toEqual([...DECLINED_REASONS])
    expect(declinedReasonsFor(PERMISSIONS)).toEqual([...DECLINED_REASONS])
  })

  it("lists the nine reasons in order, Other last", () => {
    expect(DECLINED_REASONS).toHaveLength(9)
    expect(DECLINED_REASONS.at(-1)).toBe("Other")
  })

  it("knows a reason from the list, and nothing else", () => {
    expect(isDeclinedReason("Fees or cost")).toBe(true)
    expect(isDeclinedReason("fees or cost")).toBe(false)
    expect(isDeclinedReason(undefined)).toBe(false)
  })
})

describe("declineOutcome", () => {
  it("explains every refusal in a plain sentence that never shows the code", () => {
    const codes: DeclineError[] = ["forbidden", "invalid", "lead-closed", "not-found", "unavailable"]
    const messages = codes.map((code) => {
      const outcome = declineOutcome(code)
      expect(outcome.status, code).toBe("refused")
      if (outcome.status !== "refused") throw new Error("unreachable")
      expect(outcome.message, code).not.toContain(code)
      expect(outcome.message, code).toMatch(/\.$/)
      return outcome.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })
})

describe("a decline in the history", () => {
  const entry: LeadHistoryEntry = {
    id: 7,
    at: "2026-10-02T08:00:00Z",
    actor: "Test Admissions",
    record: "lead",
    recordId: "11111111-1111-4111-8111-111111111111",
    action: "update",
    changes: [
      { field: "status", from: "Visited", to: "Declined" },
      { field: "declined_reason", from: null, to: "Other" },
      { field: "declined_explanation", from: null, to: "Moving to Arusha." },
      { field: "declined_at", from: null, to: "2026-10-02T08:00:00+00:00" },
      { field: "declined_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
      { field: "status_before_decline", from: null, to: "Visited" },
    ],
  }

  it("says the lead was declined, with the reason and explanation labelled, and leaves out who and when", () => {
    const [described] = describeLeadHistory([entry], {})
    expect(described.summary).toBe("declined the lead")
    expect(described.changes).toEqual([
      { label: "Status", from: "Visited", to: "Declined" },
      { label: "Declined reason", from: "None", to: "Other" },
      { label: "Decline explanation", from: "None", to: "Moving to Arusha." },
      { label: "Status before decline", from: "None", to: "Visited" },
    ])
  })
})
