import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { setAgentEmail } from "@/lib/services/agent-invites"
import { checkNewAgent, createAgent, recreateAgent } from "@/lib/services/marketing-agents"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// An email already in use, said without naming anyone the caller can't see
// (#250). Inviting staff answers `email_in_use` with only the email for any
// holder outside the caller's managed set; the Agents screen names only
// another agent. Every refusal is checked on the raw RPC detail, which the
// caller can read, not only on what the screen shows.

function newEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function name() {
  return `Email Use ${randomUUID().slice(0, 8)}`
}

async function roleId(roleName: string): Promise<string> {
  const { rows } = await inRolledBackTransaction((sql) => sql.query<{ id: string }>("select id from public.roles where name = $1", [roleName]))
  return rows[0].id
}

// A current agent with `email`, created by the Manager.
async function agentWith(email: string) {
  const created = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: phone(), email })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return created.data.agent
}

// A login in Auth at an email no staff or agent record holds: a throwaway
// staff member's login, its Auth email since moved.
async function strayLogin(email: string) {
  const staff = await createThrowawayStaff([])
  await asSystem((sql) => sql.query("update auth.users set email = $1 where lower(email) = $2", [email, staff.email]))
}

async function auditRowsBy(staffId: string): Promise<number> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ n: number }>("select count(*)::int as n from public.audit_log where actor_staff_id = $1", [staffId]),
  )
  return rows[0].n
}

function detail(error: { details?: string | null } | null) {
  return JSON.parse(error?.details ?? "{}") as Record<string, unknown>
}

// A direct connection acting as `person`'s signed-in session, for holding an
// invite open while another runs.
async function sessionOf(person: { id: string }) {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  // A deadlock or a lost wake-up fails the test instead of hanging it.
  await sql.query("set statement_timeout = '15s'")
  await sql.query("begin")
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [person.id])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  return sql
}

async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
  const waiting = Symbol("waiting")
  const first = await Promise.race([promise.then(() => null, () => null), new Promise((resolve) => setTimeout(() => resolve(waiting), 500))])
  return first === waiting
}

describe("inviting staff to an email already in use", () => {
  test("staff outside the managed set, the Super Admin, an agent and another login all answer email_in_use with only the email", async () => {
    // An Admissions Manager of the test's own, so the audit count is theirs alone.
    const inviter = await createThrowawayStaff([], { onRole: await roleId("Admissions Manager") })
    const client = await signedIn(inviter)
    const into = await roleId("Admissions Staff")
    const agentEmail = newEmail("agent-held")
    await agentWith(agentEmail)
    const loginEmail = newEmail("stray-login")
    await strayLogin(loginEmail)
    const before = await auditRowsBy(inviter.id)

    for (const email of [ACCOUNTANT.email, SUPER_ADMIN.email, agentEmail, loginEmail]) {
      const { error } = await client.rpc("invite_staff_member", { full_name: "Someone Else", email: email.toUpperCase(), role_id: into })
      expect(error?.message, email).toBe("email_in_use")
      expect(detail(error), email).toEqual({ email })
    }
    expect(await auditRowsBy(inviter.id)).toBe(before)
  })

  test("an agent's email is in use to the Super Admin too, who manages every role", async () => {
    const agentEmail = newEmail("agent-super")
    await agentWith(agentEmail)
    const { error } = await (await signedIn(SUPER_ADMIN)).rpc("invite_staff_member", {
      full_name: "Someone Else",
      email: agentEmail,
      role_id: await roleId("Admissions Staff"),
    })
    expect(error?.message).toBe("email_in_use")
    expect(detail(error)).toEqual({ email: agentEmail })
  })

  test("staff inside the managed set still answer already_staff with their name and status", async () => {
    const client = await signedIn(MANAGER)
    const into = await roleId("Admissions Staff")
    for (const person of [
      { ...ADMISSIONS, active: true },
      { ...DEACTIVATED, active: false },
    ]) {
      const { error } = await client.rpc("invite_staff_member", { full_name: "Someone Else", email: person.email, role_id: into })
      expect(error?.message).toBe("already_staff")
      expect(detail(error)).toEqual({ email: person.email, name: person.name, active: person.active })
    }
  })

  // The loser of two invites at once meets the winner's row only at the
  // insert. The first invite holds the email's lock, so the second waits,
  // then finds the committed row through the unique index.
  test.each([
    { winnerRole: "Accountant", code: "email_in_use", names: false },
    { winnerRole: "Admissions Staff", code: "already_staff", names: true },
  ])("the concurrent path: a winner in $winnerRole leaves the Manager $code", async ({ winnerRole, code, names }) => {
    const email = newEmail("race")
    const [winnerRoleId, managerRoleId] = await Promise.all([roleId(winnerRole), roleId("Admissions Staff")])
    const winner = await sessionOf(SUPER_ADMIN)
    const loser = await sessionOf(MANAGER)
    try {
      await winner.query("select public.invite_staff_member('Race Winner', $1, $2)", [email, winnerRoleId])
      const losing = loser.query("select public.invite_staff_member('Race Loser', $1, $2)", [email, managerRoleId])
      expect(await stillWaiting(losing)).toBe(true)
      await winner.query("commit")
      const error = await losing.then(
        () => null,
        (e: { message: string; detail?: string }) => e,
      )
      expect(error?.message).toBe(code)
      expect(JSON.parse(error?.detail ?? "{}")).toEqual(names ? { email, name: "Race Winner", active: true } : { email })
    } finally {
      await Promise.all([winner.end(), loser.end()])
    }
  })
})

describe("the Agents screen and an email already in use", () => {
  test("setting an agent's email to staff's or the Super Admin's sends no name; another agent's names them", async () => {
    const client = await signedIn(MANAGER)
    const agent = await agentWith(newEmail("set-target"))
    const otherEmail = newEmail("set-other")
    const other = await agentWith(otherEmail)

    for (const email of [ADMISSIONS.email, ACCOUNTANT.email, SUPER_ADMIN.email]) {
      const { error } = await client.rpc("set_marketing_agent_email", { agent_id: agent.id, email })
      expect(error?.message, email).toBe("email_taken")
      expect(detail(error), email).toEqual({ email })
      expect(await setAgentEmail(client, agent.id, email)).toEqual({ ok: false, error: { kind: "email-taken", email, agent: null } })
    }

    const { error } = await client.rpc("set_marketing_agent_email", { agent_id: agent.id, email: otherEmail })
    expect(detail(error)).toEqual({ email: otherEmail, holder: "agent", name: other.fullName, code: other.code })
  })

  test("a caller with agents.approve but not leads.view, who can't read agents, isn't told the agent's name", async () => {
    const approver = await signedIn(await createThrowawayStaff(["agents.approve"]))
    const otherEmail = newEmail("unread-other")
    await agentWith(otherEmail)
    const target = await agentWith(newEmail("unread-target"))

    const set = await approver.rpc("set_marketing_agent_email", { agent_id: target.id, email: otherEmail })
    expect(set.error?.message).toBe("email_taken")
    expect(detail(set.error)).toEqual({ email: otherEmail })
    const checked = await approver.rpc("check_marketing_agent", { full_name: name(), phone: phone(), whatsapp: null, email: otherEmail, code: null })
    expect(checked.error?.message).toBe("email_taken")
    expect(detail(checked.error)).toEqual({ email: otherEmail })
  })

  test("Create agent names another agent holding the email, and says only in use for staff", async () => {
    const client = await signedIn(MANAGER)
    const otherEmail = newEmail("create-other")
    const other = await agentWith(otherEmail)
    const named = { kind: "email-taken", email: otherEmail, agent: { name: other.fullName, code: other.code } }

    expect(await checkNewAgent(client, { fullName: name(), phone: phone(), email: otherEmail })).toEqual({ ok: false, error: named })
    expect(await createAgent(client, { fullName: name(), phone: phone(), email: otherEmail.toUpperCase() })).toEqual({ ok: false, error: named })

    for (const email of [ACCOUNTANT.email, SUPER_ADMIN.email]) {
      const hidden = { ok: false, error: { kind: "email-taken", email, agent: null } }
      expect(await checkNewAgent(client, { fullName: name(), phone: phone(), email }), email).toEqual(hidden)
      expect(await createAgent(client, { fullName: name(), phone: phone(), email }), email).toEqual(hidden)
      const raw = await client.rpc("create_marketing_agent", { full_name: name(), phone: phone(), whatsapp: null, email, code: null })
      expect(detail(raw.error), email).toEqual({ email })
    }
  })

  test("Recreate agent does the same, and a refused Recreate changes nothing", async () => {
    const client = await signedIn(MANAGER)
    const agent = await agentWith(newEmail("recreate-target"))
    const otherEmail = newEmail("recreate-other")
    const other = await agentWith(otherEmail)
    const draft = (email: string) => ({ fullName: name(), phone: phone(), email })

    expect(await recreateAgent(client, agent.id, draft(otherEmail), "Wrong email")).toEqual({
      ok: false,
      error: { kind: "email-taken", email: otherEmail, agent: { name: other.fullName, code: other.code } },
    })
    expect(await recreateAgent(client, agent.id, draft(ADMISSIONS.email), "Wrong email")).toEqual({
      ok: false,
      error: { kind: "email-taken", email: ADMISSIONS.email, agent: null },
    })
    const raw = await client.rpc("recreate_marketing_agent", {
      agent_id: agent.id,
      full_name: name(),
      phone: phone(),
      whatsapp: null,
      email: SUPER_ADMIN.email,
      reason: "Wrong email",
    })
    expect(detail(raw.error)).toEqual({ email: SUPER_ADMIN.email })

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query(
        `select a.retired_at, (select count(*)::int from public.agent_status_changes c where c.agent_id = a.id) as changes
         from public.marketing_agents a where a.id = $1`,
        [agent.id],
      ),
    )
    expect(rows[0]).toEqual({ retired_at: null, changes: 0 })
  })
})
