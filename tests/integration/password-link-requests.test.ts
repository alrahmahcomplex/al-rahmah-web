import { createHash, randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAgentInvites, sendAgentInvite, type AgentInviteSender } from "@/lib/services/agent-invites"
import {
  decidePasswordLink,
  sendPasswordLink,
  type LinkDecision,
  type LinkLimits,
  type LinkSenders,
  type LinkToSend,
} from "@/lib/services/password-link-requests"
import { changeAgentStatus, createAgent } from "@/lib/services/marketing-agents"

import { anonClient, asSystem, inOneSnapshot, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { MANAGER, SEEDED_AGENT } from "../support/fixtures"

// Public password-link requests (#194, #265) against local Supabase: which
// agent or staff member gets a reset or a new invite, the per-email limit,
// the hourly budget and the access switch. Senders are stubbed unless a test
// needs a real login. Every agent is the test's own, with invented names and
// example.test emails.

// Limits high enough that tests running alongside never reach them.
const OPEN: LinkLimits = { perEmailLimit: 1_000, hourlyBudget: 1_000_000 }
const REDIRECTS = {
  agent: { reset: "http://localhost:3100/login/reset-password", invite: "http://localhost:3100/discount-code/set-password" },
  staff: { reset: "http://localhost:3100/login/reset-password", invite: "http://localhost:3100/auth/confirm" },
}

const refuse: AgentInviteSender = async () => {
  throw new Error("this sender should not be called")
}

// Agent senders, with staff senders that must not be called.
function agentSenders(reset: AgentInviteSender, invite: AgentInviteSender): LinkSenders {
  return { agent: { reset, invite }, staff: { reset: refuse, invite: refuse } }
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

function hashOf(address: string) {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex")
}

async function manager() {
  return signedIn(MANAGER)
}

async function approvedAgent(address: string) {
  const created = await createAgent(await manager(), {
    fullName: `Zawadi Link ${randomUUID().slice(0, 8)}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email: address,
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id }
}

// The real invite, through local Auth, so the agent has an unjoined login.
const realInvite: AgentInviteSender = async (address, redirectTo) => {
  const { error } = await secretClient().auth.admin.inviteUserByEmail(address, { redirectTo, data: { kind: "agent" } })
  return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
}

async function invitedAgent(label: string) {
  const address = email(label)
  const agent = await approvedAgent(address)
  const sent = await sendAgentInvite(await manager(), realInvite, agent.id, REDIRECTS.agent.invite)
  if (!sent.ok) throw new Error(`could not invite: ${JSON.stringify(sent)}`)
  return { ...agent, address }
}

// An Approved agent who has joined: a login with a password, linked by email.
async function joinedAgent(label: string) {
  const address = email(label)
  const agent = await approvedAgent(address)
  const login = await secretClient().auth.admin.createUser({ email: address, password: "fixture-password", email_confirm: true })
  if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
  return { ...agent, address }
}

async function decide(address: string, limits: LinkLimits = OPEN): Promise<LinkDecision> {
  const decided = await decidePasswordLink(secretClient(), address, limits)
  if (!decided.ok) throw new Error(decided.error)
  return decided.data
}

// The recorded attempts of `kind` for the agent, oldest first.
async function events(agentId: string, kind: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ result: string; email: string; created_by: string | null }>(
      "select result, email, created_by from public.agent_events where agent_id = $1 and kind = $2 order by created_at",
      [agentId, kind],
    )
    return rows
  })
}

// request_password_link inside `sql`'s transaction, as the secret key calls it.
async function requestInTransaction(sql: Client, address: string, perEmailLimit: number, hourlyBudget: number) {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
  const { rows } = await sql.query<{ outcome: string }>("select outcome from public.request_password_link($1, $2, $3)", [
    address,
    perEmailLimit,
    hourlyBudget,
  ])
  return rows[0].outcome
}

describe("who gets an email", () => {
  test("an active agent who has joined gets a reset to the reset page, recorded as sent", async () => {
    const agent = await joinedAgent("joined")
    const decided = await decide(`  ${agent.address.toUpperCase()} `)
    expect(decided).toEqual({ kind: "reset", principal: "agent", email: agent.address, attemptId: expect.any(String) })

    const reset = vi.fn<AgentInviteSender>(async () => ({ error: null }))
    const invite = vi.fn<AgentInviteSender>(async () => ({ error: null }))
    const sent = await sendPasswordLink(secretClient(), agentSenders(reset, invite), REDIRECTS, decided as LinkToSend)

    expect(sent).toEqual({ ok: true, data: null })
    expect(reset).toHaveBeenCalledWith(agent.address, REDIRECTS.agent.reset)
    expect(invite).not.toHaveBeenCalled()
    expect(await events(agent.id, "reset")).toEqual([
      { result: "started", email: agent.address, created_by: null },
      { result: "sent", email: agent.address, created_by: null },
    ])
  })

  test("a failed send is recorded with its reason", async () => {
    const agent = await joinedAgent("failed")
    const decided = (await decide(agent.address)) as LinkToSend
    const reset = vi.fn<AgentInviteSender>(async () => ({ error: { message: "Too many", status: 429, code: "over_email_send_rate_limit" } }))

    const sent = await sendPasswordLink(secretClient(), agentSenders(reset, reset), REDIRECTS, decided)

    expect(sent).toEqual({ ok: false, error: { kind: "rate-limited" } })
    expect((await events(agent.id, "reset")).map((e) => e.result)).toEqual(["started", "rate_limited"])
  })

  test("Tuma kiungo kipya: an agent invited but not joined gets a new invite through Auth, and stays invited", async () => {
    const agent = await invitedAgent("invited")
    const decided = await decide(agent.address)
    expect(decided).toEqual({ kind: "invite", principal: "agent", email: agent.address, attemptId: expect.any(String) })

    const reset = vi.fn<AgentInviteSender>(async () => ({ error: null }))
    const sent = await sendPasswordLink(secretClient(), agentSenders(reset, realInvite), REDIRECTS, decided as LinkToSend)

    expect(sent).toEqual({ ok: true, data: null })
    expect(reset).not.toHaveBeenCalled()
    const invites = await events(agent.id, "invite")
    // The Manager's invite, then the public one, with no staff member on it.
    expect(invites.map((e) => [e.result, e.created_by === null])).toEqual([
      ["started", false],
      ["sent", false],
      ["started", true],
      ["sent", true],
    ])
    const notes = await getAgentInvites(await manager(), [agent.id])
    expect(notes.ok && notes.data.get(agent.id)?.state).toBe("invited")
  })

  test("an agent whose used link left no password gets a new invite to a new login", async () => {
    const agent = await invitedAgent("unfinished")
    // Using the link confirmed the email; saving the password then failed.
    const firstLogin = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ user_id: string }>("select user_id from public.marketing_agents where id = $1", [agent.id])
      await sql.query("update auth.users set email_confirmed_at = now() where id = $1", [rows[0].user_id])
      return rows[0].user_id
    })

    const decided = await decide(agent.address)
    expect(decided.kind).toBe("invite")
    const sent = await sendPasswordLink(secretClient(), agentSenders(realInvite, realInvite), REDIRECTS, decided as LinkToSend)

    expect(sent).toEqual({ ok: true, data: null })
    const logins = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string | null }>("select user_id from public.marketing_agents where id = $1", [agent.id])
      const { rows: old } = await sql.query("select 1 from auth.users where id = $1", [firstLogin])
      return { now: rows[0].user_id, oldExists: old.length > 0 }
    })
    expect(logins.oldExists).toBe(false)
    expect(logins.now).not.toBeNull()
    expect(logins.now).not.toBe(firstLogin)
  })

  test("when a joined agent's Auth email is one still stored on an unjoined agent, the joined agent gets the reset", async () => {
    const joined = await joinedAgent("owner")
    // Stored on an Approved agent with no login yet: Auth holds the address nowhere else.
    const waiting = { address: email("stored") }
    await approvedAgent(waiting.address)
    // The joined agent changes their sign-in email in Auth to the other's address.
    await asSystem(async (sql) => {
      await sql.query(
        "update auth.users set email = $1 where id = (select user_id from public.marketing_agents where id = $2)",
        [waiting.address, joined.id],
      )
    })

    expect(await decide(waiting.address)).toEqual({ kind: "reset", principal: "agent", email: waiting.address, attemptId: expect.any(String) })
    expect(await events(joined.id, "reset")).toHaveLength(1)
  })

  test.each([
    ["an email nobody uses", async () => email("stranger")],
    ["an Approved agent never invited", async () => {
      const address = email("not-invited")
      await approvedAgent(address)
      return address
    }],
    ["a switched-off agent who has joined", async () => {
      const agent = await joinedAgent("switched-off")
      expect((await changeAgentStatus(await manager(), agent.id, "switch-off", "Testing resets")).ok).toBe(true)
      return agent.address
    }],
    ["a switched-off agent who was invited", async () => {
      const agent = await invitedAgent("off-invited")
      expect((await changeAgentStatus(await manager(), agent.id, "switch-off", "Testing resets")).ok).toBe(true)
      return agent.address
    }],
    ["a retired agent who had joined", async () => {
      const agent = await joinedAgent("retired")
      expect((await changeAgentStatus(await manager(), agent.id, "retire", "Testing resets")).ok).toBe(true)
      return agent.address
    }],
  ])("%s gets nothing, and the request still counts", async (_label, address) => {
    const typed = await address()
    expect(await decide(typed)).toEqual({ kind: "none" })
    const counted = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ n: number }>(
        "select count(*)::int as n from public.agent_link_requests where email_hash = $1",
        [hashOf(typed)],
      )
      return rows[0].n
    })
    expect(counted).toBeGreaterThanOrEqual(1)
  })

  // #265: staff resets work with agent access off, so an agent's email gets
  // the stranger's answer then; a separate one would say it isn't staff's.
  test("nothing goes out to an agent while agent access is off, and the request counts like any other", async () => {
    const agent = await joinedAgent("access-off")
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      expect(await requestInTransaction(sql, agent.address, 1_000, 1_000_000)).toBe("none")
      const { rows } = await sql.query("select 1 from public.agent_link_requests where email_hash = $1", [hashOf(agent.address)])
      expect(rows).toHaveLength(1)
      const { rows: started } = await sql.query("select 1 from public.agent_events where agent_id = $1 and kind = 'reset'", [agent.id])
      expect(started).toEqual([])
    })
  })
})

describe("the limits", () => {
  test("the per-email limit counts every request for the address in the hour, agent or not", async () => {
    const agent = await joinedAgent("per-email")
    const stranger = email("per-email-stranger")
    await inRolledBackTransaction(async (sql) => {
      // Two earlier requests each, outside Supabase's 60-second gap.
      for (const address of [agent.address, stranger]) {
        await sql.query(
          "insert into public.agent_link_requests (email_hash, requested_at) values ($1, now() - interval '5 minutes'), ($1, now() - interval '3 minutes')",
          [hashOf(address)],
        )
      }
      expect(await requestInTransaction(sql, agent.address, 3, 1_000_000)).toBe("reset")
    })
    await inRolledBackTransaction(async (sql) => {
      for (const address of [agent.address, stranger]) {
        await sql.query(
          "insert into public.agent_link_requests (email_hash, requested_at) values ($1, now() - interval '5 minutes'), ($1, now() - interval '3 minutes')",
          [hashOf(address)],
        )
      }
      expect(await requestInTransaction(sql, agent.address, 2, 1_000_000)).toBe("limited")
      expect(await requestInTransaction(sql, stranger.toUpperCase(), 2, 1_000_000)).toBe("limited")
    })
  })

  test("a repeat within 60 seconds gets the neutral reply and uses no allowance", async () => {
    const agent = await joinedAgent("repeat")
    expect((await decide(agent.address)).kind).toBe("reset")
    expect(await decide(agent.address)).toEqual({ kind: "none" })
    expect(await decide(agent.address.toUpperCase())).toEqual({ kind: "none" })

    const counted = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ n: number }>(
        "select count(*)::int as n from public.agent_link_requests where email_hash = $1",
        [hashOf(agent.address)],
      )
      return rows[0].n
    })
    expect(counted).toBe(1)
    expect(await events(agent.id, "reset")).toHaveLength(1)
  })

  test("the hourly budget counts every address's requests, and a refused request isn't counted", async () => {
    const agent = await joinedAgent("budget")
    // One snapshot, so requests from tests running alongside can't move the
    // count between the reads and the calls.
    await inOneSnapshot(async (sql) => {
      await sql.query("delete from public.agent_link_requests where requested_at < now() - interval '1 hour'")
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.agent_link_requests")
      const used = rows[0].n

      expect(await requestInTransaction(sql, agent.address, 1_000, used)).toBe("busy")
      expect(await requestInTransaction(sql, agent.address, 1_000, used + 1)).toBe("reset")
      expect(await requestInTransaction(sql, email("budget-stranger"), 1_000, used + 1)).toBe("busy")
      const after = await sql.query<{ n: number }>("select count(*)::int as n from public.agent_link_requests")
      expect(after.rows[0].n).toBe(used + 1)
    })
  })

  test("the counter keeps only an email hash and a time, and each write prunes rows older than an hour", async () => {
    const address = email("prune")
    await inRolledBackTransaction(async (sql) => {
      await sql.query("insert into public.agent_link_requests (email_hash, requested_at) values ($1, now() - interval '61 minutes')", [
        hashOf("old@example.test"),
      ])
      expect(await requestInTransaction(sql, address, 1_000, 1_000_000)).toBe("none")

      const { rows: old } = await sql.query("select 1 from public.agent_link_requests where email_hash = $1", [hashOf("old@example.test")])
      expect(old).toEqual([])
      const { rows: columns } = await sql.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'agent_link_requests' order by ordinal_position",
      )
      expect(columns.map((c) => c.column_name)).toEqual(["email_hash", "requested_at"])
      const { rows: mine } = await sql.query<{ email_hash: string }>(
        "select email_hash from public.agent_link_requests where email_hash = $1",
        [hashOf(address)],
      )
      expect(mine).toHaveLength(1)

      // Not audited, and a delete is allowed.
      const { rows: triggers } = await sql.query(
        "select 1 from pg_trigger where tgrelid = 'public.agent_link_requests'::regclass and not tgisinternal",
      )
      expect(triggers).toEqual([])
      await sql.query("delete from public.agent_link_requests where email_hash = $1", [hashOf(address)])
    })
  })
})

describe("who may call it", () => {
  test("only the secret key: a visitor and the seeded agent are refused", async () => {
    for (const client of [anonClient(), await signedIn(SEEDED_AGENT)]) {
      const requested = await client.rpc("request_password_link", { email: SEEDED_AGENT.email, per_email_limit: 1, hourly_budget: 1 })
      expect(requested.error?.code).toMatch(/42501|PGRST202/)
      const recorded = await client.rpc("record_agent_link", { attempt_id: randomUUID(), result: "sent", error_code: null })
      expect(recorded.error?.code).toMatch(/42501|PGRST202/)
      expect((await client.from("agent_link_requests").select()).error?.code).toBe("42501")
    }
  })

  test("record_agent_link closes only a public attempt, once", async () => {
    const agent = await joinedAgent("record")
    const decided = (await decide(agent.address)) as LinkToSend
    const client = secretClient()
    expect((await client.rpc("record_agent_link", { attempt_id: decided.attemptId, result: "sent", error_code: null })).error).toBeNull()
    const again = await client.rpc("record_agent_link", { attempt_id: decided.attemptId, result: "sent", error_code: null })
    expect(again.error?.message).toBe("already_recorded")
    const unknown = await client.rpc("record_agent_link", { attempt_id: randomUUID(), result: "sent", error_code: null })
    expect(unknown.error?.message).toBe("not_found")
  })
})
