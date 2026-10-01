import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import type { LeadHistoryEntry } from "@/lib/services/audit"

const LEAD = "11111111-1111-4111-8111-111111111111"
const CONTACT = "22222222-2222-4222-8222-222222222222"
const OTHER_CONTACT = "33333333-3333-4333-8333-333333333333"
const names: Record<string, string> = { [CONTACT]: "Amina Juma", [OTHER_CONTACT]: "Amina J. Copy" }

function entry(overrides: Partial<LeadHistoryEntry>): LeadHistoryEntry {
  return {
    id: 1,
    at: "2026-09-30T07:15:00Z",
    actor: "Test Admissions",
    record: "lead",
    recordId: LEAD,
    action: "update",
    changes: [],
    ...overrides,
  }
}

const change = (field: string, from: unknown, to: unknown) => ({ field, from, to })

// A history of one entry, described.
function describeLeadHistoryEntry(one: LeadHistoryEntry, contactNames: Record<string, string>) {
  return describeLeadHistory([one], contactNames)[0]
}

// A contact's creation, with an unconfirmed match to `match` if given.
function contactCreated(id: number, contactId: string, match: string | null = null) {
  return entry({
    id,
    record: "contact",
    recordId: contactId,
    action: "insert",
    changes: [change("full_name", null, names[contactId]), change("pending_family_match_id", null, match)],
  })
}

describe("describeLeadHistory", () => {
  it("describes a walk-in creation with plain labels in the lead screen's order, leaving out what was left empty", () => {
    const described = describeLeadHistoryEntry(
      entry({
        action: "insert",
        // In the order the database stores them, not the screen's.
        changes: [
          change("status", null, "Visited"),
          change("closure", null, null),
          change("class_name", null, "STD 2"),
          change("visit_date", null, "2026-09-29"),
          change("student_name", null, "Baraka Juma"),
          change("day_or_boarding", null, "Day"),
          change("enrollment_year", null, 2027),
          change("admission_number", null, "ADMSN-40719"),
          change("guardian_contact_id", null, CONTACT),
          change("returning_family_joined", null, false),
          change("returning_family_reapplied", null, false),
        ],
      }),
      names,
    )

    expect(described).toEqual({
      id: 1,
      at: "2026-09-30T07:15:00Z",
      actor: "Test Admissions",
      summary: "created the lead",
      changes: [
        { label: "Admission Number", from: null, to: "ADMSN-40719" },
        { label: "Student name", from: null, to: "Baraka Juma" },
        { label: "Class", from: null, to: "STD 2" },
        { label: "Enrollment year", from: null, to: "2027" },
        { label: "Day or boarding", from: null, to: "Day" },
        { label: "Status", from: null, to: "Visited" },
        { label: "Visit date", from: null, to: "29 Sept 2026" },
        { label: "Parent or guardian", from: null, to: "Amina Juma" },
      ],
    })
  })

  it("says when a new lead joined a Family at the front desk", () => {
    const [described] = describeLeadHistory(
      [
        entry({ id: 5, action: "insert", changes: [change("guardian_contact_id", null, CONTACT), change("returning_family_joined", null, true)] }),
        contactCreated(1, CONTACT),
      ],
      names,
    )
    expect(described.summary).toBe("created the lead and joined a Family")
    expect(described.changes).toContainEqual({ label: "Returning family: joined a Family", from: null, to: "Yes" })
  })

  it("says a lead from the Admission form was matched to a Family, not joined, while the match is unconfirmed", () => {
    const [described] = describeLeadHistory(
      [
        entry({ id: 6, action: "insert", changes: [change("guardian_contact_id", null, OTHER_CONTACT), change("returning_family_joined", null, true)] }),
        contactCreated(5, OTHER_CONTACT, CONTACT),
        contactCreated(1, CONTACT),
      ],
      names,
    )
    expect(described.summary).toBe("created the lead, matched to a known Family but not yet confirmed")
  })

  it("says a later child joined when the contact's match was confirmed before it was created", () => {
    const [described] = describeLeadHistory(
      [
        entry({ id: 8, action: "insert", changes: [change("guardian_contact_id", null, OTHER_CONTACT), change("returning_family_joined", null, true)] }),
        entry({ id: 7, record: "contact", recordId: OTHER_CONTACT, changes: [change("pending_family_match_id", CONTACT, null)] }),
        contactCreated(5, OTHER_CONTACT, CONTACT),
      ],
      names,
    )
    expect(described.summary).toBe("created the lead and joined a Family")
  })

  it("names a recorded visit", () => {
    const described = describeLeadHistoryEntry(
      entry({ changes: [change("status", "Applied", "Visited"), change("visit_date", null, "2026-09-30")] }),
      names,
    )
    expect(described.summary).toBe("recorded a visit")
    expect(described.changes).toEqual([
      { label: "Status", from: "Applied", to: "Visited" },
      { label: "Visit date", from: "None", to: "30 Sept 2026" },
    ])
  })

  it("names a confirmed Family match: the lead moved onto the contact its own was matched to", () => {
    // Confirming may clear the old contact's match before or after moving the
    // lead; either way the move reads as a confirmation.
    for (const clearedFirst of [true, false]) {
      const leadMove = clearedFirst ? 10 : 9
      const described = describeLeadHistory(
        [
          entry({ id: clearedFirst ? 9 : 10, record: "contact", recordId: OTHER_CONTACT, changes: [change("pending_family_match_id", CONTACT, null)] }),
          entry({ id: leadMove, changes: [change("guardian_contact_id", OTHER_CONTACT, CONTACT)] }),
          contactCreated(5, OTHER_CONTACT, CONTACT),
        ].sort((a, b) => b.id - a.id),
        names,
      )
      const moved = described.find((e) => e.id === leadMove)!
      expect(moved.summary).toBe("confirmed the Family match")
      expect(moved.changes).toEqual([{ label: "Parent or guardian", from: "Amina J. Copy", to: "Amina Juma" }])
    }
  })

  it("names a rejected Family match: the Family cause cleared, the contact kept", () => {
    const described = describeLeadHistoryEntry(entry({ changes: [change("returning_family_joined", true, false)] }), names)
    expect(described.summary).toBe("rejected the Family match")
    expect(described.changes).toEqual([{ label: "Returning family: joined a Family", from: "Yes", to: "No" }])
  })

  it("names a separation: a contact of its own and the Family cause cleared", () => {
    const described = describeLeadHistoryEntry(
      entry({ changes: [change("guardian_contact_id", CONTACT, OTHER_CONTACT), change("returning_family_joined", true, false)] }),
      names,
    )
    expect(described.summary).toBe("separated the lead from its Family")
  })

  it("names a separation of a lead that never joined: moved onto a copy, not onto a matched contact", () => {
    const [moved] = describeLeadHistory(
      [
        entry({ id: 9, at: "2026-09-30T09:00:01Z", changes: [change("guardian_contact_id", CONTACT, OTHER_CONTACT)] }),
        contactCreated(8, OTHER_CONTACT),
        contactCreated(1, CONTACT),
      ],
      names,
    )
    expect(moved.summary).toBe("separated the lead from its Family")
  })

  it("names any other change to the lead as a change", () => {
    const described = describeLeadHistoryEntry(entry({ changes: [change("class_name", "STD 2", "STD 3")] }), names)
    expect(described.summary).toBe("changed the lead")
    expect(described.changes).toEqual([{ label: "Class", from: "STD 2", to: "STD 3" }])
  })

  it("describes a contact by its current name, and its fields in plain words", () => {
    const created = describeLeadHistoryEntry(
      entry({
        record: "contact",
        recordId: CONTACT,
        action: "insert",
        changes: [
          change("full_name", null, "Amina Juma"),
          change("relationship", null, "Mother"),
          change("relationship_description", null, null),
          change("phone", null, "+255712345678"),
          change("whatsapp", null, null),
          change("origin", null, "front_desk"),
          change("pending_family_match_id", null, null),
        ],
      }),
      names,
    )
    expect(created.summary).toBe("added the parent or guardian Amina Juma")
    expect(created.changes).toEqual([
      { label: "Full name", from: null, to: "Amina Juma" },
      { label: "Relationship", from: null, to: "Mother" },
      { label: "Phone", from: null, to: "+255712345678" },
      { label: "Added from", from: null, to: "Front desk" },
    ])

    const changed = describeLeadHistoryEntry(
      entry({ record: "contact", recordId: CONTACT, changes: [change("whatsapp", null, "+255788000111")] }),
      names,
    )
    expect(changed.summary).toBe("changed the parent or guardian Amina Juma")
    expect(changed.changes).toEqual([{ label: "WhatsApp", from: "Same as phone", to: "+255788000111" }])
  })

  it("describes an unconfirmed Family match on a contact, and its clearing", () => {
    const matched = describeLeadHistoryEntry(
      entry({
        record: "contact",
        recordId: OTHER_CONTACT,
        action: "insert",
        changes: [change("full_name", null, "Amina J. Copy"), change("origin", null, "admission_form"), change("pending_family_match_id", null, CONTACT)],
      }),
      names,
    )
    expect(matched.summary).toBe("added the parent or guardian Amina J. Copy, matched to a known Family but not yet confirmed")
    expect(matched.changes).toContainEqual({ label: "Unconfirmed Family match", from: null, to: "Amina Juma" })
    expect(matched.changes).toContainEqual({ label: "Added from", from: null, to: "Admission form" })

    const cleared = describeLeadHistoryEntry(
      entry({ record: "contact", recordId: OTHER_CONTACT, changes: [change("pending_family_match_id", CONTACT, null)] }),
      names,
    )
    expect(cleared.summary).toBe("closed the unconfirmed Family match of Amina J. Copy")
    expect(cleared.changes).toEqual([{ label: "Unconfirmed Family match", from: "Amina Juma", to: "None" }])
  })

  it("shows a field it does not know under its raw name, with its raw value", () => {
    const described = describeLeadHistoryEntry(
      entry({ changes: [change("referral_code", "AGT-01", "AGT-02"), change("marks", null, { maths: 80 })] }),
      names,
    )
    expect(described.summary).toBe("changed the lead")
    expect(described.changes).toEqual([
      { label: "referral_code", from: "AGT-01", to: "AGT-02" },
      { label: "marks", from: "None", to: '{"maths":80}' },
    ])
  })

  it("shows an action kind it does not know under its raw name, with its details", () => {
    const described = describeLeadHistoryEntry(
      entry({ record: null, recordId: null, action: "interview_booked", changes: [change("slot", null, "morning")] }),
      names,
    )
    expect(described.summary).toBe("recorded interview_booked")
    expect(described.changes).toEqual([{ label: "slot", from: null, to: "morning" }])
  })

  it("shows a row from a table it does not know under the table's name", () => {
    const described = describeLeadHistoryEntry(
      entry({ record: "interviews", recordId: LEAD, action: "insert", changes: [change("score", null, 72)] }),
      names,
    )
    expect(described.summary).toBe("added an interviews record")
    expect(described.changes).toEqual([{ label: "score", from: null, to: "72" }])
  })

  it("shows a contact id it cannot name as the id", () => {
    const unknown = "44444444-4444-4444-8444-444444444444"
    const described = describeLeadHistoryEntry(entry({ changes: [change("guardian_contact_id", CONTACT, unknown)] }), names)
    expect(described.changes).toEqual([{ label: "Parent or guardian", from: "Amina Juma", to: unknown }])
  })
})
