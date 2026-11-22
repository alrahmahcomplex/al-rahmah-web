import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAgentSignIn, getSignInRemovals, removeAgentSignIn } from "@/lib/services/agent-sign-in-removal"
import { checkConfirmationNumber, createPhoneLogin, sendConfirmationNumber, sendSelfConfirmInvite, startSelfConfirm } from "@/lib/services/agent-self-confirm"
import { confirmationOf } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
import { createAgent } from "@/lib/services/marketing-agents"
import type { SmsSender } from "@/lib/services/sms"

import { anonClient, asSystem, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../../support/db"
import { ADMISSIONS, MANAGER } from "../../support/fixtures"

// Remove this sign-in (#503 slice 4a) against local Supabase. Serial: the
// email-closed tests switch self-confirm on for the whole database.

const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }
const PASSWORD = "remove-sign-in-password"

async function setSelfConfirm(enabled: boolean) {
  await asSystem((sql) => sql.query("select public.set_agent_self_confirm($1)", [enabled]))
}

beforeAll(() => setSelfConfirm(true))
afterAll(() => setSelfConfirm(false))

function mobile() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

async function agentOnRecord() {
  const created = await createAgent(await signedIn(MANAGER), { fullName: "Neema Simu Juma", phone: mobile(), whatsapp: "", email: "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, code: created.data.agent.code, fullName: created.data.agent.fullName, phone: created.data.agent.phone }
}

function keptSender() {
  const messages: string[] = []
  const send: SmsSender = async (_to, message) => {
    messages.push(message)
    return { ok: true, data: { requestId: `kept-${messages.length}` } }
  }
  return { send, lastDigits: () => /(\d{6})/.exec(messages.at(-1) ?? "")?.[1] ?? "" }
}

const words = (digits: string) => `Al-Rahmah Complex: namba yako ya kuthibitisha ni ${digits}.`

// An agent joined by mobile self-confirm, and a browser signed in as them.
async function joinedByMobile() {
  const agent = await agentOnRecord()
  const browser = randomUUID()
  const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser, ip: null })
  if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
  const sms = keptSender()
  await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.data.attempt, browser }, words, ENV)
  await checkConfirmationNumber(secretClient(), { attempt: started.data.attempt, browser, digits: sms.lastDigits() }, ENV)
  const login = await createPhoneLogin(secretClient(), { attempt: started.data.attempt, browser, phone: agent.phone, password: PASSWORD }, 6)
  if (!login.ok) throw new Error("no login")
  const session = anonClient()
  const signedInAgent = await session.auth.signInWithPassword({ phone: agent.phone.slice(1), password: PASSWORD, options: { captchaToken: TEST_CAPTCHA_TOKEN } })
  if (signedInAgent.error) throw new Error(signedInAgent.error.message)
  return { agent, userId: login.data.userId, session }
}

describe("Remove this sign-in", () => {
  test("signs the agent out everywhere: no login, not joined, and a token issued before reads nothing", async () => {
    const { agent, userId, session } = await joinedByMobile()
    const before = await session.rpc("current_agent_account").maybeSingle<{ state: string }>()
    expect(before.data?.state).toBe("active")

    const manager = await signedIn(MANAGER)
    expect(await getAgentSignIn(manager, agent.id)).toMatchObject({ ok: true, data: { login: userId, signedInWith: agent.phone, joinedAt: expect.any(String) } })
    expect(await removeAgentSignIn(manager, agent.id, true, userId)).toEqual({ ok: true, data: { signedInWith: agent.phone } })

    const after = await asSystem(async (sql) => {
      const r = await sql.query<{ user_id: string | null; logins: number; open_attempts: number; removals: number }>(
        `select m.user_id,
                (select count(*)::int from auth.users u where u.id = $2) as logins,
                (select count(*)::int from public.agent_confirm_attempts a where a.agent_id = m.id and a.state in ('matched', 'sent', 'proven')) as open_attempts,
                (select count(*)::int from public.agent_sign_in_removals r where r.agent_id = m.id) as removals
         from public.marketing_agents m where m.id = $1`,
        [agent.id, userId],
      )
      return r.rows[0]
    })
    expect(after).toEqual({ user_id: null, logins: 0, open_attempts: 0, removals: 1 })

    // The access token the agent held still verifies until it expires, but
    // the agent's reads find no agent behind it.
    const stale = await session.rpc("current_agent_account").maybeSingle<{ state: string }>()
    expect(stale.data).toBeNull()

    const notes = await getSignInRemovals(manager, [agent.id])
    expect(notes.ok && notes.data.get(agent.id)).toMatchObject({ removedBy: MANAGER.name, closeEmail: true })
    // A second removal finds nothing to remove.
    expect(await removeAgentSignIn(manager, agent.id, true, userId)).toEqual({ ok: false, error: "not-joined" })
  })

  test("a stale sheet removes nothing once the agent signs in with another login", async () => {
    const { agent, userId } = await joinedByMobile()
    const manager = await signedIn(MANAGER)
    expect(await removeAgentSignIn(manager, agent.id, false, randomUUID())).toEqual({ ok: false, error: "changed" })
    const kept = await asSystem(async (sql) => (await sql.query("select user_id from public.marketing_agents where id = $1", [agent.id])).rows[0])
    expect(kept).toEqual({ user_id: userId })
  })

  test("an email join's removal forgets the record's email, even after the login changed address, so the public new-link form can't invite it back", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const address = `intruder-${randomUUID().slice(0, 8)}@example.test`
    const invite = async (email: string, redirectTo: string) => {
      const { error } = await secretClient().auth.admin.inviteUserByEmail(email, { redirectTo, data: { kind: "agent" } })
      return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
    }
    await sendSelfConfirmInvite(
      secretClient(),
      invite,
      { attempt: started.data.attempt, browser, email: address, hourlyBudget: 1000 },
      "http://localhost:3100/discount-code/set-password",
    )
    const login = await asSystem(async (sql) => (await sql.query<{ user_id: string }>("select user_id from public.marketing_agents where id = $1", [agent.id])).rows[0].user_id)
    const joined = await secretClient().auth.admin.updateUserById(login, { password: PASSWORD, email_confirm: true })
    expect(joined.error).toBeNull()
    // Then they sign in with another email: the record still holds the first.
    const later = `later-${randomUUID().slice(0, 8)}@example.test`
    expect((await secretClient().auth.admin.updateUserById(login, { email: later, email_confirm: true })).error).toBeNull()

    expect(await removeAgentSignIn(await signedIn(MANAGER), agent.id, true, login)).toEqual({ ok: true, data: { signedInWith: later } })
    const record = await asSystem(async (sql) => (await sql.query("select email, user_id from public.marketing_agents where id = $1", [agent.id])).rows[0])
    expect(record).toEqual({ email: null, user_id: null })
    const asked = await secretClient().rpc("request_password_link", { email: address, per_email_limit: 5, hourly_budget: 1000 })
    expect(asked.error).toBeNull()
    expect((asked.data as { outcome: string }[])[0].outcome).toBe("none")
  })

  test("staff without agents.approve can't read or remove a sign-in", async () => {
    const { agent, userId } = await joinedByMobile()
    const staff = await signedIn(ADMISSIONS)
    expect(await getAgentSignIn(staff, agent.id)).toEqual({ ok: false, error: "forbidden" })
    expect(await removeAgentSignIn(staff, agent.id, true, userId)).toEqual({ ok: false, error: "forbidden" })
    const linked = await asSystem(async (sql) => (await sql.query("select user_id is not null as linked from public.marketing_agents where id = $1", [agent.id])).rows[0])
    expect(linked).toEqual({ linked: true })
  })

  test("an agent who never joined has no sign-in to remove", async () => {
    const agent = await agentOnRecord()
    expect(await removeAgentSignIn(await signedIn(MANAGER), agent.id, false, randomUUID())).toEqual({ ok: false, error: "not-joined" })
  })

  test("with the tick, email self-confirm is closed on the code; mobile stays open", async () => {
    const { agent, userId } = await joinedByMobile()
    await removeAgentSignIn(await signedIn(MANAGER), agent.id, true, userId)
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser, ip: null })
    expect(started).toMatchObject({ ok: true, data: { kind: "ready", canText: true, emailOpen: false } })
    if (!started.ok || started.data.kind !== "ready") return
    const invite = async (email: string, redirectTo: string) => {
      const { error } = await secretClient().auth.admin.inviteUserByEmail(email, { redirectTo })
      return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
    }
    expect(
      await sendSelfConfirmInvite(
        secretClient(),
        invite,
        { attempt: started.data.attempt, browser, email: `closed-${randomUUID().slice(0, 8)}@example.test`, hourlyBudget: 1000 },
        "http://localhost:3100/discount-code/set-password",
      ),
    ).toEqual({ ok: true, data: { kind: "email_closed" } })
    // The mobile on record still self-confirms, once the join's number is a minute old.
    await asSystem((sql) =>
      sql.query(
        "update public.agent_confirm_numbers n set created_at = n.created_at - interval '61 seconds' from public.agent_confirm_attempts a where a.id = n.attempt_id and a.agent_id = $1",
        [agent.id],
      ),
    )
    expect(await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: started.data.attempt, browser }, words, ENV)).toMatchObject({
      ok: true,
      data: { kind: "sent" },
    })
  })

  test("with the tick, a record with no mobile can't be retaken with a typed mobile either", async () => {
    // An imported record with no mobile, joined with a typed mobile.
    const letter = () => String.fromCharCode(65 + randomInt(0, 26))
    const code = `R${letter()}${letter()}-${randomInt(100, 1000)}`
    const manager = await signedIn(MANAGER)
    const rows = toCsv([["Code", "Full name", "Mobile", "WhatsApp", "Email"], [code, "Neema Simu Juma", "", "", ""]])
    const checked = await checkAgentImportFile(manager, `remove-${randomUUID().slice(0, 8)}.csv`, new TextEncoder().encode(rows))
    if (!checked.ok) throw new Error("import check failed")
    const done = await confirmAgentImport(manager, confirmationOf(checked.data))
    if (!done.ok || done.data.kind !== "imported") throw new Error("import failed")
    const agentId = await asSystem(async (sql) => (await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [code])).rows[0].id)
    const typed = `+2557${String(randomInt(10_000_000, 100_000_000))}`
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code, names: "Neema Simu Juma", phone: typed, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.data.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: started.data.attempt, browser, digits: sms.lastDigits() }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: started.data.attempt, browser, phone: typed, password: PASSWORD }, 6)
    if (!login.ok) throw new Error("no login")

    expect((await removeAgentSignIn(manager, agentId, true, login.data.userId)).ok).toBe(true)
    const again = await startSelfConfirm(secretClient(), { code, names: "Neema Simu Juma", phone: mobile(), browser: randomUUID(), ip: null })
    expect(again).toEqual({ ok: true, data: { kind: "email_closed" } })
  })

  test("without the tick, email self-confirm stays open", async () => {
    const { agent, userId } = await joinedByMobile()
    await removeAgentSignIn(await signedIn(MANAGER), agent.id, false, userId)
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser: randomUUID(), ip: null })
    expect(started).toMatchObject({ ok: true, data: { kind: "ready", emailOpen: true } })
  })
})
