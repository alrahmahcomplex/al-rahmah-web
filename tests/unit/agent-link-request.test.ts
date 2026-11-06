import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const stubs = vi.hoisted(() => ({
  limit: vi.fn(),
  turnstile: vi.fn(),
  decide: vi.fn(),
  send: vi.fn(),
  client: vi.fn(),
  after: vi.fn(),
  headers: { value: new Headers() },
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: async () => stubs.headers.value }))
vi.mock("next/server", () => ({ after: (work: () => unknown) => stubs.after(work) }))
vi.mock("@/lib/rate-limit", () => ({
  checkPublicFormLimit: (input: unknown) => {
    calls.order.push("firewall")
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
vi.mock("@/utils/supabase/admin", () => ({ agentResetSender: () => "reset-sender", agentInviteSender: () => "invite-sender" }))
vi.mock("@/lib/services/agent-link-requests", async (original) => ({
  ...(await original<typeof import("@/lib/services/agent-link-requests")>()),
  decideAgentLink: (...args: unknown[]) => {
    calls.order.push("database")
    return stubs.decide(...args)
  },
  sendAgentLink: (...args: unknown[]) => stubs.send(...args),
}))

import { requestPasswordLink } from "@/app/discount-code/link-request-actions"
import { DEFAULT_LINK_LIMITS, readLinkLimits } from "@/lib/services/agent-link-requests"

function posted(fields: Record<string, string> = {}) {
  const data = new FormData()
  data.set("cf-turnstile-response", "token-from-widget")
  data.set("form", "agent-reset")
  data.set("email", " Amani@Example.test ")
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  calls.order = []
  stubs.headers.value = new Headers({ "x-real-ip": "203.0.113.7", host: "alrahmah.example", "x-forwarded-proto": "https" })
  stubs.limit.mockReset().mockResolvedValue("allowed")
  stubs.turnstile.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.client.mockReset().mockReturnValue({ secret: "client" })
  stubs.decide.mockReset().mockResolvedValue({ ok: true, data: { kind: "none" } })
  stubs.send.mockReset().mockResolvedValue({ ok: true, data: null })
  stubs.after.mockReset()
})

describe("requesting a password link", () => {
  it("checks Turnstile, then the firewall key per form and email, then the database", async () => {
    await requestPasswordLink(posted())

    expect(calls.order).toEqual(["turnstile", "firewall", "database"])
    expect(stubs.turnstile).toHaveBeenCalledWith(expect.objectContaining({ action: "agent-link", remoteIp: "203.0.113.7" }))
    expect(stubs.limit).toHaveBeenCalledWith(expect.objectContaining({ key: "agent-reset", subject: "amani@example.test" }))
    expect(stubs.decide).toHaveBeenCalledWith({ secret: "client" }, "amani@example.test", DEFAULT_LINK_LIMITS)
  })

  it("keys the expired-link form on its own name", async () => {
    await requestPasswordLink(posted({ form: "agent-new-link" }))
    expect(stubs.limit).toHaveBeenCalledWith(expect.objectContaining({ key: "agent-new-link" }))
  })

  it.each([
    ["nobody to send to", { kind: "none" }],
    ["a reset", { kind: "reset", email: "amani@example.test", attemptId: "a1" }],
    ["a new invite", { kind: "invite", email: "amani@example.test", attemptId: "a2" }],
  ])("answers the same for %s", async (_label, decision) => {
    stubs.decide.mockResolvedValue({ ok: true, data: decision })
    expect(await requestPasswordLink(posted())).toEqual({ status: "sent" })
  })

  it("sends after the reply, to the page for the link's kind on the request's own site", async () => {
    const decision = { kind: "reset", email: "amani@example.test", attemptId: "a1" }
    stubs.decide.mockResolvedValue({ ok: true, data: decision })

    await requestPasswordLink(posted())
    expect(stubs.send).not.toHaveBeenCalled()
    await stubs.after.mock.calls[0][0]()

    expect(stubs.send).toHaveBeenCalledWith(
      { secret: "client" },
      { reset: "reset-sender", invite: "invite-sender" },
      {
        reset: "https://alrahmah.example/discount-code/reset-password",
        invite: "https://alrahmah.example/discount-code/set-password",
      },
      decision,
    )
  })

  it("sends nothing when there is nobody to send to", async () => {
    await requestPasswordLink(posted())
    expect(stubs.after).not.toHaveBeenCalled()
  })

  it.each([
    ["the per-email limit", { kind: "limited" }, "rate-limited"],
    ["the hourly budget", { kind: "busy" }, "rate-limited"],
    ["the access switch", { kind: "access-off" }, "access-off"],
  ])("refuses at %s", async (_label, decision, status) => {
    stubs.decide.mockResolvedValue({ ok: true, data: decision })
    expect(await requestPasswordLink(posted())).toEqual({ status })
    expect(stubs.after).not.toHaveBeenCalled()
  })

  it("stops at a failed Turnstile check before the firewall or the database", async () => {
    stubs.turnstile.mockResolvedValue({ ok: false, error: "failed" })
    expect(await requestPasswordLink(posted())).toEqual({ status: "check-failed" })
    expect(calls.order).toEqual(["turnstile"])
  })

  it("stops at the firewall before the database", async () => {
    stubs.limit.mockResolvedValue("limited")
    expect(await requestPasswordLink(posted())).toEqual({ status: "rate-limited" })
    expect(calls.order).toEqual(["turnstile", "firewall"])
  })

  it.each(["", "not-an-email", "a@b"])("refuses the email %j before any check", async (email) => {
    expect(await requestPasswordLink(posted({ email }))).toEqual({ status: "invalid-email" })
    expect(calls.order).toEqual([])
  })

  it("refuses an unknown form name", async () => {
    expect(await requestPasswordLink(posted({ form: "admission" }))).toEqual({ status: "unavailable" })
    expect(calls.order).toEqual([])
  })
})

describe("the configured limits", () => {
  it("reads both from the environment", () => {
    expect(readLinkLimits({ AGENT_LINK_PER_EMAIL_LIMIT: "5", PUBLIC_EMAIL_HOURLY_BUDGET: "10" })).toEqual({
      perEmailLimit: 5,
      hourlyBudget: 10,
    })
  })

  it.each([undefined, "", "ten", "-1", "2.5"])("falls back to the default for %j, never to no limit", (value) => {
    expect(readLinkLimits({ AGENT_LINK_PER_EMAIL_LIMIT: value, PUBLIC_EMAIL_HOURLY_BUDGET: value })).toEqual(DEFAULT_LINK_LIMITS)
  })
})
