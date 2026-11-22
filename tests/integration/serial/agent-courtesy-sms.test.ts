import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  checkConfirmationNumber,
  courtesySms,
  createPhoneLogin,
  sendConfirmationNumber,
  sendCourtesySms,
  sendSelfConfirmInvite,
  startSelfConfirm,
} from "@/lib/services/agent-self-confirm"
import { confirmationOf } from "@/lib/agent-import"
import { toCsv } from "@/lib/import"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
import { createAgent } from "@/lib/services/marketing-agents"
import type { SmsSender } from "@/lib/services/sms"

import { asSystem, secretClient, signedIn } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// The courtesy SMS (#503 slice 4b, decision 78) against local Supabase.
// Serial: self-confirm is switched on for the whole database.

async function setSelfConfirm(enabled: boolean) {
  await asSystem((sql) => sql.query("select public.set_agent_self_confirm($1)", [enabled]))
}

beforeAll(() => setSelfConfirm(true))
afterAll(() => setSelfConfirm(false))

const OFFICE = "0673 526 644"

function mobile() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

function keptSender() {
  const sent: { to: string; message: string }[] = []
  const send: SmsSender = async (to, message) => {
    sent.push({ to, message })
    return { ok: true, data: { requestId: `kept-${sent.length}` } }
  }
  return { send, sent }
}

const invite = async (email: string, redirectTo: string) => {
  const { error } = await secretClient().auth.admin.inviteUserByEmail(email, { redirectTo, data: { kind: "agent" } })
  return { error: error ? { message: error.message, status: error.status, code: error.code } : null }
}

// An agent with a mobile on file who joins by email self-confirm: the invite,
// then the password the set-password page saves.
async function joinedByEmail() {
  const created = await createAgent(await signedIn(MANAGER), { fullName: "Neema Simu Juma", phone: mobile(), whatsapp: "", email: "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error("could not create")
  const agent = created.data.agent
  const browser = randomUUID()
  const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: null, browser, ip: null })
  if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
  const address = `courtesy-${randomUUID().slice(0, 8)}@example.test`
  const sent = await sendSelfConfirmInvite(
    secretClient(),
    invite,
    { attempt: started.data.attempt, browser, email: address, hourlyBudget: 1000 },
    "http://localhost:3100/discount-code/set-password",
  )
  if (!sent.ok || sent.data.kind !== "sent") throw new Error(`invite not sent: ${JSON.stringify(sent)}`)
  const login = await asSystem(async (sql) => (await sql.query<{ user_id: string }>("select user_id from public.marketing_agents where id = $1", [agent.id])).rows[0].user_id)
  const joined = await secretClient().auth.admin.updateUserById(login, { password: "courtesy-password", email_confirm: true })
  if (joined.error) throw new Error(joined.error.message)
  return { agent, login, address }
}

describe("the courtesy SMS", () => {
  test("goes once to the mobile on file after an email self-confirm, naming the email and the office", async () => {
    const { agent, login, address } = await joinedByEmail()
    const sms = keptSender()
    expect(await sendCourtesySms(secretClient(), sms.send, login, (opened) => courtesySms(opened, OFFICE))).toEqual({ ok: true, data: { sent: true } })
    expect(sms.sent).toEqual([{ to: agent.phone.slice(1), message: `Akaunti yako ya Al-Rahmah imefunguliwa kwa ${address}. Si wewe? Piga ofisi ${OFFICE}.` }])
    const logged = await asSystem(async (sql) => (await sql.query("select kind, result from public.sms_sends where to_phone = $1", [agent.phone])).rows)
    expect(logged).toEqual([{ kind: "courtesy", result: "sent" }])

    // A second password save sends nothing.
    expect(await sendCourtesySms(secretClient(), sms.send, login, (opened) => courtesySms(opened, OFFICE))).toEqual({ ok: true, data: { sent: false } })
    expect(sms.sent).toHaveLength(1)
  })

  test("goes to nobody after a mobile join on the record's own mobile", async () => {
    const created = await createAgent(await signedIn(MANAGER), { fullName: "Neema Simu Juma", phone: mobile(), whatsapp: "", email: "", code: "" })
    if (!created.ok || created.data.kind !== "created") throw new Error("could not create")
    const agent = created.data.agent
    const browser = randomUUID()
    // A typed mobile that differs is ignored: the number goes to the record's.
    const started = await startSelfConfirm(secretClient(), { code: agent.code, names: agent.fullName, phone: mobile(), browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const texts = keptSender()
    const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }
    const sent = await sendConfirmationNumber(secretClient(), texts.send, { attempt: started.data.attempt, browser }, (d) => `namba ${d}`, ENV)
    expect(sent).toMatchObject({ ok: true, data: { kind: "sent", phone: agent.phone } })
    const digits = /(\d{6})/.exec(texts.sent.at(-1)?.message ?? "")?.[1] ?? ""
    await checkConfirmationNumber(secretClient(), { attempt: started.data.attempt, browser, digits }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: started.data.attempt, browser, phone: agent.phone, password: "courtesy-password" }, 6)
    if (!login.ok) throw new Error("no login")
    const sms = keptSender()
    expect(await sendCourtesySms(secretClient(), sms.send, login.data.userId, (opened) => courtesySms(opened, OFFICE))).toEqual({ ok: true, data: { sent: false } })
    expect(sms.sent).toEqual([])
  })

  test("goes to nobody after a typed-mobile join on a record with no mobile", async () => {
    const letter = () => String.fromCharCode(65 + randomInt(0, 26))
    const code = `C${letter()}${letter()}-${randomInt(100, 1000)}`
    const manager = await signedIn(MANAGER)
    const rows = toCsv([["Code", "Full name", "Mobile", "WhatsApp", "Email"], [code, "Neema Simu Juma", "", "", ""]])
    const checked = await checkAgentImportFile(manager, `courtesy-${randomUUID().slice(0, 8)}.csv`, new TextEncoder().encode(rows))
    if (!checked.ok) throw new Error("import check failed")
    const done = await confirmAgentImport(manager, confirmationOf(checked.data))
    if (!done.ok || done.data.kind !== "imported") throw new Error("import failed")
    const typed = `+2557${String(randomInt(10_000_000, 100_000_000))}`
    const browser = randomUUID()
    const started = await startSelfConfirm(secretClient(), { code, names: "Neema Simu Juma", phone: typed, browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const texts = keptSender()
    const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }
    await sendConfirmationNumber(secretClient(), texts.send, { attempt: started.data.attempt, browser }, (d) => `namba ${d}`, ENV)
    const digits = /(\d{6})/.exec(texts.sent.at(-1)?.message ?? "")?.[1] ?? ""
    await checkConfirmationNumber(secretClient(), { attempt: started.data.attempt, browser, digits }, ENV)
    const login = await createPhoneLogin(secretClient(), { attempt: started.data.attempt, browser, phone: typed, password: "courtesy-password" }, 6)
    if (!login.ok) throw new Error("no login")
    const sms = keptSender()
    expect(await sendCourtesySms(secretClient(), sms.send, login.data.userId, (opened) => courtesySms(opened, OFFICE))).toEqual({ ok: true, data: { sent: false } })
    expect(sms.sent).toEqual([])
  })

  test("goes to nobody for a login that isn't a self-confirm one", async () => {
    const sms = keptSender()
    expect(await sendCourtesySms(secretClient(), sms.send, randomUUID(), (opened) => courtesySms(opened, OFFICE))).toEqual({ ok: true, data: { sent: false } })
    expect(sms.sent).toEqual([])
  })

  test("fits one SMS for an everyday email", () => {
    expect(courtesySms("amina.k@mfano.com", OFFICE).length).toBeLessThanOrEqual(160)
  })
})
