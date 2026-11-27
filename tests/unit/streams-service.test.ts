import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { changeStream, deleteStream, openStream, streamName } from "@/lib/services/streams"

// The streams service (#449; who a stream takes, 2026-11-26): a refusal below
// the children placed carries the database's count, which may be higher than
// the screen showed, and says whether it is about the stream being raised; a
// label refusal says whether it is about the new stream's label.

function client(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }))
  return { supabase: { rpc } as unknown as SupabaseClient, rpc }
}

const change = { streamId: "s1", label: "B", seats: 12, takes: "Boys" as const }

describe("changeStream", () => {
  test("a below_placed refusal returns the database's count and which stream it is about", async () => {
    const own = client({ error: { message: "below_placed", code: "P0001", details: '{"placed": 13}' } })
    expect(await changeStream(own.supabase, change)).toEqual({ ok: false, error: "below_placed", placed: 13, raised: false })
    const raised = client({ error: { message: "below_placed", code: "P0001", details: '{"placed": 4, "stream": "raise"}' } })
    expect(await changeStream(raised.supabase, change)).toEqual({ ok: false, error: "below_placed", placed: 4, raised: true })
  })

  test("a below_placed refusal without a readable count returns null", async () => {
    const { supabase } = client({ error: { message: "below_placed", code: "P0001", details: "not json" } })
    expect(await changeStream(supabase, change)).toEqual({ ok: false, error: "below_placed", placed: null, raised: false })
  })

  test("a label refusal says whether the new stream's label clashed", async () => {
    const own = client({ error: { message: "label_taken", code: "P0001" } })
    expect(await changeStream(own.supabase, change)).toEqual({ ok: false, error: "label_taken", opening: false })
    const opening = client({ error: { message: "label_taken", code: "P0001", details: '{"field": "open_label"}' } })
    expect(await changeStream(opening.supabase, change)).toEqual({ ok: false, error: "label_taken", opening: true })
  })

  test("sends a new stream or a raise only when asked, and reads what moved", async () => {
    const { supabase, rpc } = client({
      data: {
        stream: { id: "s1", label: "B", takes: "Boys", seats: 12, position: 1, placed: 10, brought_up_from: null },
        opened: { id: "s9", label: "C", takes: "Girls", seats: 5, position: 3, placed: 2, brought_up_from: null },
        moved: [{ lead_id: "l1", stream_id: "s9" }, { lead_id: "l2", stream_id: null }],
        seated_from_waiting: 1,
      },
    })
    const result = await changeStream(supabase, { ...change, open: { takes: "Girls", label: "C", seats: 5, requestId: "r1" } })
    expect(rpc).toHaveBeenCalledWith("change_stream", {
      stream_id: "s1",
      label: "B",
      seats: 12,
      takes: "Boys",
      open_takes: "Girls",
      open_label: "C",
      open_seats: 5,
      open_request: "r1",
      raise_stream: null,
      raise_seats: null,
    })
    expect(result).toMatchObject({
      ok: true,
      data: {
        stream: { id: "s1", takes: "Boys", placed: 10, boys: null, girls: null },
        opened: { id: "s9", label: "C" },
        moved: [{ leadId: "l1", streamId: "s9" }, { leadId: "l2", streamId: null }],
        seatedFromWaiting: 1,
      },
    })
  })
})

describe("an optional label and deleting a stream (owner 2026-11-26)", () => {
  test("an empty label is sent as none, and read back as empty; a stream with none is named by its class", async () => {
    const { supabase, rpc } = client({ data: { id: "s1", label: null, takes: "Mixed", seats: 40, position: 1, placed: 0, brought_up_from: null } })
    const opened = await openStream(supabase, { year: 2027, className: "STD 1", label: " ", takes: "Mixed", seats: 40, requestId: "r1" })
    expect(rpc).toHaveBeenCalledWith("open_stream", expect.objectContaining({ label: null }))
    expect(opened).toMatchObject({ ok: true, data: { label: "" } })
    const changed = client({ data: { stream: { id: "s1", label: null, takes: "Boys", seats: 9, position: 1, placed: 0, brought_up_from: null }, opened: null, moved: [], seated_from_waiting: 0 } })
    await changeStream(changed.supabase, { ...change, label: "", open: { takes: "Girls", label: "", seats: 3, requestId: "r2" } })
    expect(changed.rpc).toHaveBeenCalledWith("change_stream", expect.objectContaining({ label: null, open_label: null, open_takes: "Girls" }))
    expect([streamName("STD 1", "", "Mixed"), streamName("FORM 1", "", "Girls"), streamName("FORM 1", "B", "Boys")]).toEqual(["STD 1", "FORM 1 (Girls)", "FORM 1 B (Boys)"])
  })

  test("a refused delete says how many children are placed in the stream", async () => {
    const { supabase, rpc } = client({ error: { message: "not_empty", code: "P0001", details: '{"placed": 2}' } })
    expect(await deleteStream(supabase, "s1")).toEqual({ ok: false, error: "not_empty", placed: 2 })
    expect(rpc).toHaveBeenCalledWith("delete_stream", { stream_id: "s1" })
    const gone = client({ error: { message: "not_found", code: "P0001" } })
    expect(await deleteStream(gone.supabase, "s1")).toEqual({ ok: false, error: "not_found" })
  })
})
