import { describe, expect, test } from "vitest"

import { addDays, dueLabel, followUpOutcome, recordedOutcome, scheduledOutcome } from "@/app/staff/leads/[id]/follow-up-outcome"
import {
  enteredLate,
  formatContactTime,
  fromTanzaniaLocal,
  recordOutcomeText,
  tanzaniaNowLocal,
} from "@/app/staff/leads/[id]/follow-up-record-format"
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

  const recordEntry = (changes: LeadHistoryEntry["changes"]): LeadHistoryEntry => ({
    id: 9,
    at: "2026-10-03T08:00:00Z",
    actor: "Test Manager",
    record: "follow_up_records",
    recordId: "r1",
    action: "insert",
    changes,
  })

  test("a recorded contact reads plainly, naming who made it and when, in Tanzania time", () => {
    const [described] = describeLeadHistory(
      [
        recordEntry([
          { field: "lead_id", from: null, to: "lead" },
          { field: "follow_up_id", from: null, to: "f1" },
          { field: "kind", from: null, to: "contact" },
          { field: "outcome", from: null, to: "next_date" },
          { field: "comment", from: null, to: "Spoke with the mother." },
          { field: "method", from: null, to: "Phone call" },
          { field: "contacted_by", from: null, to: "staff-1" },
          { field: "contacted_at", from: null, to: "2026-10-03T11:30:00+00:00" },
          { field: "entered_at", from: null, to: "2026-10-03T12:00:00+00:00" },
          { field: "next_follow_up_id", from: null, to: "f2" },
        ]),
      ],
      { "staff-1": "Test Admissions" },
    )
    expect(described).toMatchObject({
      actor: "Test Manager",
      summary: "recorded a follow-up",
      changes: [
        { label: "Contact method", from: null, to: "Phone call" },
        { label: "Made the contact", from: null, to: "Test Admissions" },
        { label: "Contacted at", from: null, to: "3 Oct 2026, 14:30" },
        { label: "Comment", from: null, to: "Spoke with the mother." },
        { label: "Outcome", from: null, to: "Next follow-up planned" },
      ],
    })
  })

  test("an unplanned contact and a follow-up closed with its lead say so", () => {
    const described = describeLeadHistory(
      [
        recordEntry([
          { field: "kind", from: null, to: "contact" },
          { field: "outcome", from: null, to: "lead_enrolled" },
          { field: "contacted_by", from: null, to: "gone" },
        ]),
        recordEntry([
          { field: "kind", from: null, to: "closed_with_lead" },
          { field: "follow_up_id", from: null, to: "f1" },
          { field: "cause", from: null, to: "archived" },
        ]),
      ],
      {},
    )
    expect(described[0].summary).toBe("recorded an unplanned contact")
    expect(described[0].changes).toContainEqual({ label: "Outcome", from: null, to: "No next date: the lead is Enrolled" })
    // A name the page could not find still shows the raw value.
    expect(described[0].changes).toContainEqual({ label: "Made the contact", from: null, to: "gone" })
    expect(described[1]).toMatchObject({
      summary: "closed the follow-up with the lead",
      changes: [{ label: "Closed because", from: null, to: "The lead was archived" }],
    })
  })
})

describe("recording a contact", () => {
  test("every refusal reads as a plain sentence, and a conflict offers a reload", () => {
    const fields = ["comment", "method", "contacted_by", "contacted_at", "outcome", "next_due_on", "next_note"] as const
    for (const field of fields) {
      const outcome = followUpOutcome({ kind: "invalid", field }, "record")
      expect(outcome.message, field).toMatch(/^[A-Z].*\.$/)
      expect(outcome.message, field).not.toMatch(/_/)
    }
    expect(followUpOutcome({ kind: "conflict" }, "record")).toEqual({
      status: "refused",
      field: null,
      conflict: true,
      message: "Someone else has already recorded or changed this follow-up. Nothing was saved. Reload the page to see it.",
    })
    expect(followUpOutcome({ kind: "forbidden" }, "record").message).toBe("Your role can't record follow-ups.")
    expect(followUpOutcome({ kind: "not-found" }, "record").message).toBe("This lead could not be found. Reload the page.")
  })

  test("confirms the next date in words, or just the record", () => {
    expect(recordedOutcome("2026-10-11")).toEqual({ status: "saved", message: "Follow-up recorded. Next follow-up on 11 Oct 2026." })
    expect(recordedOutcome(null)).toEqual({ status: "saved", message: "Follow-up recorded." })
  })

  test("reads and writes contact times in Tanzania time", () => {
    // 20:59 UTC is 23:59 in Dar es Salaam; 21:00 UTC is already the next day.
    expect(tanzaniaNowLocal(new Date("2026-03-01T20:59:30Z"))).toBe("2026-03-01T23:59")
    expect(tanzaniaNowLocal(new Date("2026-03-01T21:00:00Z"))).toBe("2026-03-02T00:00")
    expect(fromTanzaniaLocal("2026-03-02T00:00")).toBe("2026-03-01T21:00:00.000Z")
    for (const bad of ["", "2026-03-02", "2026-13-40T99:99", "tomorrow"]) expect(fromTanzaniaLocal(bad), bad).toBeNull()
    expect(formatContactTime("2026-10-03T11:30:00Z")).toBe("3 Oct 2026, 14:30")
  })

  test("shows when a record was entered only if over an hour after the contact", () => {
    expect(enteredLate({ contactedAt: "2026-10-03T08:00:00Z", enteredAt: "2026-10-03T09:00:00Z" })).toBe(false)
    expect(enteredLate({ contactedAt: "2026-10-03T08:00:00Z", enteredAt: "2026-10-03T09:01:00Z" })).toBe(true)
    expect(enteredLate({ contactedAt: null, enteredAt: "2026-10-03T09:01:00Z" })).toBe(false)
  })

  test("says how each record ended", () => {
    expect(recordOutcomeText({ kind: "contact", outcome: "next_date", cause: null }, "2026-10-11")).toBe("Next follow-up: 11 Oct 2026")
    expect(recordOutcomeText({ kind: "contact", outcome: "lead_enrolled", cause: null }, null)).toBe("No next date: the lead is Enrolled")
    expect(recordOutcomeText({ kind: "closed_with_lead", outcome: null, cause: "declined" }, null)).toBe("Closed with the lead (Declined)")
  })
})
