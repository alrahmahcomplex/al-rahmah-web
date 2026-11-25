import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  checkConfirmationNumber,
  createPhoneLogin,
  pendingAgentCode,
  selfConfirmOpen,
  sendConfirmationNumber,
  setNewAgentEmail,
  startNewAgentSelfConfirm,
  startSelfConfirm,
} from "@/lib/services/agent-self-confirm"
import { createAgent } from "@/lib/services/marketing-agents"
import type { SmsSender } from "@/lib/services/sms"

import { anonClient, asSystem, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// New agents choose how to sign in too (#503 slice 4d-b) against local
// Supabase. Serial: these tests switch self-confirm on for the whole
// database, and back off.

const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }
const PASSWORD = "new-agent-password"

async function setSelfConfirm(enabled: boolean) {
  await asSystem((sql) => sql.query("select public.set_agent_self_confirm($1)", [enabled]))
}

beforeAll(() => setSelfConfirm(true))
// Back on, as go-live left it (20270128120100), for the files after this one.
afterAll(() => setSelfConfirm(true))

const mobile = () => `07${String(randomInt(10_000_000, 100_000_000))}`
const e164 = (local: string) => `+255${local.slice(1)}`
const names = () => `Baraka Mpya ${String.fromCharCode(65 + randomInt(0, 26))}${randomUUID().replace(/[^a-z]/g, "").slice(0, 6)}`

function keptSender() {
  const messages: string[] = []
  const send: SmsSender = async (_to, message) => {
    messages.push(message)
    return { ok: true, data: { requestId: `kept-${messages.length}` } }
  }
  return { send, lastDigits: () => /(\d{6})/.exec(messages.at(-1) ?? "")?.[1] ?? "" }
}
const words = (digits: string) => `Al-Rahmah Complex: namba yako ya kuthibitisha ni ${digits}.`

async function startNew(fullName: string, phone: string, browser: string) {
  const started = await startNewAgentSelfConfirm(secretClient(), { fullName, phone, whatsapp: "", browser, ip: null })
  if (!started.ok) throw new Error("start failed")
  return started.data
}

async function record(code: string) {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string; status: string; email: string | null; user_id: string | null; phone: string | null; joined: boolean }>(
      "select id, status, email, user_id, phone, user_id is not null and public.agent_joined(user_id) as joined from public.marketing_agents where code = $1",
      [code],
    )
    return rows[0]
  })
}

// Proves the mobile and sets the password: the whole mobile path.
async function joinByMobile(fullName: string, phone: string) {
  const browser = randomUUID()
  const started = await startNew(fullName, phone, browser)
  if (started.kind !== "ready") throw new Error(`not ready: ${started.kind}`)
  const sms = keptSender()
  const sent = await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)
  expect(sent).toEqual({ ok: true, data: { kind: "sent", phone: e164(phone), onRecord: true, show: true } })
  expect(await checkConfirmationNumber(secretClient(), { attempt: started.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
    ok: true,
    data: { kind: "right", phone: e164(phone) },
  })
  const login = await createPhoneLogin(secretClient(), { attempt: started.attempt, browser, phone: e164(phone), password: PASSWORD }, 6)
  expect(login.ok).toBe(true)
  return started
}

async function signInByMobile(phone: string) {
  const session = anonClient()
  const signed = await session.auth.signInWithPassword({ phone: e164(phone).slice(1), password: PASSWORD, options: { captchaToken: TEST_CAPTCHA_TOKEN } })
  if (signed.error) throw new Error(signed.error.message)
  return session
}

describe("a new agent's start", () => {
  test("the page reads that self-confirm is on", async () => {
    expect(await selfConfirmOpen(secretClient())).toBe(true)
  })

  test("makes today's Pending record, with no email, and an attempt for this browser", async () => {
    const fullName = names()
    const phone = mobile()
    const started = await startNew(fullName, phone, randomUUID())
    expect(started).toMatchObject({ kind: "ready", canText: true })
    if (started.kind !== "ready") return
    expect(await record(started.code)).toMatchObject({ status: "Pending", email: null, user_id: null, phone: e164(phone) })
    const attempt = await asSystem(async (sql) => (await sql.query("select new_agent, state from public.agent_confirm_attempts where id = $1", [started.attempt])).rows[0])
    expect(attempt).toEqual({ new_agent: true, state: "matched" })
  })

  test("the same person sending again from the same browser goes on with their Pending record; any other browser or name finds the mobile has a code", async () => {
    const fullName = names()
    const phone = mobile()
    const browser = randomUUID()
    const first = await startNew(fullName, phone, browser)
    const again = await startNew(fullName, phone, browser)
    expect(again.kind === "ready" && first.kind === "ready" && again.code === first.code).toBe(true)
    // A name and a mobile alone never adopt the record from another browser (Sol, #538).
    expect(await startNew(fullName, phone, randomUUID())).toEqual({ kind: "code_needed" })
    expect(await startNew(names(), phone, browser)).toEqual({ kind: "code_needed" })

    const onRecord = await createAgent(await signedIn(MANAGER), { fullName: names(), phone: mobile(), whatsapp: "", email: "", code: "" })
    if (!onRecord.ok || onRecord.data.kind !== "created") throw new Error("could not create")
    const local = `0${onRecord.data.agent.phone.slice(4)}`
    expect(await startNew(onRecord.data.agent.fullName, local, randomUUID())).toEqual({ kind: "code_needed" })
  })

  test("refuses a name or mobile it can't read, naming the field", async () => {
    expect(await startNew("A", mobile(), randomUUID())).toEqual({ kind: "invalid", field: "full_name" })
    expect(await startNew(names(), "12", randomUUID())).toEqual({ kind: "invalid", field: "phone" })
  })

  test("a browser gets three attempts a day", async () => {
    const browser = randomUUID()
    for (let i = 0; i < 3; i++) expect((await startNew(names(), mobile(), browser)).kind).toBe("ready")
    expect(await startNew(names(), mobile(), browser)).toEqual({ kind: "setups_limited" })
  })

  test("is off while self-confirm is off", async () => {
    await setSelfConfirm(false)
    try {
      expect(await selfConfirmOpen(secretClient())).toBe(false)
      expect(await startNew(names(), mobile(), randomUUID())).toEqual({ kind: "off" })
    } finally {
      await setSelfConfirm(true)
    }
  })
})

describe("a new agent by mobile", () => {
  test("proves the typed mobile, sets a password, and sees no students until the office approves the code", async () => {
    const fullName = names()
    const phone = mobile()
    const started = await joinByMobile(fullName, phone)
    if (started.kind !== "ready") return
    // Linked to the Pending record, which stays Pending.
    expect(await record(started.code)).toMatchObject({ status: "Pending", joined: true })

    const session = await signInByMobile(phone)
    expect((await session.rpc("agent_students", {})).data).toEqual({ state: "not_approved" })
    expect((await session.rpc("current_agent_account").maybeSingle()).data).toEqual({ state: "not_approved", full_name: null, code: null })
    expect(await pendingAgentCode(session)).toEqual({ ok: true, data: started.code })

    // Approving flips the status; nothing else is needed.
    const approved = await (await signedIn(MANAGER)).rpc("approve_marketing_agent", { agent_id: (await record(started.code)).id })
    expect(approved.error).toBeNull()
    const after = await signInByMobile(phone)
    expect((await after.rpc("agent_students", {})).data).toMatchObject({ state: "active" })
    expect(await pendingAgentCode(after)).toEqual({ ok: true, data: null })
  })

  test("a Pending record the office switches off can't be proven any more", async () => {
    const browser = randomUUID()
    const started = await startNew(names(), mobile(), browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const switched = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", { agent_id: (await record(started.code)).id, kind: "switched_off", reason: "Test" })
    expect(switched.error).toBeNull()
    const sms = keptSender()
    expect(await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)).toEqual({ ok: true, data: { kind: "off" } })
  })

  test("an attempt from another browser is expired", async () => {
    const started = await startNew(names(), mobile(), randomUUID())
    if (started.kind !== "ready") throw new Error("not ready")
    const sms = keptSender()
    expect(await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser: randomUUID() }, words, ENV)).toEqual({ ok: true, data: { kind: "expired" } })
  })

})

// A code the office hasn't approved yet, typed as a code holder (owner, 24 Nov
// 2026): it goes on to the choice of how to sign in, as a new agent's does,
// instead of today's claim path, which asked for an email first.
describe("a code the office hasn't approved yet", () => {
  // A Pending record from another browser, as when the person registered on
  // another day and comes back with the code.
  async function pendingCode() {
    const fullName = names()
    const phone = mobile()
    const started = await startNew(fullName, phone, randomUUID())
    if (started.kind !== "ready") throw new Error("not ready")
    return { fullName, phone, code: started.code }
  }

  test("with matching names goes on to the choice, as a new agent's attempt, never showing the email on record", async () => {
    const held = await pendingCode()
    await asSystem((sql) => sql.query("update public.marketing_agents set email = $2 where code = $1", [held.code, `office-${randomUUID().slice(0, 8)}@example.test`]))
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code: held.code, names: held.fullName, phone: held.phone, browser, ip: null })
    expect(started).toMatchObject({ ok: true, data: { kind: "ready", canText: true, typedMatches: true, emailOnRecord: false, emailOpen: true, pendingCode: held.code } })
    if (!started.ok || started.data.kind !== "ready") return
    const id = started.data.attempt
    const attempt = await asSystem(async (sql) => (await sql.query("select new_agent, typed_phone from public.agent_confirm_attempts where id = $1", [id])).rows[0])
    expect(attempt).toEqual({ new_agent: true, typed_phone: null })
  })

  test("wrong names still don't match", async () => {
    const held = await pendingCode()
    expect(await startSelfConfirm(secretClient(), { code: held.code, names: names(), phone: held.phone, browser: randomUUID(), ip: null })).toEqual({
      ok: true,
      data: { kind: "name_mismatch" },
    })
  })

  test("by mobile, the number goes to the mobile on the record, never a typed one, and the login waits for the office", async () => {
    const held = await pendingCode()
    const browser = randomUUID()
    const typed = mobile()
    const started = await startSelfConfirm(secretClient(), { code: held.code, names: held.fullName, phone: typed, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    expect(started.data.typedMatches).toBe(false)
    const sms = keptSender()
    expect(await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.data.attempt, browser }, words, ENV)).toEqual({
      ok: true,
      data: { kind: "sent", phone: e164(held.phone), onRecord: true, show: false },
    })
    expect(await checkConfirmationNumber(secretClient(), { attempt: started.data.attempt, browser, digits: sms.lastDigits() }, ENV)).toEqual({
      ok: true,
      data: { kind: "right", phone: e164(held.phone) },
    })
    const login = await createPhoneLogin(secretClient(), { attempt: started.data.attempt, browser, phone: e164(held.phone), password: PASSWORD }, 6)
    expect(login.ok).toBe(true)
    expect(await record(held.code)).toMatchObject({ status: "Pending", joined: true })
    const session = await signInByMobile(held.phone)
    expect((await session.rpc("agent_students", {})).data).toEqual({ state: "not_approved" })
  })

  test("by email, the email goes on the Pending record, from the browser that started only", async () => {
    const held = await pendingCode()
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code: held.code, names: held.fullName, phone: held.phone, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const address = `baraka-${randomUUID().slice(0, 8)}@example.test`
    expect(await setNewAgentEmail(secretClient(), { attempt: started.data.attempt, browser: randomUUID(), email: address })).toEqual({ ok: true, data: { kind: "expired" } })
    expect(await setNewAgentEmail(secretClient(), { attempt: started.data.attempt, browser, email: address })).toEqual({
      ok: true,
      data: { kind: "registered", code: held.code, email: address },
    })
    expect(await record(held.code)).toMatchObject({ status: "Pending", email: address, user_id: null })
  })

  test("an Approved code's attempt is unchanged: not a new agent's", async () => {
    const onRecord = await createAgent(await signedIn(MANAGER), { fullName: names(), phone: mobile(), whatsapp: "", email: "", code: "" })
    if (!onRecord.ok || onRecord.data.kind !== "created") throw new Error("could not create")
    const agent = onRecord.data.agent
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser: randomUUID(), ip: null })
    expect(started).toMatchObject({ ok: true, data: { kind: "ready", pendingCode: null } })
  })
})

describe("a new agent by email", () => {
  test("puts the email on the Pending record and sends nothing now", async () => {
    const browser = randomUUID()
    const started = await startNew(names(), mobile(), browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const address = `baraka-${randomUUID().slice(0, 8)}@example.test`
    expect(await setNewAgentEmail(secretClient(), { attempt: started.attempt, browser, email: address })).toEqual({
      ok: true,
      data: { kind: "registered", code: started.code, email: address },
    })
    expect(await record(started.code)).toMatchObject({ status: "Pending", email: address, user_id: null })
    // The attempt is done: no number can go out for it any more.
    const sms = keptSender()
    expect(await sendConfirmationNumber(secretClient(), sms.send, { attempt: started.attempt, browser }, words, ENV)).toEqual({ ok: true, data: { kind: "expired" } })
  })

  test("never replaces an email the office put on the record while the attempt was open", async () => {
    const browser = randomUUID()
    const started = await startNew(names(), mobile(), browser)
    if (started.kind !== "ready") throw new Error("not ready")
    const office = `office-${randomUUID().slice(0, 8)}@example.test`
    await asSystem((sql) => sql.query("update public.marketing_agents set email = $2 where code = $1", [started.code, office]))
    expect(await setNewAgentEmail(secretClient(), { attempt: started.attempt, browser, email: `other-${randomUUID().slice(0, 8)}@example.test` })).toEqual({
      ok: true,
      data: { kind: "email_unusable" },
    })
    expect(await record(started.code)).toMatchObject({ email: office })
  })

  test("refuses an email someone else uses, or none, and only from the browser that started", async () => {
    const browser = randomUUID()
    const started = await startNew(names(), mobile(), browser)
    if (started.kind !== "ready") throw new Error("not ready")
    expect(await setNewAgentEmail(secretClient(), { attempt: started.attempt, browser, email: MANAGER.email })).toEqual({ ok: true, data: { kind: "email_unusable" } })
    expect(await setNewAgentEmail(secretClient(), { attempt: started.attempt, browser, email: "not-an-email" })).toEqual({ ok: true, data: { kind: "no_email" } })
    expect(await setNewAgentEmail(secretClient(), { attempt: started.attempt, browser: randomUUID(), email: "x@example.test" })).toEqual({ ok: true, data: { kind: "expired" } })
  })

  test("a code holder's attempt can't use it", async () => {
    const onRecord = await createAgent(await signedIn(MANAGER), { fullName: names(), phone: mobile(), whatsapp: "", email: "", code: "" })
    if (!onRecord.ok || onRecord.data.kind !== "created") throw new Error("could not create")
    const agent = onRecord.data.agent
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    expect(await setNewAgentEmail(secretClient(), { attempt: started.data.attempt, browser, email: "x@example.test" })).toEqual({ ok: true, data: { kind: "expired" } })
  })
})
