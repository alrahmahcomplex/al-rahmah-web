import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  getInterviewRegistration,
  getLeadInterviews,
  recordInterviewResult,
  registerForInterview,
  setInterviewFeeStatus,
} from "@/lib/services/interviews"
import { approveReopeningRequest, declineLead, markLead } from "@/lib/services/lead-closure"
import { createLead, getLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { anonClient, asStaffActor, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// A retaken interview after a Retake reopening (#71), through the interview,
// lead closure and reopening modules against local Supabase, signed in as
// each seeded role. Each test makes and reopens leads of its own; slice 8's
// seeded reopened leads are only asked, never registered.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 8's seed: reopened after a Failed interview, one for a retake and one
// to enrol without a retaken interview.
const SEEDED_RETAKE = "1ead0000-0000-4000-8000-000000000087"
const SEEDED_ENROL_WITHOUT_RETAKE = "1ead0000-0000-4000-8000-000000000086"

function phone() {
  // A leading 4 keeps it clear of the seeded 700 000 numbers and the other
  // test files' numbers.
  return `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// An enrollment year no S/N has been issued in yet, as
// interview-registration.test.ts picks one.
async function freshYear(): Promise<number> {
  const used = await inRolledBackTransaction(
    async (sql) =>
      (await sql.query<{ enrollment_year: number }>(
        "select enrollment_year from public.interview_serial_counters where enrollment_year >= 2040",
      )).rows,
  )
  const taken = new Set(used.map((row) => row.enrollment_year))
  const free = Array.from({ length: 61 }, (_, i) => 2040 + i).filter((year) => !taken.has(year))
  if (free.length === 0) throw new Error("No unused enrollment year left between 2040 and 2100; run npm run db:reset")
  return free[randomInt(0, free.length)]
}

// A walk-in lead, registered and interviewed today with `result`. Returns
// the lead and its first interview.
async function interviewedLead(result: "Passed" | "Failed" = "Failed") {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Retake Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Retake ${randomUUID().slice(0, 8)}`, className: "STD 5", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const lead = created.data.leadId
  const registered = await registerForInterview(admissions, lead)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result,
    score: result === "Passed" ? 81 : 42.5,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  return { lead, first: registered.data }
}

// Declines the lead, raises a Reopening request and approves it with the
// retake choice.
async function reopened(lead: string, enrolWithoutRetake: boolean) {
  const declined = await declineLead(await signedIn(MANAGER), lead, { reason: "Did not pass interview" })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family asks for another sitting.", source: "lead" })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data, { enrolWithoutRetake })
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
}

async function statusOf(lead: string) {
  const read = await getLead(await signedIn(ADMISSIONS), lead)
  if (!read.ok) throw new Error(`no lead: ${read.error}`)
  return read.data.status
}

async function interviewsOf(lead: string) {
  const read = await getLeadInterviews(await signedIn(ADMISSIONS), lead)
  if (!read.ok) throw new Error(`no interviews: ${read.error}`)
  return read.data
}

describe("registering a retaken interview", () => {
  test("is allowed once after a Retake approval, with the next S/N, and refused a second time", async () => {
    const { lead, first } = await interviewedLead()
    await reopened(lead, false)
    // A year of its own, so the retake's S/N is known.
    const year = await freshYear()
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead, year]))
    const admissions = await signedIn(ADMISSIONS)

    expect(await getInterviewRegistration(admissions, lead)).toEqual({ ok: true, data: "retake" })
    const retake = await registerForInterview(admissions, lead)
    expect(retake).toEqual({
      ok: true,
      data: { interviewId: expect.any(String), serialNumber: 1, enrollmentYear: year, retake: true },
    })

    expect(await registerForInterview(admissions, lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await registerForInterview(await signedIn(MANAGER), lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await getInterviewRegistration(admissions, lead)).toEqual({ ok: true, data: null })

    // The retake is current, Not Paid with the calculated amount; the first
    // keeps its S/N and result.
    const interviews = await interviewsOf(lead)
    expect(interviews).toHaveLength(2)
    expect(interviews[0]).toMatchObject({
      id: retake.ok && retake.data.interviewId,
      serialNumber: 1,
      enrollmentYear: year,
      result: null,
      score: null,
      feeStatus: "Not Paid",
      amount: 50_000,
    })
    expect(interviews[1]).toMatchObject({
      id: first.interviewId,
      serialNumber: first.serialNumber,
      enrollmentYear: thisYear + 1,
      result: "Failed",
      score: 42.5,
    })
    expect(await statusOf(lead)).toBe("Interviewed")
  })

  test("two staff registering the retake at once register it once", async () => {
    const { lead } = await interviewedLead()
    await reopened(lead, false)
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([registerForInterview(one, lead), registerForInterview(other, lead)])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "already_registered" }])
    expect(await interviewsOf(lead)).toHaveLength(2)
  })

  test("a registration whose transaction began before the approval still counts as the retake", async () => {
    const { lead } = await interviewedLead()
    const declined = await declineLead(await signedIn(MANAGER), lead, { reason: "Did not pass interview" })
    if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
    const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Another sitting, please.", source: "lead" })
    if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)

    // Test Admissions' transaction starts, the approval commits meanwhile,
    // and only then does that transaction register the retake.
    await asStaffActor(ADMISSIONS.id, async (sql) => {
      const { rows } = await sql.query("select user_id from public.staff_members where id = $1", [ADMISSIONS.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
      await sql.query("set local role authenticated")
      await sql.query("select now()")

      const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data, { enrolWithoutRetake: false })
      if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)

      await sql.query("select public.register_for_interview($1)", [lead])
    })

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await interviewsOf(lead)).toHaveLength(2)
  })

  test("is refused after Enrol without a retaken interview", async () => {
    const { lead } = await interviewedLead()
    await reopened(lead, true)
    const admissions = await signedIn(ADMISSIONS)

    expect(await getInterviewRegistration(admissions, lead)).toEqual({ ok: true, data: null })
    expect(await registerForInterview(admissions, lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await interviewsOf(lead)).toHaveLength(1)
  })

  test("is refused for an Interviewed lead never declined", async () => {
    const { lead } = await interviewedLead("Passed")
    const admissions = await signedIn(ADMISSIONS)

    expect(await getInterviewRegistration(admissions, lead)).toEqual({ ok: true, data: null })
    expect(await registerForInterview(admissions, lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await interviewsOf(lead)).toHaveLength(1)
  })

  test("is refused after a later approval that didn't choose a retake", async () => {
    const { lead } = await interviewedLead()
    await reopened(lead, false)
    // Marked Inactive and reopened again: the latest approval reopens a lead
    // that wasn't Declined, so it carries no retake choice.
    const marked = await markLead(await signedIn(MANAGER), lead, { mark: "inactive", reason: "No longer pursuing admission" })
    if (!marked.ok) throw new Error(`mark failed: ${marked.error}`)
    const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" })
    if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
    const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data)
    if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "already_registered" })
  })

  test("is refused while the reopened lead is closed again", async () => {
    const { lead } = await interviewedLead()
    await reopened(lead, false)
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [lead]))

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "lead_closed" })
    expect(await getInterviewRegistration(await signedIn(ADMISSIONS), lead)).toEqual({ ok: true, data: null })
  })

  test("the Accountant may not register it", async () => {
    const { lead } = await interviewedLead()
    await reopened(lead, false)

    expect(await registerForInterview(await signedIn(ACCOUNTANT), lead)).toEqual({ ok: false, error: "forbidden" })
    expect(await interviewsOf(lead)).toHaveLength(1)
  })

  test("the seeded leads: the Retake one is offered a retake, the Enrol without retake one isn't", async () => {
    const admissions = await signedIn(ADMISSIONS)
    expect(await getInterviewRegistration(admissions, SEEDED_ENROL_WITHOUT_RETAKE)).toEqual({ ok: true, data: null })
    // Untouched by the tests, so still open for its retake after a reset.
    const seeded = await getInterviewRegistration(admissions, SEEDED_RETAKE)
    expect(seeded.ok).toBe(true)
  })

  test("asking needs leads.view", async () => {
    expect(await getInterviewRegistration(anonClient(), SEEDED_RETAKE)).toEqual({ ok: false, error: "forbidden" })
    expect(await getInterviewRegistration(await signedIn(ADMISSIONS), randomUUID())).toEqual({ ok: false, error: "not_found" })
  })
})

describe("the retaken interview's result and fee", () => {
  async function retaken() {
    const { lead, first } = await interviewedLead()
    // The first fee is Paid, so the retake's own fee shows apart from it.
    const paid = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), first.interviewId, "paid")
    if (!paid.ok) throw new Error(`fee failed: ${paid.error}`)
    await reopened(lead, false)
    const retake = await registerForInterview(await signedIn(ADMISSIONS), lead)
    if (!retake.ok) throw new Error(`retake failed: ${retake.error}`)
    return { lead, first, retake: retake.data }
  }

  test("recording its result keeps the lead Interviewed and leaves the earlier interview as it was", async () => {
    const { lead, first, retake } = await retaken()
    const admissions = await signedIn(ADMISSIONS)

    const recorded = await recordInterviewResult(admissions, retake.interviewId, { interviewDate: today, result: "Passed", score: 73 })
    expect(recorded).toEqual({ ok: true, data: { firstRecording: true, changed: true } })
    expect(await statusOf(lead)).toBe("Interviewed")

    const [current, earlier] = await interviewsOf(lead)
    expect(current).toMatchObject({ id: retake.interviewId, result: "Passed", score: 73, nextAction: "Complete enrollment" })
    expect(earlier).toMatchObject({ id: first.interviewId, result: "Failed", score: 42.5, nextAction: "Contact the admissions office" })
  })

  test("a correction acts on the interview it names", async () => {
    const { lead, first, retake } = await retaken()
    const admissions = await signedIn(ADMISSIONS)
    await recordInterviewResult(admissions, retake.interviewId, { interviewDate: today, result: "Passed", score: 73 })

    // Correcting the earlier interview leaves the retake alone.
    const corrected = await recordInterviewResult(admissions, first.interviewId, { interviewDate: today, result: "Failed", score: 45 })
    expect(corrected).toEqual({ ok: true, data: { firstRecording: false, changed: true } })

    const [current, earlier] = await interviewsOf(lead)
    expect(current).toMatchObject({ result: "Passed", score: 73 })
    expect(earlier).toMatchObject({ result: "Failed", score: 45 })
    expect(await statusOf(lead)).toBe("Interviewed")
  })

  test("its fee starts Not Paid with no lock and is marked on its own", async () => {
    const { lead, first, retake } = await retaken()
    const accountant = await signedIn(ACCOUNTANT)

    const locks = await inRolledBackTransaction(
      async (sql) =>
        (await sql.query<{ id: string; fee_status: string; locked_amount: number | null }>(
          "select id, fee_status, locked_amount from public.interviews where lead = $1",
          [lead],
        )).rows,
    )
    expect(locks).toEqual(
      expect.arrayContaining([
        { id: retake.interviewId, fee_status: "Not Paid", locked_amount: null },
        { id: first.interviewId, fee_status: "Paid", locked_amount: 50_000 },
      ]),
    )

    expect(await setInterviewFeeStatus(accountant, retake.interviewId, "paid")).toMatchObject({ ok: true, data: { feeStatus: "Paid", lockedAmount: 50_000 } })
    // Marking the earlier one Not Paid leaves the retake Paid.
    expect(await setInterviewFeeStatus(accountant, first.interviewId, "not_paid")).toMatchObject({ ok: true, data: { feeStatus: "Not Paid" } })

    const [current, earlier] = await interviewsOf(lead)
    expect(current).toMatchObject({ id: retake.interviewId, feeStatus: "Paid", amount: 50_000 })
    expect(earlier).toMatchObject({ id: first.interviewId, feeStatus: "Not Paid" })
  })

  test("the history keeps both interviews", async () => {
    const { lead, first, retake } = await retaken()
    await recordInterviewResult(await signedIn(ADMISSIONS), retake.interviewId, { interviewDate: today, result: "Passed", score: 73 })

    const history = await getLeadHistory(await signedIn(MANAGER), lead)
    if (!history.ok) throw new Error(`history failed: ${history.error}`)
    const interviewEntries = history.data.entries.filter((entry) => entry.record === "interviews")

    const registrations = interviewEntries.filter((entry) => entry.action === "insert")
    expect(registrations.map((entry) => entry.recordId).sort()).toEqual([first.interviewId, retake.interviewId].sort())
    expect(registrations.find((entry) => entry.recordId === retake.interviewId)?.changes).toEqual(
      expect.arrayContaining([{ field: "serial_number", from: null, to: retake.serialNumber }]),
    )
    // Each result stays as its own entry.
    const results = interviewEntries.filter((entry) => entry.changes.some((c) => c.field === "result" && c.from === null))
    expect(results.map((entry) => [entry.recordId, entry.changes.find((c) => c.field === "result")?.to])).toEqual(
      expect.arrayContaining([
        [first.interviewId, "Failed"],
        [retake.interviewId, "Passed"],
      ]),
    )
  })
})
