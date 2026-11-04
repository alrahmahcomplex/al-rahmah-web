import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadInterviews, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { declineLead, markLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import {
  changeAgentStatus,
  getAgentFeeImpact,
  listAgents,
  registerAgent,
  type AgentStatusAction,
} from "@/lib/services/marketing-agents"
import { estimateDiscountCode, findReferralAgent, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { pendingAround, registerApprovedAgent } from "../support/agents"
import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Switching an agent off and on, and retiring them (#187), through the
// Manager's actions, against local Supabase. Every agent and lead is the
// test's own, with invented names and numbers.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

type Agent = { id: string; code: string; fullName: string; phone: string }

// An agent of the test's own. An Approved one is registered and approved in
// one transaction, so it is never Pending where another test counts.
async function newAgent({ approved = true, number = phone() } = {}): Promise<Agent> {
  const fullName = `Subira Status ${randomUUID().slice(0, 8)}`
  if (approved) {
    const { id, code } = await registerApprovedAgent(MANAGER, { fullName, phone: number })
    return { id, code, fullName, phone: number }
  }
  const registered = await registerAgent(secretClient(), { fullName, phone: number })
  if (!registered.ok) throw new Error(`could not register: ${JSON.stringify(registered.error)}`)
  const list = await listAgents(await signedIn(MANAGER), { query: registered.data.code, page: 1 })
  const row = list.ok ? list.data.agents.find((a) => a.code === registered.data.code) : undefined
  if (!row) throw new Error("could not find the new agent")
  return { id: row.id, code: row.code, fullName, phone: number }
}

// A Visited lead carrying `code`, registered for interview, its fee Not Paid.
async function registeredLead(code: string) {
  const student = `Pupil ${randomUUID().slice(0, 8)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Status Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: student, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { leadId: created.data.leadId, interviewId: registered.data.interviewId, student }
}

async function interviewFee(leadId: string) {
  const interviews = await getLeadInterviews(await signedIn(ADMISSIONS), leadId)
  if (!interviews.ok) throw new Error(`could not read the interviews: ${interviews.error}`)
  return { amount: interviews.data[0].amount, feeStatus: interviews.data[0].feeStatus }
}

async function change(agentId: string, action: AgentStatusAction, reason = `Test: ${action}`) {
  return changeAgentStatus(await signedIn(MANAGER), agentId, action, reason)
}

async function history(agentId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ kind: string; reason: string; changed_by: string | null; fee_change_count: number }>(
          "select kind, reason, changed_by, fee_change_count from public.agent_status_changes where agent_id = $1 order by changed_at, sequence",
          [agentId],
        )
      ).rows,
  )
}

describe("Seam 1: switching an agent off and on, and retiring them", () => {
  test("switch-off removes the discount from fees not yet Paid and keeps Paid amounts; switch-on restores it", async () => {
    const agent = await newAgent()
    const unpaid = await registeredLead(agent.code)
    const paid = await registeredLead(agent.code)
    const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), paid.interviewId, "paid")
    expect(marked).toMatchObject({ ok: true, data: { feeStatus: "Paid", lockedAmount: 40000 } })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })

    const off = await change(agent.id, "switch-off", "Left the school")
    expect(off).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 50000, feeStatus: "Not Paid" })
    expect(await interviewFee(paid.leadId)).toEqual({ amount: 40000, feeStatus: "Paid" })
    expect(await getLeadReferral(await signedIn(ADMISSIONS), unpaid.leadId)).toMatchObject({
      ok: true,
      data: { state: "switched_off", amount: 50000, discountApplied: false, switchedOffAt: expect.any(String) },
    })
    expect(await estimateDiscountCode(secretClient(), agent.code)).toEqual({ ok: true, data: { state: "switched_off", amount: 50000 } })
    expect(await findReferralAgent(await signedIn(ADMISSIONS), agent.code)).toEqual({
      ok: true,
      data: { code: agent.code, fullName: agent.fullName, state: "switched_off" },
    })

    const on = await change(agent.id, "switch-on", "Came back")
    expect(on).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
    expect(await interviewFee(paid.leadId)).toEqual({ amount: 40000, feeStatus: "Paid" })
    expect(await getLeadReferral(await signedIn(ADMISSIONS), unpaid.leadId)).toMatchObject({
      ok: true,
      data: { state: "approved", amount: 40000, switchedOffAt: null },
    })

    expect(await history(agent.id)).toEqual([
      { kind: "switched_off", reason: "Left the school", changed_by: MANAGER.id, fee_change_count: 1 },
      { kind: "switched_on", reason: "Came back", changed_by: MANAGER.id, fee_change_count: 1 },
    ])
  })

  test("retire frees the phone for a new agent, with a new code", async () => {
    const number = phone()
    const agent = await newAgent({ number })
    expect(await change(agent.id, "retire", "Wrong name on the record")).toEqual({ ok: true, data: { feeChangeCount: 0 } })

    const again = await registerAgent(secretClient(), { fullName: `${agent.fullName} Corrected`, phone: number })
    expect(again.ok).toBe(true)
    expect(again.ok && again.data.code).not.toBe(agent.code)
    expect(await findReferralAgent(await signedIn(ADMISSIONS), agent.code)).toEqual({ ok: true, data: null })
    // Retiring is permanent.
    expect(await change(agent.id, "switch-on")).toEqual({ ok: false, error: "retired" })
    expect(await change(agent.id, "retire")).toEqual({ ok: false, error: "retired" })
  })

  test("Admissions Staff and the Accountant are refused, and nothing changes", async () => {
    const agent = await newAgent()
    const lead = await registeredLead(agent.code)
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      for (const action of ["switch-off", "switch-on", "retire"] as const) {
        expect(await changeAgentStatus(await signedIn(person), agent.id, action, "Not mine to do")).toEqual({
          ok: false,
          error: "forbidden",
        })
      }
      expect(await getAgentFeeImpact(await signedIn(person), agent.id, "switch-off")).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await changeAgentStatus(anonClient(), agent.id, "switch-off", "Signed out")).toEqual({ ok: false, error: "forbidden" })
    expect(await history(agent.id)).toEqual([])
    expect(await interviewFee(lead.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
  })
})

describe("the Manager's status actions", () => {
  test("need a reason", async () => {
    const agent = await newAgent()
    for (const reason of ["", "   ", "x".repeat(501)]) {
      expect(await change(agent.id, "switch-off", reason)).toEqual({ ok: false, error: "invalid-reason" })
    }
    expect(await history(agent.id)).toEqual([])
  })

  test("refuse a change that changes nothing, and an unknown agent", async () => {
    const agent = await newAgent()
    expect(await change(agent.id, "switch-on")).toEqual({ ok: false, error: "no-change" })
    expect((await change(agent.id, "switch-off")).ok).toBe(true)
    expect(await change(agent.id, "switch-off")).toEqual({ ok: false, error: "no-change" })
    expect(await change(randomUUID(), "switch-off")).toEqual({ ok: false, error: "not-found" })
    expect(await change("not-an-id", "switch-off")).toEqual({ ok: false, error: "not-found" })
  })

  test("the fee impact lists the families not yet Paid whose fee changes, and the count matches what is recorded", async () => {
    const agent = await newAgent()
    const unpaid = await registeredLead(agent.code)
    const paid = await registeredLead(agent.code)
    expect((await setInterviewFeeStatus(await signedIn(ACCOUNTANT), paid.interviewId, "paid")).ok).toBe(true)

    const impact = await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "switch-off")
    expect(impact).toEqual({
      ok: true,
      data: {
        families: [
          expect.objectContaining({ leadId: unpaid.leadId, studentName: unpaid.student, contactName: "Status Parent", feeNow: 40000, feeAfter: 50000 }),
        ],
      },
    })
    // Switching on an agent who is on changes no fee.
    expect(await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "switch-on")).toEqual({ ok: true, data: { families: [] } })

    expect(await change(agent.id, "switch-off")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    // Retiring a switched-off agent changes no fee either.
    expect(await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "retire")).toEqual({ ok: true, data: { families: [] } })
    expect(await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "switch-on")).toMatchObject({
      ok: true,
      data: { families: [{ leadId: unpaid.leadId, feeNow: 50000, feeAfter: 40000 }] },
    })
  })

  test("closed leads whose fee is not yet Paid are listed and counted too", async () => {
    const agent = await newAgent()
    const inactive = await registeredLead(agent.code)
    const archived = await registeredLead(agent.code)
    const declined = await registeredLead(agent.code)
    expect(await markLead(await signedIn(MANAGER), inactive.leadId, { mark: "inactive", reason: "Family requested closure" })).toEqual({
      ok: true,
      data: null,
    })
    expect(await markLead(await signedIn(MANAGER), archived.leadId, { mark: "archived", reason: "Admission cycle ended" })).toEqual({
      ok: true,
      data: null,
    })
    expect(await declineLead(await signedIn(MANAGER), declined.leadId, { reason: "Fees or cost" })).toEqual({ ok: true, data: null })
    expect(await interviewFee(inactive.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })

    const impact = await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "switch-off")
    expect(impact.ok && impact.data.families.map((family) => family.leadId).sort()).toEqual(
      [inactive.leadId, archived.leadId, declined.leadId].sort(),
    )
    expect(impact.ok && impact.data.families.every((family) => family.feeNow === 40000 && family.feeAfter === 50000)).toBe(true)

    expect(await change(agent.id, "switch-off")).toEqual({ ok: true, data: { feeChangeCount: 3 } })
    for (const lead of [inactive, archived, declined]) {
      expect(await interviewFee(lead.leadId)).toEqual({ amount: 50000, feeStatus: "Not Paid" })
    }
    expect((await history(agent.id)).map((row) => row.fee_change_count)).toEqual([3])
  })

  test("recreating a switched-off agent counts the fees not yet Paid that get the discount back", async () => {
    const agent = await newAgent()
    const unpaid = await registeredLead(agent.code)
    expect((await change(agent.id, "switch-off")).ok).toBe(true)
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 50000, feeStatus: "Not Paid" })

    const replacement = randomUUID()
    await asSystem(async (sql) => {
      await sql.query("select public.record_agent_status_change($1, 'recreated', 'Wrong name', $2)", [agent.id, replacement])
      await sql.query(
        "insert into public.marketing_agents (id, full_name, phone, code, status, approved_at, approved_by) values ($1, $2, $3, $4, 'Approved', now(), $5)",
        [replacement, `${agent.fullName} Corrected`, `+255${phone().slice(1)}`, agent.code, MANAGER.id],
      )
    })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
    expect((await history(agent.id)).map((row) => [row.kind, row.fee_change_count])).toEqual([
      ["switched_off", 1],
      ["recreated", 1],
    ])
  })

  test("switching off a Pending agent changes no fee", async () => {
    const agent = await newAgent({ approved: false })
    await registeredLead(agent.code)
    expect(await getAgentFeeImpact(await signedIn(MANAGER), agent.id, "switch-off")).toEqual({ ok: true, data: { families: [] } })
    expect(await change(agent.id, "switch-off")).toEqual({ ok: true, data: { feeChangeCount: 0 } })
  })
})

describe("the Agents list", () => {
  test("hides retired records except under the Retired filter, which names who retired them and when", async () => {
    const agent = await newAgent({ approved: false })
    // The retired Pending agent no longer waits for approval. Counted in one
    // snapshot, with the retirement rolled back, so agents that other tests
    // register, approve or retire meanwhile don't move the numbers.
    const { before, after } = await pendingAround(MANAGER, (sql) =>
      sql.query("select public.record_agent_status_change($1, 'retired', 'Duplicate record')", [agent.id]),
    )
    expect(before - after).toBe(1)

    const manager = await signedIn(MANAGER)
    expect((await change(agent.id, "retire", "Duplicate record")).ok).toBe(true)

    for (const status of ["all", "Pending", "Approved"] as const) {
      const list = await listAgents(manager, { status, query: agent.code, page: 1 })
      expect(list.ok && list.data.agents.map((a) => a.id)).not.toContain(agent.id)
    }
    const retired = await listAgents(manager, { status: "Retired", query: agent.code, page: 1 })
    expect(retired.ok && retired.data.agents.find((a) => a.id === agent.id)).toMatchObject({
      retiredAt: expect.any(String),
      statusChange: { kind: "retired", changedBy: MANAGER.name, changedAt: expect.any(String), replacedBy: null },
    })
  })

  test("shows a switched-off agent with who switched them off", async () => {
    const agent = await newAgent()
    expect((await change(agent.id, "switch-off")).ok).toBe(true)
    const list = await listAgents(await signedIn(ADMISSIONS), { status: "all", query: agent.code, page: 1 })
    expect(list.ok && list.data.agents.find((a) => a.id === agent.id)).toMatchObject({
      status: "Approved",
      switchedOffAt: expect.any(String),
      retiredAt: null,
      statusChange: { kind: "switched_off", changedBy: MANAGER.name },
    })
  })
})

// A direct connection acting as `person`'s signed-in session, as the API
// would, for holding a transaction open while another one runs.
async function sessionOf(person: { id: string }): Promise<Client> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  // A deadlock or a lost wake-up fails the test instead of hanging it.
  await sql.query("set statement_timeout = '15s'")
  await sql.query("begin")
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [person.id])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  return sql
}

// Whether a promise is still waiting after a moment.
async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
  const waiting = Symbol("waiting")
  const first = await Promise.race([promise.then(() => null, () => null), new Promise((resolve) => setTimeout(() => resolve(waiting), 500))])
  return first === waiting
}

async function lockedAmount(interviewId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query<{ locked_amount: number | null }>("select locked_amount from public.interviews where id = $1", [interviewId])).rows[0]
        .locked_amount,
  )
}

describe("a payment and a status change at once", () => {
  test("a fee marked Paid during a switch-off waits for it, and is locked at the full fee the count promised", async () => {
    const agent = await newAgent()
    const lead = await registeredLead(agent.code)
    const manager = await sessionOf(MANAGER)
    const accountant = await sessionOf(ACCOUNTANT)
    try {
      const off = await manager.query<{ n: number }>("select public.change_marketing_agent_status($1, 'switched_off', 'Left the school') as n", [
        agent.id,
      ])
      expect(off.rows[0].n).toBe(1)

      const paying = accountant.query("select public.set_interview_fee_status($1, 'Paid')", [lead.interviewId])
      expect(await stillWaiting(paying)).toBe(true)
      await manager.query("commit")
      await paying
      await accountant.query("commit")
    } finally {
      await Promise.all([manager.end(), accountant.end()])
    }

    expect(await lockedAmount(lead.interviewId)).toBe(50000)
    expect((await history(agent.id)).map((row) => row.fee_change_count)).toEqual([1])
  })

  test("a switch-off during a payment waits for it, and doesn't count the fee just Paid", async () => {
    const agent = await newAgent()
    const lead = await registeredLead(agent.code)
    const accountant = await sessionOf(ACCOUNTANT)
    const manager = await sessionOf(MANAGER)
    try {
      await accountant.query("select public.set_interview_fee_status($1, 'Paid')", [lead.interviewId])

      const switching = manager.query<{ n: number }>("select public.change_marketing_agent_status($1, 'switched_off', 'Left the school') as n", [
        agent.id,
      ])
      expect(await stillWaiting(switching)).toBe(true)
      await accountant.query("commit")
      expect((await switching).rows[0].n).toBe(0)
      await manager.query("commit")
    } finally {
      await Promise.all([manager.end(), accountant.end()])
    }

    expect(await lockedAmount(lead.interviewId)).toBe(40000)
    expect((await history(agent.id)).map((row) => row.fee_change_count)).toEqual([0])
  })
})
