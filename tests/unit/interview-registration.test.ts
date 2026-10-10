import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { registeredOutcome, registerOutcome } from "@/app/staff/leads/[id]/interview-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { nextActionOf, type RegisterError } from "@/lib/services/interviews"

describe("registerOutcome", () => {
  it("confirms a registration with its S/N and year", () => {
    expect(registeredOutcome({ interviewId: "x", serialNumber: 12, enrollmentYear: 2027, retake: false })).toEqual({
      status: "registered",
      message: "Registered for interview. The S/N is 12 for 2027.",
    })
  })

  it("says when it registered a retaken interview", () => {
    expect(registeredOutcome({ interviewId: "x", serialNumber: 31, enrollmentYear: 2027, retake: true })).toEqual({
      status: "registered",
      message: "Registered for a retaken interview. The S/N is 31 for 2027.",
    })
  })

  it("explains every refusal in a plain sentence that never shows the code", () => {
    const codes: RegisterError[] = ["already_registered", "lead_closed", "lead_enrolled", "forbidden", "not_found", "unavailable"]
    const messages = codes.map((code) => {
      const outcome = registerOutcome(code)
      expect(outcome.status, code).toBe("refused")
      expect(outcome.message, code).not.toContain(code)
      expect(outcome.message, code).toMatch(/\.$/)
      return outcome.message
    })
    expect(new Set(messages).size).toBe(codes.length)
  })

  it("tells staff why a closed or Enrolled lead can't be registered", () => {
    expect(registerOutcome("lead_closed").message).toBe("This lead is closed, so it can't be registered for interview.")
    expect(registerOutcome("lead_enrolled").message).toBe("This lead is already Enrolled, so it doesn't need an interview.")
  })
})

describe("nextActionOf", () => {
  it("follows from the result, and there is none without one", () => {
    expect(nextActionOf("Passed")).toBe("Complete enrollment")
    expect(nextActionOf("Failed")).toBe("Contact the admissions office")
    expect(nextActionOf(null)).toBeNull()
  })
})

describe("an interview registration in the lead's history", () => {
  const registration: LeadHistoryEntry = {
    id: 7,
    at: "2026-10-01T07:15:00Z",
    actor: "Test Admissions",
    record: "interviews",
    recordId: "44444444-4444-4444-8444-444444444444",
    action: "insert",
    changes: [
      { field: "lead", from: null, to: "11111111-1111-4111-8111-111111111111" },
      { field: "score", from: null, to: null },
      { field: "result", from: null, to: null },
      { field: "fee_status", from: null, to: "Not Paid" },
      { field: "serial_year", from: null, to: 2027 },
      { field: "registered_at", from: null, to: "2026-10-01T07:15:00Z" },
      { field: "registered_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
      { field: "locked_amount", from: null, to: null },
      { field: "serial_number", from: null, to: 12 },
      { field: "interview_date", from: null, to: null },
    ],
  }

  it("reads as a registration with the S/N, its year and the fee, and nothing the database keeps for itself", () => {
    expect(describeLeadHistory([registration], {})).toEqual([
      {
        id: 7,
        at: "2026-10-01T07:15:00Z",
        actor: "Test Admissions",
        summary: "registered the lead for interview",
        changes: [
          { label: "S/N", from: null, to: "12" },
          { label: "S/N enrollment year", from: null, to: "2027" },
          { label: "Interview fee", from: null, to: "Not Paid" },
        ],
      },
    ])
  })

  it("shows a change to the interview with plain labels and dates", () => {
    const [described] = describeLeadHistory(
      [
        {
          ...registration,
          action: "update",
          changes: [
            { field: "interview_date", from: null, to: "2026-09-30" },
            { field: "locked_amount", from: null, to: 30000 },
          ],
        },
      ],
      {},
    )
    expect(described.summary).toBe("changed the interview")
    expect(described.changes).toEqual([
      { label: "Interview date", from: "None", to: "30 Sept 2026" },
      { label: "Amount paid", from: "None", to: "TZS 30,000" },
    ])
  })
})

describe("a retaken interview in the lead's history", () => {
  const FIRST = "44444444-4444-4444-8444-444444444441"
  const RETAKE = "44444444-4444-4444-8444-444444444442"
  const entry = (id: number, recordId: string, action: string, changes: LeadHistoryEntry["changes"]): LeadHistoryEntry => ({
    id,
    at: "2026-10-01T07:15:00Z",
    actor: "Test Admissions",
    record: "interviews",
    recordId,
    action,
    changes,
  })
  const firstRegistration = entry(1, FIRST, "insert", [{ field: "serial_number", from: null, to: 12 }])
  const firstResult = entry(2, FIRST, "update", [{ field: "result", from: null, to: "Failed" }])
  const retakeRegistration = entry(3, RETAKE, "insert", [{ field: "serial_number", from: null, to: 31 }])
  const retakeResult = entry(4, RETAKE, "update", [{ field: "result", from: null, to: "Passed" }])

  it("names each interview's S/N, and reads the later registration as the retaken interview", () => {
    // Newest first, as the history comes.
    const described = describeLeadHistory([retakeResult, retakeRegistration, firstResult, firstRegistration], {})
    expect(described.map((e) => e.summary)).toEqual([
      "recorded the interview result (S/N 31)",
      "registered the lead for a retaken interview (S/N 31)",
      "recorded the interview result (S/N 12)",
      "registered the lead for interview (S/N 12)",
    ])
  })

  it("reads as before for a lead with one interview", () => {
    const described = describeLeadHistory([firstResult, firstRegistration], {})
    expect(described.map((e) => e.summary)).toEqual(["recorded the interview result", "registered the lead for interview"])
  })
})
