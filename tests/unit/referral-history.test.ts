import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

// The lead history's words for a Referral code change (#80).

const LEAD = "11111111-1111-4111-8111-111111111111"

function update(from: unknown, to: unknown): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-10-03T07:15:00Z",
    actor: "Test Admissions",
    record: "lead",
    recordId: LEAD,
    action: "update",
    changes: [{ field: "referral_code", from, to }],
  }
}

const described = (entry: LeadHistoryEntry) => describeLeadHistory([entry], {})[0]

describe("a Referral code change in the lead's history", () => {
  it("labels the field and says whether the code was added, changed or cleared", () => {
    expect(described(update(null, "ZNM-401"))).toMatchObject({
      summary: "added a Referral code",
      changes: [{ label: "Referral code", from: "None", to: "ZNM-401" }],
    })
    expect(described(update("ZNM-401", "BJN-402"))).toMatchObject({
      summary: "changed the Referral code",
      changes: [{ label: "Referral code", from: "ZNM-401", to: "BJN-402" }],
    })
    expect(described(update("BJN-402", null))).toMatchObject({
      summary: "cleared the Referral code",
      changes: [{ label: "Referral code", from: "BJN-402", to: "None" }],
    })
  })

  it("shows the code on a lead's creation, as the Admission form stores it", () => {
    const created = described({ ...update(null, "XYZ-999"), action: "insert" })
    expect(created.summary).toBe("created the lead")
    expect(created.changes).toEqual([{ label: "Referral code", from: null, to: "XYZ-999" }])
  })

  it("labels a Marketing Agent's fields", () => {
    const agent = describeLeadHistory(
      [
        {
          ...update(null, null),
          record: "marketing_agents",
          changes: [
            { field: "code", from: null, to: "BJN-402" },
            { field: "status", from: "Pending", to: "Approved" },
            { field: "approved_at", from: null, to: "2026-10-03T07:15:00Z" },
            { field: "approved_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000001" },
            { field: "registered_at", from: null, to: "2026-10-01T07:15:00Z" },
          ],
        },
      ],
      {},
    )[0]
    expect(agent.changes.map((c) => c.label)).toEqual(["Status", "Referral code", "Registered", "Approved at", "Approved by"])
  })
})
