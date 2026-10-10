import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { priorSiblingOutcome } from "@/app/staff/leads/[id]/prior-sibling-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { FEE_DISCOUNT_NAMES } from "@/lib/services/discounts"
import type { SetPriorSiblingError } from "@/lib/services/sibling-discount"

// The Sibling discount's words (#113): the fee panel's name for it, the
// prior-sibling tick's refusals, and its entries in the lead history.

const LEAD = "11111111-1111-4111-8111-111111111111"
const PROFILE = "22222222-2222-4222-8222-222222222222"

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })

function profileEntry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-10-10T07:15:00Z",
    actor: "Test Admissions",
    record: "lead_fee_profiles",
    recordId: PROFILE,
    action: "update",
    changes: [],
    ...overrides,
  }
}

describe("the Sibling discount on the School fee", () => {
  it("is named beside the requested discounts", () => {
    expect(FEE_DISCOUNT_NAMES.sibling).toBe("Sibling")
    expect(FEE_DISCOUNT_NAMES.staff_child).toBe("Staff child")
    expect(FEE_DISCOUNT_NAMES.qualified_orphan).toBe("Qualified orphan")
  })
})

describe("the prior-sibling tick's refusals", () => {
  it("has words for every refusal, pointing at the field when one is wrong", () => {
    const errors: SetPriorSiblingError[] = ["forbidden", "not-found", "lead-closed", "invalid-name", "invalid-class", "unavailable"]
    for (const error of errors) {
      const outcome = priorSiblingOutcome(error)
      expect(outcome.status, error).toBe("refused")
      expect(outcome.status === "refused" && outcome.message.length, error).toBeGreaterThan(0)
    }
    expect(priorSiblingOutcome("invalid-name")).toMatchObject({ field: "name" })
    expect(priorSiblingOutcome("invalid-class")).toMatchObject({ field: "class" })
    expect(priorSiblingOutcome("forbidden")).toMatchObject({ field: null })
  })
})

describe("the prior-sibling tick in the lead history", () => {
  it("says staff ticked it, with the sibling's name and class", () => {
    const [described] = describeLeadHistory(
      [
        profileEntry({
          action: "insert",
          changes: [
            change("lead_id", null, LEAD),
            change("pre_form_one", null, false),
            change("prior_sibling", null, true),
            change("prior_sibling_name", null, "Amina Older"),
            change("prior_sibling_class", null, "STD 6"),
            change("sibling_kept", null, false),
          ],
        }),
      ],
      {},
    )
    expect(described).toMatchObject({
      summary: "ticked Has a sibling already at Al-Rahmah",
      changes: [
        { label: "Has a sibling already at Al-Rahmah", from: null, to: "Yes" },
        { label: "Sibling's name", from: null, to: "Amina Older" },
        { label: "Sibling's class", from: null, to: "STD 6" },
      ],
    })
  })

  it("says staff cleared it or changed the sibling", () => {
    const [cleared, changed] = describeLeadHistory(
      [
        profileEntry({
          id: 3,
          changes: [
            change("prior_sibling", true, false),
            change("prior_sibling_name", "Amina", null),
            change("prior_sibling_class", "STD 6", null),
          ],
        }),
        profileEntry({ id: 2, changes: [change("prior_sibling_class", "STD 5", "STD 6")] }),
      ],
      {},
    )
    expect(cleared.summary).toBe("cleared Has a sibling already at Al-Rahmah")
    expect(cleared.changes[0]).toEqual({ label: "Has a sibling already at Al-Rahmah", from: "Yes", to: "No" })
    expect(changed).toMatchObject({
      summary: "changed the sibling already at Al-Rahmah",
      changes: [{ label: "Sibling's class", from: "STD 5", to: "STD 6" }],
    })
  })

  it("says a sibling's enrolment enrolled the lead, which keeps the discount", () => {
    const at = "2026-10-10T09:00:00Z"
    const [status, profile] = describeLeadHistory(
      [
        {
          id: 11,
          at: at.replace("Z", ".004Z"),
          actor: "Test Accountant",
          record: "lead",
          recordId: LEAD,
          action: "update",
          changes: [change("status", "Interviewed", "Enrolled")],
        },
        profileEntry({
          id: 10,
          at,
          actor: "Test Accountant",
          changes: [
            change("status_before_enrolled", null, "Interviewed"),
            change("enrolled_trigger", null, "payment"),
            change("enrolled_on", null, "2026-10-10"),
            change("recompute_cause", null, "sibling"),
            change("sibling_kept", false, true),
          ],
        }),
      ],
      {},
    )
    expect(status.summary).toBe("enrolled the lead, because the lead's Sibling discount changed")
    expect(profile.summary).toBe("recorded what enrolled the lead")
    expect(profile.changes).toContainEqual({ label: "Keeps the Sibling discount", from: "No", to: "Yes" })
    expect(profile.changes).toContainEqual({ label: "Because", from: "None", to: "The lead's Sibling discount changed" })
  })
})
