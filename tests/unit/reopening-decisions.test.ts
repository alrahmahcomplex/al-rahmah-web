import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import {
  approvalConsequence,
  approveOutcome,
  canDecideReopening,
  rejectOutcome,
  retakeChoiceText,
} from "@/app/staff/leads/[id]/reopening-decision-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { needsRetakeChoice, type DecisionError } from "@/lib/services/reopening-requests"

describe("who may decide a reopening request", () => {
  it("needs reopenings.approve", () => {
    expect(canDecideReopening(["leads.view", "reopenings.approve"])).toBe(true)
    expect(canDecideReopening(["leads.view", "leads.create", "leads.edit", "leads.close"])).toBe(false)
  })
})

describe("the retake choice", () => {
  it("applies to a lead declined from Interviewed or Enrolled only", () => {
    expect(needsRetakeChoice("Interviewed")).toBe(true)
    expect(needsRetakeChoice("Enrolled")).toBe(true)
    expect(needsRetakeChoice("Visited")).toBe(false)
    expect(needsRetakeChoice("Applied")).toBe(false)
    expect(needsRetakeChoice(null)).toBe(false)
  })

  it("reads in words, and says nothing when it didn't apply", () => {
    expect(retakeChoiceText(true)).toBe("Enrol without a retaken interview")
    expect(retakeChoiceText(false)).toBe("Retake the interview")
    expect(retakeChoiceText(null)).toBeNull()
  })
})

describe("what approving does", () => {
  it("says where a Declined lead goes back to, Enrolled as Interviewed", () => {
    expect(approvalConsequence({ status: "Declined", closure: null, statusBefore: "Visited", visitDate: "2026-09-01" })).toBe(
      "The lead goes back to Visited. Staff can work on it again.",
    )
    expect(approvalConsequence({ status: "Declined", closure: null, statusBefore: "Enrolled", visitDate: "2026-09-01" })).toBe(
      "The lead comes back as Interviewed, and Enrolled is worked out again from its payments. Staff can work on it again.",
    )
  })

  it("names the status the database falls back to when the earlier one wasn't recorded", () => {
    expect(approvalConsequence({ status: "Declined", closure: null, statusBefore: null, visitDate: "2026-09-01" })).toBe(
      "The lead goes back to Visited. Staff can work on it again.",
    )
    expect(approvalConsequence({ status: "Declined", closure: null, statusBefore: null, visitDate: null })).toBe(
      "The lead goes back to Applied. Staff can work on it again.",
    )
  })

  it("says a mark is cleared, and that the status stays when the lead wasn't Declined", () => {
    expect(approvalConsequence({ status: "Visited", closure: "Inactive", statusBefore: null, visitDate: "2026-09-01" })).toBe(
      "Its Inactive mark is cleared and its status stays. Staff can work on it again.",
    )
    expect(approvalConsequence({ status: "Declined", closure: "Archived", statusBefore: "Applied", visitDate: null })).toBe(
      "The lead goes back to Applied. Its Archived mark is cleared. Staff can work on it again.",
    )
  })
})

describe("decision refusals", () => {
  const codes: DecisionError[] = ["forbidden", "invalid", "not-pending", "not-found", "unavailable"]

  it("explain every refusal in a plain sentence that never shows the code", () => {
    for (const outcome of [approveOutcome, rejectOutcome]) {
      const messages = codes.map((code) => {
        const result = outcome(code)
        if (result.status !== "refused") throw new Error("expected a refusal")
        expect(result.message, code).not.toMatch(/forbidden|invalid|not-pending|not-found|unavailable/)
        expect(result.message, code).toMatch(/\.$/)
        return result.message
      })
      expect(new Set(messages).size).toBe(codes.length)
    }
  })
})

describe("a decision in the history", () => {
  const base = { at: "2026-10-06T08:00:00Z", actor: "Test Manager" } as const

  const requestApproved: LeadHistoryEntry = {
    ...base,
    id: 21,
    record: "reopening_requests",
    recordId: "5e0e0000-0000-4000-8000-000000000001",
    action: "update",
    changes: [
      { field: "state", from: "pending", to: "approved" },
      { field: "decided_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000001" },
      { field: "decided_at", from: null, to: "2026-10-06T08:00:00+00:00" },
      { field: "enrol_without_retake", from: null, to: true },
      { field: "lead_was_declined", from: null, to: true },
      { field: "restored_status", from: null, to: "Interviewed" },
    ],
  }

  const leadReopened: LeadHistoryEntry = {
    ...base,
    id: 20,
    record: "lead",
    recordId: "1ead0000-0000-4000-8000-000000000001",
    action: "update",
    changes: [
      { field: "status", from: "Declined", to: "Interviewed" },
      { field: "declined_reason", from: "Fees or cost", to: null },
      { field: "status_before_decline", from: "Enrolled", to: null },
      { field: "initially_declined", from: false, to: true },
      { field: "closure", from: "Archived", to: null },
      { field: "closure_reason", from: "Admission cycle ended", to: null },
    ],
  }

  it("labels the approval and what it recorded", () => {
    const [approval] = describeLeadHistory([requestApproved], {})
    expect(approval).toMatchObject({ summary: "approved the reopening request" })
    expect(approval.changes).toEqual([
      { label: "Request", from: "Pending", to: "Approved" },
      { label: "Enrol without a retaken interview", from: "None", to: "Yes" },
      { label: "Lead was Declined", from: "None", to: "Yes" },
      { label: "Status restored to", from: "None", to: "Interviewed" },
    ])
  })

  it("labels the rejection with its reason", () => {
    const [rejection] = describeLeadHistory(
      [
        {
          ...requestApproved,
          changes: [
            { field: "state", from: "pending", to: "rejected" },
            { field: "rejection_reason", from: null, to: "Not this year." },
          ],
        },
      ],
      {},
    )
    expect(rejection).toMatchObject({ summary: "rejected the reopening request" })
    expect(rejection.changes).toEqual([
      { label: "Request", from: "Pending", to: "Rejected" },
      { label: "Reason for rejecting", from: "None", to: "Not this year." },
    ])
  })

  it("says the lead was reopened, from Declined, a mark, or both", () => {
    const [both] = describeLeadHistory([leadReopened], {})
    expect(both.summary).toBe("reopened the lead from Declined and Archived")
    expect(both.changes).toContainEqual({ label: "Initially declined", from: "No", to: "Yes" })

    const declinedOnly = { ...leadReopened, changes: leadReopened.changes.filter((c) => !c.field.startsWith("closure")) }
    expect(describeLeadHistory([declinedOnly], {})[0].summary).toBe("reopened the lead from Declined")

    const markOnly = { ...leadReopened, changes: leadReopened.changes.filter((c) => c.field.startsWith("closure")) }
    expect(describeLeadHistory([markOnly], {})[0].summary).toBe("reopened the lead from Archived")
  })
})
