import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { approvalSms, sendApprovalSms } from "@/lib/services/agent-approval-sms"
import {
  checkConfirmationNumber,
  createPhoneLogin,
  sendConfirmationNumber,
  setNewAgentEmail,
  startNewAgentSelfConfirm,
} from "@/lib/services/agent-self-confirm"
import { approveAgent } from "@/lib/services/marketing-agents"
import { fitsOneSms, type SmsSender } from "@/lib/services/sms"

import { asSystem, inRolledBackTransaction, secretClient, signedIn } from "../../support/db"
import { MANAGER } from "../../support/fixtures"

// The approval SMS (owner request 2026-11-28) against local Supabase.
// Serial: new agents choose how to sign in only while self-confirm is on,
// which the other serial files switch for the whole database.

const ENV = { OTP_HMAC_SECRET: "test-only-hmac-secret-for-self-confirm-0123456789" }

async function setSelfConfirm(enabled: boolean) {
  await asSystem((sql) => sql.query("select public.set_agent_self_confirm($1)", [enabled]))
}

beforeAll(() => setSelfConfirm(true))
afterAll(() => setSelfConfirm(true))

const mobile = () => `07${String(randomInt(10_000_000, 100_000_000))}`
const e164 = (local: string) => `+255${local.slice(1)}`
const names = () => `Zawadi Idhini ${String.fromCharCode(65 + randomInt(0, 26))}${randomUUID().replace(/[^a-z]/g, "").slice(0, 6)}`

function keptSender() {
  const sent: { to: string; message: string }[] = []
  const send: SmsSender = async (to, message) => {
    sent.push({ to, message })
    return { ok: true, data: { requestId: `kept-${sent.length}` } }
  }
  return { send, sent }
}

async function agentIdOf(code: string): Promise<string> {
  return asSystem(async (sql) => (await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [code])).rows[0].id)
}

// A brand-new agent who signs up by mobile: Pending, with a phone login.
async function newAgentByMobile() {
  const phone = mobile()
  const browser = randomUUID()
  const started = await startNewAgentSelfConfirm(secretClient(), { fullName: names(), phone, whatsapp: "", browser, ip: null })
  if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
  const { attempt, code } = started.data
  const numbers = keptSender()
  await sendConfirmationNumber(secretClient(), numbers.send, { attempt, browser }, (digits) => `namba ${digits}`, ENV)
  const digits = /(\d{6})/.exec(numbers.sent.at(-1)?.message ?? "")?.[1] ?? ""
  const right = await checkConfirmationNumber(secretClient(), { attempt, browser, digits }, ENV)
  if (!right.ok || right.data.kind !== "right") throw new Error("number not right")
  const login = await createPhoneLogin(secretClient(), { attempt, browser, phone: e164(phone), password: "approval-sms-password" }, 6)
  if (!login.ok) throw new Error("no login")
  return { id: await agentIdOf(code), phone }
}

async function approve(agentId: string) {
  const approved = await approveAgent(await signedIn(MANAGER), agentId)
  if (!approved.ok) throw new Error(`not approved: ${approved.error}`)
}

async function approvalSends(agentId: string) {
  return asSystem(async (sql) => (await sql.query("select to_phone, result from public.sms_sends where agent_id = $1 and kind = 'approved'", [agentId])).rows)
}

describe("the approval SMS", () => {
  test("fits one SMS and names the agents' sign-in page", () => {
    expect(fitsOneSms(approvalSms())).toBe(true)
    expect(approvalSms()).toContain("https://agents.alrahmahcomplex.or.tz/auth")
  })

  test("goes once to the mobile a new agent signs in with, after the Manager approves them", async () => {
    const agent = await newAgentByMobile()
    // A different mobile on the record: the SMS still goes to the login's.
    await asSystem((sql) => sql.query("update public.marketing_agents set phone = $2 where id = $1", [agent.id, e164(mobile())]))
    const sms = keptSender()
    // Still Pending: nothing to send.
    expect(await sendApprovalSms(secretClient(), sms.send, agent.id)).toEqual({ ok: true, data: { kind: "none" } })

    await approve(agent.id)
    expect(await sendApprovalSms(secretClient(), sms.send, agent.id)).toEqual({ ok: true, data: { kind: "sent", phone: e164(agent.phone) } })
    expect(sms.sent).toEqual([{ to: e164(agent.phone).slice(1), message: approvalSms() }])
    expect(await approvalSends(agent.id)).toEqual([{ to_phone: e164(agent.phone), result: "sent" }])

    // Asked again, nothing more goes.
    expect(await sendApprovalSms(secretClient(), sms.send, agent.id)).toEqual({ ok: true, data: { kind: "none" } })
    expect(sms.sent).toHaveLength(1)
  })

  test("isn't held back by the mobile's own limits, which its confirmation numbers spent", async () => {
    const agent = await newAgentByMobile()
    // Spend the mobile's hour, as a busy sign-up would.
    for (let i = 0; i < 10; i += 1) {
      const reserved = await secretClient().rpc("reserve_sms", { kind: "self_confirm", to_phone: e164(agent.phone) })
      if ((reserved.data as { outcome?: string } | null)?.outcome === "mobile_limited") break
    }
    await approve(agent.id)
    const sms = keptSender()
    expect(await sendApprovalSms(secretClient(), sms.send, agent.id)).toEqual({ ok: true, data: { kind: "sent", phone: e164(agent.phone) } })
  })

  test("doesn't go to a new agent who signed up by email, or one the Manager added", async () => {
    const browser = randomUUID()
    const started = await startNewAgentSelfConfirm(secretClient(), { fullName: names(), phone: mobile(), whatsapp: "", browser, ip: null })
    if (!started.ok || started.data.kind !== "ready") throw new Error("not ready")
    const email = await setNewAgentEmail(secretClient(), { attempt: started.data.attempt, browser, email: `approval-${randomUUID().slice(0, 8)}@example.test` })
    expect(email.ok && email.data.kind).toBe("registered")
    const byEmail = await agentIdOf(started.data.code)
    await approve(byEmail)

    const sms = keptSender()
    expect(await sendApprovalSms(secretClient(), sms.send, byEmail)).toEqual({ ok: true, data: { kind: "none" } })
    expect(sms.sent).toEqual([])
    expect(await approvalSends(byEmail)).toEqual([])
  })

  test("says agent access is off rather than texting someone who can't sign in", async () => {
    const agent = await newAgentByMobile()
    await approve(agent.id)
    // Agent access is switched for the whole database, so only inside a
    // transaction that is rolled back, asking as the secret key does.
    const answer = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('staff', $1)", [MANAGER.id])
      await sql.query("select public.set_agent_access(false)")
      await sql.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
      return (await sql.query<{ answer: { outcome: string } }>("select public.claim_approval_sms($1) as answer", [agent.id])).rows[0].answer
    })
    expect(answer).toEqual({ outcome: "access_off" })
  })

  test("only the secret key may ask for the mobile", async () => {
    const agent = await newAgentByMobile()
    const manager = await signedIn(MANAGER)
    expect((await manager.rpc("claim_approval_sms", { agent_id: agent.id })).error).not.toBeNull()
  })
})
