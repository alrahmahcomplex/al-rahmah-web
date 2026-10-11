import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  getLeadFollowUps,
  recordFollowUp,
  scheduleFollowUp,
  type ContactRecord,
  type RecordOutcome,
} from "@/lib/services/follow-ups"
import { getLeadClosure, isLeadClosed } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Declining the lead as the outcome of a recorded contact (#94), through the
// follow-up module against local Supabase. The contact record and the
// decline are saved together, or neither is. Each test makes its own leads.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's seeded Declined lead.
const DECLINED = "1ead0000-0000-4000-8000-000000000006"

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// A Visited lead, from a walk-in today.
async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Declining Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function scheduled(leadId: string): Promise<string> {
  const result = await scheduleFollowUp(await signedIn(ADMISSIONS), leadId, { dueOn: addDays(today, 1) })
  if (!result.ok) throw new Error(`schedule failed: ${JSON.stringify(result.error)}`)
  return result.data.followUpId
}

function declining(followUpId: string | null, outcome: Partial<Extract<RecordOutcome, { kind: "lead_declined" }>> = {}): ContactRecord {
  return {
    followUpId,
    comment: "The father says they have chosen a school nearer home.",
    method: "Phone call",
    contactedBy: ADMISSIONS.id,
    contactedAt: new Date(Date.now() - 60_000).toISOString(),
    outcome: { kind: "lead_declined", reason: "Enrolled elsewhere", note: "A school nearer home.", ...outcome },
  }
}

async function recordKinds(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ kind: string; outcome: string | null }>(
          "select kind, outcome from public.follow_up_records where lead_id = $1 order by entered_at",
          [leadId],
        )
      ).rows,
  )
}

// What a refused decline must leave behind: the follow-up still open, no
// record, and the lead still open.
async function expectUnchanged(staff: SupabaseClient, leadId: string, followUpId: string) {
  expect(await getLeadFollowUps(staff, leadId)).toMatchObject({ ok: true, data: { open: { id: followUpId }, records: [] } })
  expect(await recordKinds(leadId)).toEqual([])
  expect(await isLeadClosed(staff, leadId)).toEqual({ ok: true, data: false })
  const history = await getLeadHistory(staff, leadId)
  expect(history.ok && history.data.entries.filter((e) => e.record === "follow_up_records" || e.record === "lead" && e.action === "update")).toEqual([])
}

describe("declining the lead as a contact outcome", () => {
  test("records the contact, closes the follow-up and declines the lead together", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    const recorded = await recordFollowUp(staff, lead, declining(planned))
    expect(recorded).toEqual({ ok: true, data: { recordId: expect.any(String) } })

    const read = await getLeadFollowUps(staff, lead)
    expect(read).toMatchObject({
      ok: true,
      data: {
        open: null,
        records: [
          {
            id: recorded.ok && recorded.data.recordId,
            kind: "contact",
            followUpId: planned,
            outcome: "lead_declined",
            comment: "The father says they have chosen a school nearer home.",
            nextFollowUpId: null,
          },
        ],
      },
    })
    const closure = await getLeadClosure(staff, lead)
    expect(closure).toMatchObject({
      ok: true,
      data: {
        decline: {
          reason: "Enrolled elsewhere",
          explanation: "A school nearer home.",
          declinedBy: ADMISSIONS.name,
          statusBefore: "Visited",
        },
      },
    })
    expect(await isLeadClosed(staff, lead)).toEqual({ ok: true, data: true })
  })

  test("adds no closed_with_lead record, since the contact already closed the follow-up", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    expect(await recordFollowUp(await signedIn(ADMISSIONS), lead, declining(planned))).toMatchObject({ ok: true })
    expect(await recordKinds(lead)).toEqual([{ kind: "contact", outcome: "lead_declined" }])
  })

  test("declines a lead with no open follow-up from an unplanned contact", async () => {
    const lead = await newLead()
    const staff = await signedIn(MANAGER)
    expect(await recordFollowUp(staff, lead, declining(null, { reason: "Fees or cost", note: null }))).toMatchObject({ ok: true })
    expect(await recordKinds(lead)).toEqual([{ kind: "contact", outcome: "lead_declined" }])
    expect(await getLeadClosure(staff, lead)).toMatchObject({ ok: true, data: { decline: { reason: "Fees or cost", explanation: null } } })
  })

  test("Other is accepted with an explanation", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)
    expect(await recordFollowUp(staff, lead, declining(planned, { reason: "Other", note: "The family is moving abroad." }))).toMatchObject({
      ok: true,
    })
    expect(await getLeadClosure(staff, lead)).toMatchObject({
      ok: true,
      data: { decline: { reason: "Other", explanation: "The family is moving abroad." } },
    })
  })

  test("No seat available is accepted from staff who may set the seats", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const manager = await signedIn(MANAGER)
    expect(await recordFollowUp(manager, lead, declining(planned, { reason: "No seat available" }))).toMatchObject({ ok: true })
    expect(await getLeadClosure(manager, lead)).toMatchObject({ ok: true, data: { decline: { reason: "No seat available" } } })
  })
})

describe("a refused decline rolls the whole contact back", () => {
  test("for a caller who records follow-ups but may not decline leads", async () => {
    const recorder = await createThrowawayStaff(["leads.view", "follow_ups.record"])
    const lead = await newLead()
    const planned = await scheduled(lead)
    const caller = await signedIn(recorder)

    expect(await recordFollowUp(caller, lead, declining(planned, { reason: "Family changed plans" }))).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    await expectUnchanged(await signedIn(ADMISSIONS), lead, planned)
  })

  test("for No seat available picked without academic_years.manage", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    expect(await recordFollowUp(staff, lead, declining(planned, { reason: "No seat available" }))).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    await expectUnchanged(staff, lead, planned)
  })

  test("for Other with no explanation, or a blank one", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    for (const note of [null, "   "]) {
      expect(await recordFollowUp(staff, lead, declining(planned, { reason: "Other", note }))).toEqual({
        ok: false,
        error: { kind: "invalid", field: "decline_note" },
      })
    }
    await expectUnchanged(staff, lead, planned)
  })

  test("for a reason not on the list, or an explanation over 1,000 characters", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    const unknown = declining(planned, { reason: "Too far away" as never })
    expect(await recordFollowUp(staff, lead, unknown)).toEqual({ ok: false, error: { kind: "invalid", field: "decline_reason" } })
    expect(await recordFollowUp(staff, lead, declining(planned, { note: "x".repeat(1001) }))).toEqual({
      ok: false,
      error: { kind: "invalid", field: "decline_note" },
    })
    await expectUnchanged(staff, lead, planned)
  })

  test("the contact's own rules still apply first", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    expect(await recordFollowUp(staff, lead, { ...declining(planned), comment: "no" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "comment" },
    })
    // The form was showing no follow-up, but one is open.
    expect(await recordFollowUp(staff, lead, declining(null))).toEqual({ ok: false, error: { kind: "conflict" } })
    await expectUnchanged(staff, lead, planned)
  })

  test("a closed lead is read-only, and the Accountant and visitors are refused", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)

    expect(await recordFollowUp(await signedIn(ADMISSIONS), DECLINED, declining(null))).toEqual({
      ok: false,
      error: { kind: "read-only" },
    })
    expect(await recordFollowUp(await signedIn(ACCOUNTANT), lead, declining(planned))).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await recordFollowUp(anonClient(), lead, declining(planned))).toEqual({ ok: false, error: { kind: "forbidden" } })
    await expectUnchanged(await signedIn(ADMISSIONS), lead, planned)
  })
})

describe("two staff at once", () => {
  test("declining the same follow-up at once ends with one record, one decline and one refusal, without a deadlock", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const [first, second] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      recordFollowUp(first, lead, declining(planned)),
      recordFollowUp(second, lead, declining(planned, { reason: "Fees or cost" })),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    // Whoever comes second finds the lead closed.
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: { kind: "read-only" } }])
    expect(await recordKinds(lead)).toEqual([{ kind: "contact", outcome: "lead_declined" }])
  })

  test("a decline and a next date recorded at once end with one of them", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const [first, second] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      recordFollowUp(first, lead, declining(planned)),
      recordFollowUp(second, lead, { ...declining(planned), outcome: { kind: "next_date", dueOn: addDays(today, 7) } }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error.kind)).toEqual([
      expect.stringMatching(/^(read-only|conflict)$/),
    ])
    expect(await recordKinds(lead)).toHaveLength(1)
  })
})

describe("the history of a decline outcome", () => {
  test("shows the contact and the decline, both by the staff member who recorded them", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const recorded = await recordFollowUp(await signedIn(MANAGER), lead, declining(planned, { reason: "Family changed plans", note: null }))
    if (!recorded.ok) throw new Error("record failed")

    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    if (!history.ok) throw new Error("history failed")
    const contact = history.data.entries.filter((e) => e.record === "follow_up_records")
    expect(contact).toHaveLength(1)
    expect(contact[0]).toMatchObject({ action: "insert", actor: MANAGER.name, recordId: recorded.data.recordId })
    expect(contact[0].changes).toEqual(
      expect.arrayContaining([
        { field: "kind", from: null, to: "contact" },
        { field: "outcome", from: null, to: "lead_declined" },
        { field: "follow_up_id", from: null, to: planned },
      ]),
    )
    const decline = history.data.entries.filter((e) => e.record === "lead" && e.action === "update")
    expect(decline).toHaveLength(1)
    expect(decline[0]).toMatchObject({ actor: MANAGER.name })
    expect(decline[0].changes).toEqual(
      expect.arrayContaining([
        { field: "status", from: "Visited", to: "Declined" },
        { field: "declined_reason", from: null, to: "Family changed plans" },
        { field: "status_before_decline", from: null, to: "Visited" },
        { field: "declined_by", from: null, to: MANAGER.id },
      ]),
    )
  })
})
