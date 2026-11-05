import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { agentAccessLine } from "@/app/staff/agents/access-banner"
import { getAgentAccess } from "@/lib/services/agent-access"

function client(result: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: vi.fn(async () => result) } as unknown as SupabaseClient
}

describe("the Agents screen's agent access line", () => {
  it("says Off since setup until anyone changes it", () => {
    expect(agentAccessLine({ enabled: false, changedAt: null, changedBy: null })).toBe("Off since setup")
  })

  it("names the staff member or the system, with the time in East Africa", () => {
    expect(
      agentAccessLine({ enabled: true, changedAt: "2026-11-05T07:30:00Z", changedBy: { kind: "staff", name: "Test Manager" } }),
    ).toBe("On since 5 Nov 2026, 10:30, changed by Test Manager")
    expect(agentAccessLine({ enabled: false, changedAt: "2026-11-05T07:30:00Z", changedBy: { kind: "system" } })).toBe(
      "Off since 5 Nov 2026, 10:30, changed by the system",
    )
  })
})

describe("getAgentAccess", () => {
  it("reads the state and who changed it", async () => {
    const result = await getAgentAccess(
      client({
        data: [{ enabled: true, changed_at: "2026-11-05T07:30:00Z", changed_by_kind: "staff", changed_by_name: "Test Manager" }],
        error: null,
      }),
    )
    expect(result).toEqual({
      ok: true,
      data: { enabled: true, changedAt: "2026-11-05T07:30:00Z", changedBy: { kind: "staff", name: "Test Manager" } },
    })
  })

  it("is forbidden without leads.view or a session, and unavailable otherwise", async () => {
    expect(await getAgentAccess(client({ data: null, error: { message: "not_permitted" } }))).toEqual({ ok: false, error: "forbidden" })
    expect(await getAgentAccess(client({ data: null, error: { message: "denied", code: "42501" } }))).toEqual({
      ok: false,
      error: "forbidden",
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await getAgentAccess(client({ data: null, error: { message: "boom" } }))).toEqual({ ok: false, error: "unavailable" })
    expect(await getAgentAccess(client({ data: [], error: null }))).toEqual({ ok: false, error: "unavailable" })
  })
})
