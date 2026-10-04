import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import {
  alreadyRequested,
  canRaiseReopening,
  raiseOutcome,
  reopeningSourceOf,
  withdrawOutcome,
} from "@/app/staff/leads/[id]/reopening-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { isReopeningSource, type RaiseError, type WithdrawError } from "@/lib/services/reopening-requests"

describe("who may raise a reopening request", () => {
  it("needs leads.create or leads.edit, either one", () => {
    expect(canRaiseReopening(["leads.view", "leads.create"])).toBe(true)
    expect(canRaiseReopening(["leads.view", "leads.edit"])).toBe(true)
    expect(canRaiseReopening(["leads.view", "leads.decline", "reopenings.approve"])).toBe(false)
  })
})

describe("the reopen page's source", () => {
  it("keeps lead and re_application, and reads anything else as the duplicate hand-off", () => {
    expect(reopeningSourceOf("lead")).toBe("lead")
    expect(reopeningSourceOf("re_application")).toBe("re_application")
    expect(reopeningSourceOf("duplicate_match")).toBe("duplicate_match")
    // A visit without a recognised source counts as the lead screen, never as
    // a front-desk duplicate.
    expect(reopeningSourceOf(undefined)).toBe("lead")
    expect(reopeningSourceOf("something-else")).toBe("lead")
    expect(reopeningSourceOf(["duplicate_match", "lead"])).toBe("lead")
  })

  it("knows the three sources, and nothing else", () => {
    expect(isReopeningSource("lead")).toBe(true)
    expect(isReopeningSource("admission_form")).toBe(false)
  })
})

describe("already requested", () => {
  it("names who asked and the day, in Tanzania time", () => {
    expect(alreadyRequested("Test Admissions", "2026-09-27T22:30:00Z")).toBe(
      "Reopening already requested by Test Admissions on 28 Sept 2026.",
    )
  })

  it("still reads when the name or date is missing", () => {
    expect(alreadyRequested(null, null)).toBe("Reopening already requested.")
  })
})

function refusalMessages<E>(codes: E[], outcome: (code: E) => { status: string; message?: string }) {
  return codes.map((code) => {
    const result = outcome(code)
    expect(result.status, String(code)).toBe("refused")
    const message = result.message ?? ""
    expect(message, String(code)).not.toMatch(/forbidden|invalid|lead-open|already-pending|not-found|unavailable|not-pending|not-requester/)
    expect(message, String(code)).toMatch(/\.$/)
    return message
  })
}

describe("refusals", () => {
  it("explain every raise refusal in a plain sentence that never shows the code", () => {
    const codes: RaiseError[] = [
      { kind: "forbidden" },
      { kind: "invalid" },
      { kind: "lead-open" },
      { kind: "already-pending", requestedBy: "Test Manager", requestedAt: "2026-10-01T08:00:00Z" },
      { kind: "not-found" },
      { kind: "unavailable" },
    ]
    const messages = refusalMessages(codes, raiseOutcome)
    expect(new Set(messages).size).toBe(codes.length)
    expect(messages[3]).toContain("Reopening already requested by Test Manager on 1 Oct 2026.")
  })

  it("explain every withdraw refusal in a plain sentence that never shows the code", () => {
    const codes: WithdrawError[] = ["forbidden", "not-requester", "not-pending", "not-found", "unavailable"]
    expect(new Set(refusalMessages(codes, withdrawOutcome)).size).toBe(codes.length)
  })
})

describe("a reopening request in the history", () => {
  const base = {
    at: "2026-10-02T08:00:00Z",
    actor: "Test Admissions",
    record: "reopening_requests",
    recordId: "5e0e0000-0000-4000-8000-000000000001",
  } as const

  const raised: LeadHistoryEntry = {
    ...base,
    id: 8,
    action: "insert",
    changes: [
      { field: "lead_id", from: null, to: "1ead0000-0000-4000-8000-000000000001" },
      { field: "source", from: null, to: "duplicate_match" },
      { field: "reason", from: null, to: "The family is back." },
      { field: "requested_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
      { field: "requested_at", from: null, to: "2026-10-02T08:00:00+00:00" },
      { field: "state", from: null, to: "pending" },
      { field: "decided_by", from: null, to: null },
    ],
  }

  const withdrawn: LeadHistoryEntry = {
    ...base,
    id: 9,
    action: "update",
    changes: [
      { field: "state", from: "pending", to: "withdrawn" },
      { field: "decided_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
      { field: "decided_at", from: null, to: "2026-10-02T09:00:00+00:00" },
    ],
  }

  it("labels raising and withdrawing, with the source and state in words", () => {
    const [withdrawal, raising] = describeLeadHistory([withdrawn, raised], {})

    expect(raising).toMatchObject({ actor: "Test Admissions", summary: "requested reopening" })
    expect(raising.changes).toEqual([
      { label: "Raised from", from: null, to: "Duplicate match at the front desk" },
      { label: "Reason for reopening", from: null, to: "The family is back." },
      { label: "Request", from: null, to: "Pending" },
    ])

    expect(withdrawal).toMatchObject({ summary: "withdrew the reopening request" })
    expect(withdrawal.changes).toEqual([{ label: "Request", from: "Pending", to: "Withdrawn" }])
  })

  it("leaves another table's reason and state in its own words", () => {
    const [other] = describeLeadHistory(
      [{ ...raised, record: "some_later_table", changes: [{ field: "state", from: null, to: "pending" }] }],
      {},
    )
    expect(other.changes).toEqual([{ label: "state", from: null, to: "pending" }])
  })
})
