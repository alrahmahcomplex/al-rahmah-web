import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { confirmationOf } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import { listAgentsInBatchOutcome } from "@/lib/services/agent-account-list"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
import {
  getInviteBatchReport,
  getInviteBudgetUsed,
  sendInviteBatch,
  type InviteBudgetConfig,
} from "@/lib/services/agent-invite-batches"
import type { AgentInviteSender } from "@/lib/services/agent-invites"
import { changeAgentStatus } from "@/lib/services/marketing-agents"

import { anonClient, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER, SEEDED_AGENT } from "../support/fixtures"

// Invite batches (#192) against local Supabase, with the email sender
// stubbed so nothing is mailed. Each test imports its own agents, with
// invented names, numbers and example.test emails, and limits its batch to
// that import, so parallel tests never send to each other's agents.

const REDIRECT = "http://localhost:3100/discount-code/set-password"
// A budget no test reaches, for tests that aren't about the budget.
const ROOMY: InviteBudgetConfig = { dailyCap: 1_000_000, staffReserve: 0 }
const RATE_LIMITED = { message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" }

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

async function manager() {
  return signedIn(MANAGER)
}

// Imports one Approved agent per entry, with that email or none, and answers
// the import's id and the agents in sheet order.
async function importAgents(emails: (string | null)[]) {
  const stem = `Batch ${randomUUID().slice(0, 8)}`
  const rows = emails.map((address, i) => ({
    code: `IBT-${randomInt(10_000, 100_000)}${i}`,
    fullName: `${stem} Agent ${i + 1}`,
    phone: phone(),
    email: address,
  }))
  const bytes = new TextEncoder().encode(
    toCsv([
      ["Code", "Full name", "Mobile", "WhatsApp", "Email"],
      ...rows.map((row) => [row.code, row.fullName, row.phone, "", row.email ?? ""]),
    ]),
  )
  const client = await manager()
  const checked = await checkAgentImportFile(client, `agents-${randomUUID().slice(0, 8)}.csv`, bytes)
  if (!checked.ok) throw new Error(JSON.stringify(checked.error))
  const done = await confirmAgentImport(client, confirmationOf(checked.data))
  if (!done.ok || done.data.kind !== "imported") throw new Error(JSON.stringify(done))
  const ids = await inRolledBackTransaction(async (sql) => {
    const { rows: found } = await sql.query<{ id: string; full_name: string }>(
      "select id, full_name from public.marketing_agents where import_batch_id = $1",
      [done.data.kind === "imported" ? done.data.batchId : null],
    )
    return new Map(found.map((row) => [row.full_name, row.id]))
  })
  return {
    importBatchId: done.data.batchId,
    agents: rows.map((row) => ({ id: ids.get(row.fullName)!, fullName: row.fullName, email: row.email })),
  }
}

// A sender that answers each call in turn from `answers` (null for sent),
// then sends, and remembers what it was asked to send.
function stubSender(answers: ({ message: string; status?: number; code?: string } | null)[] = []) {
  let call = 0
  return vi.fn<AgentInviteSender>(async () => ({ error: answers[call++] ?? null }))
}

// An invite to `address` sent `hoursAgo` hours ago.
async function sentAgo(agentId: string, address: string, hoursAgo: number) {
  await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      "insert into public.agent_events (agent_id, kind, result, email, created_at) values ($1, 'invite', 'started', $2, now() - make_interval(hours => $3)) returning id",
      [agentId, address, hoursAgo],
    )
    await sql.query(
      "insert into public.agent_events (agent_id, kind, result, attempt_id, email, created_at) values ($1, 'invite', 'sent', $2, $3, now() - make_interval(hours => $4))",
      [agentId, rows[0].id, address, hoursAgo],
    )
  })
}

async function report(batchId: string) {
  const read = await getInviteBatchReport(await manager(), { batchId })
  if (!read.ok || !read.data) throw new Error(JSON.stringify(read))
  return read.data
}

async function listed(batchId: string, outcome: "sent" | "waiting" | "no_email" | "failed") {
  const list = await listAgentsInBatchOutcome(await manager(), batchId, outcome, { page: 1 })
  if (!list.ok) throw new Error(list.error)
  return list.data.agents.map((agent) => agent.fullName).sort()
}

describe("an invite batch", () => {
  test("skips agents invited in the last 24 hours and those with no email, and reports the four counts", async () => {
    const { importBatchId, agents } = await importAgents([email("fresh"), email("recent"), email("expired"), null])
    const [fresh, recent, expired, noEmail] = agents
    await sentAgo(recent.id, recent.email!, 2)
    await sentAgo(expired.id, expired.email!, 25)
    const send = stubSender()

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "done" } })
    expect(send.mock.calls.map(([address]) => address).sort()).toEqual([expired.email, fresh.email].sort())
    const read = await report(batch.ok ? batch.data.batchId : "")
    expect(read).toMatchObject({
      counts: { sent: 2, waiting: 0, noEmail: 1, failed: 0 },
      waitingAtStart: 2,
      skippedRecent: 1,
      stopReason: "done",
      startedBy: MANAGER.name,
    })
    expect(read.finishedAt).not.toBeNull()
    const batchId = batch.ok ? batch.data.batchId : ""
    expect(await listed(batchId, "sent")).toEqual([expired.fullName, fresh.fullName].sort())
    expect(await listed(batchId, "no_email")).toEqual([noEmail.fullName])
    expect(await listed(batchId, "waiting")).toEqual([])
  })

  test("stops at the first rate limit: the rest wait and nothing more is tried", async () => {
    const { importBatchId, agents } = await importAgents([email("r1"), email("r2"), email("r3"), email("r4")])
    const send = stubSender([null, RATE_LIMITED])

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "hourly_limit" } })
    expect(send).toHaveBeenCalledTimes(2)
    const read = await report(batch.ok ? batch.data.batchId : "")
    expect(read.counts).toEqual({ sent: 1, waiting: 3, noEmail: 0, failed: 0 })
    expect(await listed(read.id, "waiting")).toHaveLength(3)
    expect(agents).toHaveLength(4)
  })

  test("a failed send is counted as failed, and the batch carries on", async () => {
    const { importBatchId, agents } = await importAgents([email("f1"), email("f2"), email("f3")])
    const send = stubSender([null, { message: "Error sending invite email", status: 500, code: "unexpected_failure" }, null])

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "done" } })
    const read = await report(batch.ok ? batch.data.batchId : "")
    expect(read.counts).toEqual({ sent: 2, waiting: 0, noEmail: 0, failed: 1 })
    const failedName = agents.find((agent) => agent.email === send.mock.calls[1][0])!.fullName
    expect(await listed(read.id, "failed")).toEqual([failedName])
  })

  test("sends no more than the batch limit; the rest wait for the next batch", async () => {
    const { importBatchId } = await importAgents([email("c1"), email("c2"), email("c3")])
    const send = stubSender()

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId, limit: 2 })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "batch_limit" } })
    expect(send).toHaveBeenCalledTimes(2)
    expect((await report(batch.ok ? batch.data.batchId : "")).counts).toEqual({ sent: 2, waiting: 1, noEmail: 0, failed: 0 })

    // The next batch skips the two just invited.
    const next = await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId, limit: 2 })
    expect(next).toMatchObject({ ok: true, data: { stopReason: "done" } })
    expect(send).toHaveBeenCalledTimes(3)
    expect(await report(next.ok ? next.data.batchId : "")).toMatchObject({ skippedRecent: 2, counts: { sent: 1, waiting: 0 } })
  })

  test("stops at the time limit before the next send", async () => {
    const { importBatchId } = await importAgents([email("t1"), email("t2"), email("t3")])
    let clock = 0
    const send = vi.fn<AgentInviteSender>(async () => {
      clock += 20_000
      return { error: null }
    })

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, {
      config: ROOMY,
      importBatchId,
      timeLimitMs: 30_000,
      now: () => clock,
    })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "time_limit" } })
    expect(send).toHaveBeenCalledTimes(2)
    expect((await report(batch.ok ? batch.data.batchId : "")).counts).toEqual({ sent: 2, waiting: 1, noEmail: 0, failed: 0 })
  })

  test("a batch cut off mid-send still reports correctly when read again", async () => {
    const { importBatchId } = await importAgents([email("k1"), email("k2"), email("k3")])
    let calls = 0
    // The host stops the function during the second send.
    const send = vi.fn<AgentInviteSender>(async () => {
      calls += 1
      if (calls === 2) throw new Error("function timed out")
      return { error: null }
    })

    await expect(sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId })).rejects.toThrow()

    const latest = await getInviteBatchReport(await manager(), { importBatchId })
    expect(latest).toMatchObject({
      ok: true,
      data: { finishedAt: null, stopReason: null, counts: { sent: 1, waiting: 2, noEmail: 0, failed: 0 } },
    })
  })
})

describe("a batch's lists", () => {
  test("show an agent switched off since the batch as switched off, with its note", async () => {
    const { importBatchId, agents } = await importAgents([email("s1"), email("s2")])
    const batch = await sendInviteBatch(await manager(), stubSender(), REDIRECT, { config: ROOMY, importBatchId })
    const batchId = batch.ok ? batch.data.batchId : ""
    expect((await changeAgentStatus(await manager(), agents[0].id, "switch-off", "Left the school")).ok).toBe(true)

    const list = await listAgentsInBatchOutcome(await manager(), batchId, "sent", { page: 1 })
    if (!list.ok) throw new Error(list.error)
    const off = list.data.agents.find((agent) => agent.id === agents[0].id)
    const on = list.data.agents.find((agent) => agent.id === agents[1].id)

    expect(off).toMatchObject({ retiredAt: null, statusChange: { kind: "switched_off", changedBy: MANAGER.name } })
    expect(off?.switchedOffAt).not.toBeNull()
    expect(on).toMatchObject({ switchedOffAt: null, retiredAt: null, statusChange: null })
  })
})

describe("the daily budget", () => {
  test("equals the daily cap less the staff reserve, less today's agent invite emails", async () => {
    const { importBatchId } = await importAgents([email("b1"), email("b2"), email("b3"), email("b4")])
    const used = await getInviteBudgetUsed(await manager())
    if (!used.ok) throw new Error(used.error)
    // Room for two more today, unless other tests send meanwhile.
    const config = { dailyCap: used.data + 20 + 2, staffReserve: 20 }
    const send = stubSender()

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config, importBatchId })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "daily_budget" } })
    const read = await report(batch.ok ? batch.data.batchId : "")
    const left = read.dailyCap - read.staffReserve - read.usedToday
    expect(left).toBeLessThanOrEqual(2)
    expect(read.usedToday).toBeGreaterThanOrEqual(used.data)
    expect(send).toHaveBeenCalledTimes(Math.max(left, 0))
    expect(read.counts).toEqual({ sent: Math.max(left, 0), waiting: 4 - Math.max(left, 0), noEmail: 0, failed: 0 })
  })

  test("counts today's agent invite emails from agent events, failures left out", async () => {
    const before = await getInviteBudgetUsed(await manager())
    const { importBatchId } = await importAgents([email("u1"), email("u2"), email("u3")])
    const send = stubSender([null, { message: "bad", code: "email_address_invalid" }, null])

    await sendInviteBatch(await manager(), send, REDIRECT, { config: ROOMY, importBatchId })

    const after = await getInviteBudgetUsed(await manager())
    if (!before.ok || !after.ok) throw new Error("unread")
    // Other tests may send meanwhile, so at least the two that went.
    expect(after.data - before.data).toBeGreaterThanOrEqual(2)
  })

  test("with nothing left today, nothing is sent", async () => {
    const { importBatchId } = await importAgents([email("z1")])
    const send = stubSender()

    const batch = await sendInviteBatch(await manager(), send, REDIRECT, { config: { dailyCap: 5, staffReserve: 10 }, importBatchId })

    expect(batch).toMatchObject({ ok: true, data: { stopReason: "daily_budget" } })
    expect(send).not.toHaveBeenCalled()
    expect((await report(batch.ok ? batch.data.batchId : "")).counts).toEqual({ sent: 0, waiting: 1, noEmail: 0, failed: 0 })
  })
})

describe("who may send a batch", () => {
  test("staff without agents.approve and agents are refused, and nothing is sent", async () => {
    const { importBatchId } = await importAgents([email("p1")])
    const send = stubSender()

    expect(await sendInviteBatch(await signedIn(ADMISSIONS), send, REDIRECT, { config: ROOMY, importBatchId })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await sendInviteBatch(await signedIn(SEEDED_AGENT), send, REDIRECT, { config: ROOMY, importBatchId })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(send).not.toHaveBeenCalled()
  })

  test("while agent access is off, the batch is refused before it starts", async () => {
    const { importBatchId } = await importAgents([email("off")])
    const managerUser = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])
      return rows[0].user_id
    })

    const refusal = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: managerUser, role: "authenticated" })])
      await sql.query("set local role authenticated")
      return sql
        .query("select * from public.start_agent_invite_batch($1, 100, 20, 30)", [importBatchId])
        .then(() => null, (error: Error) => error.message)
    })

    expect(refusal).toBe("access_off")
  })

  test("the report and its lists are refused to agents and to visitors", async () => {
    const { importBatchId } = await importAgents([email("v1")])
    const batch = await sendInviteBatch(await manager(), stubSender(), REDIRECT, { config: ROOMY, importBatchId })
    const batchId = batch.ok ? batch.data.batchId : ""

    expect(await getInviteBatchReport(await signedIn(SEEDED_AGENT), { batchId })).toEqual({ ok: false, error: "forbidden" })
    const agentList = await listAgentsInBatchOutcome(await signedIn(SEEDED_AGENT), batchId, "sent", { page: 1 })
    expect(agentList).toEqual({ ok: false, error: "unavailable" })
    expect(await getInviteBatchReport(anonClient(), { batchId })).toEqual({ ok: false, error: "forbidden" })
  })
})
