import { beforeEach, describe, expect, it, vi } from "vitest"

// The seat read behind the Boy or girl sheet (#449): when it fails, there is
// no answer, so the sheet saves nothing. The database is stubbed.

const db = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/utils/supabase/server", () => ({ createClient: async () => ({ rpc: db.rpc }) }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: vi.fn() }))

import { genderOutlookAction } from "@/app/staff/applicants/[id]/gender-actions"

type Reply = { data?: unknown; error?: unknown }

function database(outlook: Reply) {
  db.rpc.mockImplementation(async (name: string) => {
    const reply = name === "lead_gender_outlook" ? outlook : undefined
    if (!reply) throw new Error(`unexpected read: ${name}`)
    return { data: reply.data ?? null, error: reply.error ?? null }
  })
}

const DOWN = { error: { message: "boom" } }

beforeEach(() => {
  db.rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("genderOutlookAction", () => {
  it("gives the database's answer", async () => {
    const stream = { id: "b", class_name: "FORM 1", label: "B", takes: "Boys" }
    database({ data: { placed: stream, moves: true, would_take: null } })
    expect(await genderOutlookAction("lead-1", "Girl")).toEqual({
      placed: { id: "b", className: "FORM 1", label: "B", takes: "Boys" },
      moves: true,
      wouldTake: null,
    })
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(db.rpc).toHaveBeenCalledWith("lead_gender_outlook", { lead_id: "lead-1", gender: "Girl" })
  })

  it("gives no answer when the read fails, and reads nothing else", async () => {
    database(DOWN)
    expect(await genderOutlookAction("lead-1", "Girl")).toBeNull()
    expect(db.rpc).toHaveBeenCalledTimes(1)
  })

  it("reads nothing for an answer that is not Boy or Girl", async () => {
    expect(await genderOutlookAction("lead-1", "Other" as never)).toBeNull()
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
