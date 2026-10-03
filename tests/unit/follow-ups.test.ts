import { describe, expect, test } from "vitest"

import { addDays, dueLabel, followUpOutcome, scheduledOutcome } from "@/app/staff/leads/[id]/follow-up-outcome"
import type { FollowUpWriteError } from "@/lib/services/follow-ups"
import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

describe("the Follow-ups panel's sentences", () => {
  test("every refusal reads as a plain sentence, never a code", () => {
    const errors: FollowUpWriteError[] = [
      { kind: "forbidden" },
      { kind: "invalid", field: "due_on" },
      { kind: "invalid", field: "note" },
      { kind: "invalid", field: "reason" },
      { kind: "invalid", field: null },
      { kind: "not-found" },
      { kind: "read-only" },
      { kind: "conflict" },
      { kind: "unavailable" },
    ]
    for (const error of errors) {
      for (const action of ["schedule", "change"] as const) {
        const outcome = followUpOutcome(error, action)
        expect(outcome.status).toBe("refused")
        expect(outcome.message).toMatch(/^[A-Z].*\.$/)
        expect(outcome.message).not.toMatch(/_|read-only|not-found|forbidden|conflict/)
      }
    }
    expect(followUpOutcome({ kind: "invalid", field: "reason" }, "change")).toEqual({
      status: "refused",
      field: "reason",
      message: "Give a reason of 3 to 500 characters.",
    })
    expect(followUpOutcome({ kind: "read-only" }, "schedule").message).toBe(
      "This lead is closed, so its follow-ups can't be changed.",
    )
  })

  test("confirms the date in words", () => {
    expect(scheduledOutcome("2026-10-04")).toEqual({ status: "saved", message: "Follow-up scheduled for 4 Oct 2026." })
  })

  test("says how a date stands against today", () => {
    const today = "2026-10-03"
    expect(dueLabel(today, today)).toEqual({ text: "Due today", overdue: false })
    expect(dueLabel("2026-10-04", today)).toEqual({ text: "Due tomorrow", overdue: false })
    expect(dueLabel("2026-10-10", today)).toEqual({ text: "Due in 7 days", overdue: false })
    expect(dueLabel("2026-10-02", today)).toEqual({ text: "Overdue by 1 day", overdue: true })
    expect(dueLabel("2026-09-29", today)).toEqual({ text: "Overdue by 4 days", overdue: true })
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  })
})

describe("follow-ups in the lead's history", () => {
  const entry = (id: number, recordId: string, changes: LeadHistoryEntry["changes"], actor = "Test Admissions"): LeadHistoryEntry => ({
    id,
    at: "2026-10-03T08:00:00Z",
    actor,
    record: "follow_ups",
    recordId,
    action: "insert",
    changes,
  })

  test("a scheduling reads plainly, with its date and note", () => {
    const [described] = describeLeadHistory(
      [
        entry(1, "f1", [
          { field: "lead_id", from: null, to: "lead" },
          { field: "due_on", from: null, to: "2026-10-04" },
          { field: "note", from: null, to: "Ask about the bus." },
        ]),
      ],
      {},
    )
    expect(described).toMatchObject({
      summary: "scheduled a follow-up",
      changes: [
        { label: "Follow-up date", from: null, to: "4 Oct 2026" },
        { label: "Note", from: null, to: "Ask about the bus." },
      ],
    })
  })

  test("a date change shows the earlier date and the reason, and leaves out a note carried over unchanged", () => {
    const described = describeLeadHistory(
      [
        entry(2, "f2", [
          { field: "lead_id", from: null, to: "lead" },
          { field: "due_on", from: null, to: "2026-10-09" },
          { field: "note", from: null, to: "Ask about the bus." },
          { field: "replaces_id", from: null, to: "f1" },
          { field: "change_reason", from: null, to: "Parent is travelling." },
        ], "Test Manager"),
        entry(1, "f1", [
          { field: "lead_id", from: null, to: "lead" },
          { field: "due_on", from: null, to: "2026-10-04" },
          { field: "note", from: null, to: "Ask about the bus." },
        ]),
      ],
      {},
    )
    expect(described[0]).toMatchObject({
      actor: "Test Manager",
      summary: "changed the follow-up date",
      changes: [
        { label: "Follow-up date", from: "4 Oct 2026", to: "9 Oct 2026" },
        { label: "Reason for the change", from: null, to: "Parent is travelling." },
      ],
    })
  })

  test("a date change whose earlier follow-up is not in the history still shows its new date", () => {
    const [described] = describeLeadHistory(
      [
        entry(2, "f2", [
          { field: "due_on", from: null, to: "2026-10-09" },
          { field: "note", from: null, to: "New note." },
          { field: "replaces_id", from: null, to: "gone" },
          { field: "change_reason", from: null, to: "Office closed." },
        ]),
      ],
      {},
    )
    expect(described.changes).toEqual([
      { label: "Follow-up date", from: null, to: "9 Oct 2026" },
      { label: "Note", from: null, to: "New note." },
      { label: "Reason for the change", from: null, to: "Office closed." },
    ])
  })
})
