import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { countInterviewsByDay, countRegistrationsByDay } from "@/lib/services/home-stats"
import { registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// Home's stat-card counts (#323) against local Supabase. Each test plants its
// rows on days of its own, far in the past, so no other test's rows fall on
// them, and reads only those days.

const thisYear = Number(tanzaniaToday().slice(0, 4))

let claim: InterviewYearClaim

beforeAll(async () => {
  claim = await claimInterviewYear()
})

afterAll(async () => {
  await claim?.release()
})

// A run of three days of its own in 2001–2025.
function daysOfOwn(): [string, string, string] {
  const start = Date.UTC(2001, 0, 1) + randomInt(0, 9_000) * 86_400_000
  return [0, 1, 2].map((k) => new Date(start + k * 86_400_000).toISOString().slice(0, 10)) as [string, string, string]
}

async function newLead(name: string): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Home Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `${name} ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: tanzaniaToday() },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

describe("countRegistrationsByDay", () => {
  const [first, second, third] = daysOfOwn()

  beforeAll(async () => {
    const leads = [await newLead("Home Alpha"), await newLead("Home Bravo"), await newLead("Home Charlie")]
    await asSystem(async (sql) => {
      // 08:00 in Tanzania on the first day.
      await sql.query("update public.leads set created_at = $2 where id = $1", [leads[0], `${first}T05:00:00Z`])
      // 23:30 in Tanzania on the first day is 20:30 UTC the same day.
      await sql.query("update public.leads set created_at = $2 where id = $1", [leads[1], `${first}T20:30:00Z`])
      // 21:30 UTC is already 00:30 the next day in Tanzania.
      await sql.query("update public.leads set created_at = $2 where id = $1", [leads[2], `${first}T21:30:00Z`])
    })
  })

  test("counts each student on the Tanzania day they were registered", async () => {
    const counts = await countRegistrationsByDay(await signedIn(MANAGER), first, third)
    expect(counts).toEqual({ ok: true, data: { [first]: 2, [second]: 1 } })
  })

  test("reads only the days asked for", async () => {
    expect(await countRegistrationsByDay(await signedIn(MANAGER), second, second)).toEqual({ ok: true, data: { [second]: 1 } })
  })

  test("counts nothing for staff who may not view leads, or for someone signed out", async () => {
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await countRegistrationsByDay(await signedIn(outsider), first, third)).toEqual({ ok: true, data: {} })
    expect(await countRegistrationsByDay(anonClient(), first, third)).toEqual({ ok: true, data: {} })
  })
})

describe("countInterviewsByDay", () => {
  const [first, second, third] = daysOfOwn()

  beforeAll(async () => {
    const interviews: string[] = []
    for (const name of ["Home Delta", "Home Echo", "Home Foxtrot"]) {
      const leadId = await newLead(name)
      await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, claim.year]))
      const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
      if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
      interviews.push(registered.data.interviewId)
    }
    await asSystem(async (sql) => {
      await sql.query("update public.interviews set interview_date = $2, result = 'Passed', score = 70 where id = any($1)", [interviews.slice(0, 2), first])
      await sql.query("update public.interviews set interview_date = $2, result = 'Failed', score = 40 where id = $1", [interviews[2], third])
    })
  })

  test("counts the sittings dated each day", async () => {
    expect(await countInterviewsByDay(await signedIn(MANAGER), first, third)).toEqual({ ok: true, data: { [first]: 2, [third]: 1 } })
    expect(await countInterviewsByDay(await signedIn(MANAGER), second, second)).toEqual({ ok: true, data: {} })
  })

  test("counts nothing for staff who may not view leads", async () => {
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await countInterviewsByDay(await signedIn(outsider), first, third)).toEqual({ ok: true, data: {} })
  })
})
