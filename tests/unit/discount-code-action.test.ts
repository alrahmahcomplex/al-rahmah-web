import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const stubs = vi.hoisted(() => ({
  limit: vi.fn(),
  turnstile: vi.fn(),
  register: vi.fn(),
  client: vi.fn(),
  headers: { value: new Headers() },
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => stubs.headers.value }))
vi.mock("@/lib/rate-limit", () => ({
  checkPublicFormLimit: (input: unknown) => {
    calls.order.push("rate-limit")
    return stubs.limit(input)
  },
}))
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: (input: unknown) => {
    calls.order.push("turnstile")
    return stubs.turnstile(input)
  },
}))
vi.mock("@/utils/supabase/public-form", () => ({ publicFormClient: () => stubs.client() }))
vi.mock("@/lib/services/marketing-agents", () => ({
  registerAgent: (...args: unknown[]) => {
    calls.order.push("service")
    return stubs.register(...args)
  },
}))

import { registerAsAgent } from "@/app/discount-code/actions"

function posted(fields: Record<string, string> = {}) {
  const data = new FormData()
  data.set("cf-turnstile-response", "token-from-widget")
  data.set("full_name", "Rehema Juma")
  data.set("phone", "0712 345 678")
  data.set("whatsapp", "")
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const send = (data: FormData) => registerAsAgent({ status: "idle" }, data)

beforeEach(() => {
  calls.order = []
  stubs.headers.value = new Headers({
    "x-real-ip": "203.0.113.7",
    host: "alrahmah.example",
    "x-forwarded-host": "alrahmah.example",
    "x-forwarded-proto": "https",
  })
  stubs.limit.mockReset().mockResolvedValue("allowed")
  stubs.turnstile.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.client.mockReset().mockReturnValue({ secret: "client" })
  stubs.register.mockReset().mockResolvedValue({ ok: true, data: { code: "RJ-407" } })
})

describe("registering for a Discount code", () => {
  it("runs the rate limit, then Turnstile, then registers, and returns the code and its link", async () => {
    const state = await send(posted())

    expect(calls.order).toEqual(["rate-limit", "turnstile", "service"])
    expect(state).toEqual({ status: "registered", code: "RJ-407", link: "https://alrahmah.example/apply?ref=RJ-407" })
    expect(stubs.limit).toHaveBeenCalledWith({ headers: stubs.headers.value, key: "agent" })
    expect(stubs.turnstile).toHaveBeenCalledWith({
      token: "token-from-widget",
      action: "agent",
      remoteIp: "203.0.113.7",
      hostname: "alrahmah.example",
    })
    expect(stubs.register).toHaveBeenCalledWith({ secret: "client" }, { fullName: "Rehema Juma", phone: "0712 345 678", whatsapp: null })
  })

  it("passes the WhatsApp number on when there is one", async () => {
    await send(posted({ whatsapp: "0754 000 111" }))
    expect(stubs.register).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ whatsapp: "0754 000 111" }))
  })

  it("builds the link from a Preview's own origin", async () => {
    stubs.headers.value = new Headers({ host: "al-rahmah-web-git-82.vercel.app", "x-forwarded-proto": "https" })
    expect(await send(posted())).toEqual(
      expect.objectContaining({ link: "https://al-rahmah-web-git-82.vercel.app/apply?ref=RJ-407" }),
    )
  })

  it("stops at the rate limit, before Turnstile, writing nothing", async () => {
    stubs.limit.mockResolvedValue("limited")
    expect(await send(posted())).toEqual({ status: "rate-limited" })
    expect(calls.order).toEqual(["rate-limit"])
  })

  it.each(["missing", "failed", "unavailable"])("refuses as check-failed when Turnstile says %s, writing nothing", async (error) => {
    stubs.turnstile.mockResolvedValue({ ok: false, error })
    expect(await send(posted())).toEqual({ status: "check-failed" })
    expect(calls.order).toEqual(["rate-limit", "turnstile"])
  })

  it.each([
    ["full_name", { full_name: "R" }],
    ["phone", { phone: "" }],
    ["whatsapp", { whatsapp: "0".repeat(41) }],
  ])("validates after both checks and names the %s field, writing nothing", async (field, fields) => {
    expect(await send(posted(fields))).toEqual({ status: "invalid", field })
    expect(calls.order).toEqual(["rate-limit", "turnstile"])
  })

  it("passes on a phone the database couldn't read", async () => {
    stubs.register.mockResolvedValue({ ok: false, error: { kind: "invalid", field: "phone" } })
    expect(await send(posted({ phone: "12" }))).toEqual({ status: "invalid", field: "phone" })
  })

  it("answers unavailable when the database can't be reached", async () => {
    stubs.register.mockResolvedValue({ ok: false, error: { kind: "unavailable" } })
    expect(await send(posted())).toEqual({ status: "unavailable" })
  })

  it("answers unavailable, never a raw error, when registering throws", async () => {
    stubs.register.mockRejectedValue(new Error("fetch failed: secret details"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await send(posted())).toEqual({ status: "unavailable" })
    error.mockRestore()
  })

  it("answers unavailable when the secret key isn't set, writing nothing", async () => {
    stubs.client.mockReturnValue(null)
    expect(await send(posted())).toEqual({ status: "unavailable" })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it("answers unavailable when the client can't be made", async () => {
    stubs.client.mockImplementation(() => {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await send(posted())).toEqual({ status: "unavailable" })
    error.mockRestore()
  })

  it("answers unavailable when the request's origin can't make a link, writing nothing", async () => {
    stubs.headers.value = new Headers({ "x-real-ip": "203.0.113.7" })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await send(posted())).toEqual({ status: "unavailable" })
    expect(stubs.register).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
