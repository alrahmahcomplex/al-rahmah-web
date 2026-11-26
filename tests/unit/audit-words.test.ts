import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { EMPTY_AUDIT_LOOKUPS, describeAuditEntries, describeAuditEntry, type AuditLookups } from "@/app/staff/_audit-words"
import { SUPER_ADMIN_ROLE_ID } from "@/lib/services/staff-admin"
import type { AuditEntry } from "@/lib/services/system-audit"
import { getAuditLookups } from "@/lib/services/system-audit-lookups"

const LEAD_ID = "7c1e4b2a-93d0-4f1e-a8c5-2b6d1e0f9a41"
const CONTACT_ID = "d40a77c3-1b52-4e8a-9f60-55c2a1b3e7d0"
const OTHER_CONTACT_ID = "9b2f5a1c-4e6d-47a2-8c1e-3f0b9d4a6e21"
const AGENT_ID = "e5c3a1f7-9b2d-4e06-8a14-7f0b2d6c9e31"
const STAFF_ID = "8c4f2a6e-0b3d-4e19-95a7-1d6c3e0b8f22"
const ROLE_A = "b9e1c370-4a2f-4d8b-a6c5-2e0f7d1b3a94"
const ROLE_B = "06d3f8a2-7c1e-4b59-9e40-5a2c8d1f6b73"
const STREAM_A = "5d1f3b7a-9c2e-4e80-a6b4-1f0d8c3e7a25"
const STREAM_B = "a0e6c2d8-4b1f-4937-9e5a-7c3b1d0f8e62"
const BATCH_ID = "3a6c1e08-5d2b-4f97-a0e3-8b1c7d4f2e60"

const LOOKUPS: AuditLookups = {
  ...EMPTY_AUDIT_LOOKUPS,
  leads: {
    [LEAD_ID]: { name: "Amina Juma", admissionNumber: "ADMSN-40719" },
  },
  contacts: {
    [CONTACT_ID]: "Mariamu Juma",
  },
  contactLeads: {
    [CONTACT_ID]: { id: LEAD_ID, name: "Amina Juma", admissionNumber: "ADMSN-40719" },
  },
  streams: {
    [STREAM_A]: { name: "STD 1 A", year: 2027, openedAt: "2026-11-20T05:00:00Z" },
    [STREAM_B]: { name: "STD 1 B", year: 2027, openedAt: "2026-11-22T05:05:00Z" },
  },
  agents: {
    [AGENT_ID]: { name: "Halima Said", code: "HS-118", retired: false },
  },
  inviteBatches: {
    [BATCH_ID]: { startedAt: "2026-11-22T06:12:00Z" },
  },
  staff: {
    [STAFF_ID]: { name: "Neema Kisanga", roleId: ROLE_B },
  },
  roles: {
    [SUPER_ADMIN_ROLE_ID]: "Super Admin",
    [ROLE_A]: "Front desk",
    [ROLE_B]: "Accountant",
  },
  permissions: {
    "payments.record": "Record payments",
    "reports.view": "See reports",
  },
}

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    at: "2026-11-22T07:02:00Z",
    area: "lead",
    table: "leads",
    recordId: LEAD_ID,
    leadId: LEAD_ID,
    admissionNumber: "ADMSN-40719",
    action: "update",
    oldValues: null,
    newValues: null,
    actor: "Zawadi Mrema",
    ...overrides,
  }
}

describe("describeAuditEntry", () => {
  it("describes an application update with plain labels, values, link and raw details", () => {
    const described = describeAuditEntry(
      entry({
        oldValues: { class_name: "STD 3", day_or_boarding: "Day", father_full_name_source: "derived" },
        newValues: { class_name: "STD 4", day_or_boarding: "Boarding", father_full_name_source: "entered" },
      }),
      LOOKUPS,
    )

    expect(described.event).toBe("Changed the application")
    expect(described.when).toBe("22 Nov 2026, 10:02")
    expect(described.areaLabel).toBe("Applicants")
    expect(described.record).toEqual({ kind: "Applicant", title: "Amina Juma", subtitle: "ADMSN-40719" })
    expect(described.link).toEqual({ label: "Open the application", href: `/staff/applicants/${LEAD_ID}/history` })
    expect(described.changes).toEqual([
      { label: "Class", from: "STD 3", to: "STD 4" },
      { label: "Day or boarding", from: "Day", to: "Boarding" },
      { label: "Father’s name from", from: "From the student’s name", to: "Typed in by staff" },
    ])
    expect(described.unknownCount).toBe(0)
    expect(described.details.table).toBe("leads")
    expect(described.details.action).toBe("update")
    expect(described.details.fields).toContainEqual({ field: "class_name", from: "STD 3", to: "STD 4" })
  })

  it("describes a school-fee payment insert with formatted money and date, leaving out bookkeeping columns", () => {
    const described = describeAuditEntry(
      entry({
        area: "payment",
        table: "school_fee_payments",
        recordId: "51f9c0e2-6a3d-4b7f-8e21-0c94d6a2b183",
        action: "insert",
        newValues: {
          id: "51f9c0e2-6a3d-4b7f-8e21-0c94d6a2b183",
          lead_id: LEAD_ID,
          payment_type: "first_instalment",
          amount: 450000,
          paid_on: "2026-11-20",
          recorded_by: STAFF_ID,
          recorded_at: "2026-11-22T06:51:12Z",
          request_id: "f2c8a4e6-0d1b-4e3f-9a7c-5b6e2d1f0a98",
        },
      }),
      LOOKUPS,
    )

    expect(described.event).toBe("Recorded a school-fee payment")
    expect(described.changes).toEqual([
      { label: "Payment type", from: null, to: "First instalment" },
      { label: "Amount", from: null, to: "TZS 450,000" },
      { label: "Payment date", from: null, to: "20 Nov 2026" },
    ])
    expect(described.unknownCount).toBe(0)
  })

  it("counts columns that have no words yet without showing them in What changed, keeping them under Details", () => {
    const described = describeAuditEntry(
      entry({
        area: "payment",
        table: "seat_placements",
        action: "update",
        oldValues: { stream_id: STREAM_A, cause: "lead_created", future_col: "deposit" },
        newValues: { stream_id: STREAM_B, cause: "seat_freed", future_col: "full" },
      }),
      LOOKUPS,
    )

    expect(described.event).toBe("Moved the applicant from STD 1 A to STD 1 B")
    expect(described.changes).toEqual([{ label: "Because", from: null, to: "A seat came free" }])
    expect(described.unknownCount).toBe(1)
    expect(described.details.fields).toContainEqual({ field: "future_col", from: "deposit", to: "full" })
  })

  it("describes agent access, invite batches, and failed agent invite emails in plain words", () => {
    const accessOff = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "agent_access_settings",
        recordId: "1d8f0b3c-2e6a-47c9-9b05-a4e7c2d1f063",
        leadId: null,
        admissionNumber: null,
        action: "update",
        oldValues: { enabled: true },
        newValues: { enabled: false },
      }),
      LOOKUPS,
    )
    expect(accessOff.event).toBe("Turned agent access off")
    expect(accessOff.changes).toEqual([{ label: "Agent access", from: "On", to: "Off" }])
    expect(accessOff.link).toEqual({ label: "Open Agents", href: "/staff/agents" })

    const batch = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "agent_invite_batches",
        recordId: BATCH_ID,
        leadId: null,
        admissionNumber: null,
        action: "update",
        oldValues: { finished_at: null, stop_reason: null },
        newValues: { finished_at: "2026-11-22T06:14:03Z", stop_reason: "access_off" },
      }),
      LOOKUPS,
    )
    expect(batch.event).toBe("Finished an agent invite batch")
    expect(batch.changes).toEqual([{ label: "Why it stopped", from: "None", to: "Stopped because agent access was turned off" }])
    expect(batch.link).toEqual({ label: "Open the batch on Agents", href: `/staff/agents?status=all&batch=${BATCH_ID}` })

    const failed = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "agent_events",
        recordId: "6b0e4d92-3c1a-4f58-b7e2-0a9d5c3f1e84",
        leadId: null,
        admissionNumber: null,
        action: "insert",
        newValues: {
          agent_id: AGENT_ID,
          kind: "invite",
          result: "other_error",
          error_code: "unexpected_failure",
          email: "h.said@example.com",
        },
      }),
      LOOKUPS,
    )
    expect(failed.event).toBe("Sent an agent invite that failed")
    expect(failed.record).toEqual({ kind: "Agent", title: "Halima Said", subtitle: "HS-118" })
    expect(failed.changes).toEqual([
      { label: "Email", from: null, to: "Invite" },
      { label: "Result", from: null, to: "Not sent: the email service gave an error" },
      { label: "Email service’s error", from: null, to: "unexpected_failure" },
      { label: "Sent to", from: null, to: "h.said@example.com" },
    ])
    expect(failed.link).toEqual({ label: "Open the agent", href: "/staff/agents?status=all&q=HS-118" })
  })

  it("describes staff role changes, deactivations, invites, roles permissions, and streams_activated", () => {
    const roleChange = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "staff_members",
        recordId: STAFF_ID,
        leadId: null,
        admissionNumber: null,
        action: "update",
        oldValues: { role_id: ROLE_A },
        newValues: { role_id: ROLE_B },
      }),
      LOOKUPS,
    )
    expect(roleChange.event).toBe("Changed a staff member’s role")
    expect(roleChange.changes).toEqual([{ label: "Role", from: "Front desk", to: "Accountant" }])
    expect(roleChange.link).toEqual({ label: "Open Neema Kisanga", href: `/staff/roles?role=${ROLE_B}` })

    const deactivated = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "staff_members",
        recordId: STAFF_ID,
        leadId: null,
        admissionNumber: null,
        action: "update",
        oldValues: { active: true },
        newValues: { active: false },
      }),
      LOOKUPS,
    )
    expect(deactivated.event).toBe("Deactivated a staff member")
    expect(deactivated.changes).toEqual([{ label: "Status", from: "Active", to: "Deactivated" }])

    const invite = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: null,
        recordId: null,
        leadId: null,
        admissionNumber: null,
        action: "invite_sent",
        newValues: { staff_member_id: STAFF_ID, email: "n.kisanga@example.com" },
      }),
      LOOKUPS,
    )
    expect(invite.event).toBe("Sent a staff invite")
    expect(invite.changes).toEqual([{ label: "Sent to", from: null, to: "n.kisanga@example.com" }])

    const roleUpdate = describeAuditEntry(
      entry({
        area: "staff_admin",
        table: "roles",
        recordId: ROLE_B,
        leadId: null,
        admissionNumber: null,
        action: "update",
        oldValues: { permissions: ["payments.record"] },
        newValues: { permissions: ["payments.record", "reports.view"] },
      }),
      LOOKUPS,
    )
    expect(roleUpdate.event).toBe("Changed the role Accountant")
    expect(roleUpdate.changes).toEqual([{ label: "Permissions", from: null, to: "Added: See reports" }])
    expect(roleUpdate.link).toEqual({ label: "Open Roles", href: `/staff/roles?role=${ROLE_B}` })

    const activated = describeAuditEntry(
      entry({
        area: "payment",
        table: null,
        recordId: null,
        leadId: null,
        admissionNumber: null,
        action: "streams_activated",
        newValues: { ticket: "#449", streams_created: 12, children_placed: 40, children_waiting: 2, classes: [] },
      }),
      LOOKUPS,
    )
    expect(activated.event).toBe("Switched seats to named streams")
    expect(activated.changes).toEqual([
      { label: "Streams created", from: null, to: "12" },
      { label: "Children placed", from: null, to: "40" },
      { label: "Children waiting", from: null, to: "2" },
    ])
    expect(activated.unknownCount).toBe(0)
  })

  it("reads confirmed Family matches and unconfirmed Family joins the same way Application history does", () => {
    const contacts = { [CONTACT_ID]: "Mariamu Juma", [OTHER_CONTACT_ID]: "Mariamu J. Copy" }

    // Confirmed Family match via server-loaded familyMatchTimeline (whether the
    // contact's pending match was cleared before or after moving the lead).
    for (const clearedFirst of [true, false]) {
      const leadMove = clearedFirst ? 10 : 9
      const confirmed = describeAuditEntry(
        entry({
          id: leadMove,
          oldValues: { guardian_contact_id: OTHER_CONTACT_ID },
          newValues: { guardian_contact_id: CONTACT_ID },
        }),
        {
          ...LOOKUPS,
          contacts,
          familyMatchTimeline: {
            [OTHER_CONTACT_ID]: [
              { id: 5, match: CONTACT_ID },
              { id: clearedFirst ? 9 : 10, match: null },
            ],
          },
        },
      )
      expect(confirmed.event).toBe("Confirmed the Family match")
      expect(confirmed.changes).toEqual([{ label: "Parent or guardian", from: "Mariamu J. Copy", to: "Mariamu Juma" }])
    }

    // Moving onto a contact the old contact was never matched to is still a separation.
    const separated = describeAuditEntry(
      entry({
        id: 12,
        oldValues: { guardian_contact_id: CONTACT_ID },
        newValues: { guardian_contact_id: OTHER_CONTACT_ID },
      }),
      { ...LOOKUPS, contacts },
    )
    expect(separated.event).toBe("Separated the applicant from their Family")

    // Lead created with returning_family_joined reads unconfirmed when the
    // contact had a pending match before the insert, and joined once cleared.
    const unconfirmedJoin = describeAuditEntry(
      entry({
        id: 6,
        action: "insert",
        newValues: { guardian_contact_id: OTHER_CONTACT_ID, returning_family_joined: true },
      }),
      {
        ...LOOKUPS,
        contacts,
        familyMatchTimeline: { [OTHER_CONTACT_ID]: [{ id: 5, match: CONTACT_ID }] },
      },
    )
    expect(unconfirmedJoin.event).toBe("Created the application, matched to a known Family but not yet confirmed")

    const confirmedJoin = describeAuditEntry(
      entry({
        id: 8,
        action: "insert",
        newValues: { guardian_contact_id: OTHER_CONTACT_ID, returning_family_joined: true },
      }),
      {
        ...LOOKUPS,
        contacts,
        familyMatchTimeline: {
          [OTHER_CONTACT_ID]: [
            { id: 5, match: CONTACT_ID },
            { id: 7, match: null },
          ],
        },
      },
    )
    expect(confirmedJoin.event).toBe("Created the application and joined a Family")

    // On-page guardian_contacts match entries are merged automatically too.
    const [moveRow] = describeAuditEntries(
      [
        entry({ id: 10, oldValues: { guardian_contact_id: OTHER_CONTACT_ID }, newValues: { guardian_contact_id: CONTACT_ID } }),
        entry({
          id: 5,
          table: "guardian_contacts",
          recordId: OTHER_CONTACT_ID,
          leadId: null,
          admissionNumber: null,
          action: "insert",
          newValues: { full_name: "Mariamu J. Copy", pending_family_match_id: CONTACT_ID },
        }),
      ],
      { ...LOOKUPS, contacts },
    )
    expect(moveRow.event).toBe("Confirmed the Family match")
  })
})

describe("getAuditLookups", () => {
  it("loads guardian_contacts pending_family_match_id history from audit_log for lead guardian moves", async () => {
    const queries: { table: string; eq?: [string, unknown]; in?: [string, unknown[]] }[] = []
    const supabase = {
      from(table: string) {
        const rec: { table: string; eq?: [string, unknown]; in?: [string, unknown[]] } = { table }
        queries.push(rec)
        const response =
          table === "audit_log"
            ? {
                data: [
                  { id: 5, row_id: OTHER_CONTACT_ID, new_values: { full_name: "Mariamu J. Copy", pending_family_match_id: CONTACT_ID } },
                  { id: 6, row_id: OTHER_CONTACT_ID, new_values: { phone: "+255712345678" } },
                  { id: 9, row_id: OTHER_CONTACT_ID, new_values: { pending_family_match_id: null } },
                ],
                error: null,
              }
            : { data: [], error: null }
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            rec.eq = [col, val]
            return builder
          },
          in: (col: string, vals: unknown[]) => {
            rec.in = [col, vals]
            return builder
          },
          order: () => Promise.resolve(response),
          then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
        }
        return builder
      },
    } as unknown as SupabaseClient

    const lookups = await getAuditLookups(
      supabase,
      [
        entry({
          id: 10,
          oldValues: { guardian_contact_id: OTHER_CONTACT_ID },
          newValues: { guardian_contact_id: CONTACT_ID },
        }),
      ],
      [],
    )

    expect(queries).toContainEqual({
      table: "audit_log",
      eq: ["table_name", "guardian_contacts"],
      in: ["row_id", [OTHER_CONTACT_ID]],
    })
    expect(lookups.familyMatchTimeline).toEqual({
      [OTHER_CONTACT_ID]: [
        { id: 5, match: CONTACT_ID },
        { id: 9, match: null },
      ],
    })
  })
})
