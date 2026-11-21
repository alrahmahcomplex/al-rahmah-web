import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { changeAgentStatus, createAgent } from "@/lib/services/marketing-agents"
import { signIn } from "@/lib/services/sign-in"

import { anonClient, asSystem, createThrowawayStaff, secretClient, signedIn, TEST_CAPTCHA_TOKEN } from "../support/db"
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
  return { id: created.data.agent.id, address, phone, userId: login.data.user.id }
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
    expect(byPassword.error?.code).toBe("signup_disabled")
    expect(byPassword.data.user).toBeNull()

    const byCode = await anonClient().auth.signInWithOtp({ phone: mobile().slice(1), options: { captchaToken: TEST_CAPTCHA_TOKEN } })
    expect(byCode.error?.code).toBe("signup_disabled")
  })
})

describe("only the app puts a mobile on a login", () => {
  test("a signed-in agent can't put a mobile on their own login", async () => {
    const agent = await agentWithMobileLogin()
    const session = await signedIn({ email: agent.address, password: "fixture-password" })
    const asked = await session.auth.updateUser({ phone: mobile().slice(1) })
    expect(asked.error).not.toBeNull()

    const kept = await asSystem(async (sql) => {
      const row = await sql.query<{ phone: string; phone_change: string }>("select phone, phone_change from auth.users where id = $1", [agent.userId])
      return row.rows[0]
    })
    expect(kept).toEqual({ phone: agent.phone.slice(1), phone_change: "" })
  })

  test("retiring an agent frees their mobile, which then says only wrong details", async () => {
    const agent = await agentWithMobileLogin()
    expect((await changeAgentStatus(await signedIn(MANAGER), agent.id, "retire", "Created wrongly")).ok).toBe(true)

    const user = await asSystem(async (sql) => {
      const row = await sql.query<{ phone: string | null; phone_identities: number }>(
        `select u.phone, (select count(*)::int from auth.identities i where i.user_id = u.id and i.provider = 'phone') as phone_identities
         from auth.users u where u.id = $1`,
        [agent.userId],
      )
      return row.rows[0]
    })
    expect(user).toEqual({ phone: null, phone_identities: 0 })
    expect(await signIn(anonClient(), { phone: agent.phone }, "wrong-password", TEST_CAPTCHA_TOKEN)).toEqual({
      ok: false,
      error: "invalid-credentials",
    })
  })
})

describe("staff logins never carry a mobile", () => {
  async function storedPhone(userId: string) {
    return asSystem(async (sql) => {
      const row = await sql.query<{ phone: string | null }>("select phone from auth.users where id = $1", [userId])
      return row.rows[0].phone
    })
  }

  async function staffUserId(email: string) {
    return asSystem(async (sql) => {
      const row = await sql.query<{ user_id: string }>("select user_id from public.staff_members where email = $1", [email])
      return row.rows[0].user_id
    })
  }

  test("a phone can't be put on a staff login, so staff can't sign in by mobile even through Auth", async () => {
    const staff = await createThrowawayStaff([])
    const userId = await staffUserId(staff.email)
    const phone = mobile()

    const added = await secretClient().auth.admin.updateUserById(userId, { phone: phone.slice(1), phone_confirm: true })
    expect(added.error?.message).toBe("Error updating user")
    expect(await storedPhone(userId)).toBeNull()
    // The same change on an agent's login goes through: the refusal is the staff rule.
    const agent = await agentWithMobileLogin()
    const moved = mobile()
    expect((await secretClient().auth.admin.updateUserById(agent.userId, { phone: moved.slice(1), phone_confirm: true })).error).toBeNull()
    expect(await storedPhone(agent.userId)).toBe(moved.slice(1))

    const direct = await anonClient().auth.signInWithPassword({
      phone: phone.slice(1),
      password: staff.password,
      options: { captchaToken: TEST_CAPTCHA_TOKEN },
    })
    expect(direct.error?.code).toBe("invalid_credentials")
  })

  test("a staff login can't be created with a phone", async () => {
    const suffix = randomUUID().slice(0, 8)
    const email = `phone-staff-${suffix}@example.test`
    await asSystem(async (sql) => {
      const role = await sql.query<{ id: string }>("insert into public.roles (name, permissions) values ($1, '{}') returning id", [
        `Phone staff role ${suffix}`,
      ])
      await sql.query("insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3)", [
        `Phone staff ${suffix}`,
        email,
        role.rows[0].id,
      ])
    })

    const created = await secretClient().auth.admin.createUser({
      email,
      phone: mobile().slice(1),
      password: "fixture-password",
      email_confirm: true,
      phone_confirm: true,
    })
    expect(created.error).not.toBeNull()
    expect(await staffUserId(email)).toBeNull()
  })

  test("an agent's login may still carry a mobile", async () => {
    // agentWithMobileLogin throws if the phone is refused.
    await expect(agentWithMobileLogin()).resolves.toMatchObject({ phone: expect.stringMatching(/^\+255/) })
  })
})
