import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { getLeadHistory, recordAction } from "@/lib/services/audit"

function fakeSupabase(error: { message: string } | null) {
  const rpc = vi.fn().mockResolvedValue({ data: error ? null : 1, error })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe("recordAction", () => {
  it("records the action through the database", async () => {
    const { client, rpc } = fakeSupabase(null)

    const result = await recordAction(client, "invite_sent", null, { staff_member_id: "s1" })

    expect(result).toEqual({ ok: true, data: null })
    expect(rpc).toHaveBeenCalledWith("record_action", {
      kind: "invite_sent",
      lead_id: null,
      details: { staff_member_id: "s1" },
    })
  })

  it("reports a caller whose role lacks the kind's permission", async () => {
    const { client } = fakeSupabase({ message: "not_permitted" })

    expect(await recordAction(client, "invite_sent", null, {})).toEqual({ ok: false, error: "not-permitted" })
  })

  it("reports a lead-scoped action sent without a lead", async () => {
    const { client } = fakeSupabase({ message: "lead_required" })

    expect(await recordAction(client, "invite_sent", null, {})).toEqual({ ok: false, error: "lead-required" })
  })

  it("reports anything else as unavailable", async () => {
    const { client } = fakeSupabase({ message: "connection refused" })

    expect(await recordAction(client, "invite_sent", null, {})).toEqual({ ok: false, error: "unavailable" })
  })
})

describe("getLeadHistory", () => {
  const contactId = "22222222-2222-4222-8222-222222222222"
  const row = {
    id: 7,
    created_at: "2026-09-30T07:15:00Z",
    table_name: "leads",
    row_id: "11111111-1111-4111-8111-111111111111",
    action: "insert",
    old_values: null,
    new_values: { id: "11111111-1111-4111-8111-111111111111", student_name: "Baraka Juma", guardian_contact_id: contactId },
    actor_kind: "staff",
    actor_name: "Test Admissions",
  }

  function fakeHistory(names: { data: unknown; error: { message: string } | null }) {
    const inIds = vi.fn().mockResolvedValue(names)
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: [row], error: null }),
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ in: inIds }) }),
    } as unknown as SupabaseClient
    return { client, inIds }
  }

  it("returns the entries with the names of the contacts they mention", async () => {
    const { client, inIds } = fakeHistory({ data: [{ id: contactId, full_name: "Amina Juma" }], error: null })

    const result = await getLeadHistory(client, row.row_id)

    expect(inIds).toHaveBeenCalledWith("id", [contactId])
    expect(result).toEqual({
      ok: true,
      data: {
        entries: [
          {
            id: 7,
            at: row.created_at,
            actor: "Test Admissions",
            record: "lead",
            recordId: row.row_id,
            action: "insert",
            changes: [
              { field: "student_name", from: null, to: "Baraka Juma" },
              { field: "guardian_contact_id", from: null, to: contactId },
            ],
          },
        ],
        contactNames: { [contactId]: "Amina Juma" },
      },
    })
  })

  it("still returns the history when the contact names can't be read", async () => {
    const { client } = fakeHistory({ data: null, error: { message: "URI too long" } })

    const result = await getLeadHistory(client, row.row_id)

    expect(result.ok && result.data.entries).toHaveLength(1)
    expect(result.ok && result.data.contactNames).toEqual({})
  })
})
