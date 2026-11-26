import { beforeEach, describe, expect, it } from "vitest"

import { clearFlow, FLOW_KEY, FLOW_MAX_AGE_MS, parseFlow, readFlow, writeFlow, type SavedFlow } from "@/app/discount-code/flow-state"

// Where the person is in choosing how to sign in, kept for a reload (owner,
// prototype v5): Choose, Check your SMS and Set password come back.

const STARTED = {
  status: "self-confirm" as const,
  attempt: "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01",
  mobileOnRecord: true,
  typedMatches: true,
  canText: true,
  emailOnRecord: false,
  emailOpen: true,
  email: "",
  phone: "0712345123",
}
const NOW = 1_800_000_000_000
const flow = (over: Partial<SavedFlow> = {}): SavedFlow => ({ started: STARTED, startedAt: NOW - 1000, step: { at: "password", phone: "+255712345123" }, smsOff: false, ...over })
const raw = (value: unknown) => JSON.stringify({ version: 1, ...(value as object) })

beforeEach(() => window.sessionStorage.clear())

describe("parseFlow", () => {
  it("reads back every step it keeps", () => {
    expect(parseFlow(raw(flow()), NOW)).toEqual(flow())
    expect(parseFlow(raw(flow({ step: { at: "choose" }, smsOff: true })), NOW)).toEqual(flow({ step: { at: "choose" }, smsOff: true }))
    const sms = { at: "sms" as const, masked: "07•• ••• 123", onRecord: true, sentAt: NOW - 5000 }
    expect(parseFlow(raw(flow({ step: sms })), NOW)).toEqual(flow({ step: sms }))
    expect(parseFlow(raw(flow({ step: { at: "ask-email" } })), NOW)).toEqual(flow({ step: { at: "ask-email" } }))
  })

  it("keeps a new agent's waiting code with the attempt", () => {
    const started = { ...STARTED, newAgent: true, code: "YAI-121" }
    expect(parseFlow(raw(flow({ started })), NOW)?.started).toEqual(started)
  })

  // Owner, prototype v6 item 3: no SMS possible, so the choice is today's
  // claim by email, with no attempt behind it.
  it("keeps a choice by email only with no attempt, and refuses an empty attempt for anything else", () => {
    const office = { ...STARTED, attempt: "", canText: false, emailOpen: false, emailClaim: true, mobileOnRecord: false, typedMatches: false }
    expect(parseFlow(raw(flow({ started: office, step: { at: "ask-email" } })), NOW)?.started).toEqual(office)
    expect(parseFlow(raw(flow({ started: { ...STARTED, attempt: "" } })), NOW)).toBeNull()
    expect(parseFlow(raw(flow({ started: { ...office, canText: true } })), NOW)).toBeNull()
  })

  it("keeps short names' claim flag with the attempt", () => {
    const started = { ...STARTED, emailOpen: false, emailClaim: true }
    expect(parseFlow(raw(flow({ started })), NOW)?.started).toEqual(started)
  })

  it("drops a flow older than its attempt's 60 minutes", () => {
    expect(parseFlow(raw(flow({ startedAt: NOW - FLOW_MAX_AGE_MS - 1 })), NOW)).toBeNull()
  })

  it.each([
    ["another version", JSON.stringify({ version: 2, ...flow() })],
    ["not JSON", "{"],
    ["an attempt that isn't an id", raw(flow({ started: { ...STARTED, attempt: "x" } }))],
    ["a step it never keeps", raw({ ...flow(), step: { at: "email", email: "a@b.c" } })],
    ["a password step without a mobile", raw({ ...flow(), step: { at: "password", phone: "07" } })],
    ["a new agent without a code", raw(flow({ started: { ...STARTED, newAgent: true } }))],
  ])("refuses %s", (_name, value) => {
    expect(parseFlow(value, NOW)).toBeNull()
  })
})

describe("the tab's storage", () => {
  it("writes, reads and clears", () => {
    const now = { ...flow(), startedAt: Date.now() }
    writeFlow(now)
    expect(readFlow()).toEqual(now)
    clearFlow()
    expect(readFlow()).toBeNull()
  })

  it("throws away a stored flow it can't read", () => {
    window.sessionStorage.setItem(FLOW_KEY, "{")
    expect(readFlow()).toBeNull()
    expect(window.sessionStorage.getItem(FLOW_KEY)).toBeNull()
  })
})
