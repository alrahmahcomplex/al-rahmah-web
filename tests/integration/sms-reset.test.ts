import { randomInt, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))
// The route finishes a slow send after its answer; outside Next.js, now.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (work: () => unknown) => void work() }))

import { POST } from "@/app/api/auth/send-sms/route"
import { resetSms } from "@/app/api/auth/send-sms/words"
import { createAgent } from "@/lib/services/marketing-agents"
import { checkResetNumber, requestResetSms, saveResetPassword } from "@/lib/services/sms-reset"
import { signWebhook } from "@/lib/standard-webhooks"

import { anonClient, asSystem, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../support/db"
import { MANAGER } from "../support/fixtures"

// The reset by SMS (#503 slice 2b) against local Supabase: the Send SMS hook
// route as Auth calls it, and the three steps against local Auth, whose
// phone provider is on while sign-ups stay off (supabase/config.toml).
// Local Auth texts nothing to TEST_NUMBER and takes TEST_CODE for it
// (auth.sms.test_otp), so the steps can be typed; the hook is called here
// directly, signed with the local test secret.

const HOOK_SECRET = "v1,whsec_+MGBB5HlwmiVEtF39l8a73U9xuIKvoj/wVb5aIvOecM="
const TEST_NUMBER = "+255799000503"
const TEST_CODE = "246810"

beforeAll(() => {
  process.env.SEND_SMS_HOOK_SECRET = HOOK_SECRET
  process.env.SMS_FAKE = "1"
})

function mobile() {
  return `+2557${String(randomInt(10_000_000, 100_000_000))}`
}

// An Approved agent whose login carries a confirmed mobile, as self-confirm
// (slice 3) will make them; until then an email login with a phone.
async function agentWithMobileLogin(phone = mobile()) {
  const address = `sms-reset-${randomUUID().slice(0, 8)}@example.test`
  const created = await createAgent(await signedIn(MANAGER), {
    fullName: `Neema Simu ${randomUUID().slice(0, 8)}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email: address,
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  const login = await secretClient().auth.admin.createUser({
    email: address,
    phone: phone.slice(1),
    password: "fixture-password",
    email_confirm: true,
    phone_confirm: true,
  })
  if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
  return { agentId: created.data.agent.id, userId: login.data.user.id, phone, address }
}

function hookRequest(body: unknown, secret = HOOK_SECRET) {
  const text = JSON.stringify(body)
  const id = `msg_${randomUUID()}`
  const timestamp = Math.floor(Date.now() / 1000)
  return new Request("http://localhost/api/auth/send-sms", {
    method: "POST",
    headers: { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": signWebhook(secret, id, timestamp, text) },
    body: text,
  })
}

async function sendsTo(phone: string) {
  return asSystem(async (sql) => {
    const rows = await sql.query<{ kind: string; result: string; agent_id: string | null }>(
      "select kind, result, agent_id from public.sms_sends where to_phone = $1 order by created_at",
      [phone],
    )
    return rows.rows
  })
}

describe("the Send SMS hook", () => {
  test("texts an agent's login through the fake sender, with the budget and the log", async () => {
    const agent = await agentWithMobileLogin()
    const response = await POST(hookRequest({ user: { id: agent.userId, phone: agent.phone.slice(1), phone_change: "" }, sms: { otp: "739204" } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(await sendsTo(agent.phone)).toEqual([{ kind: "reset", result: "sent", agent_id: agent.agentId }])
  })

  test("refuses a request without the right signature, and sends nothing", async () => {
    const agent = await agentWithMobileLogin()
    const body = { user: { id: agent.userId, phone: agent.phone.slice(1) }, sms: { otp: "739204" } }
    const response = await POST(hookRequest(body, "v1,whsec_b3RoZXItc2VjcmV0LWZvci1ob29rcy1vbmx5"))
    expect(response.status).toBe(401)
    expect(await sendsTo(agent.phone)).toEqual([])
  })

  test("texts nothing to a login that isn't an agent's, or for a phone change, and still answers 200", async () => {
    const phone = mobile()
    const stranger = await POST(hookRequest({ user: { id: randomUUID(), phone: phone.slice(1) }, sms: { otp: "739204" } }))
    expect(stranger.status).toBe(200)
    expect(await sendsTo(phone)).toEqual([])

    const agent = await agentWithMobileLogin()
    const asked = mobile()
    const change = await POST(hookRequest({ user: { id: agent.userId, phone: agent.phone.slice(1), phone_change: asked.slice(1) }, sms: { otp: "739204" } }))
    expect(change.status).toBe(200)
    expect(await sendsTo(asked)).toEqual([])
    expect(await sendsTo(agent.phone)).toEqual([])
  })

  test("texts nothing to a switched-off agent: the session would be theirs for the number", async () => {
    const agent = await agentWithMobileLogin()
    const switched = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", { agent_id: agent.agentId, kind: "switched_off", reason: "Test" })
    expect(switched.error).toBeNull()
    const response = await POST(hookRequest({ user: { id: agent.userId, phone: agent.phone.slice(1) }, sms: { otp: "739204" } }))
    expect(response.status).toBe(200)
    expect(await sendsTo(agent.phone)).toEqual([])
  })

  test("its words fit one SMS and name the number", () => {
    expect(resetSms("739204")).toContain("739204")
  })
})

describe("resetting a password by SMS", () => {
  test("a number with no login gets the same answer as one with a login, and no login is made", async () => {
    const phone = mobile()
    expect(await requestResetSms(anonClient(), phone, TEST_CAPTCHA_TOKEN)).toEqual({ ok: true, data: null })
    const made = await asSystem(async (sql) => (await sql.query("select 1 from auth.users where phone = $1", [phone.slice(1)])).rowCount)
    expect(made).toBe(0)
  })

  test("the agent asks, types the number, sets a new password and signs in with it", async () => {
    // Frees the local test number from an earlier run's login.
    await asSystem((sql) => sql.query("update auth.users set phone = null, phone_confirmed_at = null where phone = $1", [TEST_NUMBER.slice(1)]))
    const agent = await agentWithMobileLogin(TEST_NUMBER)
    const browser = anonClient()

    expect(await requestResetSms(browser, TEST_NUMBER, TEST_CAPTCHA_TOKEN)).toEqual({ ok: true, data: null })
    expect(await checkResetNumber(browser, TEST_NUMBER, "000000")).toEqual({ ok: false, error: "wrong-number" })
    const proven = await checkResetNumber(browser, TEST_NUMBER, TEST_CODE)
    expect(proven).toEqual({ ok: true, data: { userId: agent.userId } })
    // Another login's id saves nothing, even on this session.
    expect(await saveResetPassword(browser, "new-sms-password", "00000000-0000-0000-0000-000000000000")).toEqual({ ok: false, error: "signed-out" })
    expect(await saveResetPassword(browser, "new-sms-password", agent.userId)).toEqual({ ok: true, data: null })

    const fresh = anonClient()
    const { error } = await fresh.auth.signInWithPassword({ phone: TEST_NUMBER.slice(1), password: "new-sms-password", options: { captchaToken: TEST_CAPTCHA_TOKEN } })
    expect(error).toBeNull()
    const old = await anonClient().auth.signInWithPassword({ email: agent.address, password: "fixture-password", options: { captchaToken: TEST_CAPTCHA_TOKEN } })
    expect(old.error?.code).toBe("invalid_credentials")
  })
})
