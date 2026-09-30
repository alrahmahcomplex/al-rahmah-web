import { describe, expect, it } from "vitest"

import { recordVisitOutcome } from "@/app/staff/leads/[id]/record-visit-outcome"

describe("recordVisitOutcome", () => {
  it("points a future date at the Visit date field", () => {
    expect(recordVisitOutcome({ kind: "invalid", field: "visit_date" })).toEqual({
      status: "refused",
      field: "visit_date",
      message: "Choose today or an earlier date for the visit.",
    })
  })

  it("says a lead past Applied already has its visit recorded", () => {
    expect(recordVisitOutcome({ kind: "not-applied" })).toEqual({
      status: "refused",
      field: null,
      message: "This lead is no longer Applied, so its visit is already recorded. Reload the page to see it.",
    })
  })

  it("explains every other refusal without naming a field", () => {
    for (const kind of ["forbidden", "not-found", "closed", "unavailable"] as const) {
      const outcome = recordVisitOutcome({ kind })
      expect(outcome).toMatchObject({ status: "refused", field: null })
      expect(outcome.status === "refused" && outcome.message.length).toBeGreaterThan(0)
    }
  })
})
