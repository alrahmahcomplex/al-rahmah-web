import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { describeNotice, dismissNotices, getMyNotices, type NoticeRow } from "@/lib/services/staff-admin"

function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// 25 September 2026, 10:00 in Dar es Salaam.
const AT = "2026-09-25T07:00:00.123456+00:00"

function row(overrides: Partial<NoticeRow>): NoticeRow {
  return {
    id: 1,
    created_at: AT,
    actor_kind: "staff",
    actor_name: "Amina Juma",
    old_role: null,
    new_role: null,
    active: null,
    ...overrides,
  }
}

describe("describeNotice", () => {
  it("names the actor, both roles and the date for a role change", () => {
    expect(describeNotice(row({ old_role: "Admissions Manager", new_role: "Admissions Staff" }))).toBe(
      "Amina Juma changed your role from Admissions Manager to Admissions Staff on 25 September 2026.",
    )
  })

  it("says deactivated or reactivated for a change of active state", () => {
    expect(describeNotice(row({ active: false }))).toBe("Amina Juma deactivated your account on 25 September 2026.")
    expect(describeNotice(row({ active: true }))).toBe("Amina Juma reactivated your account on 25 September 2026.")
  })

  it("joins a role change and an active change made in one write", () => {
    expect(describeNotice(row({ old_role: "Accountant", new_role: "Admissions Staff", active: true }))).toBe(
      "Amina Juma changed your role from Accountant to Admissions Staff and reactivated your account on 25 September 2026.",
    )
  })

  it("dates the notice in East Africa Time, not the server's zone", () => {
    // 22:30 UTC on the 24th is already the 25th in Dar es Salaam.
    expect(describeNotice(row({ created_at: "2026-09-24T22:30:00+00:00", active: false }))).toBe(
      "Amina Juma deactivated your account on 25 September 2026.",
    )
  })

  it("names an actor that is not a person by its kind", () => {
    expect(describeNotice(row({ actor_kind: "system", actor_name: null, active: false }))).toBe(
      "The system deactivated your account on 25 September 2026.",
    )
  })
})

describe("getMyNotices", () => {
  it("reads the caller's notices and describes each", async () => {
    const { client, rpc } = fakeSupabase({ data: [row({ id: 7, active: false })], error: null })

    expect(await getMyNotices(client)).toEqual({
      ok: true,
      data: [{ id: 7, at: AT, message: "Amina Juma deactivated your account on 25 September 2026." }],
    })
    expect(rpc).toHaveBeenCalledWith("my_notices")
  })

  it("reports an outage rather than showing no notices", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } })
    vi.spyOn(console, "error").mockImplementation(() => {})

    expect(await getMyNotices(client)).toEqual({ ok: false, error: "unavailable" })
  })
})

describe("dismissNotices", () => {
  it("dismisses through the newest notice shown", async () => {
    const { client, rpc } = fakeSupabase({ data: null, error: null })

    expect(await dismissNotices(client, 9)).toEqual({ ok: true, data: null })
    expect(rpc).toHaveBeenCalledWith("dismiss_notices", { through: 9 })
  })

  it("reports a refusal as unavailable", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "not_found" } })
    vi.spyOn(console, "error").mockImplementation(() => {})

    expect(await dismissNotices(client, 9)).toEqual({ ok: false, error: "unavailable" })
  })
})
