import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { rejectEmailClaim } from "@/lib/services/agent-email-claims"
import { signUpAgent } from "@/lib/services/agent-sign-up"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { decideDiscount, requestDiscount } from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { getHomeActivity } from "@/lib/services/home-activity"
import { markReApplicationReviewed } from "@/lib/services/re-applications"
import { releaseResult } from "@/lib/services/result-release"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead, recordVisit } from "@/lib/services/leads"
import { createAgent } from "@/lib/services/marketing-agents"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { agentWithLogin } from "../support/agent-students"
import { actAsStaff, anonClient, asSystem, createThrowawayStaff, inOneSnapshot, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// Home's Activity log (#406): home_activity against local Supabase, read as
// each role. Every row a test looks for is one it made; the log is the whole
// school's, so tests running alongside add rows of their own, and a test only
// ever looks for its own ids. Reads take every page in one snapshot.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))
// Today's first moment in Tanzania (UTC+3), as an instant.
const dayStart = new Date(`${today}T00:00:00+03:00`)

type Row = { kind: string; id: string; all_day: boolean; at: string } & Record<string, unknown>
type Activity = { total: number; rows: Row[] }

// Every page of the log as `staffId` sees it, read in one snapshot.
async function activityAs(staffId: string): Promise<Activity> {
  return inOneSnapshot(async (sql) => {
    await actAsStaff(sql, staffId)
    return everyPage(sql)
  })
}

async function everyPage(sql: Client): Promise<Activity> {
  const first = await sql.query<{ a: Activity }>("select public.home_activity(0, 100) as a")
  const { total } = first.rows[0].a
  const rows = [...first.rows[0].a.rows]
  if (total > 100) {
    const rest = await sql.query<{ a: Activity }>(
      "select public.home_activity(o, 100) as a from generate_series(100, $1 - 1, 100) o order by o",
      [total],
    )
    for (const page of rest.rows) rows.push(...page.a.rows)
  }
  return { total, rows }
}

const mine = (activity: Activity, ids: string[]) => activity.rows.filter((row) => ids.includes(row.id))
const kindsFor = (activity: Activity, leadId: string) =>
  activity.rows.filter((row) => row.lead_id === leadId).map((row) => row.kind)

// A leading 04 keeps these clear of the seeded numbers and the other files'.
const phone = () => `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
const word = () => `H${randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")}`

// One Admission form; returns each child's lead id and the form's key.
async function formSent(children: { name: string; className?: "KG 1" | "STD 4" }[], parentPhone = phone()) {
  const submissionKey = randomUUID()
  const sent = await submitAdmissionForm(secretClient(), {
    submissionKey,
    parent: { fullName: `Activity Parent ${word()}`, relationship: "Mother", phone: parentPhone },
    children: children.map((c) => ({ fullName: c.name, className: c.className ?? "KG 1", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" as const })),
  })
  if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
  const ids = await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string; admission_number: string }>(
      "select id, admission_number from public.leads where admission_number = any($1::text[])",
      [sent.data.map((o) => o.admissionNumber)],
    )
    return sent.data.map((o) => rows.find((r) => r.admission_number === o.admissionNumber)!.id)
  })
  return { leadIds: ids, submissionKey, parentPhone }
}

// Moves a form and its children back to `at`, as if sent then. Triggers are
// off for the one transaction, since a lead's creation time never changes.
async function sentAt(submissionKey: string, leadIds: string[], at: Date) {
  await asSystem(async (sql) => {
    await sql.query("set local session_replication_role = replica")
    await sql.query("update public.admission_submissions set created_at = $2 where submission_key = $1", [submissionKey, at])
    await sql.query("update public.leads set created_at = $2 where id = any($1::uuid[])", [leadIds, at])
  })
}

async function childName(leadId: string) {
  return asSystem(async (sql) => (await sql.query<{ student_name: string }>("select student_name from public.leads where id = $1", [leadId])).rows[0].student_name)
}

async function walkIn(name = `Activity ${word()}`) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: `Walk Parent ${word()}`, relationship: "Father", phone: phone() } },
    student: { fullName: name, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function passed(leadId: string) {
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 78 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  return registered.data.interviewId
}

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

// A Passed lead in a claimed year with a schedule, so payments can be recorded.
async function payableLead() {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  const leadId = await walkIn()
  await passed(leadId)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, claim.year]))
  return leadId
}

async function pay(leadId: string, amount: number) {
  const recorded = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type: "initial_deposit", amount, paidOn: today }, randomUUID())
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data.paymentId
}

async function overdueFollowUp(leadId: string, note: string) {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>(
      "insert into public.follow_ups (lead_id, due_on, note) values ($1, $2, $3) returning id",
      [leadId, tanzaniaToday(new Date(Date.now() - 9 * DAY)), note],
    )
    return rows[0].id
  })
}

async function claimOnAgent() {
  const number = `07${String(randomInt(10_000_000, 100_000_000))}`
  const created = await createAgent(await signedIn(MANAGER), { fullName: `Zawadi Activity ${word()}`, phone: number, whatsapp: "", email: "", code: "" })
  if (!created.ok || created.data.kind !== "created") throw new Error(`could not create: ${JSON.stringify(created)}`)
  const agent = created.data.agent
  const claimed = await signUpAgent(secretClient(), {
    fullName: `Zawadi Mwenyewe ${word()}`,
    phone: number,
    whatsapp: null,
    email: `activity-${randomUUID().slice(0, 8)}@example.test`,
    hasCode: true,
    code: agent.code,
  })
  if (!claimed.ok || claimed.data.kind !== "claimed") throw new Error(`claim failed: ${JSON.stringify(claimed)}`)
  return agent.id
}

describe("what each role sees", () => {
  test("the Manager sees every kind, with names and amounts", async () => {
    const form = await formSent([{ name: `${word()} Form Child` }])
    const discountLead = await walkIn()
    const request = await requestDiscount(await signedIn(ADMISSIONS), discountLead, "staff_child", "Staff ID seen at the desk.", randomUUID())
    if (!request.ok) throw new Error(`request failed: ${JSON.stringify(request.error)}`)
    const feeLead = await payableLead()
    const paymentId = await pay(feeLead, 600_000)
    const callLead = await walkIn()
    const followUpId = await overdueFollowUp(callLead, "Book the interview.")
    const agentId = await claimOnAgent()
    // The same child sent again from the same phone is a re-application.
    const returning = await formSent([{ name: `${word()} Returning Child` }])
    await formSent([{ name: (await childName(returning.leadIds[0])), className: "STD 4" }], returning.parentPhone)
    const reApplication = await asSystem(async (sql) =>
      (await sql.query<{ id: string }>("select id from public.re_applications where lead_id = $1", [returning.leadIds[0]])).rows,
    )

    const seen = await activityAs(MANAGER.id)
    expect(mine(seen, [form.leadIds[0]])).toMatchObject([
      { kind: "new_application", all_day: false, student_name: expect.stringContaining("Form Child"), class_name: "KG 1", referral_code: null },
    ])
    expect(mine(seen, [request.data])).toMatchObject([
      { kind: "discount_request", discount: "staff_child", note: "Staff ID seen at the desk.", requested_by: ADMISSIONS.name, lead_id: discountLead },
    ])
    expect(mine(seen, [paymentId])).toMatchObject([
      { kind: "fee_paid", payment_type: "initial_deposit", amount: 600_000, recorded_by: ACCOUNTANT.name, lead_id: feeLead },
    ])
    expect(mine(seen, [followUpId])).toMatchObject([{ kind: "call_back", note: "Book the interview.", lead_id: callLead, relationship: "Father" }])
    expect(mine(seen, [agentId])).toMatchObject([{ kind: "agent_claim", claims: 1 }])
    expect(mine(seen, [reApplication[0].id])).toMatchObject([
      { kind: "re_application", lead_id: returning.leadIds[0], class_name: "KG 1", asked_class: "STD 4", differing_fields: expect.arrayContaining(["class_name"]) },
    ])
    // Nothing that would let a row be used to reach the family is returned.
    expect(JSON.stringify(seen.rows.filter((row) => row.lead_id === callLead))).not.toMatch(/phone/)
  })

  test("an Admissions Officer sees the same, except claimed Discount codes", async () => {
    const agentId = await claimOnAgent()
    const callLead = await walkIn()
    const followUpId = await overdueFollowUp(callLead, "Call after Friday prayers.")
    const seen = await activityAs(ADMISSIONS.id)
    expect(mine(seen, [followUpId])).toHaveLength(1)
    expect(mine(seen, [agentId])).toEqual([])
    expect(seen.rows.some((row) => row.kind === "agent_claim")).toBe(false)
  })

  test("the Accountant sees payments and leads but no claims", async () => {
    const feeLead = await payableLead()
    const paymentId = await pay(feeLead, 400_000)
    const callLead = await walkIn()
    const followUpId = await overdueFollowUp(callLead, "Ask about the uniform.")
    const seen = await activityAs(ACCOUNTANT.id)
    expect(mine(seen, [paymentId])).toHaveLength(1)
    expect(mine(seen, [followUpId])).toMatchObject([{ kind: "call_back" }])
    expect(seen.rows.some((row) => row.kind === "agent_claim")).toBe(false)
  })

  test("without payments.view, no payment shows; without leads.view, no lead shows", async () => {
    const feeLead = await payableLead()
    const paymentId = await pay(feeLead, 350_000)
    const agentId = await claimOnAgent()

    const leadsOnly = await createThrowawayStaff(["leads.view"])
    const asLeadsOnly = await activityAs(leadsOnly.id)
    expect(mine(asLeadsOnly, [paymentId])).toEqual([])
    expect(asLeadsOnly.rows.some((row) => row.kind === "fee_paid" || row.kind === "agent_claim")).toBe(false)

    // Agents are read under leads.view, so agents.approve alone sees nothing.
    const claimsOnly = await createThrowawayStaff(["agents.approve"])
    await expect(activityAs(claimsOnly.id)).rejects.toThrow("not_permitted")
    const leadsAndClaims = await createThrowawayStaff(["leads.view", "agents.approve"])
    expect(mine(await activityAs(leadsAndClaims.id), [agentId])).toHaveLength(1)
  })

  test("payments.view alone, no permission, a deactivated member, an agent and anon are refused", async () => {
    for (const permissions of [["payments.view"], []]) {
      const member = await createThrowawayStaff(permissions)
      const answer = await (await signedIn(member)).rpc("home_activity", { row_offset: 0, row_limit: 10 })
      expect(answer.error?.message).toBe("not_permitted")
      expect(await getHomeActivity(await signedIn(member), 1)).toEqual({ ok: false, error: "forbidden" })
    }

    await expect(activityAs(DEACTIVATED.id)).rejects.toThrow("not_permitted")

    const agent = await agentWithLogin()
    const asAgent = await (await signedIn(agent)).rpc("home_activity", { row_offset: 0, row_limit: 10 })
    expect(asAgent.error?.message).toBe("not_permitted")

    const asAnon = await anonClient().rpc("home_activity", { row_offset: 0, row_limit: 10 })
    expect(asAnon.error?.code).toBe("42501")
  })

  test("the Super Admin sees every kind", async () => {
    const agentId = await claimOnAgent()
    const seen = await activityAs(SUPER_ADMIN.id)
    expect(mine(seen, [agentId])).toHaveLength(1)
  })
})

describe("today, and what leaves the log", () => {
  test("a form sent before today's first moment in Tanzania is expected; from it, it is a new application", async () => {
    const before = await formSent([{ name: `${word()} Before Edge` }])
    const after = await formSent([{ name: `${word()} After Edge` }])
    const tooOld = await formSent([{ name: `${word()} Too Old` }])
    const weekEdge = await formSent([{ name: `${word()} Week Edge` }])
    await sentAt(weekEdge.submissionKey, weekEdge.leadIds, new Date(dayStart.getTime() - 7 * DAY))
    await sentAt(before.submissionKey, before.leadIds, new Date(dayStart.getTime() - 1000))
    await sentAt(after.submissionKey, after.leadIds, dayStart)
    await sentAt(tooOld.submissionKey, tooOld.leadIds, new Date(dayStart.getTime() - 7 * DAY - 1000))

    const seen = await activityAs(ADMISSIONS.id)
    expect(mine(seen, [before.submissionKey])).toMatchObject([
      { kind: "expected", all_day: true, sent_on: yesterday, children: [{ lead_id: before.leadIds[0] }] },
    ])
    expect(kindsFor(seen, before.leadIds[0])).toEqual([])
    expect(mine(seen, [after.leadIds[0]])).toMatchObject([{ kind: "new_application" }])
    expect(mine(seen, [tooOld.submissionKey])).toEqual([])
    expect(mine(seen, [weekEdge.submissionKey])).toMatchObject([{ kind: "expected" }])
  })

  test("today's application stays after the family is checked in, with its new status", async () => {
    const form = await formSent([{ name: `${word()} Same Day Visit` }])
    expect((await recordVisit(await signedIn(ADMISSIONS), form.leadIds[0], today)).ok).toBe(true)
    expect(mine(await activityAs(ADMISSIONS.id), [form.leadIds[0]])).toMatchObject([{ kind: "new_application", status: "Visited", closure: null }])
  })

  test("call backs due up to today show; one due tomorrow does not", async () => {
    const lead = await walkIn()
    const ids = await asSystem(async (sql) => {
      const due = async (on: string) =>
        (await sql.query<{ id: string }>("insert into public.follow_ups (lead_id, due_on) values ($1, $2) returning id", [lead, on])).rows[0].id
      return { today: await due(today), tomorrow: await due(tanzaniaToday(new Date(Date.now() + DAY))) }
    })
    const seen = await activityAs(ADMISSIONS.id)
    expect(mine(seen, [ids.today])).toMatchObject([{ kind: "call_back", due_on: today, note: null }])
    expect(mine(seen, [ids.tomorrow])).toEqual([])
  })

  test("only school-fee payments recorded today show, and never Fee waived or the Pre-Form One fee", async () => {
    const lead = await payableLead()
    const yesterdays = await pay(lead, 310_000)
    const todays = await pay(lead, 320_000)
    const others = await asSystem(async (sql) => {
      await sql.query("set local session_replication_role = replica")
      await sql.query("update public.school_fee_payments set recorded_at = $2 where id = $1", [yesterdays, new Date(dayStart.getTime() - 1000)])
      await sql.query("update public.school_fee_payments set recorded_at = $2 where id = $1", [todays, dayStart])
      const insert = async (type: string, amount: number | null) =>
        (
          await sql.query<{ id: string }>(
            "insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by) values ($1, $2, $3, $4, $5) returning id",
            [lead, type, amount, today, ACCOUNTANT.id],
          )
        ).rows[0].id
      return [await insert("fee_waived", null), await insert("pre_form_one_fee", 450_000)]
    })
    const seen = await activityAs(MANAGER.id)
    expect(mine(seen, [todays])).toHaveLength(1)
    expect(mine(seen, [yesterdays, ...others])).toEqual([])
  })

  test("an expected form names only the children still waiting", async () => {
    const form = await formSent([{ name: `${word()} First Twin` }, { name: `${word()} Second Twin`, className: "STD 4" }])
    await sentAt(form.submissionKey, form.leadIds, new Date(dayStart.getTime() - 2 * DAY))
    const visited = await recordVisit(await signedIn(ADMISSIONS), form.leadIds[0], today)
    expect(visited.ok).toBe(true)

    const [row] = mine(await activityAs(ADMISSIONS.id), [form.submissionKey])
    expect((row.children as { lead_id: string }[]).map((c) => c.lead_id)).toEqual([form.leadIds[1]])
  })

  test("a result is ready once Paid, and a payment shows as adjusted until it is voided", async () => {
    const resultLead = await walkIn()
    const interviewId = await passed(resultLead)
    expect(mine(await activityAs(ADMISSIONS.id), [interviewId])).toEqual([])
    expect((await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")).ok).toBe(true)
    expect(mine(await activityAs(ADMISSIONS.id), [interviewId])).toMatchObject([
      { kind: "result_ready", result: "Passed", score: 78, changed_since_sent: false, interview_date: today },
    ])
    const admissions = await signedIn(ADMISSIONS)
    expect((await releaseResult(admissions, interviewId, "sms", { officePhone: "+255 673 526 644" })).ok).toBe(true)
    expect(mine(await activityAs(ADMISSIONS.id), [interviewId])).toEqual([])
    expect((await recordInterviewResult(admissions, interviewId, { interviewDate: today, result: "Passed", score: 81 })).ok).toBe(true)
    expect(mine(await activityAs(ADMISSIONS.id), [interviewId])).toMatchObject([{ kind: "result_ready", score: 81, changed_since_sent: true }])

    const feeLead = await payableLead()
    const paymentId = await pay(feeLead, 300_000)
    const accountant = await signedIn(ACCOUNTANT)
    const corrected = await adjustPayment(
      accountant,
      paymentId,
      { reason: "Wrong amount", void: false, type: "first_instalment", amount: 800_000, paidOn: today, note: null },
      randomUUID(),
    )
    expect(corrected.ok).toBe(true)
    expect(mine(await activityAs(MANAGER.id), [paymentId])).toMatchObject([{ payment_type: "first_instalment", amount: 800_000 }])
    const voided = await adjustPayment(accountant, paymentId, { reason: "Duplicate entry", void: true, note: null }, randomUUID())
    expect(voided.ok).toBe(true)
    expect(mine(await activityAs(MANAGER.id), [paymentId])).toEqual([])
  })

  test("a decided request and a decided claim leave the log", async () => {
    const lead = await walkIn()
    const request = await requestDiscount(await signedIn(ADMISSIONS), lead, "qualified_orphan", "Letter from the ward office.", randomUUID())
    if (!request.ok) throw new Error(`request failed: ${JSON.stringify(request.error)}`)
    const agentId = await claimOnAgent()
    expect(mine(await activityAs(MANAGER.id), [request.data, agentId])).toHaveLength(2)

    const manager = await signedIn(MANAGER)
    expect((await decideDiscount(manager, request.data, { decision: "refuse", reason: "No letter came." })).ok).toBe(true)
    const claims = await asSystem(async (sql) =>
      (await sql.query<{ id: string }>("select id from public.agent_email_claims where agent_id = $1 and claim_id is null", [agentId])).rows,
    )
    expect((await rejectEmailClaim(manager, claims[0].id)).ok).toBe(true)
    expect(mine(await activityAs(MANAGER.id), [request.data, agentId])).toEqual([])

    const returning = await formSent([{ name: `${word()} Reviewed Return` }])
    await formSent([{ name: await childName(returning.leadIds[0]) }], returning.parentPhone)
    const [reApplication] = await asSystem(async (sql) =>
      (await sql.query<{ id: string }>("select id from public.re_applications where lead_id = $1", [returning.leadIds[0]])).rows,
    )
    expect(mine(await activityAs(MANAGER.id), [reApplication.id])).toHaveLength(1)
    expect((await markReApplicationReviewed(await signedIn(ADMISSIONS), reApplication.id)).ok).toBe(true)
    expect(mine(await activityAs(MANAGER.id), [reApplication.id])).toEqual([])
  })
})

describe("pages", () => {
  test("pages never overlap, add up to the total and keep all-day rows first", async () => {
    const seen = await activityAs(MANAGER.id)
    expect(seen.rows).toHaveLength(seen.total)
    expect(new Set(seen.rows.map((row) => `${row.kind}:${row.id}`)).size).toBe(seen.total)
    const firstTimed = seen.rows.findIndex((row) => !row.all_day)
    expect(seen.rows.slice(firstTimed === -1 ? seen.rows.length : firstTimed).every((row) => !row.all_day)).toBe(true)
  })

  test("refuses an unreadable offset or limit", async () => {
    const manager = await signedIn(MANAGER)
    for (const [row_offset, row_limit, field] of [
      [-1, 10, "row_offset"],
      [0, 0, "row_limit"],
      [0, 101, "row_limit"],
    ] as const) {
      const { error } = await manager.rpc("home_activity", { row_offset, row_limit })
      expect(error?.message).toBe("invalid")
      expect(JSON.parse(error?.details ?? "{}")).toEqual({ field })
    }
  })

  test("an offset at the top of the integer range gives an empty page with the total", async () => {
    const { data, error } = await (await signedIn(MANAGER)).rpc("home_activity", { row_offset: 2_147_483_647, row_limit: 100 })
    expect(error).toBeNull()
    expect(data).toMatchObject({ rows: [] })
    expect((data as { total: number }).total).toBeGreaterThanOrEqual(0)
  })

  test("the service reads one page of ten with the total", async () => {
    const page = await getHomeActivity(await signedIn(MANAGER), 1)
    if (!page.ok) throw new Error(page.error)
    expect(page.data.rows.length).toBeLessThanOrEqual(10)
    expect(page.data.pageCount).toBe(Math.max(1, Math.ceil(page.data.total / 10)))
  })
})
