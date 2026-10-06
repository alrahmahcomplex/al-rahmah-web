import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import {
  countUnreviewedReApplications,
  getLeadReApplications,
  getReApplication,
  listReApplications,
  markReApplicationReviewed,
  RE_APPLICATIONS_PER_PAGE,
} from "@/lib/services/re-applications"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn, unusedAdmissionNumber } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Reviewing Re-applications (#77), against local Supabase: the queue, a
// lead's list, and Mark reviewed. Each test records re-applications of its
// own, with invented names and numbers clear of the seeded +255 700 000 xxx
// fixtures, so the seeded ones keep their review state across runs.

const [, nextYear] = admissionYears()

// The seeded Archived lead (00_base.sql).
const ARCHIVED_LEAD = "1ead0000-0000-4000-8000-000000000005"

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

type Lead = { id: string; admissionNumber: string; studentName: string; phone: string }

// A lead on file, Visited, Mother, STD 3, Day, written as the system actor.
async function onFile(closure: "Archived" | null = null): Promise<Lead> {
  const studentName = `Mtoto Mapitio ${randomUUID().slice(0, 8)}`
  const local = phone()
  const admissionNumber = await unusedAdmissionNumber()
  const id = await asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin)
       values ('Mama Mapitio', 'Mother', $1, 'admission_form') returning id`,
      [`+255${local.slice(1)}`],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (
         admission_number, student_name, class_name, enrollment_year, day_or_boarding,
         status, closure, closure_reason, visit_date, guardian_contact_id
       ) values ($1, $2, 'STD 3', $3, 'Day', 'Visited', $4, $5, '2026-09-01', $6) returning id`,
      [admissionNumber, studentName, nextYear, closure, closure ? "No longer pursuing admission" : null, contact.rows[0].id],
    )
    return lead.rows[0].id
  })
  return { id, admissionNumber, studentName, phone: local }
}

// The Admission form sending the child again, asking for STD 4: one field
// differs.
async function reApply(lead: Pick<Lead, "id" | "studentName" | "phone">): Promise<string> {
  const { data, error } = await secretClient().rpc("record_re_application", {
    lead_id: lead.id,
    submission_key: randomUUID(),
    submitted: {
      contact: { full_name: "Mama Mapitio", relationship: "Mother", phone: lead.phone },
      student: { full_name: lead.studentName, class_name: "STD 4", enrollment_year: nextYear, day_or_boarding: "Day" },
    },
  })
  if (error) throw new Error(`could not record a re-application: ${error.message}`)
  return data as string
}

async function unreviewedInDatabase(): Promise<number> {
  return inRolledBackTransaction(
    async (sql) => Number((await sql.query("select count(*) from public.re_applications where reviewed_at is null")).rows[0].count),
  )
}

async function reviewOf(id: string): Promise<{ reviewed_at: string | null; reviewed_by: string | null }> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select reviewed_at, reviewed_by from public.re_applications where id = $1", [id])).rows[0],
  )
}

describe("the Re-applications queue", () => {
  test("lists the unreviewed ones oldest first, 50 a page, with the lead and how many fields differ", async () => {
    // At least two pages, so the second page is read too.
    const missing = RE_APPLICATIONS_PER_PAGE + 1 - (await unreviewedInDatabase())
    for (let i = 0; i < missing; i++) await reApply(await onFile())
    const lead = await onFile()
    const latest = await reApply(lead)

    const staff = await signedIn(ADMISSIONS)
    const first = await listReApplications(staff, { filter: "unreviewed", page: 1 })
    if (!first.ok) throw new Error(first.error)
    expect(first.data.reApplications).toHaveLength(RE_APPLICATIONS_PER_PAGE)
    expect(first.data.total).toBeGreaterThan(RE_APPLICATIONS_PER_PAGE)
    expect(first.data.pageCount).toBe(Math.ceil(first.data.total / RE_APPLICATIONS_PER_PAGE))
    expect(first.data.reApplications.every((entry) => entry.reviewedAt === null)).toBe(true)
    const times = first.data.reApplications.map((entry) => Date.parse(entry.receivedAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))

    const second = await listReApplications(staff, { filter: "unreviewed", page: 2 })
    if (!second.ok) throw new Error(second.error)
    expect(Date.parse(second.data.reApplications[0].receivedAt)).toBeGreaterThanOrEqual(times[times.length - 1])

    // The newest is on the last page, with its lead's details. (Tests running
    // alongside may add newer ones, so it is looked for from the last page
    // back.)
    const counted = await listReApplications(staff, { filter: "unreviewed", page: 1 })
    if (!counted.ok) throw new Error(counted.error)
    let found
    for (let page = counted.data.pageCount; page > 0 && !found; page--) {
      const read = await listReApplications(staff, { filter: "unreviewed", page })
      if (!read.ok) throw new Error(read.error)
      found = read.data.reApplications.find((entry) => entry.id === latest)
    }
    expect(found).toMatchObject({
      leadId: lead.id,
      admissionNumber: lead.admissionNumber,
      studentName: lead.studentName,
      status: "Visited",
      closure: null,
      differingFields: ["class_name"],
      reviewedAt: null,
      reviewedBy: null,
    })
  })

  test("a page past the last is empty, and still says how many there are", async () => {
    const staff = await signedIn(ADMISSIONS)
    const beyond = await listReApplications(staff, { filter: "unreviewed", page: 10_000 })
    if (!beyond.ok) throw new Error(beyond.error)
    expect(beyond.data.reApplications).toEqual([])
    expect(beyond.data.total).toBeGreaterThan(0)
  })

  test("Show reviewed lists the reviewed ones, the latest review first, with who reviewed each", async () => {
    const staff = await signedIn(ADMISSIONS)
    const reviewed = await reApply(await onFile())
    expect((await markReApplicationReviewed(staff, reviewed)).ok).toBe(true)

    const list = await listReApplications(staff, { filter: "reviewed", page: 1 })
    if (!list.ok) throw new Error(list.error)
    expect(list.data.reApplications[0]).toMatchObject({ id: reviewed, reviewedBy: ADMISSIONS.name })
    expect(list.data.reApplications.every((entry) => entry.reviewedAt !== null)).toBe(true)
    const times = list.data.reApplications.map((entry) => Date.parse(entry.reviewedAt!))
    expect(times).toEqual([...times].sort((a, b) => b - a))

    const unreviewed = await listReApplications(staff, { filter: "unreviewed", page: 1 })
    if (!unreviewed.ok) throw new Error(unreviewed.error)
    expect(unreviewed.data.reApplications.some((entry) => entry.id === reviewed)).toBe(false)
  })

  test("the count is the unreviewed ones, and drops when one is reviewed", async () => {
    const staff = await signedIn(MANAGER)
    const id = await reApply(await onFile())

    const before = await countUnreviewedReApplications(staff)
    if (!before.ok) throw new Error(before.error)
    expect(before.data).toBe(await unreviewedInDatabase())

    expect((await markReApplicationReviewed(staff, id)).ok).toBe(true)
    const after = await countUnreviewedReApplications(staff)
    if (!after.ok) throw new Error(after.error)
    expect(after.data).toBe(await unreviewedInDatabase())
  })

  test("staff without leads.view read an empty queue and a count of none", async () => {
    await reApply(await onFile())
    const outsider = await signedIn(await createThrowawayStaff([]))

    const list = await listReApplications(outsider, { filter: "unreviewed", page: 1 })
    expect(list).toEqual({ ok: true, data: { reApplications: [], total: 0, page: 1, pageCount: 1 } })
    expect(await countUnreviewedReApplications(outsider)).toEqual({ ok: true, data: 0 })
  })
})

describe("a lead's re-applications", () => {
  test("lists every one on the lead, newest first, reviewed or not", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await onFile()
    const older = await reApply(lead)
    const newer = await reApply(lead)
    expect((await markReApplicationReviewed(staff, older)).ok).toBe(true)

    const list = await getLeadReApplications(await signedIn(ACCOUNTANT), lead.id)
    if (!list.ok) throw new Error(list.error)
    expect(list.data.map((entry) => entry.id)).toEqual([newer, older])
    expect(list.data[0]).toMatchObject({ reviewedAt: null, reviewedBy: null, differingFields: ["class_name"] })
    expect(list.data[1]).toMatchObject({ reviewedBy: ADMISSIONS.name })
    expect(list.data[1].reviewedAt).not.toBeNull()
  })
})

describe("one re-application", () => {
  test("holds what the family sent, beside the lead it names", async () => {
    const lead = await onFile()
    const id = await reApply(lead)

    const read = await getReApplication(await signedIn(ACCOUNTANT), id)
    if (!read.ok) throw new Error(read.error)
    expect(read.data).toMatchObject({
      id,
      leadId: lead.id,
      admissionNumber: lead.admissionNumber,
      studentName: lead.studentName,
      status: "Visited",
      closure: null,
      differingFields: ["class_name"],
      reviewedAt: null,
      reviewedBy: null,
      submitted: {
        contactName: "Mama Mapitio",
        relationship: "Mother",
        relationshipDescription: null,
        phone: `+255${lead.phone.slice(1)}`,
        whatsapp: null,
        studentName: lead.studentName,
        className: "STD 4",
        enrollmentYear: nextYear,
        dayOrBoarding: "Day",
      },
    })
  })

  test("one that doesn't exist, or a malformed id, is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getReApplication(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await getReApplication(staff, "not-an-id")).toEqual({ ok: false, error: "not-found" })
  })
})

describe("Mark reviewed", () => {
  test("records the staff member and the time, once", async () => {
    const id = await reApply(await onFile())
    const staff = await signedIn(ADMISSIONS)

    expect(await markReApplicationReviewed(staff, id)).toEqual({ ok: true, data: null })
    const review = await reviewOf(id)
    expect(review.reviewed_by).toBe(ADMISSIONS.id)
    expect(review.reviewed_at).not.toBeNull()

    // Marking it again is refused, and keeps the first review.
    expect(await markReApplicationReviewed(await signedIn(MANAGER), id)).toEqual({ ok: false, error: "no-change" })
    expect(await reviewOf(id)).toEqual(review)
  })

  test("needs leads.edit: the Accountant, staff with leads.view alone and anon are refused", async () => {
    const id = await reApply(await onFile())
    const viewer = await createThrowawayStaff(["leads.view"])

    for (const client of [await signedIn(ACCOUNTANT), await signedIn(viewer)]) {
      expect(await markReApplicationReviewed(client, id)).toEqual({ ok: false, error: "forbidden" })
    }
    const { error } = await anonClient().rpc("mark_re_application_reviewed", { re_application_id: id })
    expect(error).not.toBeNull()
    expect(await reviewOf(id)).toEqual({ reviewed_at: null, reviewed_by: null })
  })

  test("is refused to the secret key, which acts for no staff member", async () => {
    const id = await reApply(await onFile())
    const { error } = await secretClient().rpc("mark_re_application_reviewed", { re_application_id: id })
    expect(error?.message).toBe("not_permitted")
  })

  test("a re-application that doesn't exist, or a malformed id, is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await markReApplicationReviewed(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await markReApplicationReviewed(staff, "not-an-id")).toEqual({ ok: false, error: "not-found" })
  })

  test("is allowed on the seeded Archived lead, which stays Archived", async () => {
    const lead = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ student_name: string; phone: string }>(
            `select l.student_name, g.phone from public.leads l
             join public.guardian_contacts g on g.id = l.guardian_contact_id where l.id = $1`,
            [ARCHIVED_LEAD],
          )
        ).rows[0],
    )
    const id = await reApply({ id: ARCHIVED_LEAD, studentName: lead.student_name, phone: `0${lead.phone.slice(4)}` })

    expect(await markReApplicationReviewed(await signedIn(ADMISSIONS), id)).toEqual({ ok: true, data: null })
    const after = await inRolledBackTransaction(
      async (sql) => (await sql.query("select closure from public.leads where id = $1", [ARCHIVED_LEAD])).rows[0],
    )
    expect(after.closure).toBe("Archived")
  })

  test("shows in the lead's history with the staff member's name", async () => {
    const lead = await onFile()
    const id = await reApply(lead)
    expect((await markReApplicationReviewed(await signedIn(ADMISSIONS), id)).ok).toBe(true)

    const history = await getLeadHistory(await signedIn(MANAGER), lead.id)
    if (!history.ok) throw new Error(history.error)
    const [review] = history.data.entries
    expect(review).toMatchObject({ actor: ADMISSIONS.name, record: "re_applications", recordId: id, action: "update" })
    expect(review.changes.map((change) => change.field).sort()).toEqual(["reviewed_at", "reviewed_by"])
  })
})
