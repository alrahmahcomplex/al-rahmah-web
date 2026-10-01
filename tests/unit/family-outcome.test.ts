import { describe, expect, it } from "vitest"

import { familyOutcome } from "@/app/staff/leads/[id]/family-outcome"

describe("familyOutcome", () => {
  it("says a match someone else already settled needs a reload", () => {
    expect(familyOutcome({ kind: "no-pending-match" })).toEqual({
      status: "refused",
      field: null,
      message: "This match has already been confirmed or rejected. Reload the page to see the Family as it is now.",
    })
  })

  it("says a lead left alone on its contact has no Family to leave", () => {
    expect(familyOutcome({ kind: "not-shared" })).toEqual({
      status: "refused",
      field: null,
      message: "This child no longer shares a parent or guardian with anyone. Reload the page to see the Family as it is now.",
    })
  })

  it("links a confirmation that would duplicate a lead to that lead", () => {
    expect(
      familyOutcome({
        kind: "duplicate",
        lead: { id: "lead-1", admissionNumber: "ADMSN-12345", status: "Visited", closure: null },
      }),
    ).toEqual({ status: "duplicate", admissionNumber: "ADMSN-12345", href: "/staff/leads/lead-1" })
  })

  it("explains every other refusal without naming a field", () => {
    for (const kind of ["forbidden", "not-found", "closed", "children-changed", "unavailable"] as const) {
      const outcome = familyOutcome({ kind })
      expect(outcome).toMatchObject({ status: "refused", field: null })
      expect(outcome.status === "refused" && outcome.message.length).toBeGreaterThan(0)
    }
  })
})
