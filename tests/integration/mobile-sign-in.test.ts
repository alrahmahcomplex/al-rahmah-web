import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { createAgent } from "@/lib/services/marketing-agents"
import { signIn } from "@/lib/services/sign-in"

import { anonClient, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../support/db"
import { MANAGER } from "../support/fixtures"

// Signing in with a mobile and a password (#503 slice 2a) against local Auth,
// whose phone provider is on while sign-ups stay off (supabase/config.toml),
// as on hosted. Until self-confirm makes phone logins (slice 3), a login with
// a phone is an agent's email login that also carries a confirmed mobile.

function mobile() {
  return `+2557${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

async function agentWithMobileLogin() {
  const address = `mobile-${randomUUID().slice(0, 8)}@example.test`
  const created = await createAgent(await signedIn(MANAGER), {
    fullName: `Neema Simu ${randomUUID().slice(0, 8)}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email: address,
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  const phone = mobile()
  const login = await secretClient().auth.admin.createUser({
    email: address,
    phone: phone.slice(1),
    password: "fixture-password",
    email_confirm: true,
    phone_confirm: true,
  })
  if (login.error || !login.data.user) throw new Error(`could not create the login: ${login.error?.message}`)
  return { address, phone }
}

describe("signing in with a mobile", () => {
  test("an agent signs in with their mobile and password, typed with the + or without", async () => {
    const agent = await agentWithMobileLogin()
    expect(await signIn(anonClient(), { phone: agent.phone }, "fixture-password", TEST_CAPTCHA_TOKEN)).toEqual({ ok: true, data: "agent" })
    // The same login still signs in with its email.
    expect(await signIn(anonClient(), { email: agent.address }, "fixture-password", TEST_CAPTCHA_TOKEN)).toEqual({ ok: true, data: "agent" })
  })

  test("a wrong password, or a mobile with no login, is the same wrong-details answer", async () => {
    const agent = await agentWithMobileLogin()
    expect(await signIn(anonClient(), { phone: agent.phone }, "wrong-password", TEST_CAPTCHA_TOKEN)).toEqual({
      ok: false,
      error: "invalid-credentials",
    })
    expect(await signIn(anonClient(), { phone: mobile() }, "fixture-password", TEST_CAPTCHA_TOKEN)).toEqual({
      ok: false,
      error: "invalid-credentials",
    })
  })

  test("nobody can sign up by phone, by password or by SMS code", async () => {
    const byPassword = await anonClient().auth.signUp({
      phone: mobile().slice(1),
      password: "fixture-password",
      options: { captchaToken: TEST_CAPTCHA_TOKEN },
    })
    expect(byPassword.error).not.toBeNull()
    expect(byPassword.data.user).toBeNull()

    const byCode = await anonClient().auth.signInWithOtp({ phone: mobile().slice(1), options: { captchaToken: TEST_CAPTCHA_TOKEN } })
    expect(byCode.error).not.toBeNull()
  })
})
