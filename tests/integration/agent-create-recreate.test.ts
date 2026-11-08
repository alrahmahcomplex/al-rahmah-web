import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { signUpAgent } from "@/lib/services/agent-sign-up"
import { getLeadInterviews, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import {
  changeAgentStatus,
  checkNewAgent,
  createAgent,
  getRecreatePreview,
  listAgents,
  recreateAgent,
} from "@/lib/services/marketing-agents"
import { findReferralAgent, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { registerApprovedAgent } from "../support/agents"
import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// Creating an agent and recreating a retired one (#189), through the
// Manager's actions, against local Supabase. Every agent and lead is the
// test's own, with invented names, numbers and codes.

const DAY = 24 * 60 * 60 * 1000
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(tanzaniaToday().slice(0, 4))

function phone() {
  return `07${String(randomInt(10_000_000, 100_000_000)).padStart(8, "0")}`
}
const asE164 = (local: string) => `+255${local.slice(1)}`

// A code no record holds: two letters and five digits, from 676 million.
function freshCode() {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  return `T${letter()}${letter()}-${randomInt(10_000, 100_000)}`
}

function name(stem = "Neema Create") {
  return `${stem} ${randomUUID().slice(0, 8)}`
}

type Agent = { id: string; code: string; fullName: string; phone: string }

async function approvedAgent(): Promise<Agent> {
  const fullName = name("Baraka Recreate")
  const number = phone()
  const { id, code } = await registerApprovedAgent(MANAGER, { fullName, phone: number })
  return { id, code, fullName, phone: asE164(number) }
}

async function codedLead(code: string, { register = false } = {}) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Create Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 5", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  if (!register) return { leadId: created.data.leadId, interviewId: null }
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { leadId: created.data.leadId, interviewId: registered.data.interviewId }
}

async function interviewFee(leadId: string) {
  const interviews = await getLeadInterviews(await signedIn(ADMISSIONS), leadId)
  if (!interviews.ok) throw new Error(`could not read the interviews: ${interviews.error}`)
  return { amount: interviews.data[0].amount, feeStatus: interviews.data[0].feeStatus }
}

async function agentRow(id: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query(
          "select id, full_name, phone, whatsapp, email, code, status::text, approved_by, retired_at, switched_off_at, user_id from public.marketing_agents where id = $1",
          [id],
        )
      ).rows[0],
  )
}

async function agentsWithPhone(e164: string) {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select id from public.marketing_agents where phone = $1", [e164])).rows.map((r) => r.id as string),
  )
}

async function retire(agentId: string) {
  const done = await changeAgentStatus(await signedIn(MANAGER), agentId, "retire", "Test: wrong record")
  if (!done.ok) throw new Error(`could not retire: ${done.error}`)
}

describe("Seam 1: the Manager creates an agent", () => {
  test("the agent starts Approved, approved by the Manager, with the normalised phone, a confirmed email and a generated code", async () => {
    const fullName = name()
    const number = phone()
    const email = `${randomUUID().slice(0, 8)}@Example.TEST`
    const created = await createAgent(await signedIn(MANAGER), { fullName: `  ${fullName} `, phone: number, email: ` ${email} ` })
    expect(created).toEqual({
      ok: true,
      data: { kind: "created", agent: { id: expect.any(String), fullName, code: expect.stringMatching(/^NC[A-Z]?-\d{3,4}$/), phone: asE164(number) } },
    })
    if (!created.ok || created.data.kind !== "created") return
    expect(await agentRow(created.data.agent.id)).toMatchObject({
      status: "Approved",
      approved_by: MANAGER.id,
      email: email.toLowerCase(),
      whatsapp: null,
      retired_at: null,
      switched_off_at: null,
    })
    // The audit names the Manager as the one who created it.
    const audit = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query("select actor_kind::text, actor_staff_id from public.audit_log where table_name = 'marketing_agents' and row_id = $1 and action = 'insert'", [
            created.data.kind === "created" ? created.data.agent.id : "",
          ])
        ).rows,
    )
    expect(audit).toEqual([{ actor_kind: "staff", actor_staff_id: MANAGER.id }])
  })

  test("a supplied existing code is kept, normalised, and leads already carrying it get the discount", async () => {
    const code = freshCode()
    const lead = await codedLeadWithUnknownCode(code)
    const created = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: phone(), code: ` ${code.toLowerCase()} ` })
    expect(created).toMatchObject({ ok: true, data: { kind: "created", agent: { code } } })
    expect(await getLeadReferral(await signedIn(ADMISSIONS), lead)).toMatchObject({ ok: true, data: { state: "approved", amount: 40000 } })
  })

  test("a phone already used returns the existing agent, with name, code and status, and creates nothing", async () => {
    const existing = await approvedAgent()
    const local = `0${existing.phone.slice(4)}`
    const before = await agentsWithPhone(existing.phone)
    const answer = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: local, code: freshCode() })
    expect(answer).toEqual({
      ok: true,
      data: { kind: "phone-taken", agent: { id: existing.id, fullName: existing.fullName, code: existing.code, state: "Approved" } },
    })
    expect(await agentsWithPhone(existing.phone)).toEqual(before)

    expect((await changeAgentStatus(await signedIn(MANAGER), existing.id, "switch-off", "Test")).ok).toBe(true)
    expect(await createAgent(await signedIn(MANAGER), { fullName: name(), phone: local })).toMatchObject({
      ok: true,
      data: { kind: "phone-taken", agent: { id: existing.id, state: "Switched off" } },
    })
  })

  test("a supplied code a current agent holds is refused, naming that agent, and creates nothing", async () => {
    const existing = await approvedAgent()
    const number = phone()
    const answer = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: number, code: existing.code.toLowerCase() })
    expect(answer).toEqual({
      ok: true,
      data: { kind: "code-taken", agent: { id: existing.id, fullName: existing.fullName, code: existing.code, state: "Approved" } },
    })
    expect(await agentsWithPhone(asE164(number))).toEqual([])
  })

  test("a code a retired record held offers Recreate, with the record's name and how many students carry the code", async () => {
    const old = await approvedAgent()
    await codedLead(old.code)
    await codedLead(old.code)
    await retire(old.id)
    const number = phone()
    const answer = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: number, code: old.code })
    expect(answer).toEqual({
      ok: true,
      data: { kind: "retired-code", agent: { id: old.id, fullName: old.fullName, code: old.code }, studentCount: 2 },
    })
    expect(await agentsWithPhone(asE164(number))).toEqual([])
  })

  test("generated codes skip codes already on leads", async () => {
    // Every three-digit code for this name's prefix is on a lead with no
    // agent behind it, so the generated code has four digits.
    const prefix = `Q${String.fromCharCode(65 + randomInt(0, 26))}${String.fromCharCode(65 + randomInt(0, 26))}`
    const fullName = `${prefix[0]}uddus ${prefix[1]}aleh ${prefix[2]}atibu`
    const template = await codedLeadWithUnknownCode(freshCode())
    const { code, coded } = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Admission numbers are drawn at random from the free ones, as the
      // app and other suites draw theirs. One taken by a transaction running
      // alongside raises a unique violation, so the planting retries from a
      // savepoint with a fresh draw.
      let inserted
      for (let attempt = 1; ; attempt++) {
        await sql.query("savepoint plant")
        try {
          inserted = await sql.query(
            `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, guardian_contact_id, status, visit_date, referral_code)
             select free.number, 'Coded ' || free.n, l.class_name, l.enrollment_year, l.day_or_boarding, l.guardian_contact_id, l.status, l.visit_date,
                    $1 || '-' || lpad((free.n - 1)::text, 3, '0')
             from public.leads l,
                  (select number, row_number() over () as n
                   from (select 'ADMSN-' || lpad(g::text, 5, '0') as number
                         from generate_series(0, 99999) g
                         where not exists (select 1 from public.leads x where x.admission_number = 'ADMSN-' || lpad(g::text, 5, '0'))
                         order by random()
                         limit 1000) picked) free
             where l.id = $2`,
            [prefix, template],
          )
          await sql.query("release savepoint plant")
          break
        } catch (error) {
          if ((error as { code?: string }).code !== "23505" || attempt === 5) throw error
          await sql.query("rollback to savepoint plant")
        }
      }
      const { rows } = await sql.query("select agent_id from public.create_agent_record($1, $2, null, null, null, 'Pending', null)", [
        fullName,
        asE164(phone()),
      ])
      const made = await sql.query("select code from public.marketing_agents where id = $1", [rows[0].agent_id])
      return { code: made.rows[0].code as string, coded: inserted!.rowCount }
    })
    expect(coded).toBe(1000)
    expect(code).toMatch(new RegExp(`^${prefix}-\\d{4}$`))
  }, 60_000)

  test("refuses bad input field by field", async () => {
    const manager = await signedIn(MANAGER)
    expect(await createAgent(manager, { fullName: "x", phone: phone() })).toEqual({ ok: false, error: { kind: "invalid", field: "full_name" } })
    expect(await createAgent(manager, { fullName: name(), phone: "12" })).toEqual({ ok: false, error: { kind: "invalid", field: "phone" } })
    expect(await createAgent(manager, { fullName: name(), phone: phone(), whatsapp: "abc" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "whatsapp" },
    })
    expect(await createAgent(manager, { fullName: name(), phone: phone(), email: "not-an-email" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "email" },
    })
    expect(await createAgent(manager, { fullName: name(), phone: phone(), code: "BAD CODE!" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "code" },
    })
  })

  test("an email a current agent or a staff member uses is refused", async () => {
    const email = `${randomUUID().slice(0, 8)}@example.test`
    const manager = await signedIn(MANAGER)
    expect((await createAgent(manager, { fullName: name(), phone: phone(), email })).ok).toBe(true)
    expect(await createAgent(manager, { fullName: name(), phone: phone(), email: email.toUpperCase() })).toMatchObject({
      ok: false,
      error: { kind: "email-taken" },
    })
    expect(await createAgent(manager, { fullName: name(), phone: phone(), email: ADMISSIONS.email })).toMatchObject({
      ok: false,
      error: { kind: "email-taken" },
    })
  })

  test("Admissions Staff, the Accountant and a signed-out visitor are refused, and nothing is created", async () => {
    const number = phone()
    for (const client of [await signedIn(ADMISSIONS), await signedIn(ACCOUNTANT), anonClient()]) {
      expect(await createAgent(client, { fullName: name(), phone: number })).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await checkNewAgent(client, { fullName: name(), phone: number })).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await agentsWithPhone(asE164(number))).toEqual([])
  })
})

describe("checking an agent before saving", () => {
  test("shows the normalised phone, WhatsApp, email and code, or the code's prefix when it will be generated, and saves nothing", async () => {
    const number = phone()
    const whatsapp = phone()
    const code = freshCode()
    const manager = await signedIn(MANAGER)
    expect(
      await checkNewAgent(manager, { fullName: "Neema Asha Create", phone: number, whatsapp, email: " A@B.TEST ", code: code.toLowerCase() }),
    ).toEqual({
      ok: true,
      data: { kind: "ready", fullName: "Neema Asha Create", phone: asE164(number), whatsapp: asE164(whatsapp), email: "a@b.test", code, codePrefix: "NAC" },
    })
    expect(await checkNewAgent(manager, { fullName: "Neema Asha Create", phone: number })).toMatchObject({
      ok: true,
      data: { kind: "ready", code: null, codePrefix: "NAC" },
    })
    expect(await agentsWithPhone(asE164(number))).toEqual([])
  })

  test("names a phone already used, a code taken and a retired code, as saving would", async () => {
    const existing = await approvedAgent()
    const manager = await signedIn(MANAGER)
    expect(await checkNewAgent(manager, { fullName: name(), phone: existing.phone })).toMatchObject({
      ok: true,
      data: { kind: "phone-taken", agent: { id: existing.id } },
    })
    expect(await checkNewAgent(manager, { fullName: name(), phone: phone(), code: existing.code })).toMatchObject({
      ok: true,
      data: { kind: "code-taken", agent: { id: existing.id } },
    })
    await retire(existing.id)
    expect(await checkNewAgent(manager, { fullName: name(), phone: phone(), code: existing.code })).toMatchObject({
      ok: true,
      data: { kind: "retired-code", agent: { id: existing.id }, studentCount: 0 },
    })
  })
})

// A lead carrying a code no agent holds: set as the database owner, since
// staff can only set a code an agent holds.
async function codedLeadWithUnknownCode(code: string) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Create Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 5", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await asSystem((sql) => sql.query("update public.leads set referral_code = $1 where id = $2", [code, created.data.leadId]))
  return created.data.leadId
}

describe("Seam 1: Recreate", () => {
  test("retires a current record and creates the corrected one with the same code, in one step; students and the fee stay", async () => {
    const old = await approvedAgent()
    const unpaid = await codedLead(old.code, { register: true })
    const other = await codedLead(old.code)
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })

    const preview = await getRecreatePreview(await signedIn(MANAGER), old.id)
    expect(preview).toEqual({
      ok: true,
      data: {
        agent: { id: old.id, fullName: old.fullName, phone: old.phone, whatsapp: null, email: null, code: old.code, retired: false },
        studentCount: 2,
        // Approved before and after: no fee moves.
        families: [],
      },
    })

    const correctedName = `${old.fullName} Corrected`
    const done = await recreateAgent(await signedIn(MANAGER), old.id, { fullName: correctedName, phone: old.phone }, "Name spelled wrong")
    expect(done).toEqual({
      ok: true,
      data: { agent: { id: expect.any(String), fullName: correctedName, code: old.code }, studentCount: 2, feeChangeCount: 0 },
    })
    if (!done.ok) return
    const replacement = done.data.agent.id

    expect(await agentRow(old.id)).toMatchObject({ retired_at: expect.any(Date) })
    expect(await agentRow(replacement)).toMatchObject({ status: "Approved", approved_by: MANAGER.id, switched_off_at: null, retired_at: null, code: old.code })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
    expect(await getLeadReferral(await signedIn(ADMISSIONS), other.leadId)).toMatchObject({
      ok: true,
      data: { state: "approved", agentName: correctedName, amount: 40000 },
    })
    expect(await findReferralAgent(await signedIn(ADMISSIONS), old.code)).toEqual({
      ok: true,
      data: { code: old.code, fullName: correctedName, state: "approved" },
    })

    const history = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            "select kind, old_agent_id, new_agent_id, code, student_count, lead_ids, reason, changed_by from public.agent_status_changes where agent_id = $1",
            [old.id],
          )
        ).rows,
    )
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      kind: "recreated",
      old_agent_id: old.id,
      new_agent_id: replacement,
      code: old.code,
      student_count: 2,
      reason: "Name spelled wrong",
      changed_by: MANAGER.id,
    })
    expect([...history[0].lead_ids].sort()).toEqual([unpaid.leadId, other.leadId].sort())

    // The list names the replacement on the retired row.
    const retired = await listAgents(await signedIn(MANAGER), { status: "Retired", query: old.code, page: 1 })
    expect(retired.ok && retired.data.agents.find((a) => a.id === old.id)?.statusChange).toMatchObject({
      kind: "recreated",
      replacedBy: { fullName: correctedName, code: old.code },
    })
  })

  test("moves a linked login to the new record", async () => {
    const old = await approvedAgent()
    const userId = await linkLogin(old.id)
    const done = await recreateAgent(await signedIn(MANAGER), old.id, { fullName: old.fullName, phone: old.phone }, "Wrong WhatsApp")
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(await agentRow(old.id)).toMatchObject({ user_id: null })
    expect(await agentRow(done.data.agent.id)).toMatchObject({ user_id: userId })
  })

  test("recreates a retired record whose code no one holds: the students return to the code and their unpaid fees get the discount back", async () => {
    const old = await approvedAgent()
    const unpaid = await codedLead(old.code, { register: true })
    const paid = await codedLead(old.code, { register: true })
    expect((await setInterviewFeeStatus(await signedIn(ACCOUNTANT), paid.interviewId!, "paid")).ok).toBe(true)
    await retire(old.id)
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 50000, feeStatus: "Not Paid" })

    const preview = await getRecreatePreview(await signedIn(MANAGER), old.id)
    expect(preview).toMatchObject({
      ok: true,
      data: { agent: { id: old.id, retired: true }, studentCount: 2, families: [{ leadId: unpaid.leadId, feeNow: 50000, feeAfter: 40000 }] },
    })

    const number = phone()
    const done = await recreateAgent(await signedIn(MANAGER), old.id, { fullName: old.fullName, phone: number }, "Same person, new number")
    expect(done).toEqual({
      ok: true,
      data: { agent: { id: expect.any(String), fullName: old.fullName, code: old.code }, studentCount: 2, feeChangeCount: 1 },
    })
    expect(await interviewFee(unpaid.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
    expect(await interviewFee(paid.leadId)).toEqual({ amount: 40000, feeStatus: "Paid" })

    // Once the code is held again, the retired record can't be recreated twice.
    expect(await recreateAgent(await signedIn(MANAGER), old.id, { fullName: old.fullName, phone: phone() }, "Again")).toEqual({
      ok: false,
      error: { kind: "retired" },
    })
  })

  test("a phone another current agent uses is refused, and the old record stays as it was", async () => {
    const old = await approvedAgent()
    const other = await approvedAgent()
    expect(await recreateAgent(await signedIn(MANAGER), old.id, { fullName: old.fullName, phone: other.phone }, "Wrong number")).toEqual({
      ok: false,
      error: { kind: "phone-taken", agent: { id: other.id, fullName: other.fullName, code: other.code, state: "Approved" } },
    })
    expect(await agentRow(old.id)).toMatchObject({ retired_at: null })
  })

  test("needs a reason", async () => {
    const old = await approvedAgent()
    for (const reason of ["", "   ", "x".repeat(501)]) {
      expect(await recreateAgent(await signedIn(MANAGER), old.id, { fullName: old.fullName, phone: old.phone }, reason)).toEqual({
        ok: false,
        error: { kind: "invalid", field: "reason" },
      })
    }
    expect(await agentRow(old.id)).toMatchObject({ retired_at: null })
  })

  test("Admissions Staff, the Accountant and a signed-out visitor are refused, and nothing changes", async () => {
    const old = await approvedAgent()
    const lead = await codedLead(old.code, { register: true })
    for (const client of [await signedIn(ADMISSIONS), await signedIn(ACCOUNTANT), anonClient()]) {
      expect(await recreateAgent(client, old.id, { fullName: old.fullName, phone: old.phone }, "Not mine")).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
      expect(await getRecreatePreview(client, old.id)).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await agentRow(old.id)).toMatchObject({ retired_at: null })
    expect(await interviewFee(lead.leadId)).toEqual({ amount: 40000, feeStatus: "Not Paid" })
  })
})

describe("public registration through the shared creation function", () => {
  test("keeps its retry guarantee: the same details twice return the same code and make one agent", async () => {
    const number = phone()
    const fullName = name("Rehema Register")
    const email = `rehema-${randomUUID().slice(0, 8)}@example.test`
    const signUp = () => signUpAgent(secretClient(), { fullName, phone: number, whatsapp: null, email, hasCode: false, code: null })
    const first = await signUp()
    const again = await signUp()
    expect(first.ok && first.data.kind).toBe("registered")
    expect(again).toEqual(first)
    expect(await agentsWithPhone(asE164(number))).toHaveLength(1)
    const code = first.ok && first.data.kind === "registered" ? first.data.code : ""
    const listed = await listAgents(await signedIn(MANAGER), { query: code, page: 1 })
    expect(listed.ok && listed.data.agents[0]).toMatchObject({ status: "Pending", approvedAt: null })
  })

  // #196 dropped register_marketing_agent(full_name, phone, whatsapp), the
  // registration function from before sign-up took an email (#193).
  test("the old three-argument registration function is gone", async () => {
    const remaining = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ args: string }>(
        `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'register_marketing_agent'`,
      )
      return rows.map((row) => row.args)
    })
    expect(remaining).toEqual([])

    const { data, error } = await secretClient().rpc("register_marketing_agent", { full_name: name(), phone: phone(), whatsapp: null })
    expect(error?.code).toBe("PGRST202")
    expect(data).toBeNull()
  })
})

// Gives an agent record a login, as agent sign-in does (#188): a confirmed
// email on the record, then the auth user, which the sign-up trigger links.
async function linkLogin(agentId: string): Promise<string> {
  const email = `login-${randomUUID().slice(0, 8)}@example.test`
  await asSystem((sql) => sql.query("update public.marketing_agents set email = $1 where id = $2", [email, agentId]))
  const { data, error } = await secretClient().auth.admin.createUser({ email, password: "fixture-password", email_confirm: true })
  if (error || !data.user) throw new Error(`could not create the login: ${error?.message}`)
  return data.user.id
}

// A direct connection acting as `person`'s signed-in session, as the API
// would, for holding a transaction open while another one runs.
async function sessionOf(person: { id: string }) {
  const { Client } = await import("pg")
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  // A deadlock or a lost wake-up fails the test instead of hanging it.
  await sql.query("set statement_timeout = '15s'")
  await sql.query("begin")
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [person.id])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  return sql
}

async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
  const waiting = Symbol("waiting")
  const first = await Promise.race([promise.then(() => null, () => null), new Promise((resolve) => setTimeout(() => resolve(waiting), 500))])
  return first === waiting
}

async function lockedAmount(interviewId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query<{ locked_amount: number | null }>("select locked_amount from public.interviews where id = $1", [interviewId])).rows[0]
        .locked_amount,
  )
}

async function recreatedCount(agentId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select fee_change_count from public.agent_status_changes where agent_id = $1 and kind = 'recreated'", [agentId])).rows.map(
        (r) => r.fee_change_count as number,
      ),
  )
}

describe("a payment and the Recreate of a retired code at once", () => {
  test("a fee marked Paid during the Recreate waits for it, and is locked at the discounted fee the count promised", async () => {
    const old = await approvedAgent()
    const lead = await codedLead(old.code, { register: true })
    await retire(old.id)
    const manager = await sessionOf(MANAGER)
    const accountant = await sessionOf(ACCOUNTANT)
    try {
      const done = await manager.query("select public.recreate_marketing_agent($1, $2, $3, null, null, 'Same person') as r", [
        old.id,
        old.fullName,
        phone(),
      ])
      expect(done.rows[0].r.fee_change_count).toBe(1)
      const paying = accountant.query("select public.set_interview_fee_status($1, 'Paid')", [lead.interviewId])
      expect(await stillWaiting(paying)).toBe(true)
      await manager.query("commit")
      await paying
      await accountant.query("commit")
    } finally {
      await Promise.all([manager.end(), accountant.end()])
    }
    expect(await lockedAmount(lead.interviewId!)).toBe(40000)
    expect(await recreatedCount(old.id)).toEqual([1])
  })

  test("a Recreate during a payment waits for it, and doesn't count the fee just Paid", async () => {
    const old = await approvedAgent()
    const lead = await codedLead(old.code, { register: true })
    await retire(old.id)
    const accountant = await sessionOf(ACCOUNTANT)
    const manager = await sessionOf(MANAGER)
    try {
      await accountant.query("select public.set_interview_fee_status($1, 'Paid')", [lead.interviewId])
      const recreating = manager.query("select public.recreate_marketing_agent($1, $2, $3, null, null, 'Same person') as r", [
        old.id,
        old.fullName,
        phone(),
      ])
      expect(await stillWaiting(recreating)).toBe(true)
      await accountant.query("commit")
      expect((await recreating).rows[0].r.fee_change_count).toBe(0)
      await manager.query("commit")
    } finally {
      await Promise.all([manager.end(), accountant.end()])
    }
    expect(await lockedAmount(lead.interviewId!)).toBe(50000)
    expect(await recreatedCount(old.id)).toEqual([0])
  })
})

describe("retiring", () => {
  test("detaches a linked login, so a retired record never holds one", async () => {
    const agent = await approvedAgent()
    await linkLogin(agent.id)
    await retire(agent.id)
    expect(await agentRow(agent.id)).toMatchObject({ user_id: null, retired_at: expect.any(Date) })
  })
})

describe("retiring records the detached login", () => {
  test("the retire's history keeps the login id for the ban step, out of staff reach", async () => {
    const agent = await approvedAgent()
    const userId = await linkLogin(agent.id)
    await retire(agent.id)
    const detached = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            `select c.kind, d.user_id
             from public.agent_detached_logins d
             join public.agent_status_changes c on c.id = d.status_change_id
             where c.agent_id = $1`,
            [agent.id],
          )
        ).rows,
    )
    expect(detached).toEqual([{ kind: "retired", user_id: userId }])

    // The Manager reads the history, but not the detached login.
    const { error } = await (await signedIn(MANAGER)).from("agent_detached_logins").select("user_id")
    expect(error?.code).toBe("42501")
  })

  test("retiring a record with no login, and Recreate, which moves the login, record none", async () => {
    const plain = await approvedAgent()
    await retire(plain.id)
    const moved = await approvedAgent()
    await linkLogin(moved.id)
    const done = await recreateAgent(await signedIn(MANAGER), moved.id, { fullName: moved.fullName, phone: moved.phone }, "Wrong name")
    expect(done.ok).toBe(true)
    const rows = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            `select d.user_id from public.agent_detached_logins d
             join public.agent_status_changes c on c.id = d.status_change_id
             where c.agent_id = any($1)`,
            [[plain.id, moved.id]],
          )
        ).rows,
    )
    expect(rows).toEqual([])
  })
})

describe("an email belongs to one login: staff or agent", () => {
  async function inviteRoleId() {
    return inRolledBackTransaction(
      async (sql) => (await sql.query<{ id: string }>("select id from public.roles where name = 'Admissions Staff'")).rows[0].id,
    )
  }

  test("a current agent's email can't be given to a staff member; a retired agent's can", async () => {
    const email = `agent-${randomUUID().slice(0, 8)}@example.test`
    const created = await createAgent(await signedIn(MANAGER), { fullName: name(), phone: phone(), email })
    expect(created.ok && created.data.kind).toBe("created")
    const administrator = await signedIn(SUPER_ADMIN)
    const roleId = await inviteRoleId()

    const refused = await administrator.rpc("invite_staff_member", { full_name: "Staff Clash", email: email.toUpperCase(), role_id: roleId })
    expect(refused.error?.message).toBe("email_in_use")
    expect(JSON.parse(refused.error?.details ?? "{}")).toEqual({ email })

    if (created.ok && created.data.kind === "created") await retire(created.data.agent.id)
    const invited = await administrator.rpc("invite_staff_member", { full_name: "Staff Clash", email, role_id: roleId })
    expect(invited.error).toBeNull()
  })

  test("a staff email can't be given to an agent", async () => {
    const staff = await createThrowawayStaff([])
    expect(await createAgent(await signedIn(MANAGER), { fullName: name(), phone: phone(), email: staff.email })).toMatchObject({
      ok: false,
      error: { kind: "email-taken" },
    })
  })

  test("an agent create and a staff invite of one email at once: the second waits and is refused", async () => {
    const roleId = await inviteRoleId()
    const inviter = SUPER_ADMIN
    for (const first of ["agent", "staff"] as const) {
      const email = `race-${randomUUID().slice(0, 8)}@example.test`
      const manager = await sessionOf(MANAGER)
      const administrator = await sessionOf(inviter)
      const createAgentSql = () =>
        manager.query("select public.create_marketing_agent($1, $2, null, $3, null) as r", [name(), phone(), email])
      const inviteSql = () => administrator.query("select public.invite_staff_member('Race Staff', $1, $2)", [email, roleId])
      try {
        if (first === "agent") {
          expect((await createAgentSql()).rows[0].r.outcome).toBe("created")
          const inviting = inviteSql()
          expect(await stillWaiting(inviting)).toBe(true)
          await manager.query("commit")
          await expect(inviting).rejects.toThrow("email_in_use")
        } else {
          await inviteSql()
          const creating = createAgentSql()
          expect(await stillWaiting(creating)).toBe(true)
          await administrator.query("commit")
          await expect(creating).rejects.toThrow("email_taken")
        }
      } finally {
        await Promise.all([manager.end(), administrator.end()])
      }
    }
  })

  test("two agent creates of one email at once: one is created, the other refused", async () => {
    const email = `twice-${randomUUID().slice(0, 8)}@example.test`
    const first = await sessionOf(MANAGER)
    const second = await sessionOf(MANAGER)
    try {
      const create = (sql: Awaited<ReturnType<typeof sessionOf>>) =>
        sql.query("select public.create_marketing_agent($1, $2, null, $3, null) as r", [name(), phone(), email])
      expect((await create(first)).rows[0].r.outcome).toBe("created")
      const again = create(second)
      expect(await stillWaiting(again)).toBe(true)
      await first.query("commit")
      await expect(again).rejects.toThrow("email_taken")
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  })
})
