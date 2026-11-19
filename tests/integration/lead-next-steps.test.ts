import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { nextStep, readNextStepInput, type NextStep, type NextStepInput } from "@/lib/lead-next-step"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { getLeadFollowUps, scheduleFollowUp } from "@/lib/services/follow-ups"
import {
  getInterviewRegistration,
  getLeadInterviews,
  recordInterviewResult,
  registerForInterview,
  setInterviewFeeStatus,
} from "@/lib/services/interviews"
import { approveReopeningRequest, declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { listNextStepFacts, NEXT_STEP_INPUTS_PER_REQUEST } from "@/lib/services/lead-next-steps"
import { createLead, getLead } from "@/lib/services/leads"
import { getLeadReopenings, raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { getResultRelease, listReleaseStatus, releaseResult } from "@/lib/services/result-release"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn, whileUnchanged } from "../support/db"
import { freshCode, leadWithCode } from "../support/discount-codes"
import { claimFeeYear, noScheduleYear, type FeeYearClaim } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../support/fixtures"

// The Applicants list's Next step column (#415): lead_next_step_inputs gives,
// for a whole page in one call, the same inputs the side sheet and the
// record's card read one lead at a time (readNextStepInput), so nextStep
// decides the same step. Each test compares the two reads, input by input,
// for leads the file makes in every state nextStep knows, and for every
// seeded lead, as staff with and without payments.view.

const OFFICE = { officePhone: "+255 673 526 644" }
const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// STD 2 Day: TZS 2,000,000. Its Academic-year start is the schedule's own,
// in the claimed year, so First instalment doesn't enrol.
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

const DEPOSIT: PaymentInput = {
  type: "initial_deposit",
  amount: 300_000,
  paidOn: today,
}
const FIRST: PaymentInput = {
  type: "first_instalment",
  amount: 500_000,
  paidOn: today,
}
const FULL: PaymentInput = {
  type: "full_payment",
  amount: 2_000_000,
  paidOn: today,
}

let claim: FeeYearClaim
let feeYear: number
// Leads with a follow-up, open or needed: archived afterwards, so the
// Follow-ups queue the browser tests read stays the seeded one.
const queued: string[] = []

// One session per staff member for the whole file: dozens of sign-ins at
// once time out under load.
const sessions = new Map<string, Promise<SupabaseClient>>()
function as(staff: FixtureStaff): Promise<SupabaseClient> {
  if (!sessions.has(staff.email)) sessions.set(staff.email, signedIn(staff))
  return sessions.get(staff.email)!
}

beforeAll(async () => {
  claim = await claimFeeYear()
  feeYear = claim.year
  const saved = await saveFeeAmounts(await as(ACCOUNTANT), feeYear, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
})

afterAll(async () => {
  await claim?.release()
  if (queued.length === 0) return
  await asSystem((sql) =>
    sql.query(
      "update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = any($1) and closure is null and status not in ('Declined', 'Enrolled')",
      [queued],
    ),
  )
})

// ---------------------------------------------------------------------------
// The two reads.
// ---------------------------------------------------------------------------

// What the side sheet decides from: the lead's own reads, with the fee read
// only for staff who may view payments, as loadApplicantSheet does.
async function oneByOne(client: SupabaseClient, leadId: string, seesFee: boolean): Promise<NextStepInput | null> {
  const lead = await getLead(client, leadId)
  if (!lead.ok) throw new Error(`no lead ${leadId}: ${lead.error}`)
  return readNextStepInput(
    {
      interviews: (id) => getLeadInterviews(client, id),
      registration: (id) => getInterviewRegistration(client, id),
      reopenings: (id) => getLeadReopenings(client, id),
      release: (id) => getResultRelease(client, id, OFFICE),
      releaseStatus: (id) => listReleaseStatus(client, [id]),
      followUps: (id) => getLeadFollowUps(client, id),
    },
    lead.data,
    seesFee ? getLeadFee(client, leadId) : null,
    today,
  )
}

async function together(client: SupabaseClient, leadIds: string[]): Promise<Map<string, NextStepInput>> {
  const read = await listNextStepFacts(client, leadIds)
  if (!read.ok) throw new Error(`batch failed: ${read.error}`)
  return new Map([...read.data].map(([id, facts]) => [id, { ...facts, today }]))
}

type BothReads = {
  batch: Map<string, NextStepInput>
  single: Map<string, NextStepInput | null>
}

// Both reads for each lead, as `client`: the page's one call, and the
// sheet's reads, ten leads at a time.
async function bothReads(client: SupabaseClient, leadIds: string[], seesFee: boolean): Promise<BothReads> {
  const batch = await together(client, leadIds)
  const single = new Map<string, NextStepInput | null>()
  for (let from = 0; from < leadIds.length; from += 10) {
    await Promise.all(leadIds.slice(from, from + 10).map(async (id) => single.set(id, await oneByOne(client, id, seesFee))))
  }
  return { batch, single }
}

// The same input for every lead, so the same step. Returns the steps by id.
function expectSame({ batch, single }: BothReads, leadIds: string[]): Map<string, NextStep> {
  expect([...batch.keys()].sort()).toEqual([...leadIds].sort())
  const steps = new Map<string, NextStep>()
  for (const id of leadIds) {
    const input = single.get(id) ?? null
    expect(input, `the sheet's read of ${id}`).not.toBeNull()
    expect(batch.get(id), `lead ${id}`).toEqual(input)
    steps.set(id, nextStep(input!))
  }
  return steps
}

async function expectSameSteps(staff: FixtureStaff, leadIds: string[], seesFee: boolean): Promise<Map<string, NextStep>> {
  return expectSame(await bothReads(await as(staff), leadIds, seesFee), leadIds)
}

// ---------------------------------------------------------------------------
// Leads in each state.
// ---------------------------------------------------------------------------

function phone() {
  // A leading 6 keeps it clear of the seeded 700 000 numbers.
  return `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

async function newLead(start: "walk-in" | "admission-form" = "walk-in"): Promise<string> {
  // The Admission form writes with the secret key, as the public form does.
  const created = await createLead(start === "walk-in" ? await as(ADMISSIONS) : secretClient(), {
    guardian: {
      contact: {
        fullName: "Next Step Parent",
        relationship: "Mother",
        phone: phone(),
      },
    },
    student: {
      fullName: `Next Step ${randomUUID().slice(0, 8)}`,
      className: "STD 2",
      enrollmentYear: thisYear + 1,
      dayOrBoarding: "Day",
    },
    start: start === "walk-in" ? { kind: "walk-in", visitDate: today } : { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function moveToYear(leadId: string, year: number) {
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
}

async function register(leadId: string): Promise<string> {
  const registered = await registerForInterview(await as(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return registered.data.interviewId
}

async function payInterview(interviewId: string) {
  const marked = await setInterviewFeeStatus(await as(ACCOUNTANT), interviewId, "paid")
  if (!marked.ok) throw new Error(`fee failed: ${marked.error}`)
}

async function result(interviewId: string, outcome: "Passed" | "Failed", score: number) {
  const recorded = await recordInterviewResult(await as(ADMISSIONS), interviewId, { interviewDate: today, result: outcome, score })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
}

async function send(interviewId: string) {
  const sent = await releaseResult(await as(ADMISSIONS), interviewId, "sms", OFFICE)
  if (!sent.ok) throw new Error(`release failed: ${sent.error}`)
}

// Registered, paid, with the result recorded and sent, in `year`.
async function sentLead(outcome: "Passed" | "Failed", year = feeYear): Promise<{ leadId: string; interviewId: string }> {
  const leadId = await newLead()
  const interviewId = await register(leadId)
  await payInterview(interviewId)
  await result(interviewId, outcome, outcome === "Passed" ? 80 : 40)
  await send(interviewId)
  await moveToYear(leadId, year)
  return { leadId, interviewId }
}

async function followUpOn(leadId: string, dueOn: string) {
  queued.push(leadId)
  if (dueOn >= today) {
    const planned = await scheduleFollowUp(await as(ADMISSIONS), leadId, {
      dueOn,
    })
    if (!planned.ok) throw new Error(`follow-up failed: ${JSON.stringify(planned.error)}`)
    return
  }
  // A date in the past can't be scheduled, so it is planted as the owner.
  await asSystem((sql) => sql.query("insert into public.follow_ups (lead_id, due_on) values ($1, $2)", [leadId, dueOn]))
}

async function pay(leadId: string, payment: PaymentInput) {
  const paid = await recordPayment(await as(ACCOUNTANT), leadId, payment, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${JSON.stringify(paid.error)}`)
}

// Declined after a Failed result, then reopened with the retake choice.
async function reopenedLead(enrolWithoutRetake: boolean): Promise<string> {
  const { leadId } = await sentLead("Failed")
  queued.push(leadId)
  const declined = await declineLead(await as(MANAGER), leadId, {
    reason: "Did not pass interview",
  })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await as(ADMISSIONS), leadId, {
    reason: "The family is back.",
    source: "lead",
  })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(await as(MANAGER), raised.data, { enrolWithoutRetake })
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
  return leadId
}

// ---------------------------------------------------------------------------

describe("lead_next_step_inputs", () => {
  test("gives the sheet's inputs, and so its step, for a lead in every state", async () => {
    const cases: { name: string; leadId: string; step: NextStep }[] = []
    const add = (name: string, leadId: string, step: NextStep) => cases.push({ name, leadId, step })

    add("applied through the form", await newLead("admission-form"), {
      kind: "record-visit",
    })
    add("visited", await newLead(), {
      kind: "register-interview",
      retake: false,
    })

    {
      const leadId = await newLead()
      await register(leadId)
      add("registered, fee not paid", leadId, {
        kind: "collect-interview-fee",
        amount: STANDARD_INTERVIEW_FEE,
      })
    }
    {
      // A Promo code of the test's own takes its amount off the fee. Not the
      // seeded agent's code, whose student list the other tests read.
      const code = freshCode("N")
      const promo = await (
        await as(MANAGER)
      ).rpc("create_promo_code", {
        name: `Next step ${code}`,
        code,
        amount: 10_000,
        ends_on: null,
        note: null,
      })
      if (promo.error) throw new Error(`promo failed: ${promo.error.message}`)
      const leadId = await leadWithCode(code)
      await register(leadId)
      const expected = await inRolledBackTransaction(async (sql) => {
        await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })])
        return (await sql.query<{ amount: number }>("select amount from public.expected_interview_amount($1)", [leadId])).rows[0].amount
      })
      add("registered with a discount code, fee not paid", leadId, {
        kind: "collect-interview-fee",
        amount: expected,
      })
    }
    {
      const leadId = await newLead()
      await payInterview(await register(leadId))
      add("fee paid, no result", leadId, { kind: "record-result" })
    }
    {
      const leadId = await newLead()
      const interviewId = await register(leadId)
      await payInterview(interviewId)
      await result(interviewId, "Passed", 80)
      add("result recorded, not sent", leadId, {
        kind: "send-result",
        corrected: false,
      })
    }
    {
      const { leadId, interviewId } = await sentLead("Passed")
      await result(interviewId, "Passed", 82)
      add("result corrected after it was sent", leadId, {
        kind: "send-result",
        corrected: true,
      })
    }
    {
      const { leadId, interviewId } = await sentLead("Passed")
      // Corrected and back again: no change since it was sent.
      await result(interviewId, "Passed", 81)
      await result(interviewId, "Passed", 80)
      add("result sent, a correction undone", leadId, {
        kind: "record-deposit",
      })
    }
    add("failed and sent, no follow-up", (await sentLead("Failed")).leadId, {
      kind: "schedule-follow-up",
      reason: "failed",
    })
    {
      const { leadId } = await sentLead("Failed")
      await followUpOn(leadId, addDays(today, 7))
      add("failed and sent, follow-up ahead", leadId, {
        kind: "wait-for-follow-up",
        dueOn: addDays(today, 7),
      })
    }
    {
      const leadId = await newLead()
      await followUpOn(leadId, today)
      add("follow-up due today", leadId, {
        kind: "record-follow-up",
        dueOn: today,
        overdue: false,
      })
    }
    {
      const leadId = await newLead()
      await followUpOn(leadId, addDays(today, -3))
      add("follow-up overdue", leadId, {
        kind: "record-follow-up",
        dueOn: addDays(today, -3),
        overdue: true,
      })
    }
    add("reopened, no follow-up date", await reopenedLead(false), {
      kind: "schedule-follow-up",
      reason: "reopened",
    })
    {
      const leadId = await reopenedLead(false)
      await followUpOn(leadId, addDays(today, 7))
      add("reopened for a retake", leadId, {
        kind: "register-interview",
        retake: true,
      })
    }
    {
      const leadId = await reopenedLead(true)
      await followUpOn(leadId, addDays(today, 7))
      add("reopened to enrol without a retake", leadId, {
        kind: "record-deposit",
      })
    }
    add("passed and sent, nothing paid", (await sentLead("Passed")).leadId, {
      kind: "record-deposit",
    })
    {
      const { leadId } = await sentLead("Passed")
      await pay(leadId, DEPOSIT)
      add("deposit paid", leadId, {
        kind: "collect-school-fee",
        priority: "Deposit",
      })
    }
    {
      const { leadId } = await sentLead("Passed")
      await pay(leadId, DEPOSIT)
      await pay(leadId, FIRST)
      add("first instalment reached", leadId, {
        kind: "collect-school-fee",
        priority: "First instalment",
      })
    }
    {
      const { leadId } = await sentLead("Passed")
      await pay(leadId, FULL)
      add("paid in full", leadId, { kind: "enrolled" })
    }
    add("passed and sent, in a year with no Fee schedule", (await sentLead("Passed", await noScheduleYear())).leadId, {
      kind: "school-fee-unknown",
    })
    {
      const leadId = await newLead()
      const declined = await declineLead(await as(MANAGER), leadId, {
        reason: "Enrolled elsewhere",
      })
      if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
      add("declined", leadId, { kind: "closed" })
    }

    const ids = cases.map((each) => each.leadId)
    // Staff with payments.view (all three seeded roles hold it) see the fee.
    for (const staff of [ADMISSIONS, ACCOUNTANT]) {
      const steps = await expectSameSteps(staff, ids, true)
      for (const each of cases) expect(steps.get(each.leadId), `${each.name}, as ${staff.name}`).toEqual(each.step)
    }

    // Every kind of step is among the cases.
    const kinds = new Set(cases.map((each) => each.step.kind))
    expect([...kinds].sort()).toEqual(
      [
        "closed",
        "enrolled",
        "record-follow-up",
        "schedule-follow-up",
        "record-visit",
        "register-interview",
        "collect-interview-fee",
        "record-result",
        "send-result",
        "wait-for-follow-up",
        "record-deposit",
        "collect-school-fee",
        "school-fee-unknown",
      ].sort(),
    )
    // The discount code case really took a discount off.
    const discounted = cases.find((each) => each.name.includes("discount code"))!.step
    expect(discounted.kind === "collect-interview-fee" && discounted.amount).toBeLessThan(STANDARD_INTERVIEW_FEE)

    // Without payments.view the fee can't be read, one lead or a page at a
    // time: a lead that may pay has the School fee step with no amount.
    const noFee = await createThrowawayStaff(["leads.view"])
    const steps = await expectSameSteps(noFee, ids, false)
    for (const each of cases) {
      const feeStep = ["record-deposit", "collect-school-fee"].includes(each.step.kind)
      expect(steps.get(each.leadId), `${each.name}, without payments.view`).toEqual(feeStep ? { kind: "school-fee-unknown" } : each.step)
    }
  }, 180_000)

  test("gives the sheet's inputs for every seeded lead, a page at a time", async () => {
    const seeded = await inRolledBackTransaction(async (sql) => {
      // The seeds' leads, the dashboard's 1ead2031-… ones among them.
      const { rows } = await sql.query<{ id: string }>("select id from public.leads where id::text like '1ead%' order by id")
      return rows.map((row) => row.id)
    })
    expect(seeded.length).toBeGreaterThan(0)

    // The seeded leads' rows, so a test running alongside that changes one
    // makes the comparison run again rather than fail.
    const state = (sql: Client) =>
      sql
        .query<{ versions: string }>(
          `select md5(concat_ws('|',
             (select string_agg(t.xmin::text, ',' order by t.id) from public.leads t where t.id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.interviews t where t.lead = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.follow_ups t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.follow_up_records t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.reopening_requests t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.school_fee_payments t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.payment_adjustments t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.discount_requests t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.lead_fee_profiles t where t.lead_id = any($1)),
             (select string_agg(t.xmin::text, ',' order by t.enrollment_year) from public.fee_schedules t),
             (select string_agg(t.xmin::text, ',' order by t.id) from public.fee_band_amounts t),
             (select count(*)::text from public.audit_log t where t.lead_id = any($1) and t.action = 'result_released')
           )) as versions`,
          [seeded],
        )
        .then(async (answer) => {
          // TEMPORARY DIAGNOSTIC (#312): which rows change between reads.
          const detail = await sql.query<{ part: string; id: string; xmin: string }>(
            `select 'leads' as part, t.id::text, t.xmin::text from public.leads t where t.id = any($1)
             union all select 'interviews', t.id::text, t.xmin::text from public.interviews t where t.lead = any($1)
             union all select 'follow_ups', t.id::text, t.xmin::text from public.follow_ups t where t.lead_id = any($1)
             union all select 'follow_up_records', t.id::text, t.xmin::text from public.follow_up_records t where t.lead_id = any($1)
             union all select 'reopening_requests', t.id::text, t.xmin::text from public.reopening_requests t where t.lead_id = any($1)
             union all select 'school_fee_payments', t.id::text, t.xmin::text from public.school_fee_payments t where t.lead_id = any($1)
             union all select 'payment_adjustments', t.id::text, t.xmin::text from public.payment_adjustments t where t.lead_id = any($1)
             union all select 'discount_requests', t.id::text, t.xmin::text from public.discount_requests t where t.lead_id = any($1)
             union all select 'lead_fee_profiles', t.lead_id::text, t.xmin::text from public.lead_fee_profiles t where t.lead_id = any($1)
             union all select 'fee_schedules', t.enrollment_year::text, t.xmin::text from public.fee_schedules t
             union all select 'fee_band_amounts', t.id::text, t.xmin::text from public.fee_band_amounts t`,
            [seeded],
          )
          const now = new Map(detail.rows.map((r) => [`${r.part}:${r.id}`, r.xmin]))
          const before = (globalThis as { __diag?: Map<string, string> }).__diag
          if (before) {
            const changed = [...new Set([...before.keys(), ...now.keys()])].filter((k) => before.get(k) !== now.get(k))
            if (changed.length) {
              const leadIds = changed.filter((k) => k.startsWith("leads:")).map((k) => k.slice(6))
              const lead = leadIds.length
                ? (await sql.query("select id, admission_number, status, guardian_contact_id from public.leads where id = any($1)", [leadIds])).rows
                : []
              console.warn("DIAG changed", JSON.stringify(changed), JSON.stringify(lead))
            }
          }
          ;(globalThis as { __diag?: Map<string, string> }).__diag = now
          return answer.rows[0].versions
        })

    const client = await as(ADMISSIONS)
    const { result: pages } = await whileUnchanged(
      state,
      async () => {
        const read: { ids: string[]; reads: BothReads }[] = []
        for (let from = 0; from < seeded.length; from += 50) {
          const ids = seeded.slice(from, from + 50)
          read.push({ ids, reads: await bothReads(client, ids, true) })
        }
        return read
      },
      { tries: 5 },
    )
    const kinds = new Set<string>()
    for (const page of pages) for (const step of expectSame(page.reads, page.ids).values()) kinds.add(step.kind)
    // The seeds hold leads at many steps, not one.
    expect(kinds.size).toBeGreaterThan(3)
  }, 300_000)

  test("one call takes up to 200 leads and leaves out unknown ids", async () => {
    const client = await as(ADMISSIONS)
    const leadId = await newLead()
    const read = await listNextStepFacts(client, [leadId, randomUUID()])
    expect(read.ok && [...read.data.keys()]).toEqual([leadId])
    expect(await listNextStepFacts(client, [])).toEqual({
      ok: true,
      data: new Map(),
    })

    const tooMany = await client.rpc("lead_next_step_inputs", {
      lead_ids: Array.from({ length: NEXT_STEP_INPUTS_PER_REQUEST + 1 }, () => randomUUID()),
    })
    expect(tooMany.error?.message).toBe("too_many")
  })

  test("staff without leads.view, and anyone signed out, are refused", async () => {
    const leadId = await newLead()
    const noLeads = await createThrowawayStaff(["payments.view"])
    expect(await listNextStepFacts(await as(noLeads), [leadId])).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await listNextStepFacts(anonClient(), [leadId])).toEqual({
      ok: false,
      error: "forbidden",
    })
  })
})
