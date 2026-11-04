import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { Client } from "pg"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"
import { approveAgent, listAgents, registerAgent } from "@/lib/services/marketing-agents"
import { estimateDiscountCode, findReferralAgent, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// One current agent per Discount code (#184): agent_for_code, the cached
// status columns and their history, and partial uniqueness. No screen retires
// or switches off an agent yet, so these tests do it as the database owner
// through record_agent_status_change, the one internal writer. Every agent and
// lead is the test's own, with invented names and numbers.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}

const asE164 = (local: string) => `+255${local.slice(1)}`

type Agent = { id: string; code: string; fullName: string; phone: string }

async function newAgent({ approved = false } = {}): Promise<Agent> {
  const fullName = `Upendo Resolver ${randomUUID().slice(0, 8)}`
  const number = phone()
  const registered = await registerAgent(secretClient(), { fullName, phone: number })
  if (!registered.ok) throw new Error(`could not register: ${JSON.stringify(registered.error)}`)
  const list = await listAgents(await signedIn(MANAGER), { query: registered.data.code, page: 1 })
  const row = list.ok ? list.data.agents.find((a) => a.code === registered.data.code) : undefined
  if (!row) throw new Error("could not find the new agent")
  if (approved) {
    const done = await approveAgent(await signedIn(MANAGER), row.id)
    if (!done.ok) throw new Error(`could not approve: ${done.error}`)
  }
  return { id: row.id, code: row.code, fullName, phone: asE164(number) }
}

async function newLead(code: string | null = null): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Resolver Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  if (code) {
    const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
    if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  }
  return created.data.leadId
}

function changeStatus(sql: Client, agentId: string, kind: string, newAgentId: string | null = null) {
  return sql.query("select public.record_agent_status_change($1, $2, $3, $4)", [agentId, kind, `Test: ${kind}`, newAgentId])
}

// Retires `old` and creates its replacement with the same code, as Recreate
// will: the status change first, then the new record, in one transaction.
async function recreate(old: Agent): Promise<Agent> {
  const replacement = { id: randomUUID(), code: old.code, fullName: `${old.fullName} Corrected`, phone: asE164(phone()) }
  await asSystem(async (sql) => {
    await changeStatus(sql, old.id, "recreated", replacement.id)
    await sql.query("insert into public.marketing_agents (id, full_name, phone, code) values ($1, $2, $3, $4)", [
      replacement.id,
      replacement.fullName,
      replacement.phone,
      replacement.code,
    ])
  })
  return replacement
}

async function fee(leadId: string) {
  const referral = await getLeadReferral(await signedIn(ADMISSIONS), leadId)
  if (!referral.ok) throw new Error(`could not read the fee: ${referral.error}`)
  return referral.data
}

// A function body that compares a marketing_agents code column, whether as
// `alias.code`, `marketing_agents.code` or a bare `code` on an unaliased
// marketing_agents query. Comments are left out first.
const NOT_ALIASES = new Set([
  "where", "on", "join", "left", "inner", "for", "using", "set", "order", "group",
  "limit", "returning", "values", "select", "union", "into",
])

function comparesAgentCode(source: string): boolean {
  const body = source.toLowerCase().replace(/--.*$/gm, "")
  const names = new Set(["marketing_agents"])
  for (const match of body.matchAll(/marketing_agents\b(?:\s+as)?\s+([a-z_][a-z0-9_]*)/g)) {
    if (!NOT_ALIASES.has(match[1])) names.add(match[1])
  }
  const comparison = "(=|<>|!=|\\bis\\s+(not\\s+)?distinct\\s+from\\b|\\bin\\s*\\(|\\blike\\b|~)"
  for (const name of names) {
    const column = `\\b${name}\\.code\\b`
    if (new RegExp(`${column}\\s*${comparison}`).test(body) || new RegExp(`${comparison}\\s*${column}`).test(body)) return true
  }
  // `from public.marketing_agents where code = …`, with no alias.
  return /marketing_agents\s+where\b[^;]*\bcode\s*(=|<>|!=|\bin\b|\bis\b)/.test(body)
}

// The two functions allowed to read agents by their code column. Every other
// lookup goes through them.
const CODE_READERS = ["agent_for_code", "agent_code_issued"]

async function functionsComparingAgentCode(sql: Client): Promise<string[]> {
  const { rows } = await sql.query<{ name: string; source: string }>(
    `select p.proname as name, p.prosrc as source
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ilike '%marketing_agents%'`,
  )
  return rows.filter((r) => !CODE_READERS.includes(r.name) && comparesAgentCode(r.source)).map((r) => r.name)
}

describe("one rule for code lookups", () => {
  test("no function compares an agent's code column except agent_for_code and agent_code_issued", async () => {
    expect(await inRolledBackTransaction(functionsComparingAgentCode)).toEqual([])
  })

  test("the check catches a function that joins the code directly", async () => {
    const caught = await inRolledBackTransaction(async (sql) => {
      await sql.query(`
        create function public.joins_agent_code_184(lead_id uuid) returns text language sql as $$
          select a.full_name from public.leads l
          left join public.marketing_agents a on a.code = l.referral_code
          where l.id = joins_agent_code_184.lead_id
        $$`)
      await sql.query(`
        create function public.filters_agent_code_184(typed text) returns bigint language sql as $$
          select count(*) from public.marketing_agents where code = typed
        $$`)
      return functionsComparingAgentCode(sql)
    })
    expect(caught.sort()).toEqual(["filters_agent_code_184", "joins_agent_code_184"])
  })

  test("agent_for_code is internal: no signed-in role, visitor or secret key may call it", async () => {
    const grants = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select r.rolname, has_function_privilege(r.rolname, 'public.agent_for_code(text)', 'execute') as can
         from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname`,
      )
      return rows
    })
    expect(grants).toEqual([
      { rolname: "anon", can: false },
      { rolname: "authenticated", can: false },
      { rolname: "service_role", can: false },
    ])
  })
})

describe("a code held by a retired record and a new one", () => {
  test("gives exactly one answer, the new record, and the fee follows the new record's status", async () => {
    const old = await newAgent({ approved: true })
    const lead = await newLead(old.code)
    expect(await fee(lead)).toMatchObject({ agentName: old.fullName, amount: 40000, discountApplied: true })

    const replacement = await recreate(old)

    const resolved = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query("select id from public.agent_for_code($1)", [old.code.toLowerCase()])
      return rows.map((r) => r.id)
    })
    expect(resolved).toEqual([replacement.id])

    // The replacement is Pending, so the code gives no discount until approved.
    expect(await fee(lead)).toEqual({
      code: old.code,
      state: "pending",
      agentName: replacement.fullName,
      amount: 50000,
      discountApplied: false,
    })
  })

  test("after the new record is approved the discount is back, through every lookup", async () => {
    const old = await newAgent({ approved: true })
    const lead = await newLead(old.code)
    const replacement = await recreate(old)
    expect(await approveAgent(await signedIn(MANAGER), replacement.id)).toEqual({ ok: true, data: null })

    expect(await fee(lead)).toMatchObject({ state: "approved", agentName: replacement.fullName, amount: 40000, discountApplied: true })
    expect(await findReferralAgent(await signedIn(ADMISSIONS), old.code)).toEqual({
      ok: true,
      data: { code: old.code, fullName: replacement.fullName, state: "approved" },
    })
    expect(await estimateDiscountCode(secretClient(), old.code)).toEqual({ ok: true, data: { state: "approved", amount: 40000 } })

    // The students follow the code to the new record; the retired one has none.
    const list = await listAgents(await signedIn(MANAGER), { query: old.code, page: 1 })
    if (!list.ok) throw new Error("list unavailable")
    const counts = Object.fromEntries(list.data.agents.filter((a) => a.code === old.code).map((a) => [a.id, a.leadCount]))
    expect(counts).toEqual({ [old.id]: 0, [replacement.id]: 1 })
  })

  test("the recreated row records both ids, the code, the student count and the lead ids", async () => {
    const old = await newAgent({ approved: true })
    const leads = [await newLead(old.code), await newLead(old.code)]
    const replacement = await recreate(old)

    const rows = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select kind, agent_id, old_agent_id, new_agent_id, code, student_count, lead_ids, reason, changed_by
         from public.agent_status_changes where agent_id = $1`,
        [old.id],
      )
      return result.rows
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: "recreated",
      agent_id: old.id,
      old_agent_id: old.id,
      new_agent_id: replacement.id,
      code: old.code,
      student_count: 2,
      reason: "Test: recreated",
      changed_by: null,
    })
    expect([...rows[0].lead_ids].sort()).toEqual([...leads].sort())
  })

  test("a recreated row must name a new record that holds the same code by commit", async () => {
    const old = await newAgent()
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await changeStatus(sql, old.id, "recreated", randomUUID())
        await sql.query("set constraints all immediate")
      }),
    ).rejects.toThrow()

    const other = await newAgent()
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await changeStatus(sql, old.id, "recreated", other.id)
        await sql.query("set constraints all immediate")
      }),
    ).rejects.toThrow(/recreated_code_mismatch/)
  })
})

describe("the discount rule", () => {
  test("an Approved agent who is switched off gives no discount, and switching on restores it", async () => {
    const agent = await newAgent({ approved: true })
    const lead = await newLead(agent.code)

    await asSystem((sql) => changeStatus(sql, agent.id, "switched_off"))
    expect(await fee(lead)).toMatchObject({ amount: 50000, discountApplied: false })
    expect(await estimateDiscountCode(secretClient(), agent.code)).toEqual({
      ok: true,
      data: { state: "switched_off", amount: 50000 },
    })

    await asSystem((sql) => changeStatus(sql, agent.id, "switched_on"))
    expect(await fee(lead)).toMatchObject({ amount: 40000, discountApplied: true })
    expect(await estimateDiscountCode(secretClient(), agent.code)).toEqual({ ok: true, data: { state: "approved", amount: 40000 } })
  })

  test("a retired Approved agent's code gives no discount and names no agent", async () => {
    const agent = await newAgent({ approved: true })
    const lead = await newLead(agent.code)
    await asSystem((sql) => changeStatus(sql, agent.id, "retired"))

    expect(await fee(lead)).toEqual({ code: agent.code, state: "unrecognised", agentName: null, amount: 50000, discountApplied: false })
    expect(await estimateDiscountCode(secretClient(), agent.code)).toEqual({ ok: true, data: { state: "unknown", amount: 50000 } })
    expect(await findReferralAgent(await signedIn(ADMISSIONS), agent.code)).toEqual({ ok: true, data: null })
  })
})

describe("setting a lead's code", () => {
  test("a code held only by a retired record is refused with its own message", async () => {
    const agent = await newAgent({ approved: true })
    await asSystem((sql) => changeStatus(sql, agent.id, "retired"))
    const lead = await newLead()
    expect(await setLeadReferralCode(await signedIn(ADMISSIONS), lead, agent.code.toLowerCase())).toEqual({
      ok: false,
      error: "retired-code",
    })
  })

  test("once the code is recreated, it is accepted again", async () => {
    const old = await newAgent()
    const replacement = await recreate(old)
    const lead = await newLead()
    expect(await setLeadReferralCode(await signedIn(ADMISSIONS), lead, old.code)).toEqual({ ok: true, data: { code: replacement.code } })
  })
})

describe("partial uniqueness", () => {
  test("a retired record's phone is free for a new registration, which gets a new code", async () => {
    const old = await newAgent()
    const again = await registerAgent(secretClient(), { fullName: old.fullName, phone: old.phone })
    expect(again).toEqual({ ok: true, data: { code: old.code } })

    await asSystem((sql) => changeStatus(sql, old.id, "retired"))
    const fresh = await registerAgent(secretClient(), { fullName: old.fullName, phone: old.phone })
    expect(fresh.ok).toBe(true)
    if (fresh.ok) expect(fresh.data.code).not.toBe(old.code)
  })

  test("two current records can't share a code or a phone; a retired one doesn't count", async () => {
    const agent = await newAgent()
    const insert = (code: string, number: string) =>
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("insert into public.marketing_agents (full_name, phone, code) values ('Duplicate', $1, $2)", [number, code])
      })
    await expect(insert(agent.code, asE164(phone()))).rejects.toThrow(/duplicate key/)
    await expect(insert(`ZZ-${randomInt(1000, 10000)}`, agent.phone)).rejects.toThrow(/duplicate key/)

    await asSystem((sql) => changeStatus(sql, agent.id, "retired"))
    await expect(insert(agent.code, agent.phone)).resolves.toBeUndefined()
  })

  test("registration never generates a code a retired record holds", async () => {
    const prefix = `R${String.fromCharCode(65 + randomInt(0, 26))}${String.fromCharCode(65 + randomInt(0, 26))}`
    const name = `${prefix[0]}ashidi ${prefix[1]}ama ${prefix[2]}uma`
    const { code, retired } = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Every three-digit code for this prefix, then all of them retired.
      await sql.query(
        `insert into public.marketing_agents (full_name, phone, code)
         select 'Retired Agent', '+2556' || lpad((n + $2::int)::text, 8, '0'), $1 || '-' || lpad(n::text, 3, '0')
         from generate_series(0, 999) n
         on conflict do nothing`,
        [prefix, randomInt(0, 90_000_000)],
      )
      const { rows } = await sql.query(
        `select count(public.record_agent_status_change(a.id, 'retired', 'Test: retired', null))::int as retired
         from public.marketing_agents a where a.full_name = 'Retired Agent' and a.retired_at is null and a.code like $1 || '-___'`,
        [prefix],
      )
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
      await sql.query("set local role service_role")
      const made = await sql.query("select public.register_marketing_agent($1, $2, null) as code", [name, phone()])
      return { code: made.rows[0].code as string, retired: rows[0].retired as number }
    })
    expect(retired).toBe(1000)
    expect(code).toMatch(new RegExp(`^${prefix}-\\d{4}$`))
  }, 60_000)
})

describe("the cached status columns and their history", () => {
  async function state(agentId: string) {
    return inRolledBackTransaction(async (sql) => {
      const agent = await sql.query<{ retired_at: Date | null; switched_off_at: Date | null }>(
        "select retired_at, switched_off_at from public.marketing_agents where id = $1",
        [agentId],
      )
      const changes = await sql.query(
        "select kind, changed_at from public.agent_status_changes where agent_id = $1 order by changed_at, sequence",
        [agentId],
      )
      return { ...agent.rows[0], changes: changes.rows as { kind: string; changed_at: Date }[] }
    })
  }

  // What the history says the cache should hold.
  function expected(changes: { kind: string; changed_at: Date }[]) {
    let switchedOff: Date | null = null
    let retired: Date | null = null
    for (const change of changes) {
      if (change.kind === "switched_off") switchedOff = change.changed_at
      if (change.kind === "switched_on") switchedOff = null
      if (change.kind === "retired" || change.kind === "recreated") retired = change.changed_at
    }
    return { switched_off_at: switchedOff, retired_at: retired }
  }

  test("each change writes the cache and a history row together, and the two agree", async () => {
    const agent = await newAgent({ approved: true })
    expect(await state(agent.id)).toEqual({ retired_at: null, switched_off_at: null, changes: [] })

    for (const kind of ["switched_off", "switched_on", "switched_off", "retired"]) {
      await asSystem((sql) => changeStatus(sql, agent.id, kind))
      const now = await state(agent.id)
      expect(now.changes.at(-1)?.kind).toBe(kind)
      expect({ retired_at: now.retired_at, switched_off_at: now.switched_off_at }).toEqual(expected(now.changes))
    }
    expect((await state(agent.id)).changes).toHaveLength(4)
  })

  test("a change whose transaction began before another committed still replays after it", async () => {
    const agent = await newAgent({ approved: true })
    // Opened first, so its transaction start is earlier than the switch-off.
    const early = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await early.connect()
    try {
      await early.query("begin")
      await early.query("select public.set_audit_actor('system')")
      await new Promise((resolve) => setTimeout(resolve, 20))

      await asSystem((sql) => changeStatus(sql, agent.id, "switched_off"))

      await changeStatus(early, agent.id, "switched_on")
      await early.query("commit")
    } finally {
      await early.query("rollback").catch(() => {})
      await early.end()
    }

    const now = await state(agent.id)
    expect(now.changes.map((c) => c.kind)).toEqual(["switched_off", "switched_on"])
    expect(now.switched_off_at).toBeNull()
    expect({ retired_at: now.retired_at, switched_off_at: now.switched_off_at }).toEqual(expected(now.changes))
  })

  test("a change that doesn't apply is refused and writes nothing", async () => {
    const agent = await newAgent()
    const attempt = (kind: string) => asSystem((sql) => changeStatus(sql, agent.id, kind))
    await expect(attempt("switched_on")).rejects.toThrow(/no_change/)
    await attempt("switched_off")
    await expect(attempt("switched_off")).rejects.toThrow(/no_change/)
    await attempt("retired")
    for (const kind of ["retired", "switched_on", "switched_off"]) {
      await expect(attempt(kind)).rejects.toThrow(/agent_retired/)
    }
    await expect(asSystem((sql) => changeStatus(sql, agent.id, "recreated", randomUUID()))).rejects.toThrow(/agent_retired/)
    await expect(attempt("recreated")).rejects.toThrow(/invalid/)
    await expect(asSystem((sql) => changeStatus(sql, randomUUID(), "retired"))).rejects.toThrow(/not_found/)
    await expect(
      asSystem((sql) => sql.query("select public.record_agent_status_change($1, 'switched_on', '  ', null)", [agent.id])),
    ).rejects.toThrow(/invalid/)
    expect((await state(agent.id)).changes.map((c) => c.kind)).toEqual(["switched_off", "retired"])
  })

  test("the cache can't be written without the history: set, changed or cleared directly", async () => {
    const agent = await newAgent()
    const direct = (statement: string, params: unknown[] = [agent.id]) =>
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(statement, params)
      })
    await expect(direct("update public.marketing_agents set retired_at = now() where id = $1")).rejects.toThrow(/agent_status_cached/)
    await expect(direct("update public.marketing_agents set switched_off_at = now() where id = $1")).rejects.toThrow(/agent_status_cached/)
    await expect(
      direct("insert into public.marketing_agents (full_name, phone, code, switched_off_at) values ('Cached', $1, 'CACHED-1', now())", [
        asE164(phone()),
      ]),
    ).rejects.toThrow(/agent_status_cached/)

    await asSystem((sql) => changeStatus(sql, agent.id, "retired"))
    await expect(direct("update public.marketing_agents set retired_at = null where id = $1")).rejects.toThrow(/agent_status_cached/)
    await expect(direct("update public.marketing_agents set full_name = 'Renamed' where id = $1")).rejects.toThrow(/agent_locked/)
  })

  test("a retired record can't be approved, and status stays locked once Approved", async () => {
    const pending = await newAgent()
    await asSystem((sql) => changeStatus(sql, pending.id, "retired"))
    expect(await approveAgent(await signedIn(MANAGER), pending.id)).toEqual({ ok: false, error: "no-change" })

    const approved = await newAgent({ approved: true })
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.marketing_agents set status = 'Pending', approved_at = null, approved_by = null where id = $1", [
          approved.id,
        ])
      }),
    ).rejects.toThrow(/agent_locked/)
  })

  test("the history is append-only, audited, read by staff who may view leads, and written by no API role", async () => {
    const agent = await newAgent()
    await asSystem((sql) => changeStatus(sql, agent.id, "switched_off"))

    for (const statement of [
      "update public.agent_status_changes set reason = 'x' where agent_id = $1",
      "delete from public.agent_status_changes where agent_id = $1",
    ]) {
      await expect(inRolledBackTransaction((sql) => sql.query(statement, [agent.id]))).rejects.toThrow(/update_refused|delete_refused/)
    }

    const audit = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select a.action, a.actor_kind, a.scope from public.audit_log a
         join public.agent_status_changes c on c.id = a.row_id
         where a.table_name = 'agent_status_changes' and c.agent_id = $1`,
        [agent.id],
      )
      return rows
    })
    expect(audit).toEqual([{ action: "insert", actor_kind: "system", scope: "lead" }])

    const manager = await signedIn(MANAGER)
    const read = await manager.from("agent_status_changes").select("kind").eq("agent_id", agent.id)
    expect(read).toMatchObject({ error: null, data: [{ kind: "switched_off" }] })
    const insert = await manager.from("agent_status_changes").insert({ agent_id: agent.id, kind: "switched_on", reason: "x" })
    expect(insert.error).not.toBeNull()
    const rpc = await manager.rpc("record_agent_status_change", { agent_id: agent.id, kind: "switched_on", reason: "x", new_agent_id: null })
    expect(rpc.error).not.toBeNull()
    const secret = await secretClient().from("agent_status_changes").insert({ agent_id: agent.id, kind: "switched_on", reason: "x" })
    expect(secret.error).not.toBeNull()
  })

  test("staff without leads.view and visitors not signed in read no history", async () => {
    const agent = await newAgent()
    await asSystem((sql) => changeStatus(sql, agent.id, "switched_off"))
    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [outsider, anonClient()]) {
      const read = await client.from("agent_status_changes").select("kind").eq("agent_id", agent.id)
      expect(read.data ?? []).toEqual([])
    }
  })
})

describe("lead_count, called directly", () => {
  // Calls lead_count with the agent's own row inside a session for `staffId`,
  // as the API would, so the permission check is what decides.
  async function countAs(staffId: string, agentId: string) {
    return inRolledBackTransaction(async (sql) => {
      const row = await sql.query<{ agent: string }>("select a::text as agent from public.marketing_agents a where a.id = $1", [agentId])
      const { rows } = await sql.query("select user_id from public.staff_members where id = $1", [staffId])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
      await sql.query("set local role authenticated")
      const counted = await sql.query<{ count: string }>("select public.lead_count($1::public.marketing_agents)::text as count", [
        row.rows[0].agent,
      ])
      return Number(counted.rows[0].count)
    })
  }

  test("counts the agent's leads for staff who may view leads and nothing for staff who may not", async () => {
    const agent = await newAgent({ approved: true })
    await newLead(agent.code)
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await countAs(ADMISSIONS.id, agent.id)).toBe(1)
    expect(await countAs(outsider.id, agent.id)).toBe(0)
  })

  test("can't be called by a visitor who isn't signed in", async () => {
    const agent = await newAgent()
    await expect(
      inRolledBackTransaction(async (sql) => {
        const row = await sql.query<{ agent: string }>("select a::text as agent from public.marketing_agents a where a.id = $1", [agent.id])
        await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })])
        await sql.query("set local role anon")
        await sql.query("select public.lead_count($1::public.marketing_agents)", [row.rows[0].agent])
      }),
    ).rejects.toThrow(/permission denied/)
  })
})
