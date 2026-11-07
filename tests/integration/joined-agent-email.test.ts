import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { setAgentEmail } from "@/lib/services/agent-invites"
import { checkNewAgent, createAgent, getRecreatePreview, recreateAgent } from "@/lib/services/marketing-agents"

import { inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { MANAGER } from "../support/fixtures"

// A joined agent's email lives in Supabase Auth and only they change it
// (owner decision 41). Every check of who holds an email reads a joined
// agent's address from Auth, and an agent who hasn't joined by the stored
// email (#219). Invented names, numbers and example.test emails only.

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

function name() {
  return `Neema Moved ${randomUUID().slice(0, 8)}`
}

async function manager() {
  return signedIn(MANAGER)
}

async function createdAgent(address: string) {
  const created = await createAgent(await manager(), { fullName: name(), phone: phone(), whatsapp: "", email: address, code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return created.data.agent
}

// An agent who joined at `before`, then changed their sign-in email in Auth
// to `after`. The stored email stays `before`.
async function movedAgent(label: string) {
  const before = email(`${label}-a`)
  const after = email(`${label}-b`)
  const agent = await createdAgent(before)
  const login = await secretClient().auth.admin.createUser({ email: before, password: "fixture-password", email_confirm: true })
  if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
  const moved = await secretClient().auth.admin.updateUserById(login.data.user.id, { email: after, email_confirm: true })
  if (moved.error) throw new Error(`could not change the login's email: ${moved.error.message}`)
  return { ...agent, before, after, userId: login.data.user.id }
}

async function storedEmail(agentId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ email: string }>("select email from public.marketing_agents where id = $1", [agentId])
    return rows[0].email
  })
}

async function staffRoleId() {
  return inRolledBackTransaction(
    async (sql) => (await sql.query<{ id: string }>("select id from public.roles where name = 'Admissions Staff'")).rows[0].id,
  )
}

async function inviteStaff(address: string) {
  const administrator = await signedIn(MANAGER)
  return administrator.rpc("invite_staff_member", { full_name: "Staff Moved", email: address, role_id: await staffRoleId() })
}

async function importVerdict(address: string) {
  const { data, error } = await (await manager()).rpc("check_agent_import", {
    rows: [
      {
        sheet_row: 2,
        code: `QMV${randomInt(100_000, 1_000_000)}`,
        full_name: `Imported Agent ${randomInt(100_000, 1_000_000)}`,
        phone: `+2557${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`,
        whatsapp: null,
        email: address,
      },
    ],
  })
  if (error) throw new Error(error.message)
  return (data as { verdict: { verdict: string } }[])[0].verdict.verdict
}

describe("a joined agent who changed their email in Auth", () => {
  test("the address they left can be given to a staff member, and the one they moved to can't", async () => {
    const agent = await movedAgent("moved-staff")

    const refused = await inviteStaff(agent.after)
    expect(refused.error?.message).toBe("agent_email")
    expect(JSON.parse(refused.error?.details ?? "{}")).toEqual({ email: agent.after })

    expect((await inviteStaff(agent.before)).error).toBeNull()
    // Nothing is copied between the two stores.
    expect(await storedEmail(agent.id)).toBe(agent.before)
  })

  test("the address they left can be given to a new agent, and the one they moved to can't", async () => {
    const agent = await movedAgent("moved-agent")

    expect(await checkNewAgent(await manager(), { fullName: name(), phone: phone(), email: agent.after })).toEqual({
      ok: false,
      error: { kind: "email-taken" },
    })
    expect(await createAgent(await manager(), { fullName: name(), phone: phone(), email: agent.after })).toEqual({
      ok: false,
      error: { kind: "email-taken" },
    })
    expect(await importVerdict(agent.after)).toBe("email_taken")

    expect(await importVerdict(agent.before)).toBe("create")
    const check = await checkNewAgent(await manager(), { fullName: name(), phone: phone(), email: agent.before })
    expect(check.ok && check.data.kind).toBe("ready")
    const second = await createdAgent(agent.before)
    expect(await storedEmail(second.id)).toBe(agent.before)

    // Once the new agent holds it, the address is theirs again.
    expect((await inviteStaff(agent.before)).error?.message).toBe("agent_email")
    expect(await createAgent(await manager(), { fullName: name(), phone: phone(), email: agent.before })).toEqual({
      ok: false,
      error: { kind: "email-taken" },
    })
  })

  test("an agent who hasn't joined can be given the address they left, but not the one they moved to", async () => {
    const agent = await movedAgent("moved-edit")
    const other = await createdAgent(email("moved-edit-other"))

    expect(await setAgentEmail(await manager(), other.id, agent.after)).toMatchObject({ ok: false })
    const direct = await (await manager()).rpc("set_marketing_agent_email", { agent_id: other.id, email: agent.after })
    expect(direct.error?.message).toBe("email_taken")
    expect(JSON.parse(direct.error?.details ?? "{}")).toMatchObject({ email: agent.after, holder: "agent", code: agent.code })

    expect((await setAgentEmail(await manager(), other.id, agent.before)).ok).toBe(true)
    expect(await storedEmail(other.id)).toBe(agent.before)
  })

  test("Recreate offers the address they sign in with, and works after the one they left went to a new agent", async () => {
    const agent = await movedAgent("moved-recreate")
    await createdAgent(agent.before)

    const preview = await getRecreatePreview(await manager(), agent.id)
    if (!preview.ok) throw new Error(JSON.stringify(preview))
    expect(preview.data.agent.email).toBe(agent.after)

    const { fullName, phone, email } = preview.data.agent
    const done = await recreateAgent(await manager(), agent.id, { fullName, phone, email: email ?? "" }, "Name spelled wrong")
    expect(done.ok).toBe(true)
    // The new record keeps the login, which still signs in at the new address.
    await signedIn({ email: agent.after, password: "fixture-password" })
  })
})

describe("two current agents can't share a stored email", () => {
  test("a write straight to the table is refused, while a moved agent's old address is free", async () => {
    const taken = email("direct-taken")
    await createdAgent(taken)
    const agent = await movedAgent("direct-moved")

    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const insert = (address: string) =>
        sql.query("insert into public.marketing_agents (full_name, phone, email, code) values ($1, $2, $3, $4)", [
          name(),
          `+2557${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`,
          address,
          `QDX${randomInt(100_000, 1_000_000)}`,
        ])
      await insert(agent.before)
      await sql.query("savepoint second")
      await expect(insert(taken)).rejects.toThrow("email_taken")
      await sql.query("rollback to savepoint second")
      await expect(insert(agent.after)).rejects.toThrow("email_taken")
    })
  })
})

describe("an agent who hasn't joined", () => {
  test("holds their stored email, invited or not", async () => {
    const address = email("not-joined")
    await createdAgent(address)

    expect((await inviteStaff(address)).error?.message).toBe("agent_email")
    expect(await createAgent(await manager(), { fullName: name(), phone: phone(), email: address })).toEqual({
      ok: false,
      error: { kind: "email-taken" },
    })
    expect(await importVerdict(address)).toBe("email_taken")
  })

  test("an invited agent's unused login doesn't free their stored email, even if its address differs", async () => {
    const address = email("invited")
    const agent = await createdAgent(address)
    // The invite's login, its link not used yet.
    const login = await secretClient().auth.admin.inviteUserByEmail(address, { data: { kind: "agent" } })
    if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
    await secretClient().auth.admin.updateUserById(login.data.user.id, { email: email("invited-elsewhere"), email_confirm: true })

    expect((await inviteStaff(address)).error?.message).toBe("agent_email")
    expect(await createAgent(await manager(), { fullName: name(), phone: phone(), email: address })).toEqual({
      ok: false,
      error: { kind: "email-taken" },
    })
    expect(await storedEmail(agent.id)).toBe(address)
  })
})
