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
        leadNames: {},
        streamNames: {},
      },
    })
  })

  // A client whose history holds the given rows, answering each table's name
  // lookup from `tables`, or with an error for a table set to null.
  function fakeLookups(rows: unknown[], tables: Record<string, Record<string, unknown>[] | null>) {
    const lookups: { table: string; columns: string; ids: string[] }[] = []
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: rows, error: null }),
      from: (table: string) => ({
        select: (columns: string) => ({
          in: async (_column: string, ids: string[]) => {
            lookups.push({ table, columns, ids })
            const known = tables[table]
            if (!known) return { data: null, error: { message: "unavailable" } }
            return { data: known.filter((r) => ids.includes(r.id as string)), error: null }
          },
        }),
      }),
    } as unknown as SupabaseClient
    return { client, lookups }
  }

  const sibling = "33333333-3333-4333-8333-333333333333"
  const placed = "44444444-4444-4444-8444-444444444444"
  const opened = "55555555-5555-4555-8555-555555555555"
  const historyRow = (id: number, table: string, values: Record<string, unknown>, old: Record<string, unknown> | null = null) => ({
    ...row,
    id,
    table_name: table,
    row_id: randomId(id),
    action: old ? "update" : "insert",
    old_values: old,
    new_values: values,
  })
  const randomId = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`

  it("names the siblings and streams the entries point at, from the tables they belong to", async () => {
    const { client, lookups } = fakeLookups(
      [
        historyRow(1, "sibling_group_members", { sibling_of_lead_id: sibling, group_id: randomId(90) }),
        historyRow(2, "discount_requests", { sibling_of_lead_id: sibling, kind: "sibling" }),
        historyRow(3, "seat_placements", { stream_id: placed }, { stream_id: opened }),
        historyRow(4, "stream_requests", { resolved_by_stream_id: opened }),
        // Another table's column of the same name points at nothing to name.
        historyRow(5, "leads", { stream_id: randomId(91), sibling_of_lead_id: randomId(92) }),
      ],
      {
        guardian_contacts: [],
        leads: [{ id: sibling, student_name: "Asha Kibwana", admission_number: "ADMSN-90080" }],
        streams: [
          { id: placed, class_name: "KG 2", label: "A", takes: "Girls" },
          { id: opened, class_name: "STD 6", label: "A", takes: "Mixed" },
        ],
      },
    )

    const result = await getLeadHistory(client, row.row_id)

    expect(result.ok && result.data.leadNames).toEqual({ [sibling]: "Asha Kibwana · ADMSN-90080" })
    expect(result.ok && result.data.streamNames).toEqual({ [placed]: "KG 2 A (Girls)", [opened]: "STD 6 A" })
    // Each id is read once, from its own table only.
    expect(lookups.filter((l) => l.table === "leads").flatMap((l) => l.ids)).toEqual([sibling])
    expect(lookups.filter((l) => l.table === "streams").flatMap((l) => l.ids).sort()).toEqual([placed, opened].sort())
  })

  it("reads a long history's siblings in batches of at most 100, and reads nothing when there are none", async () => {
    const ids = Array.from({ length: 150 }, (_, n) => randomId(1000 + n))
    const { client, lookups } = fakeLookups(
      ids.map((id, n) => historyRow(n + 1, "sibling_group_members", { sibling_of_lead_id: id })),
      { guardian_contacts: [], leads: [], streams: [] },
    )

    await getLeadHistory(client, row.row_id)

    const batches = lookups.filter((l) => l.table === "leads").map((l) => l.ids.length)
    expect(batches).toEqual([100, 50])
    expect(lookups.filter((l) => l.table === "streams" || l.table === "guardian_contacts")).toEqual([])
  })

  it("still returns the history, unnamed, when the siblings or streams can't be read", async () => {
    const { client } = fakeLookups(
      [historyRow(1, "sibling_group_members", { sibling_of_lead_id: sibling }), historyRow(2, "seat_placements", { stream_id: placed })],
      { guardian_contacts: [], leads: null, streams: null },
    )
    vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await getLeadHistory(client, row.row_id)

    expect(result.ok && result.data.entries).toHaveLength(2)
    expect(result.ok && [result.data.leadNames, result.data.streamNames]).toEqual([{}, {}])
  })

  it("still returns the history when the contact names can't be read", async () => {
    const { client } = fakeHistory({ data: null, error: { message: "URI too long" } })

    const result = await getLeadHistory(client, row.row_id)

    expect(result.ok && result.data.entries).toHaveLength(1)
    expect(result.ok && result.data.contactNames).toEqual({})
  })
})
