import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { recordAction } from "@/lib/services/audit"

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
