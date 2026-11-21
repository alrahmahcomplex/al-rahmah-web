import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  checkConfirmationNumber,
  createPhoneLogin,
  digestOf,
  sendConfirmationNumber,
  sendSelfConfirmInvite,
  startSelfConfirm,
} from "@/lib/services/agent-self-confirm"
import { createAgent } from "@/lib/services/marketing-agents"
import type { SmsSender } from "@/lib/services/sms"

import { anonClient, asSystem, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// Agent self-confirm by mobile (#503 slice 3) against local Supabase. Serial:
// these tests switch self-confirm on for the whole database, and back off.

const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }

async function setSelfConfirm(enabled: boolean) {
  await asSystem((sql) => sql.query("select public.set_agent_self_confirm($1)", [enabled]))
}

beforeAll(() => setSelfConfirm(true))
afterAll(() => setSelfConfirm(false))

function mobile() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

// An Approved agent on record with three names, as the Manager adds them.
async function agentOnRecord({ phone = mobile() as string | null, names = "Neema Simu Juma" } = {}) {
  const created = await createAgent(await signedIn(MANAGER), { fullName: names, phone: phone ?? mobile(), whatsapp: "", email: "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  const agent = created.data.agent
  if (phone === null) await asSystem((sql) => sql.query("update public.marketing_agents set phone = null where id = $1", [agent.id]))
  return { id: agent.id, code: agent.code, fullName: agent.fullName, phone: phone === null ? null : agent.phone }
}

// A sender that keeps the messages, so the test can read the number.
function keptSender() {
  const messages: string[] = []
  const send: SmsSender = async (_to, message) => {
    messages.push(message)
    return { ok: true, data: { requestId: `kept-${messages.length}` } }
  }
  return { send, lastDigits: () => /(\d{6})/.exec(messages.at(-1) ?? "")?.[1] ?? "" }
}

const words = (digits: string) => `Al-Rahmah Complex: namba yako ya kuthibitisha ni ${digits}.`

async function start(agent: { code: string; fullName: string }, browser: string, phone: string | null = null) {
  const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone, browser, ip: null })
  if (!started.ok) throw new Error("start failed")
  return started.data
}

describe("self-confirm by mobile", () => {
  test("code and names, a number to the mobile on record, then a phone login linked to the agent", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser, agent.phone)
    expect(started).toMatchObject({ kind: "ready", mobileOnRecord: true, typedMatches: true })
    if (started.kind !== "ready") return

    const sms = keptSender()
    const sent = await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    expect(sent).toEqual({ ok: true, data: { kind: "sent", phone: agent.phone, onRecord: true } })

    const wrong = sms.lastDigits() === "000000" ? "111111" : "000000"
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: wrong }, ENV)).toEqual({
      ok: true,
      data: { kind: "wrong", triesLeft: 4 },
    })
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "right", phone: agent.phone },
    })

    const login = await createPhoneLogin(secretClient(), { attempt: started.attempt, phone: agent.phone!, password: "self-confirm-password" }, 6)
    expect(login.ok).toBe(true)
    const linked = await asSystem(async (sql) => {
      const row = await sql.query<{ user_id: string; joined: boolean; state: string }>(
        `select m.user_id, public.agent_joined(m.user_id) as joined, a.state
         from public.marketing_agents m join public.agent_confirm_attempts a on a.agent_id = m.id and a.id = $2
         where m.id = $1`,
        [agent.id, started.attempt],
      )
      return row.rows[0]
    })
    expect(linked).toEqual({ user_id: login.ok ? login.data.userId : "", joined: true, state: "finished" })
  })

  test("only the database keeps the number's HMAC, never the number", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    const stored = await asSystem(async (sql) => (await sql.query<{ digest: string }>("select digest from public.agent_confirm_numbers where attempt_id = $1", [started.attempt])).rows)
    expect(stored).toHaveLength(1)
    expect(stored[0].digest).toMatch(/^[0-9a-f]{64}$/)
    expect(stored[0].digest).not.toContain(sms.lastDigits())
  })

  test("another browser can't use the attempt, and a new number waits 60 seconds", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser: randomUUID(), digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "expired" },
    })
    expect(await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)).toEqual({ ok: true, data: { kind: "too_soon" } })
  })

  test("five wrong numbers lock the number", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    const wrong = sms.lastDigits() === "000000" ? "111111" : "000000"
    const answers = []
    for (let i = 0; i < 5; i += 1) answers.push(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: wrong }, ENV))
    expect(answers.at(-1)).toEqual({ ok: true, data: { kind: "locked" } })
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "locked" },
    })
  })

  test("names that don't match say so, and five wrong tries lock the code for an hour", async () => {
    const agent = await agentOnRecord()
    for (let i = 0; i < 5; i += 1) {
      expect((await startSelfConfirm(secretClient(), { code: agent.code, names: "Zawadi Mwanaisha Kombo", phone: null, browser: randomUUID(), ip: null })).ok).toBe(true)
    }
    expect(await start(agent, randomUUID())).toEqual({ kind: "locked" })
  })

  test("a record with fewer than three names goes to today's claim path", async () => {
    const agent = await agentOnRecord({ names: "Neema Juma" })
    expect(await start(agent, randomUUID())).toEqual({ kind: "weak_names" })
  })

  test("a mobile that already signs in to another login is refused after the proof (E8)", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    // Another agent's login already holds the mobile on record.
    const address = `e8-${randomUUID().slice(0, 8)}@example.test`
    const other = await createAgent(await signedIn(MANAGER), { fullName: "Zawadi Kombo Ali", phone: mobile(), whatsapp: "", email: address, code: "" })
    if (!other.ok) throw new Error("could not create the other agent")
    const held = await secretClient().auth.admin.createUser({ email: address, phone: agent.phone!.slice(1), password: "fixture-password", email_confirm: true, phone_confirm: true })
    expect(held.error).toBeNull()
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "mobile_in_use" },
    })
  })
})

describe("phone-only logins", () => {
  test("a phone-only login without a matching proven attempt is refused", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    // An attempt that was started but never proven, then one that names nothing.
    for (const attempt of [started.attempt, randomUUID()]) {
      const made = await secretClient().auth.admin.createUser({
        phone: agent.phone!.slice(1),
        password: "self-confirm-password",
        phone_confirm: true,
        user_metadata: { self_confirm_attempt: attempt },
      })
      expect(made.error).not.toBeNull()
    }
    const plain = await secretClient().auth.admin.createUser({ phone: agent.phone!.slice(1), password: "self-confirm-password", phone_confirm: true })
    expect(plain.error).not.toBeNull()
    const linked = await asSystem(async (sql) => (await sql.query("select user_id from public.marketing_agents where id = $1", [agent.id])).rows[0])
    expect(linked).toEqual({ user_id: null })
  })

  test("a proven attempt's login can't be made for another mobile", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)
    const other = `+2557${String(randomInt(10_000_000, 100_000_000))}`
    expect(await createPhoneLogin(secretClient(), { attempt: started.attempt, phone: other, password: "self-confirm-password" }, 6)).toEqual({ ok: false, error: "not-proven" })
  })
})

describe("switched off", () => {
  test("every step answers off while self-confirm is off", async () => {
    const agent = await agentOnRecord()
    await setSelfConfirm(false)
    try {
      expect(await start(agent, randomUUID())).toEqual({ kind: "off" })
    } finally {
      await setSelfConfirm(true)
    }
    expect(digestOf("x")).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("email instead", () => {
  // Today's invite, as utils/supabase/admin sends it.
  const inviteSender = async (email: string, redirectTo: string) => {
    const { error } = await secretClient().auth.admin.inviteUserByEmail(email, { redirectTo, data: { kind: "agent" } })
    return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
  }
  const REDIRECT = "http://localhost:3100/discount-code/set-password"

  test("a record with no email stores the typed one and sends today's invite", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const address = `self-confirm-${randomUUID().slice(0, 8)}@example.test`
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: address }, REDIRECT)).toEqual({
      ok: true,
      data: { kind: "sent", email: address, stored: false },
    })
    const row = await asSystem(async (sql) => {
      const r = await sql.query<{ email: string; linked: boolean; results: string[] }>(
        `select m.email, m.user_id is not null as linked,
           array(select e.result from public.agent_events e where e.agent_id = m.id order by e.created_at) as results
         from public.marketing_agents m where m.id = $1`,
        [agent.id],
      )
      return r.rows[0]
    })
    expect(row).toEqual({ email: address, linked: true, results: ["started", "sent"] })
  })

  test("a stored email is kept and the typed one ignored", async () => {
    const stored = `stored-${randomUUID().slice(0, 8)}@example.test`
    const agent = await agentOnRecord()
    await asSystem((sql) => sql.query("update public.marketing_agents set email = $1 where id = $2", [stored, agent.id]))
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    expect(started.emailOnRecord).toBe(true)
    const sent = await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: "someone-else@example.test" }, REDIRECT)
    expect(sent).toEqual({ ok: true, data: { kind: "sent", email: stored, stored: true } })
  })

  test("an email someone else uses is refused, and nothing is stored", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: MANAGER.email }, REDIRECT)).toEqual({
      ok: true,
      data: { kind: "email_unusable" },
    })
    const email = await asSystem(async (sql) => (await sql.query("select email from public.marketing_agents where id = $1", [agent.id])).rows[0])
    expect(email).toEqual({ email: null })
  })

  test("an agent with an unused invite can still finish by mobile; the invite's login gives way", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const first = await start(agent, browser)
    if (first.kind !== "ready") throw new Error("not ready")
    const address = `unused-${randomUUID().slice(0, 8)}@example.test`
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: first.attempt, browser, email: address }, REDIRECT)

    const again = await start(agent, browser)
    if (again.kind !== "ready") throw new Error(`not ready: ${again.kind}`)
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: again.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: again.attempt, browser, digits: sms.lastDigits() }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: again.attempt, phone: agent.phone!, password: "self-confirm-password" }, 6)
    expect(login.ok).toBe(true)
    const after = await asSystem(async (sql) => {
      const r = await sql.query<{ linked_to_phone: boolean; invite_logins: number }>(
        `select m.user_id = $2 as linked_to_phone, (select count(*)::int from auth.users u where lower(u.email) = $3) as invite_logins
         from public.marketing_agents m where m.id = $1`,
        [agent.id, login.ok ? login.data.userId : null, address],
      )
      return r.rows[0]
    })
    expect(after).toEqual({ linked_to_phone: true, invite_logins: 0 })
  })
})

describe("the login marker", () => {
  // A finished self-confirm by mobile: the agent, their attempt and login.
  async function selfConfirmed() {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: started.attempt, phone: agent.phone!, password: "self-confirm-password" }, 6)
    if (!login.ok) throw new Error("no login")
    return { agent, attempt: started.attempt, userId: login.data.userId }
  }

  test("is cleared from the login once it is made", async () => {
    const done = await selfConfirmed()
    const marker = await asSystem(async (sql) => {
      const row = await sql.query<{ marker: string | null }>("select raw_user_meta_data ->> 'self_confirm_attempt' as marker from auth.users where id = $1", [done.userId])
      return row.rows[0].marker
    })
    expect(marker).toBeNull()
  })

  test("a signed-in agent who writes another attempt into their own user_metadata links nothing and changes nothing", async () => {
    const intruder = await selfConfirmed()
    // Another agent, whose attempt is proven but not finished.
    const other = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(other, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)

    const session = anonClient()
    const signed = await session.auth.signInWithPassword({ phone: intruder.agent.phone!.slice(1), password: "self-confirm-password", options: { captchaToken: TEST_CAPTCHA_TOKEN } })
    expect(signed.error).toBeNull()
    const rewrote = await session.auth.updateUser({ data: { self_confirm_attempt: started.attempt } })
    expect(rewrote.error).toBeNull()

    const after = await asSystem(async (sql) => {
      const row = await sql.query<{ other_user: string | null; intruder_user: string | null; other_state: string }>(
        `select (select user_id from public.marketing_agents where id = $1) as other_user,
                (select user_id from public.marketing_agents where id = $2) as intruder_user,
                (select state from public.agent_confirm_attempts where id = $3) as other_state`,
        [other.id, intruder.agent.id, started.attempt],
      )
      return row.rows[0]
    })
    expect(after).toEqual({ other_user: null, intruder_user: intruder.userId, other_state: "proven" })
  })
})
