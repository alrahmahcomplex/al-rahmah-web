import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { markOutcome } from "@/app/staff/leads/[id]/mark-outcome"
import { markConsequence, markTitle } from "@/app/staff/leads/[id]/mark-text"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { CLOSURE_REASONS, isClosureReason, isMarkMove, marksAllowed, type MarkError } from "@/lib/services/lead-closure"

describe("marksAllowed", () => {
  it("offers both marks on an unmarked lead, Archive alone on an Inactive one, and none on an Archived one", () => {
    expect(marksAllowed(null)).toEqual(["inactive", "archived"])
    expect(marksAllowed("Inactive")).toEqual(["archived"])
    expect(marksAllowed("Archived")).toEqual([])
  })
})

describe("the closure reasons", () => {
  it("lists the six reasons in order", () => {
    expect(CLOSURE_REASONS).toEqual([
      "Duplicate record",
      "Family requested closure",
      "Enrolled elsewhere",
      "No longer pursuing admission",
      "Record created in error",
      "Admission cycle ended",
    ])
  })

  it("knows a reason and a move from the list, and nothing else", () => {
    expect(isClosureReason("Duplicate record")).toBe(true)
    expect(isClosureReason("duplicate record")).toBe(false)
    expect(isClosureReason(undefined)).toBe(false)
    expect(isMarkMove("inactive")).toBe(true)
    expect(isMarkMove("Archived")).toBe(false)
  })
})

describe("the mark dialog", () => {
  it("names the move and says what happens next, keeping the status", () => {
    expect(markTitle("inactive", "Pendo Lyimo")).toBe("Mark Pendo Lyimo inactive")
    expect(markTitle("archived", "Pendo Lyimo")).toBe("Archive Pendo Lyimo")
    expect(markConsequence("inactive", "Visited")).toContain("keeps its status, Visited")
    expect(markConsequence("inactive", "Visited")).toContain("can still be archived later")
    expect(markConsequence("archived", "Declined")).toContain("never moved back to Inactive")
  })
})

describe("markOutcome", () => {
  it("explains every refusal in a plain sentence that never shows the code", () => {
    const codes: MarkError[] = ["forbidden", "invalid", "not-found", "unavailable"]
    const messages = codes.map((code) => {
      const outcome = markOutcome(code)
      if (outcome.status !== "refused") throw new Error("unreachable")
      expect(outcome.message, code).not.toContain(code)
      expect(outcome.message, code).toMatch(/\.$/)
      return outcome.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })
})

describe("a mark in the history", () => {
  const entry = (closure: { from: string | null; to: string }): LeadHistoryEntry => ({
    id: 9,
    at: "2026-10-02T08:00:00Z",
    actor: "Test Admissions",
    record: "lead",
    recordId: "11111111-1111-4111-8111-111111111111",
    action: "update",
    changes: [
      { field: "closure", ...closure },
      { field: "closure_reason", from: null, to: "Duplicate record" },
      { field: "closure_note", from: null, to: "Entered twice." },
      { field: "closed_at", from: null, to: "2026-10-02T08:00:00+00:00" },
      { field: "closed_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
    ],
  })

  it("says which mark was set, with the reason and note labelled, and leaves out who and when", () => {
    const [inactive] = describeLeadHistory([entry({ from: null, to: "Inactive" })], {})
    expect(inactive.summary).toBe("marked the lead Inactive")
    expect(inactive.changes).toEqual([
      { label: "Closure", from: "None", to: "Inactive" },
      { label: "Closure reason", from: "None", to: "Duplicate record" },
      { label: "Closure note", from: "None", to: "Entered twice." },
    ])
    expect(describeLeadHistory([entry({ from: null, to: "Archived" })], {})[0].summary).toBe("archived the lead")
    expect(describeLeadHistory([entry({ from: "Inactive", to: "Archived" })], {})[0].summary).toBe(
      "moved the lead from Inactive to Archived",
    )
  })
})
