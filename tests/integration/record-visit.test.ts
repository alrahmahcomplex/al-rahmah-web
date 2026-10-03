import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead, getLead, recordVisit, type Lead, type LeadStatus } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Recording the visit of an Applied family through the lead module, against
// local Supabase. Each test makes its own Applied lead through the Admission
// form start, and leaves the seeded fixtures alone.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function dayBefore(date: string, days = 1) {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() - days)
  return moved.toISOString().slice(0, 10)
}

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

async function reread(id: string): Promise<Lead> {
  const lead = await getLead(await signedIn(ADMISSIONS), id)
  if (!lead.ok) throw new Error("lead missing")
  return lead.data
}

// An Applied lead, as the Admission form makes it, read back.
async function appliedLead(): Promise<Lead> {
  const created = await createLead(secretClient(), {
    guardian: {
      // A leading 7 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Form Parent", relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Applicant ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return reread(created.data.leadId)
}

describe("recording the visit of an Applied family", () => {
  test("moves the lead to Visited with the Visit date, and changes nothing else", async () => {
    const lead = await appliedLead()

    const result = await recordVisit(await signedIn(ADMISSIONS), lead.id, dayBefore(today, 2))
    expect(result).toEqual({ ok: true, data: null })
    expect(await reread(lead.id)).toEqual({ ...lead, status: "Visited", visitDate: dayBefore(today, 2) })
  })

  test("today is a Visit date, and the Admissions Manager may record it too", async () => {
    const lead = await appliedLead()

    expect(await recordVisit(await signedIn(MANAGER), lead.id, today)).toEqual({ ok: true, data: null })
    expect(await reread(lead.id)).toMatchObject({ status: "Visited", visitDate: today })
  })

  test("refuses a date later than today in Tanzania, and changes nothing", async () => {
    const lead = await appliedLead()
    const [{ day: tomorrow }] = await rows<{ day: string }>("select (public.tanzania_today() + 1)::text as day")

    expect(await recordVisit(await signedIn(ADMISSIONS), lead.id, tomorrow)).toEqual({
      ok: false,
      error: { kind: "invalid", field: "visit_date" },
    })
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("refuses a date that isn't on the calendar as a Visit date refusal, not an outage", async () => {
    const lead = await appliedLead()
    const staff = await signedIn(ADMISSIONS)

    for (const date of [`${thisYear}-02-31`, `${thisYear}-13-01`]) {
      expect(await recordVisit(staff, lead.id, date), date).toEqual({
        ok: false,
        error: { kind: "invalid", field: "visit_date" },
      })
    }
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("refuses every status but Applied, so no lead goes backwards or records a second first visit", async () => {
    const staff = await signedIn(ADMISSIONS)
    const others: LeadStatus[] = ["Visited", "Interviewed", "Enrolled", "Declined"]
    for (const status of others) {
      const lead = await appliedLead()
      await asSystem((sql) =>
        // A Declined lead carries its reason (#97).
        sql.query(
          "update public.leads set status = $2::public.lead_status, visit_date = $3, declined_reason = case when $2::public.lead_status = 'Declined' then 'School decision'::public.declined_reason end where id = $1",
          [lead.id, status, dayBefore(today, 5)],
        ),
      )
      const before = await reread(lead.id)

      expect(await recordVisit(staff, lead.id, today), status).toEqual({ ok: false, error: { kind: "not-applied" } })
      expect(await reread(lead.id), status).toEqual(before)
    }
  })

  test("a visit already recorded is not recorded again", async () => {
    const lead = await appliedLead()
    const staff = await signedIn(ADMISSIONS)

    expect((await recordVisit(staff, lead.id, dayBefore(today, 3))).ok).toBe(true)
    expect(await recordVisit(staff, lead.id, today)).toEqual({ ok: false, error: { kind: "not-applied" } })
    expect((await reread(lead.id)).visitDate).toBe(dayBefore(today, 3))
  })

  test("two staff recording the same visit at once record it once", async () => {
    const lead = await appliedLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      recordVisit(one, lead.id, dayBefore(today)),
      recordVisit(other, lead.id, today),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { kind: "not-applied" } }])
  })

  test("an Applied lead with a closure mark is read-only", async () => {
    const lead = await appliedLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [lead.id]))

    expect(await recordVisit(await signedIn(ADMISSIONS), lead.id, today)).toEqual({ ok: false, error: { kind: "closed" } })
    expect(await reread(lead.id)).toMatchObject({ status: "Applied", visitDate: null, closure: "Inactive" })
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await recordVisit(staff, randomUUID(), today)).toEqual({ ok: false, error: { kind: "not-found" } })
    expect(await recordVisit(staff, "not-a-uuid", today)).toEqual({ ok: false, error: { kind: "not-found" } })
  })

  test("is recorded in the history with the staff member", async () => {
    const lead = await appliedLead()
    await recordVisit(await signedIn(ADMISSIONS), lead.id, today)

    const entries = await rows<{ old_values: unknown; new_values: unknown; name: string }>(
      `select a.old_values, a.new_values, s.full_name as name
       from public.audit_log a
       join public.staff_members s on s.id = a.actor_staff_id
       where a.action = 'update' and a.lead_id = $1
       order by a.id`,
      [lead.id],
    )
    expect(entries).toEqual([
      {
        old_values: { status: "Applied", visit_date: null },
        new_values: { status: "Visited", visit_date: today },
        name: ADMISSIONS.name,
      },
    ])
  })
})

describe("who may record a visit", () => {
  test("the Accountant is refused, and the lead stays Applied", async () => {
    const lead = await appliedLead()

    expect(await recordVisit(await signedIn(ACCOUNTANT), lead.id, today)).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("a role that may view leads but not record visits is refused", async () => {
    const lead = await appliedLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit"])

    expect(await recordVisit(await signedIn(viewer), lead.id, today)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("nobody outside a staff session may record one, the secret key included", async () => {
    const lead = await appliedLead()

    for (const client of [anonClient(), secretClient()]) {
      expect(await recordVisit(client, lead.id, today)).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await reread(lead.id)).toEqual(lead)
  })
})
