import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getAgentAccountCounts,
  getAgentInvites,
  sendAgentInvite,
  sendAgentInvites,
  setAgentEmail,
  type AgentInviteSender,
} from "@/lib/services/agent-invites"
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

async function approvedAgent(address: string | null): Promise<{ id: string; code: string }> {
  const created = await createAgent(await manager(), {
    fullName: `Neema Invite ${randomUUID().slice(0, 8)}`,
    phone: phone(),
    whatsapp: "",
    email: address ?? "",
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, code: created.data.agent.code }
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

async function events(agentId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ result: string; error_code: string | null; email: string; created_by: string | null }>(
      "select result, error_code, email, created_by from public.agent_events where agent_id = $1 order by created_at",
      [agentId],
    )
    return rows
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

    expect(answer).toEqual([{ outcome: "access_off", email: address, resend: false }])
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
    await asSystem((sql) =>
      sql.query(
        "insert into public.agent_events (agent_id, kind, result, email, created_at) values ($1, 'invite', 'sent', $2, now() - interval '25 hours')",
        [expired.id, expiredAddress],
      ),
    )
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
    const updateLoginEmail = vi.fn(async (userId: string, value: string) => {
      const { error } = await secretClient().auth.admin.updateUserById(userId, { email: value, email_confirm: true })
      return { error: error ? { message: error.message } : null }
    })
    const edited = await setAgentEmail(client, agent.id, newAddress, updateLoginEmail)

    expect(edited).toEqual({ ok: true, data: { email: newAddress, previousEmail: address, joined: true } })
    expect(updateLoginEmail).toHaveBeenCalledWith(login.data.user?.id, newAddress)
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

    const edited = await setAgentEmail(client, agent.id, email("revert-after"), async () => ({ error: { message: "down" } }))

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
