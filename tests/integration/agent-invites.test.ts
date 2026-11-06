import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { confirmationOf } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
import {
  getAgentAccountCounts,
  getAgentInvites,
  sendAgentInvite,
  sendAgentInvites,
  reconcileAgentEmails,
  setAgentEmail,
  type AgentEmailReconciler,
  type AgentInviteSender,
  type AgentLogins,
  type AgentRepairConfirmer,
  type LoginEmailUpdater,
} from "@/lib/services/agent-invites"
import { listAgentsInAccountState } from "@/lib/services/agent-account-list"
import { agentLogins } from "@/utils/supabase/admin"
import { changeAgentStatus, createAgent } from "@/lib/services/marketing-agents"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER, SEEDED_AGENT } from "../support/fixtures"

// Invites, account states and email edits (#191) against local Supabase, with
// the email sender stubbed so nothing is mailed. Every agent here is the
// test's own, with invented names, numbers and example.test emails.

const REDIRECT = "http://localhost:3100/discount-code/set-password"

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

async function manager() {
  return signedIn(MANAGER)
}

async function approvedAgent(address: string | null): Promise<{ id: string; code: string; fullName: string }> {
  const fullName = `Neema Invite ${randomUUID().slice(0, 8)}`
  const created = await createAgent(await manager(), {
    fullName,
    phone: phone(),
    whatsapp: "",
    email: address ?? "",
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, code: created.data.agent.code, fullName }
}

// A sender that answers `error` and remembers what it was asked to send.
function stubSender(error: { message: string; status?: number; code?: string } | null = null) {
  return vi.fn<AgentInviteSender>(async () => ({ error }))
}

// The real sender's invite, through local Auth, so a login exists as it would.
const realSender: AgentInviteSender = async (address, redirectTo) => {
  const { error } = await secretClient().auth.admin.inviteUserByEmail(address, { redirectTo, data: { kind: "agent" } })
  return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
}

// The recorded outcome of each invite attempt, oldest first.
async function events(agentId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ result: string; error_code: string | null; email: string; created_by: string | null }>(
      `select result, error_code, email, created_by from public.agent_events
       where agent_id = $1 and kind = 'invite' and result <> 'started' order by created_at`,
      [agentId],
    )
    return rows
  })
}

// An invite to `address` that went out 25 hours ago, so its link has expired.
async function sentLongAgo(agentId: string, address: string) {
  await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      "insert into public.agent_events (agent_id, kind, result, email, created_at) values ($1, 'invite', 'started', $2, now() - interval '25 hours') returning id",
      [agentId, address],
    )
    await sql.query(
      "insert into public.agent_events (agent_id, kind, result, attempt_id, email, created_at) values ($1, 'invite', 'sent', $2, $3, now() - interval '25 hours')",
      [agentId, rows[0].id, address],
    )
  })
}

async function storedEmail(agentId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ email: string }>("select email from public.marketing_agents where id = $1", [agentId])
    return rows[0].email
  })
}

async function loginEmail(userId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ email: string }>("select email from auth.users where id = $1", [userId])
    return rows[0]?.email ?? null
  })
}

// An Approved agent who has joined: a login with a password, linked by email.
async function joinedAgent(label: string) {
  const address = email(label)
  const agent = await approvedAgent(address)
  const login = await secretClient().auth.admin.createUser({ email: address, password: "fixture-password", email_confirm: true })
  if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
  return { ...agent, address, userId: login.data.user.id }
}

// The secret key's Auth write, as utils/supabase/admin.ts makes it, marked
// with the event it carries out. Without writeId it is a plain move, as the
// agent's own change or a write from outside the app would be.
const realLoginUpdater = async (userId: string, value: string, writeId?: string) => {
  const { error } = await secretClient().auth.admin.updateUserById(userId, {
    email: value,
    email_confirm: true,
    ...(writeId ? { app_metadata: { agent_email_write: writeId } } : {}),
  })
  return { error: error ? { message: error.message } : null }
}

// The secret key's check before a put-back, as utils/supabase/admin.ts makes it.
const realRepairConfirmer: AgentRepairConfirmer = async (repairId) => {
  const { data, error } = await secretClient().rpc("confirm_agent_email_repair", { repair_id: repairId })
  return { data, error }
}

// The secret key's reconcile, as utils/supabase/admin.ts makes it.
const realReconciler: AgentEmailReconciler = async (agentId) => {
  const { data, error } = await secretClient().rpc("reconcile_agent_emails", { for_agent: agentId })
  return { data, error }
}

function logins(update: LoginEmailUpdater, reconcile: AgentEmailReconciler = realReconciler): AgentLogins {
  return { update, reconcile, confirmRepair: realRepairConfirmer }
}

const realLogins = logins(realLoginUpdater)

const reconcileDown: AgentEmailReconciler = async () => ({ data: null, error: { message: "fetch failed" } })

// The Manager's session, except that the named calls fail as if the
// database couldn't be reached.
async function managerWithout(...failing: string[]): Promise<SupabaseClient> {
  const client = await manager()
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "rpc") {
        return (name: string, args?: object) =>
          failing.includes(name)
            ? Promise.resolve({ data: null, error: { message: "TypeError: fetch failed", code: "" } })
            : target.rpc(name, args)
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

async function openEmailChanges(agentId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from public.agent_events e
       where e.agent_id = $1 and e.kind = 'email_change' and e.result in ('started', 'repair')
         and not exists (select 1 from public.agent_events c where c.attempt_id = e.id)`,
      [agentId],
    )
    return rows[0].n
  })
}

async function stateOf(client: SupabaseClient, agentId: string) {
  const invites = await getAgentInvites(client, [agentId])
  if (!invites.ok) throw new Error(invites.error)
  return invites.data.get(agentId)?.state ?? null
}

// Runs `work` in a rolled-back transaction as the signed-in `userId`, the way
// an RPC call from their session runs.
async function asUser<T>(userId: string, work: (sql: Client) => Promise<T>): Promise<T> {
  return inRolledBackTransaction(async (sql) => {
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })])
    await sql.query("set local role authenticated")
    return work(sql)
  })
}

async function userIdOf(staffId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
    return rows[0].user_id
  })
}

describe("sending an invite", () => {
  test("sends to the agent's email with the set-password link, and records it as sent by the Manager", async () => {
    const address = email("invite-sent")
    const agent = await approvedAgent(address)
    const send = stubSender()

    const result = await sendAgentInvite(await manager(), send, agent.id, REDIRECT)

    expect(result).toEqual({ ok: true, data: { email: address, resend: false } })
    expect(send).toHaveBeenCalledWith(address, REDIRECT)
    expect(await events(agent.id)).toEqual([{ result: "sent", error_code: null, email: address, created_by: MANAGER.id }])
  })

  test("nothing goes out when the email changed since the Manager saw it", async () => {
    const shown = email("shown")
    const agent = await approvedAgent(shown)
    expect((await setAgentEmail(await manager(), agent.id, email("changed"))).ok).toBe(true)
    const send = stubSender()

    const result = await sendAgentInvite(await manager(), send, agent.id, REDIRECT, { expectedEmail: shown })

    expect(result).toEqual({ ok: false, error: { kind: "email-changed" } })
    expect(send).not.toHaveBeenCalled()
    expect(await events(agent.id)).toEqual([])
  })

  test("a result is recorded only for an attempt the Manager started, and only once", async () => {
    const client = await manager()
    const unknown = await client.rpc("record_agent_invite", { attempt_id: randomUUID(), result: "sent", error_code: null })
    expect(unknown.error?.message).toBe("not_found")

    const address = email("record-once")
    const agent = await approvedAgent(address)
    const prepared = await client.rpc("prepare_agent_invite", { agent_id: agent.id, expected_email: null })
    const attemptId = (prepared.data as { attempt_id: string }[])[0].attempt_id
    expect((await client.rpc("record_agent_invite", { attempt_id: attemptId, result: "sent", error_code: null })).error).toBeNull()
    const again = await client.rpc("record_agent_invite", { attempt_id: attemptId, result: "smtp_error", error_code: null })
    expect(again.error?.message).toBe("already_recorded")

    const other = await signedIn(await createThrowawayStaff(["agents.approve", "leads.view"]))
    const second = await client.rpc("prepare_agent_invite", { agent_id: agent.id, expected_email: null })
    const secondId = (second.data as { attempt_id: string }[])[0].attempt_id
    const notTheirs = await other.rpc("record_agent_invite", { attempt_id: secondId, result: "sent", error_code: null })
    expect(notTheirs.error?.message).toBe("not_found")
    expect(await events(agent.id)).toEqual([{ result: "sent", error_code: null, email: address, created_by: MANAGER.id }])
  })

  test("a send still counts when the agent is switched off while it goes out, to the address it went to", async () => {
    const client = await manager()
    const address = email("off-mid-send")
    const agent = await approvedAgent(address)
    const send = vi.fn<AgentInviteSender>(async () => {
      expect((await changeAgentStatus(client, agent.id, "switch-off", "Switched off while the invite went out")).ok).toBe(true)
      return { error: null }
    })

    const result = await sendAgentInvite(client, send, agent.id, REDIRECT)

    expect(result).toEqual({ ok: true, data: { email: address, resend: false } })
    expect(await events(agent.id)).toEqual([{ result: "sent", error_code: null, email: address, created_by: MANAGER.id }])
    expect((await changeAgentStatus(client, agent.id, "switch-on", "Back on")).ok).toBe(true)
    expect(await stateOf(client, agent.id)).toBe("invited")
  })

  test("a used link whose password wasn't saved leaves the agent invited, and a resend starts a new login", async () => {
    const client = await manager()
    const address = email("unfinished")
    const agent = await approvedAgent(address)
    expect((await sendAgentInvite(client, realSender, agent.id, REDIRECT)).ok).toBe(true)
    // Using the link confirms the email; the password save then failed.
    const firstLogin = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ user_id: string }>("select user_id from public.marketing_agents where id = $1", [agent.id])
      await sql.query("update auth.users set email_confirmed_at = now() where id = $1", [rows[0].user_id])
      return rows[0].user_id
    })

    expect(await stateOf(client, agent.id)).toBe("invited")
    const resent = await sendAgentInvite(client, realSender, agent.id, REDIRECT)

    expect(resent).toEqual({ ok: true, data: { email: address, resend: true } })
    expect(await loginEmail(firstLogin)).toBeNull()
    const secondLogin = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string | null }>("select user_id from public.marketing_agents where id = $1", [agent.id])
      return rows[0].user_id
    })
    expect(secondLogin).not.toBeNull()
    expect(secondLogin).not.toBe(firstLogin)
    expect(await stateOf(client, agent.id)).toBe("invited")
  })

  test("a second invite is a resend", async () => {
    const agent = await approvedAgent(email("resend"))
    await sendAgentInvite(await manager(), stubSender(), agent.id, REDIRECT)

    const again = await sendAgentInvite(await manager(), stubSender(), agent.id, REDIRECT)

    expect(again).toMatchObject({ ok: true, data: { resend: true } })
  })

  test.each([
    ["rate-limited", { message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" }, "rate_limited", null],
    ["smtp-error", { message: "Error sending invite email", status: 500, code: "unexpected_failure" }, "smtp_error", null],
    ["rejected-address", { message: "Email address is invalid", status: 400, code: "email_address_invalid" }, "rejected_address", null],
    ["other-error", { message: "Something odd", status: 500, code: "weird_thing" }, "other_error", "weird_thing"],
  ] as const)("a failed send is reported as %s and recorded", async (error, failure, result, code) => {
    const agent = await approvedAgent(email("invite-fails"))

    const answer = await sendAgentInvite(await manager(), stubSender(failure), agent.id, REDIRECT)

    expect(answer).toMatchObject({ ok: false, error: { kind: error } })
    expect(await events(agent.id)).toMatchObject([{ result, error_code: code }])
    expect(await stateOf(await manager(), agent.id)).toBe("invite_not_sent")
  })

  test("refused, and nothing sent, for an agent who is Pending, switched off, retired, without email or already joined", async () => {
    const send = stubSender()
    const client = await manager()

    // Pending, in a rolled-back transaction, so no other test sees the Pending count move.
    const pending = asUser(await userIdOf(MANAGER.id), async (sql) => {
      await sql.query("reset role")
      await sql.query("select public.set_audit_actor('system')")
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.marketing_agents (full_name, phone, code, email) values ('Pending Invitee', $1, $2, $3) returning id",
        [`+2557${randomInt(10_000_000, 99_999_999)}`, `PND-${randomInt(1000, 9999)}`, email("pending")],
      )
      await sql.query("set local role authenticated")
      return sql.query("select * from public.prepare_agent_invite($1)", [rows[0].id])
    })
    await expect(pending).rejects.toThrow("not_approved")

    const off = await approvedAgent(email("switched-off"))
    const switched = await changeAgentStatus(client, off.id, "switch-off", "Testing invites")
    expect(switched.ok).toBe(true)
    expect(await sendAgentInvite(client, send, off.id, REDIRECT)).toMatchObject({ ok: false, error: { kind: "switched-off" } })

    const retired = await approvedAgent(email("retired"))
    expect((await changeAgentStatus(client, retired.id, "retire", "Testing invites")).ok).toBe(true)
    expect(await sendAgentInvite(client, send, retired.id, REDIRECT)).toMatchObject({ ok: false, error: { kind: "retired" } })

    const noEmail = await approvedAgent(null)
    expect(await sendAgentInvite(client, send, noEmail.id, REDIRECT)).toMatchObject({ ok: false, error: { kind: "no-email" } })

    expect(await sendAgentInvite(client, send, SEEDED_AGENT.id, REDIRECT)).toMatchObject({ ok: false, error: { kind: "already-joined" } })

    expect(send).not.toHaveBeenCalled()
  })

  test("refused for staff without agents.approve, and for the seeded agent", async () => {
    const agent = await approvedAgent(email("no-permission"))
    const send = stubSender()

    expect(await sendAgentInvite(await signedIn(ADMISSIONS), send, agent.id, REDIRECT)).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await sendAgentInvite(await signedIn(SEEDED_AGENT), send, agent.id, REDIRECT)).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(send).not.toHaveBeenCalled()
    expect(await events(agent.id)).toEqual([])
  })

  test("while agent access is off, the attempt is refused and recorded as access_off", async () => {
    const address = email("access-off")
    const agent = await approvedAgent(address)
    const managerUser = await userIdOf(MANAGER.id)

    const { answer, recorded } = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: managerUser, role: "authenticated" })])
      await sql.query("set local role authenticated")
      const answer = (await sql.query("select * from public.prepare_agent_invite($1)", [agent.id])).rows
      await sql.query("reset role")
      const recorded = (await sql.query("select result, email from public.agent_events where agent_id = $1", [agent.id])).rows
      return { answer, recorded }
    })

    expect(answer).toEqual([{ outcome: "access_off", email: address, resend: false, attempt_id: null }])
    expect(recorded).toEqual([{ result: "access_off", email: address }])
  })

  test("a batch stops at the first rate limit and leaves the rest unsent", async () => {
    const agents = [await approvedAgent(email("batch-1")), await approvedAgent(email("batch-2")), await approvedAgent(email("batch-3"))]
    let calls = 0
    const send = vi.fn<AgentInviteSender>(async () => {
      calls += 1
      return calls === 2 ? { error: { message: "Email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" } } : { error: null }
    })

    const results = await sendAgentInvites(await manager(), send, agents.map((agent) => agent.id), REDIRECT)

    expect(send).toHaveBeenCalledTimes(2)
    expect(results.map((r) => (r.result.ok ? "sent" : r.result.error.kind))).toEqual(["sent", "rate-limited"])
    expect(await events(agents[2].id)).toEqual([])
  })
})

describe("account state", () => {
  test("each state in its order of precedence", async () => {
    const client = await manager()

    const noEmail = await approvedAgent(null)
    expect(await stateOf(client, noEmail.id)).toBe("no_email")

    const notSent = await approvedAgent(email("not-sent"))
    expect(await stateOf(client, notSent.id)).toBe("invite_not_sent")

    const invited = await approvedAgent(email("invited"))
    await sendAgentInvite(client, stubSender(), invited.id, REDIRECT)
    expect(await stateOf(client, invited.id)).toBe("invited")

    const expiredAddress = email("expired")
    const expired = await approvedAgent(expiredAddress)
    await sentLongAgo(expired.id, expiredAddress)
    expect(await stateOf(client, expired.id)).toBe("invite_expired")

    expect(await stateOf(client, SEEDED_AGENT.id)).toBe("joined")

    const switchedOff = await approvedAgent(email("state-off"))
    await changeAgentStatus(client, switchedOff.id, "switch-off", "Testing states")
    expect(await stateOf(client, switchedOff.id)).toBe("switched_off")

    const retired = await approvedAgent(email("state-retired"))
    await changeAgentStatus(client, retired.id, "retire", "Testing states")
    expect(await stateOf(client, retired.id)).toBe("retired")
  })

  test("an invite to an earlier address doesn't count once the email changes", async () => {
    const client = await manager()
    const agent = await approvedAgent(email("before-change"))
    await sendAgentInvite(client, stubSender(), agent.id, REDIRECT)

    expect((await setAgentEmail(client, agent.id, email("after-change"))).ok).toBe(true)

    expect(await stateOf(client, agent.id)).toBe("invite_not_sent")
  })

  test("a Pending agent has no account state, and staff without leads.view and agents read none", async () => {
    const state = await asUser(await userIdOf(MANAGER.id), async (sql) => {
      await sql.query("reset role")
      await sql.query("select public.set_audit_actor('system')")
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.marketing_agents (full_name, phone, code, email) values ('Pending State', $1, $2, $3) returning id",
        [`+2557${randomInt(10_000_000, 99_999_999)}`, `PNS-${randomInt(1000, 9999)}`, email("pending-state")],
      )
      return (await sql.query("select public.account_state(a) as state from public.marketing_agents a where a.id = $1", [rows[0].id])).rows[0]
    })
    expect(state).toEqual({ state: null })

    const noView = await signedIn(await createThrowawayStaff([]))
    expect((await getAgentInvites(noView, [SEEDED_AGENT.id])).ok).toBe(false)
    const agentRead = await asUser(SEEDED_AGENT.userId, (sql) =>
      sql.query("select public.account_state(a) as state from public.marketing_agents a where a.id = $1", [SEEDED_AGENT.id]),
    )
    expect(agentRead.rows).toEqual([])
  })

  test("the counts include the named states", async () => {
    const agent = await approvedAgent(email("counted"))
    const counts = await getAgentAccountCounts(await manager())
    if (!counts.ok) throw new Error(counts.error)
    expect(counts.data.invite_not_sent).toBeGreaterThanOrEqual(1)
    expect(counts.data.joined).toBeGreaterThanOrEqual(1)
    expect(await stateOf(await manager(), agent.id)).toBe("invite_not_sent")
  })
})

describe("the Agents screen's account-state filters", () => {
  async function listed(state: "invite_not_sent" | "invite_expired", fullName: string) {
    const list = await listAgentsInAccountState(await manager(), state, { query: fullName, page: 1 })
    if (!list.ok) throw new Error(list.error)
    return list.data.agents.map((agent) => agent.fullName)
  }

  test("invite not sent and link expired each list only their agents", async () => {
    const notSent = await approvedAgent(email("filter-not-sent"))
    const invited = await approvedAgent(email("filter-invited"))
    await sendAgentInvite(await manager(), stubSender(), invited.id, REDIRECT)
    const expiredAddress = email("filter-expired")
    const expired = await approvedAgent(expiredAddress)
    await sentLongAgo(expired.id, expiredAddress)

    expect(await listed("invite_not_sent", notSent.fullName)).toEqual([notSent.fullName])
    expect(await listed("invite_not_sent", invited.fullName)).toEqual([])
    expect(await listed("invite_not_sent", expired.fullName)).toEqual([])
    expect(await listed("invite_expired", expired.fullName)).toEqual([expired.fullName])
    expect(await listed("invite_expired", notSent.fullName)).toEqual([])
  })

  test("an import's filter stays on: only that import's agents are listed", async () => {
    const stem = `Imani Filter ${randomUUID().slice(0, 8)}`
    const outside = await createAgent(await manager(), { fullName: `${stem} Outside`, phone: phone(), whatsapp: "", email: email("outside"), code: "" })
    expect(outside).toMatchObject({ ok: true, data: { kind: "created" } })
    const file = `agents-${randomUUID().slice(0, 8)}.csv`
    const bytes = new TextEncoder().encode(
      toCsv([
        ["Code", "Full name", "Mobile", "WhatsApp", "Email"],
        [`IFL-${randomInt(10_000, 100_000)}`, `${stem} Imported`, phone(), "", email("imported")],
      ]),
    )
    const checked = await checkAgentImportFile(await manager(), file, bytes)
    if (!checked.ok) throw new Error(JSON.stringify(checked.error))
    const done = await confirmAgentImport(await manager(), confirmationOf(checked.data))
    if (!done.ok || done.data.kind !== "imported") throw new Error(JSON.stringify(done))

    const list = await listAgentsInAccountState(await manager(), "invite_not_sent", {
      query: stem,
      page: 1,
      importBatchId: done.data.batchId,
    })

    expect(list).toMatchObject({ ok: true, data: { total: 1 } })
    expect(list.ok && list.data.agents.map((agent) => agent.fullName)).toEqual([`${stem} Imported`])
    const malformed = await listAgentsInAccountState(await manager(), "invite_not_sent", { query: stem, page: 1, importBatchId: "nope" })
    expect(malformed).toMatchObject({ ok: true, data: { total: 0 } })
  })

  test("staff without leads.view list nobody", async () => {
    const agent = await approvedAgent(email("filter-no-view"))
    const list = await listAgentsInAccountState(await signedIn(await createThrowawayStaff([])), "invite_not_sent", {
      query: agent.fullName,
      page: 1,
    })
    expect(list).toMatchObject({ ok: true, data: { total: 0, agents: [] } })
  })
})

describe("editing an agent's email", () => {
  test("a staff member's email can't be used for an agent", async () => {
    const agent = await approvedAgent(email("staff-clash"))

    const result = await setAgentEmail(await manager(), agent.id, ADMISSIONS.email)

    expect(result).toEqual({ ok: false, error: { kind: "email-taken", holder: "staff", name: ADMISSIONS.name, code: null } })
  })

  test("another current agent's email is refused, naming them", async () => {
    const holderAddress = email("held")
    const holder = await approvedAgent(holderAddress)
    const agent = await approvedAgent(null)

    const result = await setAgentEmail(await manager(), agent.id, holderAddress.toUpperCase())

    expect(result).toMatchObject({ ok: false, error: { kind: "email-taken", holder: "agent", code: holder.code } })
  })

  test("before joining, the unused login goes and the next invite goes to the new address", async () => {
    const client = await manager()
    const agent = await approvedAgent(email("first-address"))
    expect((await sendAgentInvite(client, realSender, agent.id, REDIRECT)).ok).toBe(true)
    const firstLogin = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string | null }>("select user_id from public.marketing_agents where id = $1", [agent.id])
      return rows[0].user_id
    })
    expect(firstLogin).not.toBeNull()

    const newAddress = email("second-address")
    const edited = await setAgentEmail(client, agent.id, newAddress)

    expect(edited).toEqual({ ok: true, data: { email: newAddress, previousEmail: expect.any(String), joined: false } })
    const after = await inRolledBackTransaction(async (sql) => {
      const login = await sql.query("select 1 from auth.users where id = $1", [firstLogin])
      const agentRow = await sql.query<{ email: string; user_id: string | null }>(
        "select email, user_id from public.marketing_agents where id = $1",
        [agent.id],
      )
      return { loginGone: login.rowCount === 0, ...agentRow.rows[0] }
    })
    expect(after).toEqual({ loginGone: true, email: newAddress, user_id: null })

    expect((await sendAgentInvite(client, realSender, agent.id, REDIRECT)).ok).toBe(true)
    expect(await stateOf(client, agent.id)).toBe("invited")
  })

  test("after joining, the Auth email changes too, already confirmed", async () => {
    const client = await manager()
    const address = email("joined-before")
    const agent = await approvedAgent(address)
    const login = await secretClient().auth.admin.createUser({ email: address, password: "fixture-password", email_confirm: true })
    expect(login.error).toBeNull()

    const newAddress = email("joined-after")
    const updateLoginEmail = vi.fn<LoginEmailUpdater>(realLoginUpdater)
    const edited = await setAgentEmail(client, agent.id, newAddress, logins(updateLoginEmail))

    expect(edited).toEqual({ ok: true, data: { email: newAddress, previousEmail: address, joined: true } })
    expect(updateLoginEmail).toHaveBeenCalledWith(login.data.user?.id, newAddress, expect.any(String))
    const user = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query("select email, email_confirmed_at is not null as confirmed from auth.users where id = $1", [
        login.data.user?.id,
      ])
      return rows[0]
    })
    expect(user).toEqual({ email: newAddress, confirmed: true })
    expect(await stateOf(client, agent.id)).toBe("joined")
  })

  test("after joining, a failed Auth change puts the old email back", async () => {
    const client = await manager()
    const address = email("revert-before")
    const agent = await approvedAgent(address)
    expect((await secretClient().auth.admin.createUser({ email: address, password: "fixture-password", email_confirm: true })).error).toBeNull()

    const edited = await setAgentEmail(client, agent.id, email("revert-after"), logins(async () => ({ error: { message: "down" } })))

    expect(edited).toEqual({ ok: false, error: { kind: "login-not-updated" } })
    const stored = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ email: string }>("select email from public.marketing_agents where id = $1", [agent.id])
      return rows[0].email
    })
    expect(stored).toBe(address)
  })

  test("refused for staff without agents.approve", async () => {
    const agent = await approvedAgent(null)
    expect(await setAgentEmail(await signedIn(ADMISSIONS), agent.id, email("nope"))).toEqual({ ok: false, error: { kind: "forbidden" } })
  })

  test("two saves for a joined agent take turns, so the stored and sign-in emails agree", async () => {
    const agent = await joinedAgent("turns-before")
    const first = email("turns-first")
    const second = email("turns-second")
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let reached!: () => void
    const firstAtAuth = new Promise<void>((resolve) => (reached = resolve))
    const slowUpdater = async (userId: string, value: string) => {
      reached()
      await held
      return realLoginUpdater(userId, value)
    }

    const firstSave = setAgentEmail(await manager(), agent.id, first, logins(slowUpdater))
    await firstAtAuth
    const secondSave = await setAgentEmail(await manager(), agent.id, second, realLogins)
    release()

    expect(secondSave).toEqual({ ok: false, error: { kind: "busy" } })
    expect(await firstSave).toEqual({ ok: true, data: { email: first, previousEmail: agent.address, joined: true } })
    expect(await storedEmail(agent.id)).toBe(first)
    expect(await loginEmail(agent.userId)).toBe(first)
  })

  test("a failed save closes only its own change, and the next save goes ahead", async () => {
    const agent = await joinedAgent("closes-before")

    const failed = await setAgentEmail(await manager(), agent.id, email("closes-failed"), logins(async () => ({ error: { message: "down" } })))
    expect(failed).toEqual({ ok: false, error: { kind: "login-not-updated" } })

    const next = email("closes-next")
    expect(await setAgentEmail(await manager(), agent.id, next, realLogins)).toMatchObject({ ok: true })
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await loginEmail(agent.userId)).toBe(next)
  })

  test("a change left behind for too long is taken over, and can't then finish", async () => {
    const agent = await joinedAgent("stale-before")
    const stale = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.agent_events (agent_id, kind, result, email, created_by, created_at) values ($1, 'email_change', 'started', $2, $3, now() - interval '10 minutes') returning id",
        [agent.id, email("stale-abandoned"), MANAGER.id],
      )
      return rows[0].id
    })

    const next = email("stale-next")
    expect(await setAgentEmail(await manager(), agent.id, next, realLogins)).toMatchObject({ ok: true })

    const late = await (await manager()).rpc("finish_agent_email_change", { change_id: stale })
    expect(late.error?.message).toBe("superseded")
    expect(await storedEmail(agent.id)).toBe(next)
  })

  test("an approver's own call can't change a joined agent's stored email without their sign-in email", async () => {
    const client = await manager()
    const agent = await joinedAgent("direct-before")

    const started = await client.rpc("set_marketing_agent_email", { agent_id: agent.id, email: email("direct-after") })
    expect(started.error).toBeNull()
    const changeId = (started.data as { change_id: string }[])[0].change_id
    expect(await storedEmail(agent.id)).toBe(agent.address)

    const finished = await client.rpc("finish_agent_email_change", { change_id: changeId })
    expect(finished.error?.message).toBe("login_mismatch")
    expect(await storedEmail(agent.id)).toBe(agent.address)
    expect(await loginEmail(agent.userId)).toBe(agent.address)
  })
})

// The sign-in (Auth) email is the source of truth for a joined agent. Each
// save, and each load of the Agents screen, reconciles the stored email to it.
describe("bringing a joined agent's stored email in line with their sign-in email", () => {
  test("a save whose Auth change worked but whose finish couldn't be stored is brought in line by the same save", async () => {
    const agent = await joinedAgent("finish-down-before")
    const next = email("finish-down-after")

    const saved = await setAgentEmail(await managerWithout("finish_agent_email_change"), agent.id, next, realLogins)

    expect(saved).toEqual({ ok: true, data: { email: next, previousEmail: agent.address, joined: true } })
    expect(await loginEmail(agent.userId)).toBe(next)
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await openEmailChanges(agent.id)).toBe(0)
  })

  test("when the database stays down for the rest of the save, the next reconcile brings it in line and the next save goes ahead", async () => {
    const agent = await joinedAgent("outage-before")
    const next = email("outage-after")

    const saved = await setAgentEmail(
      await managerWithout("finish_agent_email_change", "cancel_agent_email_change"),
      agent.id,
      next,
      logins(realLoginUpdater, async (agentId) => (agentId ? reconcileDown(agentId) : realReconciler(agentId))),
    )
    expect(saved).toEqual({ ok: false, error: { kind: "unavailable" } })
    expect(await loginEmail(agent.userId)).toBe(next)
    expect(await storedEmail(agent.id)).toBe(agent.address)

    // The Agents screen's load, once the database answers again.
    expect((await reconcileAgentEmails(realLogins)).ok).toBe(true)
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await openEmailChanges(agent.id)).toBe(0)

    const after = email("outage-next")
    expect(await setAgentEmail(await manager(), agent.id, after, realLogins)).toEqual({
      ok: true,
      data: { email: after, previousEmail: next, joined: true },
    })
    expect(await loginEmail(agent.userId)).toBe(after)
    expect(await storedEmail(agent.id)).toBe(after)
  })

  test("an Auth change that lands after a later change took over is put back to the later change's address", async () => {
    const agent = await joinedAgent("late-before")
    const late = email("late-a")
    const stale = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.agent_events (agent_id, kind, result, email, created_by, created_at) values ($1, 'email_change', 'started', $2, $3, now() - interval '10 minutes') returning id",
        [agent.id, late, MANAGER.id],
      )
      return rows[0].id
    })

    // B takes over the stale change A and finishes.
    const taken = email("late-b")
    expect(await setAgentEmail(await manager(), agent.id, taken, realLogins)).toMatchObject({ ok: true })
    expect(await storedEmail(agent.id)).toBe(taken)

    // A's delayed Auth write lands afterwards, and its finish is refused.
    expect((await realLoginUpdater(agent.userId, late, stale)).error).toBeNull()
    const finished = await (await manager()).rpc("finish_agent_email_change", { change_id: stale })
    expect(finished.error?.message).toBe("superseded")

    // A is older than B's save, so the next reconcile puts B back in Auth.
    const reconciled = await reconcileAgentEmails(realLogins, agent.id)
    expect(reconciled).toEqual({ ok: true, data: [{ agentId: agent.id, outcome: "put_back", email: taken }] })
    expect(await storedEmail(agent.id)).toBe(taken)
    expect(await loginEmail(agent.userId)).toBe(taken)
  })

  test("a put-back still on its way holds off a save, so it can't overwrite the saved address", async () => {
    const agent = await joinedAgent("repair-hold-before")
    const holderAddress = email("repair-hold-holder")
    await approvedAgent(holderAddress)
    expect((await realLoginUpdater(agent.userId, holderAddress)).error).toBeNull()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let reached!: () => void
    const repairAtAuth = new Promise<void>((resolve) => (reached = resolve))
    const slowUpdater: LoginEmailUpdater = async (userId, value, writeId) => {
      reached()
      await held
      return realLoginUpdater(userId, value, writeId)
    }

    const repair = reconcileAgentEmails(logins(slowUpdater), agent.id)
    await repairAtAuth
    // A second reconcile waits for the put-back rather than starting another.
    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "split", email: agent.address }],
    })
    const save = await setAgentEmail(await manager(), agent.id, email("repair-hold-next"), realLogins)
    release()

    expect(save).toEqual({ ok: false, error: { kind: "busy" } })
    expect(await repair).toEqual({ ok: true, data: [{ agentId: agent.id, outcome: "put_back", email: agent.address }] })
    expect(await storedEmail(agent.id)).toBe(agent.address)
    expect(await loginEmail(agent.userId)).toBe(agent.address)
    expect(await openEmailChanges(agent.id)).toBe(0)
  })

  test("a put-back that lands after a newer save is undone: the stored and sign-in emails end on the newer address", async () => {
    const agent = await joinedAgent("repair-late-before")
    const holderAddress = email("repair-late-holder")
    await approvedAgent(holderAddress)
    expect((await realLoginUpdater(agent.userId, holderAddress)).error).toBeNull()
    // A reconcile started putting the old address back, and its Auth write
    // was held up past the lease.
    const delayed = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.agent_events (agent_id, kind, result, email, created_at) values ($1, 'email_change', 'repair', $2, now() - interval '10 minutes') returning id",
        [agent.id, agent.address],
      )
      return rows[0].id
    })

    const next = email("repair-late-next")
    expect(await setAgentEmail(await manager(), agent.id, next, realLogins)).toEqual({
      ok: true,
      data: { email: next, previousEmail: agent.address, joined: true },
    })
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await loginEmail(agent.userId)).toBe(next)

    // The delayed put-back lands now.
    expect((await realLoginUpdater(agent.userId, agent.address, delayed)).error).toBeNull()

    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "put_back", email: next }],
    })
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await loginEmail(agent.userId)).toBe(next)
    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "in_line", email: next }],
    })
    expect(await openEmailChanges(agent.id)).toBe(0)
    // Nothing recorded the old address as the agent's again.
    const moves = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ result: string; email: string }>(
        "select result, email from public.agent_events where agent_id = $1 and result in ('changed', 'reconciled') order by created_at",
        [agent.id],
      )
      return rows
    })
    expect(moves).toEqual([{ result: "changed", email: next }])
  })

  test("a save that starts after a late Auth write first takes the address Auth holds", async () => {
    const agent = await joinedAgent("pre-before")
    const landed = email("pre-landed")
    expect((await realLoginUpdater(agent.userId, landed)).error).toBeNull()

    const next = email("pre-next")
    expect(await setAgentEmail(await manager(), agent.id, next, realLogins)).toEqual({
      ok: true,
      data: { email: next, previousEmail: landed, joined: true },
    })
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await loginEmail(agent.userId)).toBe(next)
  })

  test("a sign-in email another current agent now holds is put back to the stored one", async () => {
    const agent = await joinedAgent("taken-before")
    const holderAddress = email("taken-holder")
    await approvedAgent(holderAddress)
    expect((await realLoginUpdater(agent.userId, holderAddress)).error).toBeNull()

    const reconciled = await reconcileAgentEmails(realLogins, agent.id)

    expect(reconciled).toEqual({ ok: true, data: [{ agentId: agent.id, outcome: "put_back", email: agent.address }] })
    expect(await loginEmail(agent.userId)).toBe(agent.address)
    expect(await storedEmail(agent.id)).toBe(agent.address)
  })

  test("a change still within its lease is left to finish", async () => {
    const agent = await joinedAgent("lease-before")
    const started = await (await manager()).rpc("set_marketing_agent_email", { agent_id: agent.id, email: email("lease-after") })
    expect(started.error).toBeNull()

    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "in_line", email: agent.address }],
    })
    expect(await openEmailChanges(agent.id)).toBe(1)
  })

  test("only the secret key can reconcile or confirm a put-back: staff sessions, visitors and the seeded agent are refused", async () => {
    const agent = await joinedAgent("reconcile-denied")
    const asManager = await (await manager()).rpc("reconcile_agent_emails", { for_agent: agent.id })
    expect(asManager.error?.code).toBe("42501")
    await expect(
      asUser(SEEDED_AGENT.userId, (sql) => sql.query("select * from public.reconcile_agent_emails($1)", [agent.id])),
    ).rejects.toThrow(/permission denied/)
    const confirmAsManager = await (await manager()).rpc("confirm_agent_email_repair", { repair_id: randomUUID() })
    expect(confirmAsManager.error?.code).toBe("42501")
    await expect(
      asUser(SEEDED_AGENT.userId, (sql) => sql.query("select public.confirm_agent_email_repair($1)", [randomUUID()])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe("an agent changing their own sign-in email (owner decision, 2026-11-06)", () => {
  // The agent's own session asks Auth for the change, as Supabase's
  // updateUser does, then confirms it from both inboxes (the project asks for
  // both). The links' token hashes are read from Auth's table rather than
  // from the emails.
  async function changeOwnEmail(agent: { address: string; userId: string }, next: string) {
    const session = await signedIn({ email: agent.address, password: "fixture-password" })
    const asked = await session.auth.updateUser({ email: next })
    if (asked.error) return { session, error: asked.error }
    const tokens = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ token_hash: string }>(
        "select token_hash from auth.one_time_tokens where user_id = $1 and token_type::text like 'email_change_token_%'",
        [agent.userId],
      )
      return rows
    })
    for (const { token_hash } of tokens) {
      const confirmed = await session.auth.verifyOtp({ token_hash, type: "email_change" })
      if (confirmed.error) return { session, error: confirmed.error }
    }
    return { session, error: null }
  }

  async function emailEvents(agentId: string) {
    return inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{
        result: string
        email: string | null
        previous_email: string | null
        changed_by: string | null
        created_by: string | null
      }>(
        `select result, email, previous_email, changed_by, created_by from public.agent_events
         where agent_id = $1 and kind = 'email_change' and result in ('changed', 'reconciled') order by created_at`,
        [agentId],
      )
      return rows
    })
  }

  async function record(agentId: string) {
    return inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ code: string; full_name: string; phone: string; status: string; user_id: string }>(
        "select code, full_name, phone, status, user_id from public.marketing_agents where id = $1",
        [agentId],
      )
      return rows[0]
    })
  }

  test("the record follows the confirmed change, recorded with both emails as the agent's own, and the new email signs in", async () => {
    const agent = await joinedAgent("self-before")
    const before = await record(agent.id)
    const next = email("self-after")

    expect((await changeOwnEmail(agent, next)).error).toBeNull()
    expect(await loginEmail(agent.userId)).toBe(next)

    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "aligned", email: next }],
    })
    expect(await storedEmail(agent.id)).toBe(next)
    expect(await emailEvents(agent.id)).toEqual([
      { result: "reconciled", email: next, previous_email: agent.address, changed_by: "agent", created_by: null },
    ])
    // Identity stays: the code, name, phone, status and login are as they were.
    expect(await record(agent.id)).toEqual(before)

    const again = await signedIn({ email: next, password: "fixture-password" })
    const account = await again.rpc("current_agent_account").single<{ state: string; code: string }>()
    expect(account.data).toMatchObject({ state: "active", code: agent.code })
  })

  test("the Agents screen's load picks the change up too", async () => {
    const agent = await joinedAgent("self-load-before")
    const next = email("self-load-after")
    expect((await changeOwnEmail(agent, next)).error).toBeNull()

    expect((await reconcileAgentEmails(realLogins)).ok).toBe(true)

    expect(await storedEmail(agent.id)).toBe(next)
  })

  test("a Manager's change is still recorded as staff's, with both emails", async () => {
    const agent = await joinedAgent("staff-change-before")
    const next = email("staff-change-after")

    expect(await setAgentEmail(await manager(), agent.id, next, realLogins)).toMatchObject({ ok: true })

    expect(await emailEvents(agent.id)).toEqual([
      { result: "changed", email: next, previous_email: agent.address, changed_by: "staff", created_by: MANAGER.id },
    ])
  })

  test("a Manager's change whose Auth answer was lost, then landed, is recorded as staff's", async () => {
    const agent = await joinedAgent("lost-answer-before")
    const next = email("lost-answer-after")
    const lostAnswer: LoginEmailUpdater = async (userId, value, writeId) => {
      expect((await realLoginUpdater(userId, value, writeId)).error).toBeNull()
      return { error: { message: "fetch failed" } }
    }

    expect(await setAgentEmail(await manager(), agent.id, next, logins(lostAnswer))).toMatchObject({ ok: true })

    expect(await emailEvents(agent.id)).toEqual([
      { result: "reconciled", email: next, previous_email: agent.address, changed_by: "staff", created_by: MANAGER.id },
    ])
  })

  test("the app's secret-key client marks its Auth write with the change it carries out", async () => {
    const agent = await joinedAgent("marked-before")
    const next = email("marked-after")

    expect(await setAgentEmail(await manager(), agent.id, next, agentLogins())).toMatchObject({ ok: true })

    const marked = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ marker: string; change: string }>(
        `select u.raw_app_meta_data ->> 'agent_email_write' as marker, e.attempt_id as change
         from auth.users u, public.agent_events e
         where u.id = $1 and e.agent_id = $2 and e.result = 'changed'`,
        [agent.userId, agent.id],
      )
      return rows
    })
    expect(marked).toHaveLength(1)
    expect(marked[0].marker).toBe(marked[0].change)
  })

  test("a cancelled Manager's change doesn't make the agent's later change to that address the Manager's", async () => {
    const agent = await joinedAgent("cancelled-before")
    const next = email("cancelled-after")
    const failed = await setAgentEmail(await manager(), agent.id, next, logins(async () => ({ error: { message: "down" } })))
    expect(failed).toEqual({ ok: false, error: { kind: "login-not-updated" } })

    expect((await changeOwnEmail(agent, next)).error).toBeNull()
    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "aligned", email: next }],
    })

    expect(await emailEvents(agent.id)).toEqual([
      { result: "reconciled", email: next, previous_email: agent.address, changed_by: "agent", created_by: null },
    ])
  })

  test("a self-change to another agent's email is undone: the sign-in email goes back and nothing is recorded as changed", async () => {
    const agent = await joinedAgent("self-taken-before")
    const holderAddress = email("self-taken-holder")
    await approvedAgent(holderAddress)

    expect((await changeOwnEmail(agent, holderAddress)).error).toBeNull()
    expect(await reconcileAgentEmails(realLogins, agent.id)).toEqual({
      ok: true,
      data: [{ agentId: agent.id, outcome: "put_back", email: agent.address }],
    })

    expect(await loginEmail(agent.userId)).toBe(agent.address)
    expect(await storedEmail(agent.id)).toBe(agent.address)
    expect(await emailEvents(agent.id)).toEqual([])
  })

  test("a self-change to a staff member's email is refused by Auth and changes nothing", async () => {
    const agent = await joinedAgent("self-staff-before")

    const { error } = await changeOwnEmail(agent, MANAGER.email)

    expect(error).not.toBeNull()
    expect(await loginEmail(agent.userId)).toBe(agent.address)
    expect((await reconcileAgentEmails(realLogins, agent.id)).ok).toBe(true)
    expect(await storedEmail(agent.id)).toBe(agent.address)
    expect(await emailEvents(agent.id)).toEqual([])
  })

  test("the agent can't change their Discount code, name or email on the record, through the database or their login's details", async () => {
    const agent = await joinedAgent("self-identity")
    const before = await record(agent.id)
    const session = await signedIn({ email: agent.address, password: "fixture-password" })

    await expect(
      asUser(agent.userId, (sql) =>
        sql.query("update public.marketing_agents set code = 'HACK-1', full_name = 'Someone Else' where id = $1", [agent.id]),
      ),
    ).rejects.toThrow(/permission denied/)
    const viaApi = await session.from("marketing_agents").update({ code: "HACK-1" }).eq("id", agent.id).select()
    expect(viaApi.data ?? []).toEqual([])
    const viaRpc = await session.rpc("set_marketing_agent_email", { agent_id: agent.id, email: email("self-rpc") })
    expect(viaRpc.error?.message).toBe("not_permitted")

    // Details on the login are never read as the record.
    expect((await session.auth.updateUser({ data: { code: "HACK-1", full_name: "Someone Else" } })).error).toBeNull()
    expect((await reconcileAgentEmails(realLogins, agent.id)).ok).toBe(true)

    expect(await record(agent.id)).toEqual(before)
    expect(await storedEmail(agent.id)).toBe(agent.address)
  })
})

describe("the Agents screen's reconcile stays bounded", () => {
  test("without an agent it takes at most max_agents agents a call, and at least one", async () => {
    for (const label of ["bound-a", "bound-b", "bound-c"]) {
      const agent = await joinedAgent(label)
      expect((await realLoginUpdater(agent.userId, email(`${label}-moved`))).error).toBeNull()
    }

    const two = await secretClient().rpc("reconcile_agent_emails", { for_agent: null, max_agents: 2 })
    expect(two.error).toBeNull()
    expect(two.data).toHaveLength(2)

    const atLeastOne = await secretClient().rpc("reconcile_agent_emails", { for_agent: null, max_agents: 0 })
    expect(atLeastOne.error).toBeNull()
    expect(atLeastOne.data).toHaveLength(1)
  })
})

describe("the signed-in agent", () => {
  test("an agent reads their own account; staff read none", async () => {
    const own = await asUser(SEEDED_AGENT.userId, (sql) => sql.query("select * from public.current_agent_account()"))
    expect(own.rows).toEqual([{ state: "active", full_name: SEEDED_AGENT.name, code: SEEDED_AGENT.code }])

    const staff = await asUser(await userIdOf(MANAGER.id), (sql) => sql.query("select * from public.current_agent_account()"))
    expect(staff.rows).toEqual([])
  })

  test("switched off or access off gives the state and nothing else", async () => {
    const offState = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SEEDED_AGENT.userId, role: "authenticated" })])
      return (await sql.query("select * from public.current_agent_account()")).rows
    })
    expect(offState).toEqual([{ state: "access_off", full_name: null, code: null }])

    const switched = await inRolledBackTransaction(async (sql) => {
      await sql.query("select set_config('app.agent_status_change', $1, true)", [SEEDED_AGENT.id])
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.marketing_agents set switched_off_at = now() where id = $1", [SEEDED_AGENT.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SEEDED_AGENT.userId, role: "authenticated" })])
      return (await sql.query("select * from public.current_agent_account()")).rows
    })
    expect(switched).toEqual([{ state: "switched_off", full_name: null, code: null }])
  })
})
