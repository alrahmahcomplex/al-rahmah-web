import { randomInt, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { countInterviewsByDay, countRegistrationsByDay } from "@/lib/services/home-stats"
import { registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, signedIn, unusedAdmissionNumber } from "../support/db"
import { discountPhone } from "../support/discount-codes"
import { ADMISSIONS, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// Home's stat-card counts (#323, #519) against local Supabase: every
// interview and application on its own day, imported or entered here,
// whatever admission year. Each test plants its rows on days of its own, far
// in the past, so no other test's rows fall on them, and reads only those days.

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

// A lead a student import brought in, created now (the import day), with its
// Visit date from the file or none, enrolling in `enrollmentYear`.
async function importedLead(visitDate: string | null, enrollmentYear: number): Promise<{ leadId: string; batchId: string }> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const batch = await sql.query<{ id: string }>(
      `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
       values ('students', 'stats.csv', $1, 1, 1, 0, 0) returning id`,
      [MANAGER.id],
    )
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, phone, origin) values ('Mzazi Takwimu', $1, 'front_desk') returning id`,
      [discountPhone()],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
           guardian_contact_id, import_batch_id, custodian_relationship)
       values ($1, $2, 'STD 3', $3, 'Day', $4, $5, $6, $7, 'Mother') returning id`,
      [admissionNumber, `Home Import ${randomUUID().slice(0, 8)}`, enrollmentYear, visitDate ? "Visited" : "Applied", visitDate, contact.rows[0].id, batch.rows[0].id],
    )
    return { leadId: lead.rows[0].id, batchId: batch.rows[0].id }
  })
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
    // Imported today for a year long gone: counted on its Visit date from the file, never today.
    await importedLead(third, 2003)
    // Imported with no Visit date: the import day is its own date.
    const undated = await importedLead(null, thisYear)
    await asSystem((sql) => sql.query("update public.leads set created_at = $2 where id = $1", [undated.leadId, `${third}T09:00:00Z`]))
  })

  test("counts each student on their own Tanzania day, imported or not, whatever year they apply for", async () => {
    const counts = await countRegistrationsByDay(await signedIn(MANAGER), first, third)
    expect(counts).toEqual({ ok: true, data: { [first]: 2, [second]: 1, [third]: 2 } })
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

    // Given an S/N on the second day, no result yet: counted on that day.
    const waiting = await newLead("Home Golf")
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [waiting, claim.year]))
    const registered = await registerForInterview(await signedIn(ADMISSIONS), waiting)
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
    // The S/N's time never changes in the app (guard_interview_change), so the
    // test moves it with triggers off for this one update.
    await asSystem(async (sql) => {
      await sql.query("set session_replication_role = replica")
      await sql.query("update public.interviews set registered_at = $2 where id = $1", [registered.data.interviewId, `${second}T06:00:00Z`])
      await sql.query("set session_replication_role = default")
    })

    // Imported today as interviewed, with no result: counted on the child's Visit date from the file.
    const imported = await importedLead(second, claim.year)
    await asSystem((sql) =>
      sql.query(
        `insert into public.interviews (lead, serial_number, serial_year, registered_by, import_batch_id)
         values ($1, $2, $3, $4, $5)`,
        [imported.leadId, 900_000 + randomInt(0, 99_999), claim.year, MANAGER.id, imported.batchId],
      ),
    )

    // Imported with a Visit date on the first day, its result later recorded as sat on the third:
    // the sitting's own date wins over the Visit date.
    const resulted = await importedLead(first, claim.year)
    await asSystem((sql) =>
      sql.query(
        `insert into public.interviews (lead, serial_number, serial_year, registered_by, import_batch_id, interview_date, result, score)
         values ($1, $2, $3, $4, $5, $6, 'Passed', 65)`,
        [resulted.leadId, 900_000 + randomInt(0, 99_999), claim.year, MANAGER.id, resulted.batchId, third],
      ),
    )
  })

  test("counts every interview on its own day: the result's date, else an import's Visit date, else the S/N's day", async () => {
    expect(await countInterviewsByDay(await signedIn(MANAGER), first, third)).toEqual({ ok: true, data: { [first]: 2, [second]: 2, [third]: 2 } })
    expect(await countInterviewsByDay(await signedIn(MANAGER), second, second)).toEqual({ ok: true, data: { [second]: 2 } })
  })

  test("counts nothing for staff who may not view leads", async () => {
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await countInterviewsByDay(await signedIn(outsider), first, third)).toEqual({ ok: true, data: {} })
  })
})
