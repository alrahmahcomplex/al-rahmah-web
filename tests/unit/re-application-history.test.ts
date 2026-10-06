import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

const LEAD = "11111111-1111-4111-8111-111111111111"
const RE_APPLICATION = "44444444-4444-4444-8444-444444444444"

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })

function entry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-10-03T07:15:00Z",
    actor: "Admission form",
    record: "lead",
    recordId: LEAD,
    action: "update",
    changes: [],
    ...overrides,
  }
}

describe("a re-application in the lead's history", () => {
  it("reads as a recorded re-application, with what was sent and what differs", () => {
    const [described] = describeLeadHistory(
      [
        entry({
          record: "re_applications",
          recordId: RE_APPLICATION,
          action: "insert",
          changes: [
            change("lead_id", null, LEAD),
            change("submission_key", null, "55555555-5555-4555-8555-555555555555"),
            change("received_at", null, "2026-10-03T07:15:00Z"),
            change("contact_name", null, "Saida Marudio"),
            change("relationship", null, "Mother"),
            change("phone_as_sent", null, "0700 000 301"),
            change("phone", null, "+255700000301"),
            change("whatsapp", null, "+255700000311"),
            change("student_name", null, "Zuberi Marudio"),
            change("class_name", null, "STD 4"),
            change("differing_fields", null, ["class_name", "whatsapp"]),
            change("reviewed_at", null, null),
          ],
        }),
      ],
      {},
    )

    expect(described.actor).toBe("Admission form")
    expect(described.summary).toBe("recorded a re-application")
    expect(described.changes).toEqual([
      { label: "Student name", from: null, to: "Zuberi Marudio" },
      { label: "Class", from: null, to: "STD 4" },
      { label: "Parent or guardian name", from: null, to: "Saida Marudio" },
      { label: "Relationship", from: null, to: "Mother" },
      { label: "Phone", from: null, to: "+255700000301" },
      { label: "WhatsApp", from: null, to: "+255700000311" },
      { label: "Differs from the lead", from: null, to: "Class, WhatsApp" },
    ])
  })

  it("says Nothing when the re-application matched the lead exactly", () => {
    const [described] = describeLeadHistory(
      [entry({ record: "re_applications", recordId: RE_APPLICATION, action: "insert", changes: [change("differing_fields", null, [])] })],
      {},
    )
    expect(described.changes).toEqual([{ label: "Differs from the lead", from: null, to: "Nothing" }])
  })

  it("reads a review as the staff member marking it reviewed, with no raw ids or times", () => {
    const [described] = describeLeadHistory(
      [
        entry({
          actor: "Test Admissions",
          record: "re_applications",
          recordId: RE_APPLICATION,
          action: "update",
          changes: [
            change("reviewed_at", null, "2026-10-04T09:30:00Z"),
            change("reviewed_by", null, "a1a1a1a1-0000-4000-8000-000000000003"),
          ],
        }),
      ],
      {},
    )
    expect(described.actor).toBe("Test Admissions")
    expect(described.summary).toBe("marked the re-application reviewed")
    expect(described.changes).toEqual([])
  })

  it("reads the lead's new re-applied cause as a Returning family flag", () => {
    const [described] = describeLeadHistory([entry({ changes: [change("returning_family_reapplied", false, true)] })], {})
    expect(described.summary).toBe("flagged the lead Returning family: re-applied")
    expect(described.changes).toEqual([{ label: "Returning family: re-applied", from: "No", to: "Yes" }])
  })
})
