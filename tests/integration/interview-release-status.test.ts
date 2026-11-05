import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { listInterviews, type InterviewListItem, type InterviewListSearch } from "@/lib/services/interview-list"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { getResultRelease, getResultReleases, listReleaseStatus, releaseResult } from "@/lib/services/result-release"

import { anonClient, asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// Release status for many interviews at once (#89): listReleaseStatus and the
// Interviews list's Ready to send filter, against local Supabase. The file
// claims an enrollment year and makes its own leads in it; the year keeps
// earlier runs' rows, so tests look only for their own.

const OFFICE = { officePhone: "+255 673 526 644" }
const today = tanzaniaToday()

// supabase/seeds/60_results.sql: a retaken interview's earlier and current
// registrations, both Passed and Paid.
const RETAKEN = { earlier: "1e7e0000-0000-4000-8000-000000000604", current: "1e7e0000-0000-4000-8000-000000000605" }

let claim: InterviewYearClaim
let year: number

beforeAll(async () => {
  claim = await claimInterviewYear()
  year = claim.year
})

afterAll(async () => {
  await claim?.release()
})

// A lead of the test's own in the claimed year, registered, with the result
// unless `result` is null, and its fee Paid unless asked otherwise.
async function interviewedLead({
  result = "Passed",
  score = 74,
  paid = true,
}: { result?: "Passed" | "Failed" | null; score?: number; paid?: boolean } = {}) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Status Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Status ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: Number(today.slice(0, 4)) + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  // Moved into the claimed year before registering, so its S/N is issued there.
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  if (result) {
    const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result, score })
    if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  }
  if (paid) {
    const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
    if (!marked.ok) throw new Error(`fee failed: ${marked.error}`)
  }
  return { leadId, interviewId }
}

async function send(interviewId: string) {
  const sent = await releaseResult(await signedIn(ADMISSIONS), interviewId, "sms", OFFICE)
  if (!sent.ok) throw new Error(`release failed: ${sent.error}`)
}

async function correct(interviewId: string, result: "Passed" | "Failed", score: number) {
  const corrected = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result, score })
  if (!corrected.ok) throw new Error(`correction failed: ${corrected.error}`)
}

async function status(interviewIds: string[], client?: SupabaseClient) {
  const read = await listReleaseStatus(client ?? (await signedIn(ADMISSIONS)), interviewIds)
  if (!read.ok) throw new Error(read.error)
  return read.data
}

describe("listReleaseStatus", () => {
  test("a result never sent has no release time and is ready to send", async () => {
    const { interviewId } = await interviewedLead()
    expect((await status([interviewId])).get(interviewId)).toEqual({
      lastReleasedAt: null,
      changedSinceSent: false,
      current: true,
      readyToSend: true,
    })
  })

  test("a sent result gives the last release's time and is no longer ready", async () => {
    const { interviewId } = await interviewedLead()
    await send(interviewId)
    await send(interviewId)
    const releases = await getResultReleases(await signedIn(ADMISSIONS), interviewId)
    if (!releases.ok) throw new Error(releases.error)

    const read = (await status([interviewId])).get(interviewId)
    expect(read).toMatchObject({ changedSinceSent: false, readyToSend: false })
    expect(new Date(read!.lastReleasedAt!).getTime()).toBe(new Date(releases.data[0].releasedAt).getTime())
  })

  test("a result changed after its release is changed since sent and ready again, until it is sent again", async () => {
    const { leadId, interviewId } = await interviewedLead({ score: 74 })
    await send(interviewId)
    await correct(interviewId, "Passed", 79)

    expect((await status([interviewId])).get(interviewId)).toMatchObject({
      lastReleasedAt: expect.any(String),
      changedSinceSent: true,
      readyToSend: true,
    })
    // The lead screen reads the same rule.
    const view = await getResultRelease(await signedIn(ADMISSIONS), leadId, OFFICE)
    expect(view.ok && view.data.changedSinceSent).toBe(true)

    await send(interviewId)
    expect((await status([interviewId])).get(interviewId)).toMatchObject({ changedSinceSent: false, readyToSend: false })
  })

  test("a correction that ends where the release was is not a change", async () => {
    const { interviewId } = await interviewedLead({ result: "Passed", score: 74 })
    await send(interviewId)
    await correct(interviewId, "Failed", 30)
    await correct(interviewId, "Passed", 74)
    expect((await status([interviewId])).get(interviewId)).toMatchObject({ changedSinceSent: false, readyToSend: false })
  })

  test("Not Paid, no result, a closed lead and an earlier interview are never ready to send", async () => {
    const notPaid = await interviewedLead({ paid: false })
    const noResult = await interviewedLead({ result: null })
    const closed = await interviewedLead()
    await asSystem((sql) =>
      sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [closed.leadId]),
    )

    const read = await status([notPaid.interviewId, noResult.interviewId, closed.interviewId, RETAKEN.earlier, RETAKEN.current])
    expect(read.get(notPaid.interviewId)).toMatchObject({ readyToSend: false, current: true })
    expect(read.get(noResult.interviewId)).toMatchObject({ readyToSend: false, current: true })
    expect(read.get(closed.interviewId)).toMatchObject({ readyToSend: false, current: true })
    expect(read.get(RETAKEN.earlier)).toMatchObject({ readyToSend: false, current: false })
    expect(read.get(RETAKEN.current)).toMatchObject({ current: true })
  })

  test("no ids, or ids that don't exist, read nothing", async () => {
    expect((await status([])).size).toBe(0)
    expect((await status([randomUUID()])).size).toBe(0)
  })
})

describe("who may read release status", () => {
  test("the Accountant, who can't send, reads it: whether a family that paid has heard", async () => {
    const { interviewId } = await interviewedLead()
    await send(interviewId)
    expect((await status([interviewId], await signedIn(ACCOUNTANT))).get(interviewId)).toMatchObject({
      lastReleasedAt: expect.any(String),
      readyToSend: false,
    })
  })

  test("staff without leads.view, a deactivated staff member and a visitor are refused as forbidden", async () => {
    const { interviewId } = await interviewedLead()
    const noView = await createThrowawayStaff(["payments.view"])
    for (const client of [await signedIn(noView), await signedIn(DEACTIVATED), anonClient()]) {
      expect(await listReleaseStatus(client, [interviewId])).toEqual({ ok: false, error: "forbidden" })
    }
  })

  test("the database refuses the read directly, too", async () => {
    const noView = await createThrowawayStaff(["payments.view"])
    const { error } = await (await signedIn(noView)).rpc("interview_release_status", { interview_ids: [RETAKEN.current] })
    expect(error?.message).toBe("forbidden")
    const anon = await anonClient().rpc("interview_release_status", { interview_ids: [RETAKEN.current] })
    expect(anon.error?.code).toBe("42501")
  })
})

describe("the Ready to send filter", () => {
  async function everyRow(client: SupabaseClient, search: Omit<InterviewListSearch, "page">) {
    const rows: InterviewListItem[] = []
    for (let page = 1; ; page++) {
      const listed = await listInterviews(client, { ...search, page })
      if (!listed.ok) throw new Error(`listing failed: ${listed.error}`)
      rows.push(...listed.data.interviews)
      if (page >= listed.data.pageCount) return rows
    }
  }

  test("lists open, paid, current results not yet sent or changed since, and leaves out the rest", async () => {
    const ready = await interviewedLead()
    const changed = await interviewedLead({ score: 60 })
    await send(changed.interviewId)
    await correct(changed.interviewId, "Passed", 66)
    const sent = await interviewedLead()
    await send(sent.interviewId)
    const notPaid = await interviewedLead({ paid: false })
    const noResult = await interviewedLead({ result: null })
    const closed = await interviewedLead()
    await asSystem((sql) =>
      sql.query("update public.leads set status = 'Declined', declined_reason = 'School decision' where id = $1", [closed.leadId]),
    )
    const names = new Map(
      Object.entries({ ready, changed, sent, notPaid, noResult, closed }).map(([name, lead]) => [lead.interviewId, name]),
    )
    const ours = (rows: InterviewListItem[]) => rows.filter((row) => names.has(row.id)).map((row) => names.get(row.id))

    const staff = await signedIn(ADMISSIONS)
    expect(ours(await everyRow(staff, { enrollmentYear: year, readyToSend: true }))).toEqual(["ready", "changed"])
    expect(ours(await everyRow(staff, { enrollmentYear: year }))).toEqual(["ready", "changed", "sent", "notPaid", "noResult", "closed"])
    // It combines with the other filters.
    expect(ours(await everyRow(staff, { enrollmentYear: year, readyToSend: true, result: "Failed" }))).toEqual([])
    // The Accountant sees the same list.
    expect(ours(await everyRow(await signedIn(ACCOUNTANT), { enrollmentYear: year, readyToSend: true }))).toEqual([
      "ready",
      "changed",
    ])

    // Sending one takes it off the list.
    await send(ready.interviewId)
    expect(ours(await everyRow(await signedIn(MANAGER), { enrollmentYear: year, readyToSend: true }))).toEqual(["changed"])
  })

  test("staff without leads.view list nothing, filtered or not", async () => {
    await interviewedLead()
    const noView = await createThrowawayStaff(["payments.view"])
    const listed = await listInterviews(await signedIn(noView), { enrollmentYear: year, readyToSend: true, page: 1 })
    expect(listed).toMatchObject({ ok: true, data: { total: 0, interviews: [] } })
  })
})
