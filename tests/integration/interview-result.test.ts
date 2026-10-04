import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  getLeadInterviews,
  recordInterviewResult,
  registerForInterview,
  type InterviewResultInput,
} from "@/lib/services/interviews"
import { createLead, type LeadStatus } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "../support/fixtures"

// Recording and correcting an interview result through the interview module,
// against local Supabase. Each test registers leads of its own; the seeded
// ones are only read.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const tomorrow = tanzaniaToday(new Date(Date.now() + DAY))
const thisYear = Number(today.slice(0, 4))

// Slice 5's seeded results.
const PASSED = "1ead0000-0000-4000-8000-000000000503"
const FAILED = "1ead0000-0000-4000-8000-000000000504"

const PASS: InterviewResultInput = { interviewDate: today, result: "Passed", score: 78.5 }

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

// A lead of the test's own, registered for interview: Visited by default (a
// walk-in) or Applied (the Admission form).
async function registeredLead(start: "walk-in" | "admission-form" = "walk-in") {
  const creator = start === "walk-in" ? await signedIn(ADMISSIONS) : secretClient()
  const created = await createLead(creator, {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' 07 numbers.
      contact: { fullName: "Result Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Candidate ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: start === "walk-in" ? { kind: "walk-in", visitDate: yesterday } : { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { leadId: created.data.leadId, interviewId: registered.data.interviewId, serialNumber: registered.data.serialNumber }
}

type Stored = {
  status: LeadStatus
  visit_date: string | null
  serial_number: number
  interview_date: string | null
  result: string | null
  score: string | null
  fee_status: string
  locked_amount: number | null
}

async function stored(interviewId: string): Promise<Stored> {
  const [row] = await rows<Stored>(
    `select l.status, l.visit_date::text, i.serial_number, i.interview_date::text, i.result::text, i.score::text,
            i.fee_status::text, i.locked_amount
     from public.interviews i join public.leads l on l.id = i.lead
     where i.id = $1`,
    [interviewId],
  )
  return row
}

async function interviewHistory(leadId: string) {
  const history = await getLeadHistory(await signedIn(MANAGER), leadId)
  if (!history.ok) throw new Error("history failed")
  return history.data.entries
}

describe("recording an interview result", () => {
  test("moves a Visited lead to Interviewed and shows the result, score and Next action", async () => {
    const { leadId, interviewId } = await registeredLead()
    const staff = await signedIn(ADMISSIONS)

    expect(await recordInterviewResult(staff, interviewId, PASS)).toEqual({ ok: true, data: { firstRecording: true, changed: true } })

    expect(await stored(interviewId)).toMatchObject({ status: "Interviewed", visit_date: yesterday, interview_date: today, result: "Passed" })
    expect(await getLeadInterviews(staff, leadId)).toMatchObject({
      ok: true,
      data: [{ interviewDate: today, result: "Passed", score: 78.5, nextAction: "Complete enrollment" }],
    })
  })

  test("a Failed result's Next action is Contact the admissions office", async () => {
    const { leadId, interviewId } = await registeredLead()
    const staff = await signedIn(MANAGER)

    expect((await recordInterviewResult(staff, interviewId, { interviewDate: today, result: "Failed", score: 0 })).ok).toBe(true)
    expect(await getLeadInterviews(staff, leadId)).toMatchObject({
      ok: true,
      data: [{ result: "Failed", score: 0, nextAction: "Contact the admissions office" }],
    })
  })

  test("on an Applied lead, records the visit on the interview date and moves the lead to Interviewed in one step", async () => {
    const { leadId, interviewId } = await registeredLead("admission-form")

    expect((await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, PASS)).ok).toBe(true)

    expect(await stored(interviewId)).toMatchObject({ status: "Interviewed", visit_date: today })
    const statusChanges = (await interviewHistory(leadId))
      .filter((entry) => entry.record === "lead" && entry.action === "update")
      .map((entry) => entry.changes.find((change) => change.field === "status"))
      .reverse()
    expect(statusChanges).toEqual([
      { field: "status", from: "Applied", to: "Visited" },
      { field: "status", from: "Visited", to: "Interviewed" },
    ])
  })

  test("on an Applied lead, a role without visits.record is refused and nothing changes", async () => {
    const { interviewId } = await registeredLead("admission-form")
    const recorder = await createThrowawayStaff(["leads.view", "interviews.record"])

    expect(await recordInterviewResult(await signedIn(recorder), interviewId, PASS)).toEqual({ ok: false, error: "forbidden" })
    expect(await stored(interviewId)).toMatchObject({ status: "Applied", visit_date: null, result: null })
  })

  test("is recorded whether or not the fee is paid", async () => {
    const { interviewId } = await registeredLead()
    await asSystem((sql) =>
      sql.query("update public.interviews set fee_status = 'Paid', locked_amount = 50000, locked_discount_applied = false where id = $1", [interviewId]),
    )

    expect((await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, PASS)).ok).toBe(true)
    expect(await stored(interviewId)).toMatchObject({ result: "Passed", fee_status: "Paid", locked_amount: 50000 })
  })

  test("is in the lead's history with the staff member, and the date, result and score", async () => {
    const { leadId, interviewId } = await registeredLead()
    await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, PASS)

    const entry = (await interviewHistory(leadId)).find((e) => e.record === "interviews" && e.action === "update")
    expect(entry).toMatchObject({ actor: ADMISSIONS.name, recordId: interviewId })
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: "interview_date", from: null, to: today },
        { field: "result", from: null, to: "Passed" },
        { field: "score", from: null, to: 78.5 },
      ]),
    )
  })
})

describe("correcting an interview result", () => {
  test("changes only the interview: status, S/N, fee status and locked amount stay as they were", async () => {
    const { leadId, interviewId, serialNumber } = await registeredLead()
    const staff = await signedIn(ADMISSIONS)
    await recordInterviewResult(staff, interviewId, PASS)
    await asSystem((sql) =>
      sql.query("update public.interviews set fee_status = 'Paid', locked_amount = 30000, locked_discount_applied = true where id = $1", [interviewId]),
    )

    const corrected = await recordInterviewResult(staff, interviewId, { interviewDate: today, result: "Failed", score: 48 })

    expect(corrected).toEqual({ ok: true, data: { firstRecording: false, changed: true } })
    expect(await stored(interviewId)).toEqual({
      status: "Interviewed",
      visit_date: yesterday,
      serial_number: serialNumber,
      interview_date: today,
      result: "Failed",
      score: "48",
      fee_status: "Paid",
      locked_amount: 30000,
    })
    expect(await getLeadInterviews(staff, leadId)).toMatchObject({
      ok: true,
      data: [{ result: "Failed", nextAction: "Contact the admissions office" }],
    })
  })

  test("keeps the old and new values, who changed them and when, in the history", async () => {
    const { leadId, interviewId } = await registeredLead()
    await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, PASS)
    await recordInterviewResult(await signedIn(MANAGER), interviewId, { interviewDate: today, result: "Passed", score: 81 })

    const updates = (await interviewHistory(leadId)).filter((e) => e.record === "interviews" && e.action === "update")
    expect(updates).toHaveLength(2)
    // Newest first.
    expect(updates[0]).toMatchObject({ actor: MANAGER.name, at: expect.any(String) })
    expect(updates[0].changes).toEqual([{ field: "score", from: 78.5, to: 81 }])
  })

  test("a correction that changes nothing writes nothing", async () => {
    const { leadId, interviewId } = await registeredLead()
    const staff = await signedIn(ADMISSIONS)
    await recordInterviewResult(staff, interviewId, PASS)
    const before = (await interviewHistory(leadId)).length

    expect(await recordInterviewResult(staff, interviewId, PASS)).toEqual({ ok: true, data: { firstRecording: false, changed: false } })
    expect(await interviewHistory(leadId)).toHaveLength(before)
  })
})

describe("what a result must hold", () => {
  const cases: [string, InterviewResultInput, string][] = [
    ["no date", { ...PASS, interviewDate: null as unknown as string }, "incomplete"],
    ["no result", { ...PASS, result: null as unknown as "Passed" }, "incomplete"],
    ["a result that is neither", { ...PASS, result: "Absent" as unknown as "Passed" }, "incomplete"],
    ["no score", { ...PASS, score: null as unknown as number }, "incomplete"],
    ["a score above 100", { ...PASS, score: 100.1 }, "score_out_of_range"],
    ["a negative score", { ...PASS, score: -1 }, "score_out_of_range"],
    ["a score with two decimal places", { ...PASS, score: 72.25 }, "score_too_precise"],
    ["a date later than today in Tanzania", { ...PASS, interviewDate: tomorrow }, "date_in_future"],
    ["a date before the registration", { ...PASS, interviewDate: yesterday }, "date_before_registration"],
  ]

  test.each(cases)("refuses %s, and nothing changes", async (_, input, error) => {
    const { interviewId } = await registeredLead()

    expect(await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, input)).toEqual({ ok: false, error })
    expect(await stored(interviewId)).toMatchObject({ status: "Visited", interview_date: null, result: null, score: null })
  })

  test("refuses a bad correction and keeps the recorded result", async () => {
    const { interviewId } = await registeredLead()
    const staff = await signedIn(ADMISSIONS)
    await recordInterviewResult(staff, interviewId, PASS)

    expect(await recordInterviewResult(staff, interviewId, { ...PASS, score: 750 })).toEqual({ ok: false, error: "score_out_of_range" })
    expect(await stored(interviewId)).toMatchObject({ result: "Passed", score: "78.5" })
  })

  test("accepts the bounds, 0 and 100", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const score of [0, 100]) {
      const { interviewId } = await registeredLead()
      expect((await recordInterviewResult(staff, interviewId, { ...PASS, score })).ok, String(score)).toBe(true)
    }
  })
})

describe("who may record a result", () => {
  test("a closed lead is refused", async () => {
    const { leadId, interviewId } = await registeredLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [leadId]))

    expect(await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, PASS)).toEqual({ ok: false, error: "lead_closed" })
    expect(await stored(interviewId)).toMatchObject({ result: null })
  })

  test("the Accountant is refused", async () => {
    const { interviewId } = await registeredLead()
    expect(await recordInterviewResult(await signedIn(ACCOUNTANT), interviewId, PASS)).toEqual({ ok: false, error: "forbidden" })
    expect(await stored(interviewId)).toMatchObject({ result: null })
  })

  test("a deactivated member of Admissions Staff is refused", async () => {
    const { interviewId } = await registeredLead()
    expect(await recordInterviewResult(await signedIn(DEACTIVATED), interviewId, PASS)).toEqual({ ok: false, error: "forbidden" })
    expect(await stored(interviewId)).toMatchObject({ result: null })
  })

  test("nobody outside a staff session may record, the secret key included", async () => {
    const { interviewId } = await registeredLead()
    for (const client of [anonClient(), secretClient()]) {
      expect(await recordInterviewResult(client, interviewId, PASS)).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await stored(interviewId)).toMatchObject({ result: null })
  })

  test("an interview that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await recordInterviewResult(staff, randomUUID(), PASS)).toEqual({ ok: false, error: "not_found" })
    expect(await recordInterviewResult(staff, "not-an-id", PASS)).toEqual({ ok: false, error: "not_found" })
  })
})

describe("the seeded results", () => {
  test("show a Passed and a Failed lead with their Next action", async () => {
    const staff = await signedIn(ACCOUNTANT)
    expect(await getLeadInterviews(staff, PASSED)).toMatchObject({
      ok: true,
      data: [{ serialNumber: 2, result: "Passed", score: 78.5, nextAction: "Complete enrollment" }],
    })
    expect(await getLeadInterviews(staff, FAILED)).toMatchObject({
      ok: true,
      data: [{ serialNumber: 3, result: "Failed", score: 41, nextAction: "Contact the admissions office" }],
    })
  })
})
