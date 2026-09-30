import { describe, expect, it } from "vitest"

import { correctionOutcome } from "@/app/staff/leads/[id]/correction-outcome"

describe("correctionOutcome", () => {
  it("names the refused field with a message staff can act on", () => {
    const outcome = correctionOutcome({ kind: "invalid", field: "phone" })
    expect(outcome).toMatchObject({ status: "refused", field: "phone" })
    expect(outcome.status === "refused" && outcome.message).toMatch(/phone number can't be read/)
    expect(correctionOutcome({ kind: "invalid", field: null })).toMatchObject({ status: "refused", field: null })
  })

  it("links an open duplicate to the lead, and a closed one to the Reopening request", () => {
    const open = { id: "abc", admissionNumber: "ADMSN-12345", status: "Visited", closure: null } as const
    expect(correctionOutcome({ kind: "duplicate", lead: open })).toEqual({
      status: "duplicate",
      admissionNumber: "ADMSN-12345",
      href: "/staff/leads/abc",
    })
    const archived = { ...open, closure: "Archived" } as const
    expect(correctionOutcome({ kind: "duplicate", lead: archived })).toMatchObject({
      href: "/staff/leads/abc/reopen?source=duplicate_match",
    })
  })

  it("explains every other refusal without naming a field", () => {
    for (const kind of ["forbidden", "not-found", "closed", "not-visited", "unavailable"] as const) {
      const outcome = correctionOutcome({ kind })
      expect(outcome).toMatchObject({ status: "refused", field: null })
      expect(outcome.status === "refused" && outcome.message.length).toBeGreaterThan(0)
    }
  })
})
