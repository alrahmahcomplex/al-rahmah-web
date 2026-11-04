import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

// The lead history's words for a group invitation (#186).

function sent(channel: string): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-11-03T07:15:00Z",
    actor: "Test Admissions",
    record: "whatsapp_group_invitations",
    recordId: "22222222-2222-4222-8222-222222222222",
    action: "insert",
    changes: [
      { field: "lead_id", from: null, to: "11111111-1111-4111-8111-111111111111" },
      { field: "enrollment_year", from: null, to: 2027 },
      { field: "url", from: null, to: "https://chat.whatsapp.com/Hk3QmZ8rT2pL9wXc4VbN7a" },
      { field: "template_version", from: null, to: "group_invitation_v2" },
      { field: "channel", from: null, to: channel },
      { field: "sibling_lead_ids", from: null, to: ["33333333-3333-4333-8333-333333333333"] },
      { field: "sent_by", from: null, to: "a1a1a1a1-0000-4000-8000-000000000003" },
      { field: "sent_at", from: null, to: "2026-11-03T07:15:00Z" },
    ],
  }
}

const described = (entry: LeadHistoryEntry) => describeLeadHistory([entry], {})[0]

describe("a group invitation in the lead's history", () => {
  it("says it was sent, with the year, link, message and channel, and no ids", () => {
    expect(described(sent("whatsapp"))).toEqual(
      expect.objectContaining({
        summary: "sent the WhatsApp group invitation",
        changes: [
          { label: "Enrollment year", from: null, to: "2027" },
          { label: "Group link", from: null, to: "https://chat.whatsapp.com/Hk3QmZ8rT2pL9wXc4VbN7a" },
          { label: "Message", from: null, to: "Group invitation (version 2)" },
          { label: "Sent by", from: null, to: "WhatsApp, to the parent's WhatsApp number" },
        ],
      }),
    )
  })

  it("says a copy was copied, not sent", () => {
    expect(described(sent("copy"))).toMatchObject({ summary: "copied the WhatsApp group invitation" })
    expect(described(sent("copy")).changes.find((change) => change.label === "Sent by")?.to).toBe("Copied for staff to send")
  })
})
