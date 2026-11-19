import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { activityWindow, getHomeActivity, type FullClass } from "@/lib/services/home-activity"

describe("activityWindow", () => {
  it("puts the rows ahead on the first pages and offsets the database by them", () => {
    expect(activityWindow(1, 3)).toEqual({ aheadShown: { from: 0, to: 3 }, offset: 0, limit: 7, wanted: 7 })
    expect(activityWindow(2, 3)).toEqual({ aheadShown: { from: 3, to: 3 }, offset: 7, limit: 10, wanted: 10 })
  })

  it("still asks the database for one row, for the total, when the page is all rows ahead", () => {
    expect(activityWindow(1, 12)).toEqual({ aheadShown: { from: 0, to: 10 }, offset: 0, limit: 1, wanted: 0 })
    expect(activityWindow(2, 12)).toEqual({ aheadShown: { from: 10, to: 12 }, offset: 0, limit: 8, wanted: 8 })
  })
})

function client(answer: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null })
  return { supabase: { rpc } as unknown as SupabaseClient, rpc }
}

const FEE = {
  kind: "fee_paid",
  id: "p1",
  at: "2026-11-15T05:05:00+00:00",
  all_day: false,
  lead_id: "l1",
  admission_number: "ADMSN-12345",
  student_name: "SALMA JUMA MRISHO",
  class_name: "STD 4",
  payment_type: "first_instalment",
  amount: 600000,
  recorded_by: "Example Staff One",
}

describe("getHomeActivity", () => {
  it("maps the database's rows after the full classes, with the combined total", async () => {
    const { supabase, rpc } = client({ data: { total: 11, rows: [FEE] } })
    const full: FullClass[] = [{ className: "STD 6", need: null, elsewhere: null }]
    const result = await getHomeActivity(supabase, 1, full)
    expect(rpc).toHaveBeenCalledWith("home_activity", { row_offset: 0, row_limit: 9 })
    expect(result).toEqual({
      ok: true,
      data: {
        total: 12,
        page: 1,
        pageCount: 2,
        rows: [
          { kind: "class_full", id: "STD 6 any", className: "STD 6", need: null, elsewhere: null },
          {
            kind: "fee_paid",
            id: "p1",
            at: "2026-11-15T05:05:00+00:00",
            leadId: "l1",
            admissionNumber: "ADMSN-12345",
            studentName: "SALMA JUMA MRISHO",
            className: "STD 4",
            paymentType: "first_instalment",
            amount: 600000,
            recordedBy: "Example Staff One",
          },
        ],
      },
    })
  })

  it("maps every kind's fields from the database's names", async () => {
    const lead = { lead_id: "l2", admission_number: "ADMSN-22222", student_name: "AMANI DAUDI PETRO", class_name: "KG 2" }
    const mapped = { leadId: "l2", admissionNumber: "ADMSN-22222", studentName: "AMANI DAUDI PETRO", className: "KG 2" }
    const at = "2026-11-15T06:00:00+00:00"
    const rows = [
      { kind: "expected", id: "s1", at, all_day: true, sent_on: "2026-11-09", children: [lead] },
      { kind: "new_application", id: "l2", at, ...lead, referral_code: "AAN-132", status: "Visited", closure: null },
      { kind: "result_ready", id: "i1", at, ...lead, interview_date: "2026-11-14", result: "Passed", score: "78.5", changed_since_sent: true },
      { kind: "discount_request", id: "r1", at, ...lead, discount: "sibling", note: "Birth certificates on Thursday.", requested_by: "Example Staff One" },
      { kind: "agent_claim", id: "a1", at, agent_id: "a1", full_name: "MWALIMU EXAMPLE THREE", code: "MET-123", claims: "2" },
      { kind: "re_application", id: "x1", at, ...lead, asked_class: "FORM 1", differing_fields: ["class_name"] },
      {
        kind: "call_back",
        id: "f1",
        at,
        ...lead,
        due_on: "2026-11-06",
        note: null,
        custodian_name: "DAUDI PETRO AMANI",
        relationship: "Other",
        relationship_description: "Uncle",
      },
    ]
    const { supabase } = client({ data: { total: rows.length, rows } })
    const result = await getHomeActivity(supabase, 1)
    expect(result.ok && result.data.rows).toEqual([
      { kind: "expected", id: "s1", at, sentOn: "2026-11-09", children: [mapped] },
      { kind: "new_application", id: "l2", at, ...mapped, referralCode: "AAN-132", status: "Visited", closure: null },
      { kind: "result_ready", id: "i1", at, ...mapped, interviewDate: "2026-11-14", result: "Passed", score: 78.5, changedSinceSent: true },
      { kind: "discount_request", id: "r1", at, ...mapped, discount: "sibling", note: "Birth certificates on Thursday.", requestedBy: "Example Staff One" },
      { kind: "agent_claim", id: "a1", at, agentId: "a1", fullName: "MWALIMU EXAMPLE THREE", code: "MET-123", claims: 2 },
      { kind: "re_application", id: "x1", at, ...mapped, askedClass: "FORM 1", differingFields: ["class_name"] },
      {
        kind: "call_back",
        id: "f1",
        at,
        ...mapped,
        dueOn: "2026-11-06",
        note: null,
        custodianName: "DAUDI PETRO AMANI",
        relationship: "Other",
        relationshipDescription: "Uncle",
      },
    ])
  })

  it("leaves out a kind it does not know", async () => {
    const { supabase } = client({ data: { total: 2, rows: [{ kind: "later_kind", id: "x", at: "2026-11-15T05:00:00Z" }, FEE] } })
    const result = await getHomeActivity(supabase, 1)
    expect(result.ok && result.data.rows.map((row) => row.kind)).toEqual(["fee_paid"])
  })

  it("is forbidden when the database refuses and there is no full class", async () => {
    const { supabase } = client({ error: { message: "not_permitted" } })
    expect(await getHomeActivity(supabase, 1)).toEqual({ ok: false, error: "forbidden" })
  })

  it("still shows the full classes when the database refuses the rest", async () => {
    const { supabase } = client({ error: { message: "not_permitted" } })
    const result = await getHomeActivity(supabase, 1, [{ className: "FORM 1", need: "Boys", elsewhere: "FORM 1 A (Girls)" }])
    expect(result.ok && result.data.total).toBe(1)
  })

  it("is unavailable on any other error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase } = client({ error: { message: "boom", code: "XX000" } })
    expect(await getHomeActivity(supabase, 1)).toEqual({ ok: false, error: "unavailable" })
  })

  it("asks no page beyond the last, so the offset fits the database's integer", async () => {
    const { supabase, rpc } = client({ data: { total: 3, rows: [] } })
    const result = await getHomeActivity(supabase, 214_748_366)
    expect(rpc).toHaveBeenCalledWith("home_activity", { row_offset: 999_990, row_limit: 10 })
    expect(result).toEqual({ ok: true, data: { rows: [], total: 3, page: 100_000, pageCount: 1 } })
  })

  it("reads an unreadable page as the first", async () => {
    const { supabase, rpc } = client({ data: { total: 0, rows: [] } })
    await getHomeActivity(supabase, Number.NaN)
    expect(rpc).toHaveBeenCalledWith("home_activity", { row_offset: 0, row_limit: 10 })
  })
})
