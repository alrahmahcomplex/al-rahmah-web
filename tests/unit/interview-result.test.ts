import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { recordedOutcome, recordOutcome } from "@/app/staff/leads/[id]/interview-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { RecordResultError } from "@/lib/services/interviews"

describe("recordedOutcome", () => {
  it("says whether the result was recorded, corrected, or left as it was", () => {
    expect(recordedOutcome({ firstRecording: true, changed: true })).toEqual({
      status: "saved",
      message: "Result recorded. The lead is Interviewed.",
    })
    expect(recordedOutcome({ firstRecording: false, changed: true })).toEqual({
      status: "saved",
      message: "Result corrected. The history keeps the earlier values.",
    })
    expect(recordedOutcome({ firstRecording: false, changed: false })).toEqual({
      status: "saved",
      message: "Nothing was changed: the result is as it was.",
    })
  })
})

describe("recordOutcome", () => {
  it("explains every refusal in its own plain sentence that never shows the code", () => {
    const codes: RecordResultError[] = [
      "incomplete",
      "score_out_of_range",
      "score_too_precise",
      "date_in_future",
      "date_before_registration",
      "lead_closed",
      "forbidden",
      "not_found",
      "unavailable",
    ]
    const messages = codes.map((code) => {
      const outcome = recordOutcome(code)
      expect(outcome.status, code).toBe("refused")
      expect(outcome.message, code).not.toContain(code)
      expect(outcome.message, code).toMatch(/\.$/)
      return outcome.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })

  it("marks the field a refusal is about", () => {
    expect(recordOutcome("score_out_of_range")).toMatchObject({ field: "score", message: "Enter a score from 0 to 100." })
    expect(recordOutcome("score_too_precise")).toMatchObject({ field: "score" })
    expect(recordOutcome("date_in_future")).toMatchObject({
      field: "interview_date",
      message: "The interview date can't be later than today.",
    })
    expect(recordOutcome("date_before_registration")).toMatchObject({ field: "interview_date" })
    expect(recordOutcome("lead_closed")).toMatchObject({ field: null })
  })
})

describe("an interview result in the lead's history", () => {
  const base: LeadHistoryEntry = {
    id: 9,
    at: "2026-10-02T09:00:00Z",
    actor: "Test Admissions",
    record: "interviews",
    recordId: "44444444-4444-4444-8444-444444444444",
    action: "update",
    changes: [],
  }

  it("reads the first recording as recorded, with the date, result and score", () => {
    const [described] = describeLeadHistory(
      [
        {
          ...base,
          changes: [
            { field: "score", from: null, to: 78.5 },
            { field: "result", from: null, to: "Passed" },
            { field: "interview_date", from: null, to: "2026-10-01" },
          ],
        },
      ],
      {},
    )
    expect(described.summary).toBe("recorded the interview result")
    expect(described.changes).toEqual([
      { label: "Interview date", from: "None", to: "1 Oct 2026" },
      { label: "Interview result", from: "None", to: "Passed" },
      { label: "Interview score", from: "None", to: "78.5%" },
    ])
  })

  it("reads a later change as a correction, with the old and new values", () => {
    const [described] = describeLeadHistory(
      [{ ...base, changes: [{ field: "score", from: 78.5, to: 48 }, { field: "result", from: "Passed", to: "Failed" }] }],
      {},
    )
    expect(described.summary).toBe("corrected the interview result")
    expect(described.changes).toEqual([
      { label: "Interview result", from: "Passed", to: "Failed" },
      { label: "Interview score", from: "78.5%", to: "48%" },
    ])
  })

  it("reads the lead's move from Visited to Interviewed", () => {
    const [described] = describeLeadHistory(
      [{ ...base, record: "lead", recordId: "11111111-1111-4111-8111-111111111111", changes: [{ field: "status", from: "Visited", to: "Interviewed" }] }],
      {},
    )
    expect(described.summary).toBe("moved the lead to Interviewed")
  })
})
