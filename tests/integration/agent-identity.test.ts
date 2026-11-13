import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { changeAgentStatus, createAgent } from "@/lib/services/marketing-agents"
import { inviteStaff } from "@/lib/services/staff-admin"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { MANAGER, SEEDED_AGENT } from "../support/fixtures"

// Agent identity (#188) against local Supabase: one email per login, which
// new auth users are accepted, and what an agent session gets from the base
// checks. Every agent here is the test's own, with invented names, numbers
// and example.test emails.

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

// An Approved agent the Manager creates, with `address` as their confirmed email.
async function approvedAgent(address: string | null): Promise<{ id: string; code: string }> {
  const created = await createAgent(await signedIn(MANAGER), {
    fullName: `Rehema Identity ${randomUUID().slice(0, 8)}`,
    phone: phone(),
    whatsapp: "",
    email: address ?? "",
    code: "",
  })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  return { id: created.data.agent.id, code: created.data.agent.code }
}

async function createLogin(address: string, metadata: Record<string, unknown> = {}) {
  return secretClient().auth.admin.createUser({
    email: address,
    password: "fixture-password",
    email_confirm: true,
    user_metadata: metadata,
  })
}

async function agentUserId(agentId: string): Promise<string | null> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ user_id: string | null }>("select user_id from public.marketing_agents where id = $1", [agentId])
    return rows[0].user_id
  })
}

// Runs `query` as the database owner with `userId`'s session claims, as an
// internal function called from a request signed in as them sees them.
async function asUser<T>(sql: Client, userId: string, query: string): Promise<T[]> {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })])
  return (await sql.query(query)).rows as T[]
}

describe("one email per login", () => {
  test("an agent can't take an email a staff member holds, even written directly", async () => {
    const staff = await createThrowawayStaff([])
    await expect(
      asSystem((sql) =>
        sql.query(
          "insert into public.marketing_agents (full_name, phone, code, status, approved_at, approved_by, email) values ($1, $2, $3, 'Approved', now(), $4, $5)",
          ["Direct Insert", `+2557000${randomInt(10_000, 99_999)}`, `DIR-${randomInt(100, 999)}`, MANAGER.id, staff.email],
        ),
      ),
    ).rejects.toThrow("email_taken")
  })

  test("a staff record can't take an email a current agent holds, even written directly", async () => {
    const address = email("agent-held")
    await approvedAgent(address)
    await expect(
      asSystem(async (sql) => {
        const role = await sql.query<{ id: string }>("select id from public.roles where name = 'Admissions Staff'")
        await sql.query("insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3)", [
          "Direct Staff",
          address,
          role.rows[0].id,
        ])
      }),
    ).rejects.toThrow("email_taken")
  })

  test("an email an unrelated login uses is refused to a new agent and to a staff invite", async () => {
    // An agent's login whose Auth email has since moved to `address`, as a
    // changed sign-in email would: the login belongs to another record.
    const address = email("stray")
    const first = email("first")
    await approvedAgent(first)
    const login = await createLogin(first)
    expect(login.error).toBeNull()
    await asSystem((sql) => sql.query("update auth.users set email = $1 where id = $2", [address, login.data.user?.id]))

    const agent = await createAgent(await signedIn(MANAGER), {
      fullName: "Stray Email Agent",
      phone: phone(),
      whatsapp: "",
      email: address,
      code: "",
    })
    expect(agent).toMatchObject({ ok: false, error: { kind: "email-taken" } })

    const send = vi.fn(async () => ({ error: null }))
    const role = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ id: string }>("select id from public.roles where name = 'Admissions Staff'")
      return rows[0].id
    })
    const invited = await inviteStaff(await signedIn(MANAGER), send, { fullName: "Stray Staff", email: address, roleId: role }, "http://localhost/auth")
    // The joined agent holds the address their login moved to (#219).
    expect(invited).toMatchObject({ ok: false, error: { code: "email_in_use" } })
    expect(send).not.toHaveBeenCalled()
  })

  test("two saves of one email at once: the second waits for the first, then is refused", async () => {
    const address = email("race")
    const first = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    const second = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await Promise.all([first.connect(), second.connect()])
    try {
      await first.query("begin")
      await first.query("select public.set_audit_actor('system')")
      await first.query(
        "insert into public.marketing_agents (full_name, phone, code, status, approved_at, approved_by, email) values ('Race One', $1, $2, 'Approved', now(), $3, $4)",
        [`+2557000${randomInt(10_000, 99_999)}`, `RCO-${randomInt(100, 999)}`, MANAGER.id, address],
      )

      await second.query("begin")
      await second.query("select public.set_audit_actor('system')")
      const role = await second.query<{ id: string }>("select id from public.roles where name = 'Admissions Staff'")
      const waiting = second
        .query("insert into public.staff_members (full_name, email, role_id) values ('Race Two', $1, $2)", [address, role.rows[0].id])
        .then(
          () => "saved",
          (error: Error) => error.message,
        )

      // Still waiting on the first save's lock.
      const early = await Promise.race([waiting, new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))])
      expect(early).toBe("waiting")

      await first.query("commit")
      expect(await waiting).toBe("email_taken")
    } finally {
      await first.query("rollback").catch(() => {})
      await second.query("rollback").catch(() => {})
      await Promise.all([first.end(), second.end()])
    }
  })

  test("a retired agent's email can be given to a new agent", async () => {
    const address = email("reused")
    const old = await approvedAgent(address)
    const retired = await changeAgentStatus(await signedIn(MANAGER), old.id, "retire", "Created wrongly")
    expect(retired.ok).toBe(true)
    const again = await approvedAgent(address)
    expect(again.id).not.toBe(old.id)
  })
})

describe("who may get a login", () => {
  test("an Approved, switched-on agent with an email gets one, linked to their record", async () => {
    const address = email("joins")
    const agent = await approvedAgent(address)
    const { data, error } = await createLogin(address)
    expect(error).toBeNull()
    expect(await agentUserId(agent.id)).toBe(data.user?.id)
  })

  test("user_metadata.kind never grants or changes access", async () => {
    // Claiming to be staff still links the agent's own record, and no staff record.
    const address = email("claims-staff")
    const agent = await approvedAgent(address)
    const { data } = await createLogin(address, { kind: "staff" })
    expect(await agentUserId(agent.id)).toBe(data.user?.id)
    const staffRows = await inRolledBackTransaction((sql) =>
      sql.query("select 1 from public.staff_members where user_id = $1", [data.user?.id]),
    )
    expect(staffRows.rowCount).toBe(0)

    // Claiming to be an agent with an email nobody holds gets nothing.
    const stranger = await createLogin(email("claims-agent"), { kind: "agent" })
    expect(stranger.error).not.toBeNull()
    expect(stranger.data.user).toBeNull()
  })

  test("a Pending, switched-off or retired agent gets no login", async () => {
    const pendingAddress = email("pending")
    await asSystem((sql) =>
      sql.query("insert into public.marketing_agents (full_name, phone, code, email) values ('Pending Login', $1, $2, $3)", [
        `+2557000${randomInt(10_000, 99_999)}`,
        `PNL-${randomInt(100, 999)}`,
        pendingAddress,
      ]),
    )
    expect((await createLogin(pendingAddress)).error).not.toBeNull()

    const offAddress = email("switched-off")
    const off = await approvedAgent(offAddress)
    expect((await changeAgentStatus(await signedIn(MANAGER), off.id, "switch-off", "Left the school")).ok).toBe(true)
    expect((await createLogin(offAddress)).error).not.toBeNull()
    expect(await agentUserId(off.id)).toBeNull()

    const retiredAddress = email("retired")
    const retired = await approvedAgent(retiredAddress)
    expect((await changeAgentStatus(await signedIn(MANAGER), retired.id, "retire", "Created wrongly")).ok).toBe(true)
    expect((await createLogin(retiredAddress)).error).not.toBeNull()
  })

  test("a switched-off agent fails the sign-up check itself, not only the link step after it", async () => {
    // The link step rechecks switched-off on its own, so a refused login
    // alone can't show which step said no. Ask the sign-up check directly.
    const onAddress = email("check-on")
    await approvedAgent(onAddress)
    const offAddress = email("check-off")
    const off = await approvedAgent(offAddress)
    expect((await changeAgentStatus(await signedIn(MANAGER), off.id, "switch-off", "Left the school")).ok).toBe(true)

    const open = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ switched_on: boolean; switched_off: boolean }>(
        "select public.agent_login_open($1) as switched_on, public.agent_login_open($2) as switched_off",
        [onAddress, offAddress],
      )
      return rows[0]
    })
    expect(open).toEqual({ switched_on: true, switched_off: false })
  })

  test("staff invites still create and link the account", async () => {
    const staff = await createThrowawayStaff(["leads.view"])
    const session = await signedIn(staff)
    const { data } = await session.rpc("is_active_staff")
    expect(data).toBe(true)
  })
})

describe("an agent session and the base checks", () => {
  test("the seeded agent holds no permission, isn't active staff and has no staff record", async () => {
    const session = await signedIn(SEEDED_AGENT)
    expect((await session.rpc("has_permission", { permission: "leads.view" })).data).toBe(false)
    expect((await session.rpc("is_active_staff")).data).toBe(false)
    expect((await session.rpc("current_staff_member")).data).toEqual([])
    expect((await session.from("leads").select("id")).data).toEqual([])
    expect((await session.from("marketing_agents").select("id")).data).toEqual([])
  })

  test("current_principal names the agent, and staff as before", async () => {
    await inRolledBackTransaction(async (sql) => {
      const manager = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])
      expect(
        await asUser(sql, SEEDED_AGENT.userId, "select kind, staff_id, agent_id from public.current_principal()"),
      ).toEqual([{ kind: "agent", staff_id: null, agent_id: SEEDED_AGENT.id }])
      expect(await asUser(sql, manager.rows[0].user_id, "select kind, staff_id, agent_id from public.current_principal()")).toEqual([
        { kind: "staff", staff_id: MANAGER.id, agent_id: null },
      ])
    })
  })

  test("an agent session has no audit actor, so it can't write audited rows", async () => {
    await inRolledBackTransaction(async (sql) => {
      // Even with an actor set for the transaction, as a secret-key path would.
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: SEEDED_AGENT.userId, role: "authenticated" }),
      ])
      const { rows } = await sql.query("select kind, staff_id from public.audit_actor()")
      expect(rows).toEqual([{ kind: null, staff_id: null }])
      await expect(sql.query("update public.marketing_agents set full_name = full_name || ' x' where id = $1", [SEEDED_AGENT.id])).rejects.toThrow(
        "no_audit_actor",
      )
    })
  })

  test("current_staff_id is the signed-in staff member's id, and nothing for an agent", async () => {
    await inRolledBackTransaction(async (sql) => {
      const manager = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])
      expect(await asUser(sql, manager.rows[0].user_id, "select public.current_staff_id() as id")).toEqual([{ id: MANAGER.id }])
      expect(await asUser(sql, SEEDED_AGENT.userId, "select public.current_staff_id() as id")).toEqual([{ id: null }])
    })
  })
})

describe("retiring an agent with a login", () => {
  test("bans the login and frees its email in Auth", async () => {
    const address = email("retire-login")
    const agent = await approvedAgent(address)
    const login = await createLogin(address)
    expect(login.error).toBeNull()
    expect((await signedIn({ email: address, password: "fixture-password" })) !== null).toBe(true)

    expect((await changeAgentStatus(await signedIn(MANAGER), agent.id, "retire", "Created wrongly")).ok).toBe(true)

    const user = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ email: string | null; banned: boolean; sessions: number }>(
        `select u.email, u.banned_until > now() as banned,
           (select count(*)::int from auth.sessions s where s.user_id = u.id) as sessions
         from auth.users u where u.id = $1`,
        [login.data.user?.id],
      )
      return rows[0]
    })
    expect(user).toEqual({ email: `${login.data.user?.id}@retired.invalid`, banned: true, sessions: 0 })
    await expect(signedIn({ email: address, password: "fixture-password" })).rejects.toThrow()

    // The email is free for a correct record and a new login.
    await approvedAgent(address)
    expect((await createLogin(address)).error).toBeNull()
  })
})
