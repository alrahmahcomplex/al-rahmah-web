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
import { confirmationOf } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
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
  if (phone === null) return importedWithoutMobile(names)
  const created = await createAgent(await signedIn(MANAGER), { fullName: names, phone: phone ?? mobile(), whatsapp: "", email: "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  const agent = created.data.agent
  return { id: agent.id, code: agent.code, fullName: agent.fullName, phone: phone === null ? null : agent.phone }
}

// An Approved agent imported by code and names alone, with no mobile.
async function importedWithoutMobile(names: string) {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  const code = `S${letter()}${letter()}-${randomInt(100, 1000)}`
  const file = `self-confirm-${randomUUID().slice(0, 8)}.csv`
  const rows = toCsv([["Code", "Full name", "Mobile", "WhatsApp", "Email"], [code, names, "", "", ""]])
  const manager = await signedIn(MANAGER)
  const checked = await checkAgentImportFile(manager, file, new TextEncoder().encode(rows))
  if (!checked.ok) throw new Error(`import check failed: ${JSON.stringify(checked.error)}`)
  const done = await confirmAgentImport(manager, confirmationOf(checked.data))
  if (!done.ok || done.data.kind !== "imported") throw new Error(`import failed: ${JSON.stringify(done)}`)
  const row = await asSystem(async (sql) => (await sql.query<{ id: string; code: string; full_name: string }>("select id, code, full_name from public.marketing_agents where import_batch_id = $1", [done.data.kind === "imported" ? done.data.batchId : ""])).rows[0])
  return { id: row.id, code: row.code, fullName: row.full_name, phone: null }
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
    expect(sent).toEqual({ ok: true, data: { kind: "sent", phone: agent.phone, onRecord: true, show: true } })

    const wrong = sms.lastDigits() === "000000" ? "111111" : "000000"
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: wrong }, ENV)).toEqual({
      ok: true,
      data: { kind: "wrong", triesLeft: 4 },
    })
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "right", phone: agent.phone },
    })

    const login = await createPhoneLogin(secretClient(), { attempt: started.attempt, browser, phone: agent.phone!, password: "self-confirm-password" }, 6)
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
    expect(await createPhoneLogin(secretClient(), { attempt: started.attempt, browser, phone: other, password: "self-confirm-password" }, 6)).toEqual({ ok: false, error: "not-proven" })
  })
})

describe("from the first reviews (#530)", () => {
  const inviteSender = async (email: string, redirectTo: string) => {
    const { error } = await secretClient().auth.admin.inviteUserByEmail(email, { redirectTo, data: { kind: "agent" } })
    return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
  }
  const REDIRECT = "http://localhost:3100/discount-code/set-password"

  async function proven(agent: Awaited<ReturnType<typeof agentOnRecord>>, browser: string, typed: string | null = null) {
    const started = await start(agent, browser, typed)
    if (started.kind !== "ready") throw new Error(`not ready: ${started.kind}`)
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)
    return started.attempt
  }

  test("starting again works after an untouched attempt and after a proven one", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    expect((await start(agent, browser)).kind).toBe("ready")
    expect((await start(agent, browser)).kind).toBe("ready")
    await proven(agent, randomUUID())
    expect((await start(agent, randomUUID())).kind).toBe("ready")
  })

  test("only the browser that proved the attempt can finish it", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const attempt = await proven(agent, browser)
    expect(await createPhoneLogin(secretClient(), { attempt, browser: randomUUID(), phone: agent.phone!, password: "self-confirm-password" }, 6)).toEqual({
      ok: false,
      error: "not-proven",
    })
    expect((await createPhoneLogin(secretClient(), { attempt, browser, phone: agent.phone!, password: "self-confirm-password" }, 6)).ok).toBe(true)
  })

  test("a proof for a typed mobile finishes nothing once the record has another one", async () => {
    // A record with no mobile proves the typed one; then a Manager puts
    // another mobile on the record (approving a claim does that).
    const agent = await agentOnRecord({ phone: null })
    const typed = `+2557${String(randomInt(10_000_000, 100_000_000))}`
    const browser = randomUUID()
    const attempt = await proven(agent, browser, typed)
    await asSystem(async (sql) => {
      // As decide_agent_email_claim fills an empty mobile.
      await sql.query("select set_config('app.agent_fill_mobile', $1, true)", [agent.id])
      await sql.query("update public.marketing_agents set phone = $1 where id = $2", [`+2557${String(randomInt(10_000_000, 100_000_000))}`, agent.id])
    })
    expect(await createPhoneLogin(secretClient(), { attempt, browser, phone: typed, password: "self-confirm-password" }, 6)).toEqual({
      ok: false,
      error: "not-proven",
    })
  })

  test("a record with weak names goes to the claim path whatever names are typed", async () => {
    const agent = await agentOnRecord({ names: "J Ali Omari" })
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: "Juma Ali Omari", phone: null, browser: randomUUID(), ip: null })
    expect(started).toEqual({ ok: true, data: { kind: "weak_names" } })
  })

  test("an email link counts against the same 5 a day as the numbers, and a restart waits out the 60 seconds", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const first = await start(agent, browser)
    if (first.kind !== "ready") throw new Error("not ready")
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: first.attempt, browser, email: `limit-${randomUUID().slice(0, 8)}@example.test`, hourlyBudget: 1000 }, REDIRECT)
    const outcomes: string[] = []
    for (let i = 0; i < 5; i++) {
      // A fresh browser each time: the set-ups per browser are 3 a day.
      const fresh = randomUUID()
      const again = await start(agent, fresh)
      if (again.kind !== "ready") throw new Error("not ready")
      const sent = await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: again.attempt, browser: fresh }, words, ENV)
      outcomes.push(sent.ok ? sent.data.kind : sent.error)
      // Moves the sends back past the 60 seconds and the mobile's hour.
      await asSystem(async (sql) => {
        await sql.query(
          "update public.agent_confirm_numbers n set created_at = n.created_at - interval '61 minutes' from public.agent_confirm_attempts a where a.id = n.attempt_id and a.agent_id = $1",
          [agent.id],
        )
        await sql.query("update public.sms_sends set created_at = created_at - interval '61 minutes' where to_phone = $1", [agent.phone])
      })
    }
    expect(outcomes).toEqual(["sent", "sent", "sent", "sent", "code_limited"])

    const other = await agentOnRecord()
    const b = randomUUID()
    const one = await start(other, b)
    if (one.kind !== "ready") throw new Error("not ready")
    await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: one.attempt, browser: b }, words, ENV)
    const two = await start(other, b)
    if (two.kind !== "ready") throw new Error("not ready")
    expect(await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: two.attempt, browser: b }, words, ENV)).toEqual({ ok: true, data: { kind: "too_soon" } })
  })

  test("a mistyped email put on the record by self-confirm can be corrected; one staff entered can't", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const first = await start(agent, browser)
    if (first.kind !== "ready") throw new Error("not ready")
    const typo = `typo-${randomUUID().slice(0, 8)}@example.test`
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: first.attempt, browser, email: typo, hourlyBudget: 1000 }, REDIRECT)
    const again = await start(agent, browser)
    if (again.kind !== "ready") throw new Error("not ready")
    const right = `right-${randomUUID().slice(0, 8)}@example.test`
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: again.attempt, browser, email: right, hourlyBudget: 1000 }, REDIRECT)).toEqual({
      ok: true,
      data: { kind: "sent", email: right, stored: false },
    })
    const after = await asSystem(async (sql) => {
      const r = await sql.query<{ email: string; typo_logins: number }>(
        "select m.email, (select count(*)::int from auth.users u where lower(u.email) = $2) as typo_logins from public.marketing_agents m where m.id = $1",
        [agent.id, typo],
      )
      return r.rows[0]
    })
    expect(after).toEqual({ email: right, typo_logins: 0 })
  })

  test("after an email that didn't go, the same attempt can go on by mobile", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const failing = async () => ({ error: { message: "smtp down", status: 500, code: "unexpected_failure" } })
    const address = `failed-${randomUUID().slice(0, 8)}@example.test`
    await sendSelfConfirmInvite(secretClient(), failing, { attempt: started.attempt, browser, email: address, hourlyBudget: 1000 }, REDIRECT)
    const sent = await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: started.attempt, browser }, words, ENV)
    expect(sent).toMatchObject({ ok: true, data: { kind: "sent" } })
  })

  test("switching off keeps a link sent after the self-confirm invite (a public resend)", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const address = `resend-${randomUUID().slice(0, 8)}@example.test`
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: address, hourlyBudget: 1000 }, REDIRECT)
    // A later invite with no staff member behind it, as request_agent_link opens one.
    await asSystem((sql) =>
      sql.query("insert into public.agent_events (agent_id, kind, result, email, created_by, created_at) values ($1, 'invite', 'started', $2, null, clock_timestamp() + interval '1 second')", [
        agent.id,
        address,
      ]),
    )
    await setSelfConfirm(false)
    try {
      const linked = await asSystem(async (sql) => (await sql.query("select user_id is not null as linked from public.marketing_agents where id = $1", [agent.id])).rows[0])
      expect(linked).toEqual({ linked: true })
    } finally {
      await setSelfConfirm(true)
    }
  })

  test("a weak-names record reaches the claim path even past the browser's set-ups", async () => {
    const browser = randomUUID()
    for (let i = 0; i < 3; i++) await start(await agentOnRecord(), browser)
    const weak = await agentOnRecord({ names: "J Ali Omari" })
    expect(await startSelfConfirm(secretClient(), { code: weak.code, names: "Juma Ali Omari", phone: null, browser, ip: null })).toEqual({ ok: true, data: { kind: "weak_names" } })
  })

  test("a number Beem timed out on stays usable", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    let digits = ""
    const slow: SmsSender = async (_to, message) => {
      digits = /(\d{6})/.exec(message)?.[1] ?? ""
      return { ok: false, error: "timeout" }
    }
    expect(await sendConfirmationNumber(secretClient(), slow, { attempt: started.attempt, browser }, words, ENV)).toMatchObject({ ok: true, data: { kind: "sent" } })
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits }, ENV)).toEqual({ ok: true, data: { kind: "right", phone: agent.phone } })
  })

  test("the masked mobile is shown only for the mobile typed", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const typedOther = await start(agent, browser, mobile())
    if (typedOther.kind !== "ready") throw new Error("not ready")
    expect(await sendConfirmationNumber(secretClient(), keptSender().send, { attempt: typedOther.attempt, browser }, words, ENV)).toMatchObject({ ok: true, data: { kind: "sent", show: false } })
  })

  test("a self-confirm email waits when the public hourly email budget is spent", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const address = `busy-${randomUUID().slice(0, 8)}@example.test`
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: address, hourlyBudget: 0 }, REDIRECT)).toEqual({
      ok: true,
      data: { kind: "busy" },
    })
  })

  test("switching self-confirm off ends its unused email links, and keeps a Manager's", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const address = `off-${randomUUID().slice(0, 8)}@example.test`
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: address, hourlyBudget: 1000 }, REDIRECT)
    await setSelfConfirm(false)
    try {
      const after = await asSystem(async (sql) => {
        const r = await sql.query<{ linked: boolean; logins: number }>(
          "select m.user_id is not null as linked, (select count(*)::int from auth.users u where lower(u.email) = $2) as logins from public.marketing_agents m where m.id = $1",
          [agent.id, address],
        )
        return r.rows[0]
      })
      expect(after).toEqual({ linked: false, logins: 0 })
    } finally {
      await setSelfConfirm(true)
    }
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
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: address, hourlyBudget: 1000 }, REDIRECT)).toEqual({
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
    const sent = await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: "someone-else@example.test", hourlyBudget: 1000 }, REDIRECT)
    expect(sent).toEqual({ ok: true, data: { kind: "sent", email: stored, stored: true } })
  })

  test("an email someone else uses is refused, and nothing is stored", async () => {
    const agent = await agentOnRecord()
    const browser = randomUUID()
    const started = await start(agent, browser)
    if (started.kind !== "ready") throw new Error("not ready")
    expect(await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: started.attempt, browser, email: MANAGER.email, hourlyBudget: 1000 }, REDIRECT)).toEqual({
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
    await sendSelfConfirmInvite(secretClient(), inviteSender, { attempt: first.attempt, browser, email: address, hourlyBudget: 1000 }, REDIRECT)

    const again = await start(agent, browser)
    if (again.kind !== "ready") throw new Error(`not ready: ${again.kind}`)
    const sms = keptSender()
    await sendConfirmationNumber(secretClient(), sms.send, { attempt: again.attempt, browser }, words, ENV)
    await checkConfirmationNumber(secretClient(), { attempt: again.attempt, browser, digits: sms.lastDigits() }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: again.attempt, browser, phone: agent.phone!, password: "self-confirm-password" }, 6)
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
    const login = await createPhoneLogin(secretClient(), { attempt: started.attempt, browser, phone: agent.phone!, password: "self-confirm-password" }, 6)
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
