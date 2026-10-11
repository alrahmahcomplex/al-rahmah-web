import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import {
  getFollowUpQueue,
  getLeadFollowUps,
  recordFollowUp,
  scheduleFollowUp,
  type FollowUpQueueItem,
  type FollowUpQueueSection,
} from "@/lib/services/follow-ups"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { approveReopeningRequest, declineLead, type DeclinedReason } from "@/lib/services/lead-closure"
import { createLead, getLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { overdueAround } from "../support/overdue-count"

// Reopened leads that need a follow-up date (#95), through the follow-up,
// lead closure, reopening and payments modules against local Supabase. A
// lead reopened after a decline shows in Overdue as Needs a follow-up date,
// dated from the approval, until a follow-up is planned or it becomes
// Enrolled. Every lead a test leaves open is archived afterwards, so the
// queue the browser tests read stays the seeded one.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

const made: string[] = []

afterAll(async () => {
  if (made.length === 0) return
  await asSystem((sql) =>
    sql.query(
      "update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = any($1) and closure is null and status <> 'Declined'",
      [made],
    ),
  )
})

function phone() {
  // A leading 5 keeps it clear of the seeded 700 000 numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

async function newLead(): Promise<{ id: string; admissionNumber: string }> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: "Reopened Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Needs ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  made.push(created.data.leadId)
  return { id: created.data.leadId, admissionNumber: created.data.admissionNumber }
}

// Declines the lead, raises a Reopening request and approves it, through the
// modules. `enrolWithoutRetake` is for a lead declined after its interview.
async function declineAndReopen(lead: string, reason: DeclinedReason = "Family changed plans", enrolWithoutRetake?: boolean) {
  const declined = await declineLead(await signedIn(MANAGER), lead, { reason })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family is back.", source: "lead" })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data, { enrolWithoutRetake })
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
}

// An approval planted as the database owner, `daysAgo` days back: the
// functions stamp the time they run, so a past approval can only be planted.
async function plantApproval(lead: string, daysAgo: number) {
  await asSystem((sql) =>
    sql.query(
      `insert into public.reopening_requests (
         lead_id, source, reason, requested_by, requested_at,
         state, decided_by, decided_at, lead_was_declined, restored_status
       ) values ($1, 'lead', 'The family is back.', $2, now() - make_interval(days => $4 + 1),
         'approved', $3, now() - make_interval(days => $4), true, 'Visited')`,
      [lead, ADMISSIONS.id, MANAGER.id, daysAgo],
    ),
  )
}

// An open follow-up planted as the owner, on any date.
async function plantFollowUp(lead: string, dueOn: string) {
  await asSystem((sql) => sql.query("insert into public.follow_ups (lead_id, due_on) values ($1, $2)", [lead, dueOn]))
}

async function wholeSection(supabase: SupabaseClient, section: FollowUpQueueSection): Promise<FollowUpQueueItem[]> {
  const items: FollowUpQueueItem[] = []
  for (let page = 1; ; page++) {
    const read = await getFollowUpQueue(supabase, { section, page })
    if (!read.ok) throw new Error("queue read failed")
    items.push(...read.data.items)
    if (page >= read.data.pageCount) return items
  }
}

const itemsFor = (items: FollowUpQueueItem[], lead: string) => items.filter((item) => item.lead.id === lead)

async function needsDate(lead: string): Promise<boolean> {
  const read = await getLeadFollowUps(await signedIn(ADMISSIONS), lead)
  if (!read.ok) throw new Error(`read failed: ${read.error.kind}`)
  return read.data.needsDate
}

// Whether the lead shows in Overdue as Needs a follow-up date.
async function inOverdueAsNeedsDate(lead: string): Promise<boolean> {
  const items = itemsFor(await wholeSection(await signedIn(ADMISSIONS), "overdue"), lead)
  return items.some((item) => item.kind === "needs_date")
}

describe("a lead reopened after a decline", () => {
  test("needs a follow-up date: it shows in Overdue dated from the approval and counts in the badge", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    await declineLead(await signedIn(MANAGER), lead.id, { reason: "Family changed plans" })
    expect(await needsDate(lead.id)).toBe(false)

    const raised = await raiseReopeningRequest(staff, lead.id, { reason: "The family is back.", source: "lead" })
    if (!raised.ok) throw new Error(JSON.stringify(raised.error))
    // A Pending request is not yet a reopening.
    expect(await needsDate(lead.id)).toBe(false)
    expect(await approveReopeningRequest(await signedIn(MANAGER), raised.data, {})).toEqual({ ok: true, data: null })

    expect(await needsDate(lead.id)).toBe(true)
    const overdue = await wholeSection(staff, "overdue")
    expect(itemsFor(overdue, lead.id)).toEqual([
      {
        kind: "needs_date",
        followUpId: null,
        dueOn: today,
        daysOverdue: 0,
        note: null,
        lead: expect.objectContaining({ id: lead.id, admissionNumber: lead.admissionNumber, status: "Visited" }),
        guardian: expect.objectContaining({ name: "Reopened Parent" }),
        lastContact: null,
      },
    ])
    expect(itemsFor(await wholeSection(staff, "upcoming"), lead.id)).toEqual([])
    // The count is Overdue's total, and this lead is one of it: closing the
    // lead takes one off both.
    const { before, after } = await overdueAround(ADMISSIONS.id, (sql) =>
      sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [lead.id]),
    )
    expect(before.count).toBe(before.total)
    expect(after).toEqual({ count: before.count - 1, total: before.total - 1 })

    // The Accountant reads it too; a visitor who is not signed in, nothing.
    expect(itemsFor(await wholeSection(await signedIn(ACCOUNTANT), "overdue"), lead.id)).toHaveLength(1)
    expect(await getLeadFollowUps(anonClient(), lead.id)).toMatchObject({ ok: true, data: { needsDate: false } })
    expect((await anonClient().rpc("follow_up_date_needed")).error?.code).toBe("42501")
  })

  test("sits among the other Overdue rows by its approval's date, then by Admission Number", async () => {
    const [older, sameDayA, sameDayB, newer] = await Promise.all([newLead(), newLead(), newLead(), newLead()])
    await plantFollowUp(older.id, addDays(today, -41))
    await plantApproval(sameDayA.id, 40)
    await plantFollowUp(sameDayB.id, addDays(today, -40))
    await plantApproval(newer.id, 39)
    const sameDay = [sameDayA, sameDayB].sort((x, y) => x.admissionNumber.localeCompare(y.admissionNumber)).map((lead) => lead.id)
    const mine = [older, sameDayA, sameDayB, newer].map((lead) => lead.id)

    const overdue = await wholeSection(await signedIn(ADMISSIONS), "overdue")
    expect(overdue.map((item) => item.lead.id).filter((id) => mine.includes(id))).toEqual([older.id, ...sameDay, newer.id])
    expect(itemsFor(overdue, sameDayA.id)).toEqual([expect.objectContaining({ kind: "needs_date", dueOn: addDays(today, -40), daysOverdue: 40 })])
    expect(itemsFor(overdue, newer.id)).toEqual([expect.objectContaining({ kind: "needs_date", dueOn: addDays(today, -39), daysOverdue: 39 })])
  })

  test("a follow-up planned before the approval doesn't count", async () => {
    const lead = await newLead()
    // Planned ten days ago, before the approval yesterday.
    await asSystem((sql) =>
      sql.query("insert into public.follow_ups (lead_id, due_on, created_at) values ($1, $2, now() - interval '10 days')", [
        lead.id,
        addDays(today, -5),
      ]),
    )
    await plantApproval(lead.id, 1)

    expect(await needsDate(lead.id)).toBe(true)
  })
})

describe("what clears the need", () => {
  test("scheduling a follow-up", async () => {
    const lead = await newLead()
    await declineAndReopen(lead.id)
    expect(await inOverdueAsNeedsDate(lead.id)).toBe(true)

    const staff = await signedIn(ADMISSIONS)
    expect(await scheduleFollowUp(staff, lead.id, { dueOn: addDays(today, 1) })).toMatchObject({ ok: true })

    expect(await needsDate(lead.id)).toBe(false)
    expect(itemsFor(await wholeSection(staff, "overdue"), lead.id)).toEqual([])
    expect(itemsFor(await wholeSection(staff, "upcoming"), lead.id)).toEqual([
      expect.objectContaining({ kind: "follow_up", dueOn: addDays(today, 1) }),
    ])
  })

  test("recording a contact with a next date", async () => {
    const lead = await newLead()
    await declineAndReopen(lead.id)
    expect(await needsDate(lead.id)).toBe(true)

    const staff = await signedIn(ADMISSIONS)
    const recorded = await recordFollowUp(staff, lead.id, {
      followUpId: null,
      comment: "The father called to say they are ready to continue.",
      method: "Phone call",
      contactedBy: ADMISSIONS.id,
      contactedAt: new Date(Date.now() - 60_000).toISOString(),
      outcome: { kind: "next_date", dueOn: addDays(today, 5) },
    })
    expect(recorded).toMatchObject({ ok: true })

    expect(await needsDate(lead.id)).toBe(false)
    expect(await inOverdueAsNeedsDate(lead.id)).toBe(false)
  })

  test("declining or closing the lead again", async () => {
    const [declined, marked] = await Promise.all([newLead(), newLead()])
    await declineAndReopen(declined.id)
    await declineAndReopen(marked.id)
    await asSystem(async (sql) => {
      await sql.query("update public.leads set status = 'Declined', declined_reason = 'Family changed plans', status_before_decline = status where id = $1", [declined.id])
      await sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [marked.id])
    })

    expect(await needsDate(declined.id)).toBe(false)
    expect(await needsDate(marked.id)).toBe(false)
    const overdue = await wholeSection(await signedIn(ADMISSIONS), "overdue")
    expect(itemsFor(overdue, declined.id)).toEqual([])
    expect(itemsFor(overdue, marked.id)).toEqual([])
  })
})

describe("Enrolled", () => {
  // STD 2 Day: TZS 2,000,000.
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
  const FULL: PaymentInput = { type: "full_payment", amount: 2_000_000, paidOn: today }

  // A walk-in STD 2 Day lead in a fee year of its own, interviewed and
  // Passed today.
  async function passedLead(): Promise<string> {
    const claim = await claimFeeYear()
    onTestFinished(claim.release)
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
    if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)

    const admissions = await signedIn(ADMISSIONS)
    const created = await createLead(admissions, {
      guardian: { contact: { fullName: "Reopened Parent", relationship: "Mother", phone: phone() } },
      student: { fullName: `Needs ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    const id = created.data.leadId
    made.push(id)
    const registered = await registerForInterview(admissions, id)
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
    const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
    if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, claim.year]))
    return id
  }

  async function statusOf(lead: string) {
    const read = await getLead(await signedIn(ADMISSIONS), lead)
    if (!read.ok) throw new Error(`no lead: ${read.error}`)
    return read.data.status
  }

  test("a reopened lead that becomes Enrolled through a payment no longer needs a date", async () => {
    const lead = await passedLead()
    await declineAndReopen(lead, "Fees or cost", true)
    expect(await statusOf(lead)).toBe("Interviewed")
    expect(await inOverdueAsNeedsDate(lead)).toBe(true)

    expect(await recordPayment(await signedIn(ACCOUNTANT), lead, FULL, randomUUID())).toMatchObject({ ok: true })
    expect(await statusOf(lead)).toBe("Enrolled")

    expect(await needsDate(lead)).toBe(false)
    expect(await inOverdueAsNeedsDate(lead)).toBe(false)
  })

  test("a reopened lead that goes straight to Enrolled never appears", async () => {
    const lead = await passedLead()
    expect(await recordPayment(await signedIn(ACCOUNTANT), lead, FULL, randomUUID())).toMatchObject({ ok: true })
    expect(await statusOf(lead)).toBe("Enrolled")

    await declineAndReopen(lead, "Enrolled elsewhere", true)
    expect(await statusOf(lead)).toBe("Enrolled")

    expect(await needsDate(lead)).toBe(false)
    expect(await inOverdueAsNeedsDate(lead)).toBe(false)
  })
})
