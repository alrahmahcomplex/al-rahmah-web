import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const stubs = vi.hoisted(() => ({
  limit: vi.fn(),
  turnstile: vi.fn(),
  register: vi.fn(),
  client: vi.fn(),
  estimate: vi.fn(),
  headers: { value: new Headers() },
  // Self-confirm's starts (#503): unavailable unless a test says otherwise, so
  // today's sign-up path answers as before.
  begin: vi.fn(),
  beginNew: vi.fn(),
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
vi.mock("@/lib/services/agent-sign-up", () => ({
  signUpAgent: (...args: unknown[]) => {
    calls.order.push("service")
    return stubs.register(...args)
  },
}))

vi.mock("@/lib/services/referral", async (original) => ({
  ...(await original<typeof import("@/lib/services/referral")>()),
  estimateDiscountCode: (...args: unknown[]) => stubs.estimate(...args),
}))

vi.mock("@/app/discount-code/self-confirm-browser", () => ({
  beginSelfConfirm: (...args: unknown[]) => stubs.begin(...args),
  beginNewAgentSelfConfirm: (...args: unknown[]) => stubs.beginNew(...args),
}))

import { registerAsAgent } from "@/app/discount-code/actions"

function posted(fields: Record<string, string> = {}) {
  const data = new FormData()
  data.set("cf-turnstile-response", "token-from-widget")
  data.set("firstName", "Rehema")
  data.set("middleName", "Ali")
  data.set("lastName", "Juma")
  data.set("phone", "0712 345 678")
  data.set("whatsapp", "")
  data.set("email", "Rehema@Example.test")
  data.set("has_code", "no")
  data.set("code", "")
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
  stubs.register.mockReset().mockResolvedValue({ ok: true, data: { kind: "registered", code: "RJ-407", email: "rehema@example.test" } })
  // A new code is Pending: it takes nothing off yet.
  stubs.estimate.mockReset().mockResolvedValue({ ok: true, data: { state: "pending", amount: 50000 } })
  stubs.begin.mockReset().mockResolvedValue({ kind: "unavailable" })
  stubs.beginNew.mockReset().mockResolvedValue({ kind: "unavailable" })
})

describe("registering for a Discount code", () => {
  it("runs the rate limit, then Turnstile, then registers, and returns the code and its link", async () => {
    const state = await send(posted())

    expect(calls.order).toEqual(["rate-limit", "turnstile", "service"])
    expect(state).toEqual({
      status: "registered",
      code: "RJ-407",
      link: "https://alrahmah.example/apply?ref=RJ-407",
      email: "rehema@example.test",
      discount: null,
    })
    expect(stubs.limit).toHaveBeenCalledWith({ headers: stubs.headers.value, key: "agent", subject: "Rehema@Example.test" })
    expect(stubs.turnstile).toHaveBeenCalledWith({
      token: "token-from-widget",
      action: "agent",
      remoteIp: "203.0.113.7",
      hostname: "alrahmah.example",
    })
    expect(stubs.register).toHaveBeenCalledWith(
      { secret: "client" },
      { fullName: "REHEMA ALI JUMA", phone: "0712 345 678", whatsapp: null, email: "rehema@example.test", hasCode: false, code: null },
    )
  })

  it("passes the box and the code on, and shows a claimed code with its link", async () => {
    stubs.register.mockResolvedValue({ ok: true, data: { kind: "claimed", code: "RJ-407" } })
    expect(await send(posted({ has_code: "yes", code: " rj-407 " }))).toEqual({
      status: "claimed",
      code: "RJ-407",
      link: "https://alrahmah.example/apply?ref=RJ-407",
      discount: null,
    })
    expect(stubs.register).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hasCode: true, code: "rj-407" }))
  })

  it("names what an Approved code takes off now, for the share message, and nothing when the lookup fails", async () => {
    stubs.register.mockResolvedValue({ ok: true, data: { kind: "claimed", code: "RJ-407" } })
    stubs.estimate.mockResolvedValue({ ok: true, data: { state: "approved", amount: 35000 } })
    expect(await send(posted({ has_code: "yes", code: "RJ-407" }))).toMatchObject({ status: "claimed", discount: 15000 })
    expect(stubs.estimate).toHaveBeenCalledWith({ secret: "client" }, "RJ-407", { signal: expect.any(AbortSignal) })

    stubs.estimate.mockResolvedValue({ ok: false, error: "unavailable" })
    expect(await send(posted({ has_code: "yes", code: "RJ-407" }))).toMatchObject({ status: "claimed", discount: null })
    stubs.estimate.mockRejectedValue(new Error("aborted"))
    expect(await send(posted({ has_code: "yes", code: "RJ-407" }))).toMatchObject({ status: "claimed", discount: null })
    stubs.estimate.mockResolvedValue({ ok: true, data: { state: "switched_off", amount: 50000 } })
    expect(await send(posted({ has_code: "yes", code: "RJ-407" }))).toMatchObject({ status: "claimed", discount: null })
  })

  it.each([
    ["code_needed", "code-needed"],
    ["phone_mismatch", "phone-mismatch"],
    ["no_match", "no-match"],
    ["claim_waiting", "claim-waiting"],
    ["invited", "invited"],
    ["joined", "joined"],
    ["email_unusable", "email-unusable"],
    ["access_off", "access-off"],
  ])("answers the %s outcome as %s", async (kind, status) => {
    stubs.register.mockResolvedValue({ ok: true, data: { kind } })
    expect(await send(posted())).toEqual({ status })
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
    ["full_name", { middleName: " " }],
    ["phone", { phone: "" }],
    ["whatsapp", { whatsapp: "0".repeat(41) }],
    ["email", { email: "" }],
    ["email", { email: "not-an-email" }],
    ["code", { has_code: "yes", code: " " }],
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

// Self-confirm's order (#503 slice 4d-b): the form sends no email, flow=self-confirm.
describe("in self-confirm's order", () => {
  const later = (fields: Record<string, string> = {}) => posted({ email: "", flow: "self-confirm", ...fields })

  it("a new agent's send opens their attempt and goes on to the choice, with their waiting code", async () => {
    stubs.beginNew.mockResolvedValue({ kind: "ready", attempt: "att-1", code: "RAJ-124", canText: true })
    expect(await send(later())).toEqual({
      status: "self-confirm",
      attempt: "att-1",
      mobileOnRecord: true,
      typedMatches: true,
      canText: true,
      emailOnRecord: false,
      emailOpen: true,
      email: "",
      phone: "0712 345 678",
      newAgent: true,
      code: "RAJ-124",
    })
    expect(stubs.beginNew).toHaveBeenCalledWith({ fullName: "REHEMA ALI JUMA", phone: "0712 345 678", whatsapp: "" })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: "code_needed" }, { status: "code-needed" }],
    [{ kind: "joined" }, { status: "joined" }],
    [{ kind: "access_off" }, { status: "access-off" }],
    [{ kind: "setups_limited" }, { status: "rate-limited" }],
    [{ kind: "invalid", field: "phone" }, { status: "invalid", field: "phone" }],
    // Switched off since the page loaded: the email question comes back.
    [{ kind: "off" }, { status: "email-needed" }],
    [{ kind: "unavailable" }, { status: "unavailable" }],
  ])("a new agent's start answering %o shows %o", async (started, state) => {
    stubs.beginNew.mockResolvedValue(started)
    expect(await send(later())).toEqual(state)
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it("a code holder whose code goes to today's claim path is asked for the email first", async () => {
    stubs.begin.mockResolvedValue({ kind: "weak_names" })
    expect(await send(later({ has_code: "yes", code: "RJ-407" }))).toEqual({ status: "email-needed" })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  // Owner, 24 Nov 2026: a code the office hasn't approved yet asked for an
  // email before any choice. It now goes on to the choice as a new agent's.
  it("a code the office hasn't approved yet goes on to the choice, as a new agent's, with no email asked", async () => {
    stubs.begin.mockResolvedValue({ kind: "ready", attempt: "att-2", mobileOnRecord: true, typedMatches: true, canText: true, emailOnRecord: false, emailOpen: true, pendingCode: "YAI-121" })
    expect(await send(later({ has_code: "yes", code: "YAI-121" }))).toEqual({
      status: "self-confirm",
      attempt: "att-2",
      mobileOnRecord: true,
      typedMatches: true,
      canText: true,
      emailOnRecord: false,
      emailOpen: true,
      email: "",
      phone: "0712 345 678",
      newAgent: true,
      code: "YAI-121",
    })
    expect(stubs.register).not.toHaveBeenCalled()
  })

  it("an Approved code goes on to the choice as a code holder's", async () => {
    stubs.begin.mockResolvedValue({ kind: "ready", attempt: "att-3", mobileOnRecord: true, typedMatches: true, canText: true, emailOnRecord: true, emailOpen: true, pendingCode: null })
    const state = await send(later({ has_code: "yes", code: "AAN-132" }))
    expect(state).toMatchObject({ status: "self-confirm", attempt: "att-3" })
    expect(state).not.toHaveProperty("newAgent")
  })

  it("without flow=self-confirm an empty email is still refused, as today", async () => {
    expect(await send(posted({ email: "" }))).toEqual({ status: "invalid", field: "email" })
  })
})
