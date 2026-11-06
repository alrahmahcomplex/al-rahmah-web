import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { Client } from "pg"

import { signUpAgent } from "@/lib/services/agent-sign-up"
import { approveAgent, getPendingAgentCount, listAgents, type MarketingAgent } from "@/lib/services/marketing-agents"

import { pendingAround } from "../support/agents"
import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, lockExclusively, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SECOND_MANAGER } from "../support/fixtures"

// The marketing-agent module against local Supabase: what public registration
// makes of a record (through sign-up with the secret key the Server Action
// holds; the sign-up decision table itself is tested in
// agent-email-claims.test.ts), and the list and approval signed in as each
// seeded role. Each test registers agents of its own, with numbers clear of
// the seeded +255 700 000 xxx fixtures and example.test emails. Agents are
// never deleted, so each run adds some; `npm run db:reset` clears them.

const SEEDED_PENDING = { code: "ZNM-401", fullName: "Zawadi Neema Mwakasege", phone: "+255700000401" }
const SEEDED_APPROVED = { code: "BJN-402", fullName: "Baraka Juma Njoroge", phone: "+255700000402" }

// A leading 7 keeps it clear of the seeded 700 000 numbers.
function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

const asE164 = (local: string) => `+255${local.slice(1)}`

// A name of its own, so a search finds only this test's agent.
function agentName() {
  return `Tumaini Agent ${randomUUID().slice(0, 8)}`
}

// An email of the test's own, at a domain that never receives mail.
function email() {
  return `tumaini-${randomUUID().slice(0, 8)}@example.test`
}

// Signs up as the Discount code page does, without a code to claim.
function signUp(fullName = agentName(), number = phone(), whatsapp: string | null = null, address = email()) {
  return signUpAgent(secretClient(), { fullName, phone: number, whatsapp, email: address, hasCode: false, code: null })
}

// A new Pending agent of the test's own, with their code.
async function register(fullName = agentName(), number = phone(), whatsapp: string | null = null) {
  const signedUp = await signUp(fullName, number, whatsapp)
  if (!signedUp.ok) throw new Error(`could not register ${fullName}: ${JSON.stringify(signedUp.error)}`)
  if (signedUp.data.kind !== "registered") throw new Error(`sign-up for ${fullName} answered ${signedUp.data.kind}`)
  return { code: signedUp.data.code, fullName, phone: number }
}

async function findAgent(code: string, as = MANAGER): Promise<MarketingAgent> {
  const list = await listAgents(await signedIn(as), { status: "all", query: code, page: 1 })
  if (!list.ok) throw new Error("list unavailable")
  const agent = list.data.agents.find((a) => a.code === code)
  if (!agent) throw new Error(`no agent ${code}`)
  return agent
}

// Runs `work` as the secret key would, inside a transaction that is rolled
// back, so it can see rows the same transaction made.
async function asServiceRole<T>(sql: Client, work: () => Promise<T>): Promise<T> {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
  await sql.query("set local role service_role")
  return work()
}

describe("registration", () => {
  test("a new agent gets a code of the name's initials, a hyphen and three digits, and is Pending", async () => {
    const number = phone()
    const agent = await register("  amina   juma mrisho  khamis ", number, "+255 711 222 333")
    expect(agent.code).toMatch(/^AJM-\d{3}$/)

    const found = await findAgent(agent.code)
    expect(found).toMatchObject({
      fullName: "amina juma mrisho khamis",
      phone: asE164(number),
      whatsapp: "+255711222333",
      status: "Pending",
      approvedAt: null,
      approvedBy: null,
    })
  })

  test("initials take letters A to Z only, and a name with none gives AR", async () => {
    expect((await register("Élodie 9lives Omari")).code).toMatch(/^O-\d{3}$/)
    expect((await register("99 ..")).code).toMatch(/^AR-\d{3}$/)
  })

  test("the phone is normalized however it is typed, and a WhatsApp number equal to it is dropped", async () => {
    const number = phone()
    const spaced = `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`
    const agent = await register(agentName(), spaced, `+255${number.slice(1)}`)
    expect(await findAgent(agent.code)).toMatchObject({ phone: asE164(number), whatsapp: null })
  })

  test("a bad phone, WhatsApp number or name is refused with the field, and nothing is saved", async () => {
    const name = agentName()
    expect(await signUp(name, "12345")).toEqual({ ok: false, error: { kind: "invalid", field: "phone" } })
    expect(await signUp(name, "")).toEqual({ ok: false, error: { kind: "invalid", field: "phone" } })
    expect(await signUp(name, phone(), "+255 12")).toEqual({ ok: false, error: { kind: "invalid", field: "whatsapp" } })
    expect(await signUp(" a ", phone())).toEqual({ ok: false, error: { kind: "invalid", field: "full_name" } })
    expect(await signUp("x".repeat(101), phone())).toEqual({ ok: false, error: { kind: "invalid", field: "full_name" } })
    const list = await listAgents(await signedIn(MANAGER), { query: name, page: 1 })
    expect(list.ok && list.data.total).toBe(0)
  })

  test("a code typed with spaces finds the agent", async () => {
    const { code } = await register(agentName(), phone())
    const spaced = code.replace("-", " - ").toLowerCase()

    const list = await listAgents(await signedIn(MANAGER), { query: spaced, page: 1 })
    expect(list.ok && list.data.agents.map((a) => a.code)).toEqual([code])
  })

  test("the same sign-up four times in parallel gives one agent and one code", async () => {
    const number = phone()
    const name = agentName()
    const address = email()
    const results = await Promise.all(Array.from({ length: 4 }, () => signUp(name, number, null, address)))
    const codes = results.map((r) => (r.ok && r.data.kind === "registered" ? r.data.code : null))
    expect(codes.every((code) => code !== null && code === codes[0])).toBe(true)

    const list = await listAgents(await signedIn(MANAGER), { query: number, page: 1 })
    expect(list.ok && list.data.total).toBe(1)
  })

  test("a code already taken is never given again, and once ten tries collide the code has four digits", async () => {
    const prefix = `Q${String.fromCharCode(65 + randomInt(0, 26))}${String.fromCharCode(65 + randomInt(0, 26))}`
    const name = `${prefix[0]}uentin ${prefix[1]}ola ${prefix[2]}uma`
    const codes = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Every three-digit code for this prefix.
      await sql.query(
        `insert into public.marketing_agents (full_name, phone, code)
         select 'Collision Agent', '+2556' || lpad((n + $2::int)::text, 8, '0'), $1 || '-' || lpad(n::text, 3, '0')
         from generate_series(0, 999) n
         on conflict do nothing`,
        [prefix, randomInt(0, 90_000_000)],
      )
      return asServiceRole(sql, async () => {
        const made: string[] = []
        for (let i = 0; i < 3; i++) {
          const { rows } = await sql.query(
            "select public.sign_up_marketing_agent($1, $2, null, $3, false, null) ->> 'code' as code",
            [name, phone(), email()],
          )
          made.push(rows[0].code)
        }
        return made
      })
    })
    for (const code of codes) expect(code).toMatch(new RegExp(`^${prefix}-\\d{4}$`))
    expect(new Set(codes).size).toBe(3)
  })

  test("with most three-digit codes taken, a new code still collides with none", async () => {
    const prefix = `X${String.fromCharCode(65 + randomInt(0, 26))}${String.fromCharCode(65 + randomInt(0, 26))}`
    const name = `${prefix[0]}avier ${prefix[1]}ena ${prefix[2]}uri`
    const { code, taken } = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // All but ten of the three-digit codes.
      await sql.query(
        `insert into public.marketing_agents (full_name, phone, code)
         select 'Collision Agent', '+2556' || lpad((n + $2::int)::text, 8, '0'), $1 || '-' || lpad(n::text, 3, '0')
         from generate_series(10, 999) n
         on conflict do nothing`,
        [prefix, randomInt(0, 90_000_000)],
      )
      const { rows: before } = await sql.query("select code from public.marketing_agents where code like $1 || '-%'", [prefix])
      const made = await asServiceRole(sql, async () => {
        const { rows } = await sql.query(
          "select public.sign_up_marketing_agent($1, $2, null, $3, false, null) ->> 'code' as code",
          [name, phone(), email()],
        )
        return rows[0].code as string
      })
      return { code: made, taken: new Set(before.map((r) => r.code as string)) }
    })
    expect(code).toMatch(new RegExp(`^${prefix}-(\\d{3}|\\d{4})$`))
    expect(taken.has(code)).toBe(false)
  })

  test("only the secret key may register: visitors and staff are refused", async () => {
    for (const client of [anonClient(), await signedIn(MANAGER)]) {
      const { error } = await client.rpc("sign_up_marketing_agent", {
        full_name: agentName(), phone: phone(), whatsapp: null, email: email(), has_code: false, code: null,
      })
      expect(error).not.toBeNull()
    }
  })

  test("registration is recorded in history as the Admission form, under the lead scope with no lead", async () => {
    const agent = await register()
    const rows = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select a.action, a.actor_kind, a.actor_staff_id, a.scope, a.lead_id, a.new_values ->> 'code' as code
         from public.audit_log a
         where a.table_name = 'marketing_agents' and a.row_id = (select id from public.marketing_agents where code = $1)`,
        [agent.code],
      )
      return result.rows
    })
    expect(rows).toEqual([
      { action: "insert", actor_kind: "public_form", actor_staff_id: null, scope: "lead", lead_id: null, code: agent.code },
    ])
  })
})

describe("the agent list", () => {
  test("the seeded Pending agent heads the Pending list, oldest first", async () => {
    await register()
    const list = await listAgents(await signedIn(MANAGER), { status: "Pending", page: 1 })
    if (!list.ok) throw new Error("unavailable")
    expect(list.data.agents.every((a) => a.status === "Pending")).toBe(true)
    const times = list.data.agents.map((a) => a.registeredAt)
    expect([...times].sort()).toEqual(times)
  })

  test("the Approved filter shows who approved and when", async () => {
    const list = await listAgents(await signedIn(ACCOUNTANT), { status: "Approved", query: SEEDED_APPROVED.code, page: 1 })
    expect(list.ok && list.data.agents).toEqual([
      expect.objectContaining({
        code: SEEDED_APPROVED.code,
        fullName: SEEDED_APPROVED.fullName,
        status: "Approved",
        approvedBy: MANAGER.name,
        approvedAt: expect.any(String),
      }),
    ])
  })

  test("search matches a name, a code however typed, and a phone however typed", async () => {
    const reader = await signedIn(ADMISSIONS)
    const codes = async (query: string) => {
      const list = await listAgents(reader, { query, page: 1 })
      return list.ok ? list.data.agents.map((a) => a.code) : null
    }
    expect(await codes("zawadi neema")).toContain(SEEDED_PENDING.code)
    expect(await codes("MWAKASEGE")).toContain(SEEDED_PENDING.code)
    expect(await codes("znm-401")).toEqual([SEEDED_PENDING.code])
    expect(await codes("0700 000 401")).toEqual([SEEDED_PENDING.code])
    expect(await codes("+255 700 000 402")).toEqual([SEEDED_APPROVED.code])
    // The Approved agent's WhatsApp number finds them too.
    expect(await codes("0700000412")).toEqual([SEEDED_APPROVED.code])
    // Filter characters are dropped, never read as part of the filter.
    expect(await codes('znm-401,"*)(')).toEqual([SEEDED_PENDING.code])
  })

  test("a page past the end is empty, and says which page it is", async () => {
    const list = await listAgents(await signedIn(MANAGER), { status: "all", page: 1000 })
    expect(list.ok && list.data.agents).toEqual([])
    expect(list.ok && list.data.page).toBe(1000)
  })

  test("the Pending count counts the Pending agents, and staff without leads.view read none", async () => {
    // The seeded Pending agent is never approved, so the count is at least 1.
    const count = await getPendingAgentCount(await signedIn(MANAGER))
    expect(count.ok && count.data).toBeGreaterThanOrEqual(1)
    // A new agent adds exactly one. Counted in one snapshot, with the new
    // agent rolled back, so agents other tests register, approve or retire
    // meanwhile don't move the numbers.
    const { before, after } = await pendingAround(MANAGER, async (sql) => {
      await sql.query("select public.create_agent_record($1, $2, null, null, null, 'Pending', null)", [
        `Pending Count ${randomUUID().slice(0, 8)}`,
        asE164(phone()),
      ])
    })
    expect(after - before).toBe(1)

    const approverOnly = await createThrowawayStaff(["agents.approve"])
    expect(await getPendingAgentCount(await signedIn(approverOnly))).toEqual({ ok: true, data: 0 })
    const list = await listAgents(await signedIn(approverOnly), { page: 1 })
    expect(list.ok && list.data.total).toBe(0)
  })

  test("the Pending count leaves out a retired Pending agent", async () => {
    const registered = await register()
    const agentId = await asSystem(
      async (sql) =>
        (
          await sql.query<{ id: string }>(
            "select public.record_agent_status_change(a.id, 'retired', 'Duplicate record') is not null, a.id from public.marketing_agents a where a.code = $1 and a.retired_at is null",
            [registered.code],
          )
        ).rows[0].id,
    )
    const manager = await signedIn(MANAGER)
    // Writes to the agents wait while the table is held, so the service's
    // count and the counts read here see the same agents.
    const { service, counts } = await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.marketing_agents"])
      const { rows } = await sql.query<{ current: number; ours_retired: boolean }>(
        `select count(*) filter (where retired_at is null)::int as current,
                bool_or(id = $1 and retired_at is not null) as ours_retired
         from public.marketing_agents where status = 'Pending'`,
        [agentId],
      )
      return { service: await getPendingAgentCount(manager), counts: rows[0] }
    })
    expect(counts.ours_retired).toBe(true)
    expect(service).toEqual({ ok: true, data: counts.current })
  })

  test("visitors read no agent and no approver", async () => {
    const { data, error } = await anonClient().from("marketing_agents").select("id")
    expect(error === null ? data : []).toEqual([])
    const approvers = await anonClient().rpc("marketing_agent_approvers", { agent_ids: [] })
    expect(approvers.error).not.toBeNull()
  })
})

describe("approval", () => {
  test("the Manager approves a Pending agent, and the approver and time are recorded", async () => {
    const agent = await register()
    const started = Date.now()
    expect(await approveAgent(await signedIn(MANAGER), (await findAgent(agent.code)).id)).toEqual({ ok: true, data: null })

    const approved = await findAgent(agent.code, ADMISSIONS)
    expect(approved).toMatchObject({ status: "Approved", approvedBy: MANAGER.name })
    expect(new Date(approved.approvedAt!).getTime()).toBeGreaterThanOrEqual(started - 5_000)
  })

  test("approving an Approved agent is refused as no-change, and the first approval stands", async () => {
    const agent = await register()
    const id = (await findAgent(agent.code)).id
    await approveAgent(await signedIn(MANAGER), id)
    const first = await findAgent(agent.code)

    expect(await approveAgent(await signedIn(SECOND_MANAGER), id)).toEqual({ ok: false, error: "no-change" })
    expect(await findAgent(agent.code)).toEqual(first)
  })

  test("Admissions Staff and the Accountant are refused, and the agent stays Pending", async () => {
    const agent = await register()
    const id = (await findAgent(agent.code)).id
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      expect(await approveAgent(await signedIn(person), id), person.roleName).toEqual({ ok: false, error: "forbidden" })
    }
    expect((await findAgent(agent.code)).status).toBe("Pending")
  })

  test("approval needs agents.approve only, with no lead permission", async () => {
    const agent = await register()
    const id = (await findAgent(agent.code)).id
    const approverOnly = await createThrowawayStaff(["agents.approve"])
    expect(await approveAgent(await signedIn(approverOnly), id)).toEqual({ ok: true, data: null })
    expect(await findAgent(agent.code)).toMatchObject({ status: "Approved", approvedBy: approverOnly.name })
  })

  test("an unknown agent is not found", async () => {
    const manager = await signedIn(MANAGER)
    expect(await approveAgent(manager, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await approveAgent(manager, "not-an-id")).toEqual({ ok: false, error: "not-found" })
  })

  test("visitors can't approve", async () => {
    const agent = await register()
    const { error } = await anonClient().rpc("approve_marketing_agent", { agent_id: (await findAgent(agent.code)).id })
    expect(error).not.toBeNull()
    expect((await findAgent(agent.code)).status).toBe("Pending")
  })

  test("approval is recorded in history with the Manager, and the old and new status", async () => {
    const agent = await register()
    const id = (await findAgent(agent.code)).id
    await approveAgent(await signedIn(MANAGER), id)
    const rows = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select a.action, a.actor_kind, a.actor_staff_id, a.old_values ->> 'status' as was, a.new_values ->> 'status' as now
         from public.audit_log a
         where a.table_name = 'marketing_agents' and a.row_id = $1 and a.action = 'update'`,
        [id],
      )
      return result.rows
    })
    expect(rows).toEqual([{ action: "update", actor_kind: "staff", actor_staff_id: MANAGER.id, was: "Pending", now: "Approved" }])
  })
})

describe("the table itself", () => {
  test("nobody writes to it directly: staff and the secret key are refused", async () => {
    for (const client of [await signedIn(MANAGER), secretClient()]) {
      const insert = await client.from("marketing_agents").insert({ full_name: "Direct", phone: "+255711000000", code: "DIR-001" })
      expect(insert.error).not.toBeNull()
      const update = await client.from("marketing_agents").update({ status: "Approved" }).eq("code", SEEDED_PENDING.code)
      expect(update.error).not.toBeNull()
      const remove = await client.from("marketing_agents").delete().eq("code", SEEDED_PENDING.code)
      expect(remove.error).not.toBeNull()
    }
  })

  test("deletes are refused even for the database owner", async () => {
    await expect(
      inRolledBackTransaction((sql) => sql.query("delete from public.marketing_agents where code = $1", [SEEDED_PENDING.code])),
    ).rejects.toThrow(/delete_refused/)
  })

  test("the code, the phone and an approval never change once set", async () => {
    const attempt = (statement: string) =>
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(statement)
      })
    await expect(attempt(`update public.marketing_agents set code = 'NEW-001' where code = '${SEEDED_PENDING.code}'`)).rejects.toThrow(/agent_locked/)
    await expect(attempt(`update public.marketing_agents set phone = '+255711000001' where code = '${SEEDED_PENDING.code}'`)).rejects.toThrow(/agent_locked/)
    await expect(
      attempt(`update public.marketing_agents set status = 'Pending', approved_at = null, approved_by = null where code = '${SEEDED_APPROVED.code}'`),
    ).rejects.toThrow(/agent_locked/)
  })

  test("codes are normalized in the database: trimmed, uppercased, inner spaces removed, at most 20 of A-Z 0-9 - .", async () => {
    const normalized = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select v, public.normalize_referral_code(v) as code
         from unnest($1::text[]) v`,
        [["abc-123", " ABC-123", "ABC -123", " a b.c-1 ", "ABC_123", "", "   ", "A".repeat(20), "A".repeat(21), "ÄBC-123"]],
      )
      return rows.map((r) => r.code)
    })
    expect(normalized).toEqual(["ABC-123", "ABC-123", "ABC-123", "AB.C-1", null, null, null, "A".repeat(20), null, null])
  })
})
