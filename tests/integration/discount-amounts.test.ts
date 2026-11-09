import { randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getAgentDiscountImpact,
  getStandardDiscount,
  getStandardDiscountImpact,
  setAgentDiscount,
  setStandardDiscount,
} from "@/lib/services/discount-codes"
import { listAgents } from "@/lib/services/marketing-agents"

import { registerApprovedAgent } from "../support/agents"
import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { actAs, discountPhone, expectedFee, leadWithCode, lockedAmount, payInterview } from "../support/discount-codes"
import { ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// Discount amounts (owner decisions of 2026-11-09): the standard interview
// discount and each agent's own amount, in whole TZS off TZS 50,000. Writes
// need discount_codes.manage and a reason; a Paid fee never moves.
//
// The standard amount is shared by every test file, so the tests that change
// it run in a transaction that rolls back.

async function approvedAgent() {
  return registerApprovedAgent(MANAGER, { fullName: `Amina Punguzo ${randomUUID().slice(0, 6)}`, phone: discountPhone() })
}

describe("who may set discount amounts", () => {
  test("staff without discount_codes.manage are refused, and so is a signed-out visitor", async () => {
    const agent = await approvedAgent()
    const noPermission = await createThrowawayStaff(["leads.view"])
    for (const client of [await signedIn(ADMISSIONS), await signedIn(noPermission)]) {
      for (const [fn, args] of [
        ["set_standard_interview_discount", { amount: 5000, reason: "Test" }],
        ["set_agent_interview_discount", { agent_id: agent.id, amount: 5000, reason: "Test" }],
        ["standard_discount_fee_impact", { amount: 5000 }],
        ["agent_discount_fee_impact", { agent_id: agent.id, amount: 5000 }],
      ] as const) {
        const { error } = await client.rpc(fn, args)
        expect(error?.message, fn).toBe("not_permitted")
      }
    }
    for (const [fn, args] of [
      ["set_standard_interview_discount", { amount: 5000, reason: "Test" }],
      ["set_agent_interview_discount", { agent_id: agent.id, amount: 5000, reason: "Test" }],
      ["standard_discount_fee_impact", { amount: 5000 }],
      ["agent_discount_fee_impact", { agent_id: agent.id, amount: 5000 }],
    ] as const) {
      const { error } = await anonClient().rpc(fn, args)
      expect(error?.code, fn).toBe("42501")
    }
    expect(await setAgentDiscount(await signedIn(ADMISSIONS), agent.id, 5000, "Test")).toEqual({ ok: false, error: "forbidden" })
  })

  test("the role trigger gives discount_codes.manage leads.view, and drops it with leads.view", async () => {
    const someone = await createThrowawayStaff(["discount_codes.manage"])
    const roles = await inRolledBackTransaction(async (sql) => {
      const made = await sql.query<{ permissions: string[] }>("select permissions from public.roles where id = $1", [someone.roleId])
      await sql.query("select public.set_audit_actor('system')")
      const dropped = await sql.query<{ permissions: string[] }>(
        "update public.roles set permissions = array['discount_codes.manage'] where id = $1 returning permissions",
        [someone.roleId],
      )
      return { made: made.rows[0].permissions, dropped: dropped.rows[0].permissions }
    })
    expect(roles.made).toEqual(["discount_codes.manage", "leads.view"])
    expect(roles.dropped).toEqual([])
  })
})

describe("the standard interview discount", () => {
  test("starts at TZS 10,000 and every signed-in staff member and the secret key read it", async () => {
    const nobody = await createThrowawayStaff([])
    for (const client of [await signedIn(ADMISSIONS), await signedIn(nobody), secretClient()]) {
      expect(await getStandardDiscount(client)).toEqual({ ok: true, data: 10000 })
    }
    const { error } = await anonClient().rpc("standard_interview_discount")
    expect(error?.code).toBe("42501")
  })

  test("a new amount moves every unpaid fee on the standard, never a Paid one, and records the change", async () => {
    const agent = await approvedAgent()
    const unpaid = await leadWithCode(agent.code)
    const paid = await leadWithCode(agent.code)
    expect(await payInterview(paid)).toBe(40000)

    const result = await inRolledBackTransaction(async (sql) => {
      await actAs(sql, MANAGER.id)
      const impact = await sql.query<{ families: { lead_id: string; fee_now: number; fee_after: number }[] }>(
        "select public.standard_discount_fee_impact(15000) as families",
      )
      const changed = await sql.query<{ answer: { fee_change_count: number } }>(
        "select public.set_standard_interview_discount(15000, 'New term offer') as answer",
      )
      const history = await sql.query<{ kind: string; old_value: string; new_value: string; reason: string; lead_ids: string[]; changed_by: string }>(
        "select kind, old_value, new_value, reason, lead_ids, changed_by from public.discount_amount_changes where kind = 'standard' order by sequence desc limit 1",
      )
      const amounts = await sql.query<{ standard: number; legacy: number; fee: number }>(
        "select public.standard_interview_discount() as standard, public.interview_discount() as legacy, public.interview_fee(true) as fee",
      )
      const locked = await sql.query<{ locked_amount: number }>("select locked_amount from public.interviews where lead = $1", [paid])
      const unpaidFee = await expectedFee(sql, unpaid)
      await actAs(sql, MANAGER.id)
      // Last: a refusal ends the transaction.
      const again = await sql
        .query("select public.set_standard_interview_discount(15000, 'Again')")
        .then(() => null, (error: Error) => error.message)
      return {
        impact: impact.rows[0].families.filter((f) => [unpaid, paid].includes(f.lead_id)),
        count: changed.rows[0].answer.fee_change_count,
        history: history.rows[0],
        amounts: amounts.rows[0],
        unpaidFee,
        locked: locked.rows[0].locked_amount,
        again,
      }
    })

    expect(result.impact).toEqual([expect.objectContaining({ lead_id: unpaid, fee_now: 40000, fee_after: 35000 })])
    expect(result.count).toBeGreaterThanOrEqual(1)
    expect(result.history).toMatchObject({ kind: "standard", old_value: "10000", new_value: "15000", reason: "New term offer", changed_by: MANAGER.id })
    expect(result.history.lead_ids).toContain(unpaid)
    expect(result.history.lead_ids).not.toContain(paid)
    expect(result.amounts).toEqual({ standard: 15000, legacy: 15000, fee: 35000 })
    expect(result.unpaidFee).toBe(35000)
    // The Paid fee keeps the amount the family paid.
    expect(result.locked).toBe(40000)
    expect(result.again).toBe("no_change")
    // Rolled back: the shared standard is untouched.
    expect(await getStandardDiscount(await signedIn(ADMISSIONS))).toEqual({ ok: true, data: 10000 })
  })

  test("refuses an amount outside 0 to 50,000 and a missing reason, through the module too", async () => {
    const manager = await signedIn(MANAGER)
    expect(await setStandardDiscount(manager, 50001, "Too much")).toEqual({ ok: false, error: "invalid-amount" })
    expect(await getStandardDiscountImpact(manager, -1)).toEqual({ ok: false, error: "invalid-amount" })
    for (const reason of ["", "   ", "x".repeat(501)]) {
      const { error } = await manager.rpc("set_standard_interview_discount", { amount: 12000, reason })
      expect(error?.message).toBe("invalid")
      expect(JSON.parse(error?.details ?? "{}")).toEqual({ field: "reason" })
    }
    const { error } = await manager.rpc("set_standard_interview_discount", { amount: 50001, reason: "Too much" })
    expect(JSON.parse(error?.details ?? "{}")).toEqual({ field: "amount" })
  })
})

describe("an agent's own amount", () => {
  test("moves that agent's unpaid fees only, never a Paid one, and back to the standard with null", async () => {
    const agent = await approvedAgent()
    const other = await approvedAgent()
    const unpaid = await leadWithCode(agent.code)
    const paid = await leadWithCode(agent.code)
    const otherLead = await leadWithCode(other.code)
    expect(await payInterview(paid)).toBe(40000)
    const manager = await signedIn(MANAGER)

    expect(await getAgentDiscountImpact(manager, agent.id, 25000)).toEqual({
      ok: true,
      data: [expect.objectContaining({ leadId: unpaid, feeNow: 40000, feeAfter: 25000 })],
    })
    expect(await setAgentDiscount(manager, agent.id, 25000, "Top agent this term")).toEqual({ ok: true, data: { feeChangeCount: 1 } })

    const fees = await inRolledBackTransaction(async (sql) => ({
      unpaid: await expectedFee(sql, unpaid),
      paid: await expectedFee(sql, paid),
      other: await expectedFee(sql, otherLead),
    }))
    expect(fees).toEqual({ unpaid: 25000, paid: 25000, other: 40000 })
    expect(await lockedAmount(paid)).toBe(40000)

    // The estimate the Admission form shows follows the agent's own amount.
    const estimate = await secretClient().rpc("discount_code_estimate", { code: agent.code }).single()
    expect(estimate.data).toEqual({ state: "approved", amount: 25000 })

    // Switching off lists the families moving from the own amount to the full fee.
    const switchOff = await manager.rpc("agent_status_fee_impact", { agent_id: agent.id, kind: "switched_off" })
    expect(switchOff.data).toEqual([expect.objectContaining({ lead_id: unpaid, fee_now: 25000, fee_after: 50000 })])

    const listed = await listAgents(manager, { query: agent.code, page: 1 })
    expect(listed.ok && listed.data.agents.find((a) => a.id === agent.id)).toMatchObject({ interviewDiscount: 25000, discountAmount: 25000 })

    expect(await setAgentDiscount(manager, agent.id, 25000, "Same again")).toEqual({ ok: false, error: "no-change" })
    expect(await setAgentDiscount(manager, agent.id, null, "Back to the standard")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, unpaid))).toBe(40000)

    const history = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ kind: string; old_value: string | null; new_value: string | null; student_count: number }>(
        "select kind, old_value, new_value, student_count from public.discount_amount_changes where agent_id = $1 order by sequence",
        [agent.id],
      )
      return rows
    })
    expect(history).toEqual([
      { kind: "agent", old_value: null, new_value: "25000", student_count: 1 },
      { kind: "agent", old_value: "25000", new_value: null, student_count: 1 },
    ])
  })

  test("an own amount equal to the standard moves nobody", async () => {
    const agent = await approvedAgent()
    await leadWithCode(agent.code)
    expect(await setAgentDiscount(await signedIn(MANAGER), agent.id, 10000, "Pinned to today's standard")).toEqual({
      ok: true,
      data: { feeChangeCount: 0 },
    })
  })

  test("refuses a retired agent, an unknown one and a bad amount", async () => {
    const agent = await approvedAgent()
    const manager = await signedIn(MANAGER)
    const retired = await manager.rpc("change_marketing_agent_status", { agent_id: agent.id, kind: "retired", reason: "Left" })
    expect(retired.error).toBeNull()
    expect(await setAgentDiscount(manager, agent.id, 5000, "Too late")).toEqual({ ok: false, error: "retired" })
    expect(await getAgentDiscountImpact(manager, agent.id, 5000)).toEqual({ ok: false, error: "retired" })
    expect(await setAgentDiscount(manager, randomUUID(), 5000, "Nobody")).toEqual({ ok: false, error: "not-found" })
    expect(await setAgentDiscount(manager, agent.id, 1.5, "Half")).toEqual({ ok: false, error: "invalid-amount" })
  })

  test("Recreate keeps the agent's own amount on the new record", async () => {
    const agent = await approvedAgent()
    const manager = await signedIn(MANAGER)
    expect((await setAgentDiscount(manager, agent.id, 20000, "Special")).ok).toBe(true)
    const recreated = await manager.rpc("recreate_marketing_agent", {
      agent_id: agent.id,
      full_name: `Amina Punguzo Again ${randomUUID().slice(0, 6)}`,
      phone: discountPhone(),
      whatsapp: "",
      email: "",
      reason: "New phone",
    })
    expect(recreated.error).toBeNull()
    const newId = (recreated.data as { agent: { id: string } }).agent.id
    const amount = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ interview_discount: number | null }>("select interview_discount from public.marketing_agents where id = $1", [newId])
      return rows[0].interview_discount
    })
    expect(amount).toBe(20000)
  })

  test("the Super Admin may set amounts without holding the permission on a role", async () => {
    const agent = await approvedAgent()
    expect(await setAgentDiscount(await signedIn(SUPER_ADMIN), agent.id, 5000, "Owner's call")).toEqual({ ok: true, data: { feeChangeCount: 0 } })
  })
})

describe("discount_amount_changes", () => {
  test("is append-only and readable only by staff who may view leads", async () => {
    const nobody = await createThrowawayStaff([])
    const read = await (await signedIn(nobody)).from("discount_amount_changes").select("id").limit(1)
    expect(read.data).toEqual([])
    const outcome = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(
        "insert into public.discount_amount_changes (kind, old_value, new_value, student_count, lead_ids) values ('standard', '1', '2', 0, '{}')",
      )
      const update = await sql
        .query("savepoint a; update public.discount_amount_changes set reason = 'x'")
        .then(() => null, (error: Error) => error.message)
      await sql.query("rollback to savepoint a")
      const remove = await sql.query("delete from public.discount_amount_changes").then(() => null, (error: Error) => error.message)
      return { update, remove }
    })
    expect(outcome).toEqual({ update: "update_refused", remove: "delete_refused" })
  })
})
