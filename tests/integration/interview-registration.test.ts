import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { getLeadInterviews, registerForInterview } from "@/lib/services/interviews"
import { createLead, updateLeadDetails, type LeadStatus } from "@/lib/services/leads"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "../support/fixtures"

// Registering a lead for interview through the interview module, against
// local Supabase. Each test makes its own leads; the seeded ones are only
// read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's seeded closed leads.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
// Slice 5's seeded registration: S/N 1 for 2027.
const REGISTERED = "1ead0000-0000-4000-8000-000000000501"

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

// A lead of the test's own, Visited by default (a walk-in) or Applied (the
// Admission form).
async function newLead(start: "walk-in" | "admission-form" = "walk-in"): Promise<string> {
  // A walk-in is created on a staff session; the Admission form with the
  // secret key, as the public form does.
  const creator = start === "walk-in" ? await signedIn(ADMISSIONS) : secretClient()
  const created = await createLead(creator, {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' 07 numbers.
      contact: { fullName: "Interview Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Candidate ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: start === "walk-in" ? { kind: "walk-in", visitDate: today } : { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

// An enrollment year no S/N has been issued in yet, far from any real intake,
// so a test sees its S/Ns count from 1. The local database keeps every
// counter the tests make, so after enough runs the pool runs out and a reset
// is needed.
async function freshYear(...avoid: number[]): Promise<number> {
  const used = await rows<{ enrollment_year: number }>(
    "select enrollment_year from public.interview_serial_counters where enrollment_year >= 2040",
  )
  const taken = new Set([...used.map((row) => row.enrollment_year), ...avoid])
  const free = Array.from({ length: 61 }, (_, i) => 2040 + i).filter((year) => !taken.has(year))
  if (free.length === 0) throw new Error("No unused enrollment year left between 2040 and 2100; run npm run db:reset")
  return free[randomInt(0, free.length)]
}

async function moveToYear(leadIds: string[], year: number) {
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = any($1)", [leadIds, year]))
}

async function interviewsOf(leadId: string) {
  return rows<{ serial_number: number; serial_year: number }>(
    "select serial_number, serial_year from public.interviews where lead = $1 order by registered_at",
    [leadId],
  )
}

describe("registering a lead for interview", () => {
  test("gives a Visited lead the next S/N for its enrollment year, counting from 1 per year", async () => {
    const [first, second, otherYear] = await Promise.all([newLead(), newLead(), newLead()])
    const year = await freshYear()
    const another = await freshYear(year)
    await moveToYear([first, second], year)
    await moveToYear([otherYear], another)
    const staff = await signedIn(ADMISSIONS)

    const one = await registerForInterview(staff, first)
    const two = await registerForInterview(staff, second)
    const fresh = await registerForInterview(staff, otherYear)

    expect(one).toEqual({ ok: true, data: { interviewId: expect.any(String), serialNumber: 1, enrollmentYear: year } })
    expect(two).toMatchObject({ ok: true, data: { serialNumber: 2, enrollmentYear: year } })
    expect(fresh).toMatchObject({ ok: true, data: { serialNumber: 1, enrollmentYear: another } })
  })

  test("registers an Applied lead whose family has not been to campus, and leaves it Applied", async () => {
    const lead = await newLead("admission-form")

    const result = await registerForInterview(await signedIn(MANAGER), lead)
    expect(result.ok).toBe(true)
    const [{ status }] = await rows<{ status: LeadStatus }>("select status from public.leads where id = $1", [lead])
    expect(status).toBe("Applied")
  })

  test("staff registering different leads at once get distinct, consecutive S/Ns", async () => {
    const leads = await Promise.all(Array.from({ length: 6 }, () => newLead()))
    const year = await freshYear()
    await moveToYear(leads, year)
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all(leads.map((lead, i) => registerForInterview(i % 2 ? one : other, lead)))
    const numbers = results.map((result) => (result.ok ? result.data.serialNumber : null)).sort((a, b) => a! - b!)
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6])
  })

  test("two staff registering the same lead at once register it once", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([registerForInterview(one, lead), registerForInterview(other, lead)])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "already_registered" }])
    expect(await interviewsOf(lead)).toHaveLength(1)
  })

  test("refuses a second registration", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    const first = await registerForInterview(staff, lead)
    expect(await registerForInterview(staff, lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await interviewsOf(lead)).toEqual([
      { serial_number: first.ok && first.data.serialNumber, serial_year: thisYear + 1 },
    ])
  })

  test("refuses an Interviewed lead with no interview on file as already registered", async () => {
    const lead = await newLead()
    await asSystem((sql) => sql.query("update public.leads set status = 'Interviewed' where id = $1", [lead]))

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "already_registered" })
    expect(await interviewsOf(lead)).toEqual([])
  })

  test("refuses an Enrolled lead", async () => {
    const lead = await newLead()
    await asSystem((sql) => sql.query("update public.leads set status = 'Enrolled' where id = $1", [lead]))

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "lead_enrolled" })
    expect(await interviewsOf(lead)).toEqual([])
  })

  test("refuses the seeded Declined and Archived leads as closed", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const lead of [DECLINED, ARCHIVED]) {
      expect(await registerForInterview(staff, lead), lead).toEqual({ ok: false, error: "lead_closed" })
      expect(await interviewsOf(lead), lead).toEqual([])
    }
  })

  test("refuses an Inactive lead as closed", async () => {
    const lead = await newLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [lead]))

    expect(await registerForInterview(await signedIn(ADMISSIONS), lead)).toEqual({ ok: false, error: "lead_closed" })
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await registerForInterview(staff, randomUUID())).toEqual({ ok: false, error: "not_found" })
    expect(await registerForInterview(staff, "not-a-uuid")).toEqual({ ok: false, error: "not_found" })
  })

  test("the S/N and its year survive a correction of the lead's enrollment year", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const registered = await registerForInterview(staff, lead)
    if (!registered.ok) throw new Error("registration failed")

    const corrected = await updateLeadDetails(staff, lead, { enrollmentYear: thisYear + 2 })
    expect(corrected.ok).toBe(true)

    const interviews = await getLeadInterviews(staff, lead)
    expect(interviews).toMatchObject({
      ok: true,
      data: [{ serialNumber: registered.data.serialNumber, enrollmentYear: thisYear + 1 }],
    })
  })

  test("nobody can change an S/N or its year afterwards, even as the database owner", async () => {
    await expect(
      asSystem((sql) => sql.query("update public.interviews set serial_number = serial_number + 100 where lead = $1", [REGISTERED])),
    ).rejects.toThrow("interview_registration_locked")
    await expect(
      asSystem((sql) => sql.query("update public.interviews set serial_year = 2030 where lead = $1", [REGISTERED])),
    ).rejects.toThrow("interview_registration_locked")
  })

  test("interviews are never deleted", async () => {
    await expect(
      inRolledBackTransaction((sql) => sql.query("delete from public.interviews where lead = $1", [REGISTERED])),
    ).rejects.toThrow("delete_refused")
  })

  test("is recorded in the lead's history with the staff member and the S/N", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const registered = await registerForInterview(staff, lead)
    if (!registered.ok) throw new Error("registration failed")

    const history = await getLeadHistory(staff, lead)
    if (!history.ok) throw new Error("history failed")
    const entry = history.data.entries.find((e) => e.record === "interviews")
    expect(entry).toMatchObject({ action: "insert", actor: ADMISSIONS.name, recordId: registered.data.interviewId })
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: "serial_number", from: null, to: registered.data.serialNumber },
        { field: "serial_year", from: null, to: thisYear + 1 },
        { field: "fee_status", from: null, to: "Not Paid" },
      ]),
    )
  })
})

describe("who may register a lead for interview", () => {
  test("the Accountant is refused", async () => {
    const lead = await newLead()
    expect(await registerForInterview(await signedIn(ACCOUNTANT), lead)).toEqual({ ok: false, error: "forbidden" })
    expect(await interviewsOf(lead)).toEqual([])
  })

  test("a role that may view and edit leads but not record interviews is refused", async () => {
    const lead = await newLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit", "visits.record"])
    expect(await registerForInterview(await signedIn(viewer), lead)).toEqual({ ok: false, error: "forbidden" })
    expect(await interviewsOf(lead)).toEqual([])
  })

  test("a deactivated member of Admissions Staff is refused", async () => {
    const lead = await newLead()
    expect(await registerForInterview(await signedIn(DEACTIVATED), lead)).toEqual({ ok: false, error: "forbidden" })
    expect(await interviewsOf(lead)).toEqual([])
  })

  test("nobody outside a staff session may register, the secret key included", async () => {
    const lead = await newLead()
    for (const client of [anonClient(), secretClient()]) {
      expect(await registerForInterview(client, lead)).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await interviewsOf(lead)).toEqual([])
  })
})

describe("reading a lead's interviews", () => {
  test("shows the seeded registration with no result yet and the fee unpaid at the full amount", async () => {
    const interviews = await getLeadInterviews(await signedIn(ACCOUNTANT), REGISTERED)
    expect(interviews).toEqual({
      ok: true,
      data: [
        {
          id: expect.any(String),
          serialNumber: 1,
          enrollmentYear: 2027,
          registeredAt: expect.any(String),
          interviewDate: null,
          result: null,
          score: null,
          nextAction: null,
          feeStatus: "Not Paid",
          amount: 50_000,
          discountApplied: false,
        },
      ],
    })
  })

  test("a lead never registered has none", async () => {
    expect(await getLeadInterviews(await signedIn(ADMISSIONS), await newLead())).toEqual({ ok: true, data: [] })
  })

  test("lists the current interview (newest registration) first, with its Next action and locked amount", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await registerForInterview(staff, lead)
    if (!first.ok) throw new Error("registration failed")
    // An earlier interview with its result and a paid fee, and a retaken one
    // after it, written directly: the retake rule belongs to a later ticket.
    const retake = await asSystem(async (sql) => {
      await sql.query(
        `update public.interviews
         set interview_date = $2, result = 'Failed', score = 41.5, fee_status = 'Paid', locked_amount = 30000,
             locked_discount_applied = true
         where id = $1`,
        [first.data.interviewId, today],
      )
      const counter = await sql.query<{ n: number }>(
        `update public.interview_serial_counters set last_number = last_number + 1
         where enrollment_year = $1 returning last_number as n`,
        [thisYear + 1],
      )
      const inserted = await sql.query<{ id: string }>(
        `insert into public.interviews (lead, serial_number, serial_year, registered_at, registered_by)
         values ($1, $2, $3, now() + interval '1 minute', $4) returning id`,
        [lead, counter.rows[0].n, thisYear + 1, ADMISSIONS.id],
      )
      return inserted.rows[0].id
    })

    const interviews = await getLeadInterviews(staff, lead)
    expect(interviews).toMatchObject({
      ok: true,
      data: [
        { id: retake, result: null, nextAction: null, feeStatus: "Not Paid", amount: 50_000, discountApplied: false },
        {
          id: first.data.interviewId,
          interviewDate: today,
          result: "Failed",
          score: 41.5,
          nextAction: "Contact the admissions office",
          feeStatus: "Paid",
          amount: 30_000,
          discountApplied: true,
        },
      ],
    })
  })

  test("the database refuses half a result, a score out of range or too precise, and an amount not locked by Paid", async () => {
    const broken = [
      "update public.interviews set result = 'Passed' where lead = $1",
      "update public.interviews set result = 'Passed', score = 101, interview_date = '2026-09-20' where lead = $1",
      "update public.interviews set result = 'Passed', score = 72.25, interview_date = '2026-09-20' where lead = $1",
      "update public.interviews set locked_amount = 50000 where lead = $1",
      "update public.interviews set fee_status = 'Paid' where lead = $1",
    ]
    for (const query of broken) {
      await expect(
        inRolledBackTransaction(async (sql) => {
          await sql.query("select public.set_audit_actor('system')")
          await sql.query(query, [REGISTERED])
        }),
        query,
      ).rejects.toThrow(/check constraint/)
    }
  })

  test("visitors who are not signed in, and staff without leads.view, see no interviews or S/N counters", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [anonClient(), outsider]) {
      const interviews = await client.from("interviews").select("id")
      expect(interviews.data ?? []).toEqual([])
      expect(await getLeadInterviews(client, REGISTERED)).toEqual({ ok: true, data: [] })
    }
    for (const client of [anonClient(), await signedIn(ADMISSIONS)]) {
      const counters = await client.from("interview_serial_counters").select("enrollment_year")
      expect(counters.data ?? []).toEqual([])
    }
  })
})
