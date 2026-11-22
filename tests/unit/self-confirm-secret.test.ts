import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// Importing the module with no OTP_HMAC_SECRET must not throw: the secret is
// read only when a number is made or checked.
import { checkConfirmationNumber, sendConfirmationNumber } from "@/lib/services/agent-self-confirm"

// Self-confirm with OTP_HMAC_SECRET missing or too short (#503 slice 3): with
// the switch on, no number is made, texted or checked. It fails closed.

const ATTEMPT = "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01"

describe("self-confirm without OTP_HMAC_SECRET", () => {
  it.each([{}, { OTP_HMAC_SECRET: "" }, { OTP_HMAC_SECRET: "too-short" }])("makes and texts no number (%o)", async (env) => {
    const rpc = vi.fn()
    const send = vi.fn()
    const sent = await sendConfirmationNumber({ rpc } as unknown as SupabaseClient, send, { attempt: ATTEMPT, browser: "token" }, (d) => d, env)
    expect(sent).toEqual({ ok: false, error: "not-configured" })
    expect(rpc).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("proves nothing: a check never reaches the database", async () => {
    const rpc = vi.fn()
    expect(await checkConfirmationNumber({ rpc } as unknown as SupabaseClient, { attempt: ATTEMPT, browser: "token", digits: "482913" }, {})).toEqual({
      ok: false,
      error: "not-configured",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
