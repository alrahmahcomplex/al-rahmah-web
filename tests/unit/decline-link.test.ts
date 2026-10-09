import { describe, expect, it } from "vitest"

import { DECLINE_PARAM, declineHref, linkedDeclineReason } from "@/app/staff/leads/decline-link"
import { DECLINED_REASONS, declinedReasonsFor } from "@/lib/services/lead-closure"

// The link from Seats into a lead's Decline with a reason chosen (#115).

describe("the decline link", () => {
  it("opens the lead with the reason in the query", () => {
    const href = declineHref("1ead0000-0000-4000-8000-000000000901", "No seat available")
    expect(href).toBe("/staff/leads/1ead0000-0000-4000-8000-000000000901?decline=No+seat+available")
    expect(new URL(href, "http://localhost").searchParams.get(DECLINE_PARAM)).toBe("No seat available")
  })

  it("chooses the linked reason only when the staff member may pick it", () => {
    expect(linkedDeclineReason("No seat available", DECLINED_REASONS)).toBe("No seat available")
    // Without academic_years.manage, No seat available isn't on the list.
    expect(linkedDeclineReason("No seat available", declinedReasonsFor(["leads.decline"]))).toBeNull()
    expect(linkedDeclineReason("Fees or cost", declinedReasonsFor(["leads.decline"]))).toBe("Fees or cost")
  })

  it("ignores a missing or unknown reason", () => {
    expect(linkedDeclineReason(null, DECLINED_REASONS)).toBeNull()
    expect(linkedDeclineReason("", DECLINED_REASONS)).toBeNull()
    expect(linkedDeclineReason("no seat available", DECLINED_REASONS)).toBeNull()
  })
})
