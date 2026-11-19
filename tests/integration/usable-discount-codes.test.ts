import { randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { changeAgentStatus } from "@/lib/services/marketing-agents"
import { createPromoCode, setPromoCodeState } from "@/lib/services/promo-codes"
import { listUsableDiscountCodes } from "@/lib/services/referral"

import { registerApprovedAgent, registerPendingAgent } from "../support/agents"
import { anonClient, createThrowawayStaff, signedIn } from "../support/db"
import { discountPhone, freshCode } from "../support/discount-codes"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Discount code list on Register Students (owner, 2026-11-19): every
// code that takes money off today, for staff who may put a code on an
// application (leads.edit). Invented names and codes.

async function promo(amount: number) {
  const code = freshCode("L")
  const made = await createPromoCode(await signedIn(MANAGER), { name: `List ${code}`, code, amount, endsOn: null, note: null })
  if (!made.ok) throw new Error(`could not create ${code}: ${made.error}`)
  return made.data
}

const agentName = (who: string) => `${who} Orodha ${randomUUID().slice(0, 6)}`

describe("who may list the Discount codes", () => {
  test("staff without leads.edit are refused, and so is a signed-out visitor", async () => {
    expect(await listUsableDiscountCodes(await signedIn(ACCOUNTANT))).toEqual({ ok: false, error: "forbidden" })
    const viewer = await signedIn(await createThrowawayStaff(["leads.view"]))
    expect((await viewer.rpc("usable_discount_codes")).error?.message).toBe("not_permitted")
    expect((await anonClient().rpc("usable_discount_codes")).error?.code).toBe("42501")
    expect(await listUsableDiscountCodes(anonClient())).toEqual({ ok: false, error: "forbidden" })
  })
})

describe("which codes are listed", () => {
  test("active Promo codes and Approved agents' codes, with the holder and the amount off; nothing paused, ended, pending, switched off or retired", async () => {
    const manager = await signedIn(MANAGER)
    const active = await promo(12_000)
    const paused = await promo(8_000)
    expect((await setPromoCodeState(manager, paused.id, "paused", "Test: on hold")).ok).toBe(true)
    const ended = await promo(8_000)
    expect((await setPromoCodeState(manager, ended.id, "ended", "Test: over")).ok).toBe(true)

    const approvedName = agentName("Amina")
    const approved = await registerApprovedAgent(MANAGER, { fullName: approvedName, phone: discountPhone() })
    const pending = await registerPendingAgent({ fullName: agentName("Juma"), phone: discountPhone() })
    const off = await registerApprovedAgent(MANAGER, { fullName: agentName("Rehema"), phone: discountPhone() })
    expect((await changeAgentStatus(manager, off.id, "switch-off", "Test: paused")).ok).toBe(true)
    const retired = await registerApprovedAgent(MANAGER, { fullName: agentName("Tatu"), phone: discountPhone() })
    expect((await changeAgentStatus(manager, retired.id, "retire", "Test: wrong record")).ok).toBe(true)

    const listed = await listUsableDiscountCodes(await signedIn(ADMISSIONS))
    if (!listed.ok) throw new Error(listed.error)
    const codes = listed.data.map((c) => c.code)

    expect(listed.data.find((c) => c.code === active.code)).toEqual({ kind: "promo", code: active.code, holderName: `List ${active.code}`, amountOff: 12_000 })
    expect(listed.data.find((c) => c.code === approved.code)).toEqual({
      kind: "agent",
      code: approved.code,
      holderName: approvedName,
      amountOff: expect.any(Number),
    })
    for (const gone of [paused.code, ended.code, pending.code, off.code, retired.code]) expect(codes, gone).not.toContain(gone)
    // Each code once, every Promo code before the first agent code.
    expect(new Set(codes).size).toBe(codes.length)
    const firstAgent = listed.data.findIndex((c) => c.kind === "agent")
    expect(listed.data.slice(firstAgent).every((c) => c.kind === "agent")).toBe(true)
  })
})
