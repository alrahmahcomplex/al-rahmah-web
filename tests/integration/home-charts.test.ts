import { randomInt, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, test, vi } from "vitest"

import { admissionYears, type AdmissionChild, type AdmissionForm } from "@/lib/admission-form"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { APPLICATION_SOURCES, getHomeChartCounts, type HomeChartCounts } from "@/lib/services/home-charts"
import { createLead, LEAD_CLASSES } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn, unusedAdmissionNumber } from "../support/db"
import { discountPhone, freshCode, leadWithCode } from "../support/discount-codes"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

vi.mock("server-only", () => ({}))

// Home's chart counts (#405) against local Supabase. The test moves the leads
// it makes into a year of its own in 1963–1997, which no seed and no other
// test uses, and reads only that year. Each lead is placed at a time of day
// in Tanzania, which the database turns into an instant itself, so no UTC
// offset is written here.

const [, nextYear] = admissionYears()
// The seeded Approved agent's code.
const AGENT_CODE = "BJN-402"

let year: number

// A year in 1963–1997 with no lead in it, nor in the years either side.
async function emptyYear(): Promise<number> {
  for (;;) {
    const candidate = 1963 + randomInt(0, 35)
    const taken = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ n: number }>(
        `select count(*)::int as n from public.leads
         where created_at >= make_timestamptz($1 - 1, 1, 1, 0, 0, 0, 'Africa/Dar_es_Salaam')
           and created_at < make_timestamptz($1 + 2, 1, 1, 0, 0, 0, 'Africa/Dar_es_Salaam')`,
        [candidate],
      )
      return rows[0].n
    })
    if (taken === 0) return candidate
  }
}

function formOf(className: AdmissionChild["className"], discountCode?: string): AdmissionForm {
  return {
    submissionKey: randomUUID(),
    parent: { fullName: "Chart Parent", relationship: "Father", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    children: [{ fullName: `Chart Pupil ${randomUUID().slice(0, 8)}`, className, enrollmentYear: nextYear, dayOrBoarding: "Day" }],
    ...(discountCode ? { discountCode } : {}),
  }
}

// A lead the public Admission form creates, as the Server Action does.
async function fromForm(className: AdmissionChild["className"], discountCode?: string): Promise<string> {
  const sent = formOf(className, discountCode)
  const result = await submitAdmissionForm(secretClient(), sent)
  if (!result.ok) throw new Error(`form failed: ${JSON.stringify(result)}`)
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ id: string }>("select id from public.leads where student_name = $1", [sent.children[0].fullName])
    return rows[0].id
  })
}

// A lead staff register at the desk.
async function atDesk(className: AdmissionChild["className"]): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: "Chart Desk Parent", relationship: "Mother", phone: discountPhone() } },
    student: { fullName: `Chart Walk ${randomUUID().slice(0, 8)}`, className, enrollmentYear: nextYear, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: new Date().toISOString().slice(0, 10) },
  })
  if (!created.ok) throw new Error(`desk failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

// A lead brought in by a student import.
async function imported(): Promise<string> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const batch = await sql.query<{ id: string }>(
      `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
       values ('students', 'charts.csv', $1, 1, 1, 0, 0) returning id`,
      [MANAGER.id],
    )
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin) values ('Mzazi Chati', 'Mother', $1, 'front_desk') returning id`,
      [discountPhone()],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
           guardian_contact_id, import_batch_id)
       values ($1, $2, 'FORM 1', 2027, 'Day', 'Visited', '2026-09-01', $3, $4) returning id`,
      [admissionNumber, `Chart Import ${randomUUID().slice(0, 8)}`, contact.rows[0].id, batch.rows[0].id],
    )
    return lead.rows[0].id
  })
}

// Places the lead at a Tanzania date and time: [year, month, day, hour, minute].
async function moveTo(leadId: string, [y, m, d, h, min]: [number, number, number, number, number]) {
  await asSystem((sql) =>
    sql.query("update public.leads set created_at = make_timestamptz($2, $3, $4, $5, $6, 0, 'Africa/Dar_es_Salaam') where id = $1", [leadId, y, m, d, h, min]),
  )
}

// Writes as the database owner under another audit actor, as the form's
// later steps (a re-application, a family match) do.
async function asActor<T>(actor: "public_form", work: (sql: Parameters<Parameters<typeof asSystem>[0]>[0]) => Promise<T>): Promise<T> {
  return asSystem(async (sql) => {
    await sql.query("select public.set_audit_actor($1)", [actor])
    return work(sql)
  })
}

async function countsAs(person: { email: string; password: string }): Promise<HomeChartCounts> {
  const result = await getHomeChartCounts(await signedIn(person), year)
  if (!result.ok) throw new Error(`count refused: ${result.error}`)
  return result.data
}

const nonZero = (rows: { count: number }[], key: (row: never) => string) =>
  Object.fromEntries(rows.filter((row) => row.count > 0).map((row) => [key(row as never), row.count]))

beforeAll(async () => {
  year = await emptyYear()
  console.info(`home-charts: planted in ${year}`)
  const promo = freshCode("C")
  await asSystem((sql) => sql.query("insert into public.promo_codes (code, name, amount) values ($1, 'Chart promo', 5000)", [promo]))

  const formPlain = await fromForm("STD 4")
  const formAgent = await fromForm("STD 4", AGENT_CODE)
  const deskPlain = await atDesk("STD 2")
  const deskPromo = await leadWithCode(promo)
  const systemPlain = await leadWithCode(null)
  const importedLead = await imported()
  const nextYearLead = await atDesk("FORM 2")
  const lastYearLead = await atDesk("FORM 3")
  // Registered at the desk, then touched by the form: still the desk.
  const deskThenForm = await atDesk("KG 1")
  await asActor("public_form", (sql) => sql.query("update public.leads set returning_family_reapplied = true where id = $1", [deskThenForm]))
  // A Promo code on a form lead, and an agent's code on a desk lead: the code decides.
  const formPromo = await fromForm("KG 2")
  const deskAgent = await atDesk("KG 1")
  await asSystem(async (sql) => {
    await sql.query("update public.leads set referral_code = $2 where id = $1", [formPromo, promo])
    await sql.query("update public.leads set referral_code = $2 where id = $1", [deskAgent, AGENT_CODE])
  })

  await moveTo(formPlain, [year, 1, 1, 0, 0])
  await moveTo(formAgent, [year, 3, 10, 9, 0])
  await moveTo(deskPlain, [year, 3, 20, 9, 0])
  await moveTo(deskThenForm, [year, 2, 2, 9, 0])
  await moveTo(formPromo, [year, 2, 28, 23, 59])
  await moveTo(deskPromo, [year, 7, 4, 9, 0])
  await moveTo(deskAgent, [year, 8, 1, 0, 0])
  await moveTo(systemPlain, [year, 12, 31, 23, 59])
  await moveTo(importedLead, [year, 5, 5, 9, 0])
  await moveTo(nextYearLead, [year + 1, 1, 1, 0, 0])
  await moveTo(lastYearLead, [year - 1, 12, 31, 23, 59])
})

describe("home_chart_counts", () => {
  test("counts this year's applications by month, in Tanzania time", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.months).toEqual([1, 2, 2, 0, 0, 0, 1, 1, 0, 0, 0, 1])
    expect(counts.total).toBe(8)
  })

  test("counts them by their current class, every class listed", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.classes.map((row) => row.className)).toEqual([...LEAD_CLASSES])
    expect(nonZero(counts.classes, (row: { className: string }) => row.className)).toEqual({ "KG 1": 2, "KG 2": 1, "STD 2": 1, "STD 3": 2, "STD 4": 2 })
  })

  test("sorts them by source: a Promo code, an agent's code, the Admission form, or the desk", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.sources.map((row) => row.source)).toEqual([...APPLICATION_SOURCES])
    expect(nonZero(counts.sources, (row: { source: string }) => row.source)).toEqual({
      admission_form: 1,
      // From the form and from the desk.
      agent_code: 2,
      promo_code: 2,
      // Registered by staff (one later touched by the form) or written by the system: never the form.
      walk_in: 3,
    })
  })

  test("leaves out students brought in by an import, and applications of other years", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.classes.find((row) => row.className === "FORM 1")?.count).toBe(0)
    expect(counts.classes.find((row) => row.className === "FORM 2")?.count).toBe(0)
    expect(counts.classes.find((row) => row.className === "FORM 3")?.count).toBe(0)
    const manager = await signedIn(MANAGER)
    for (const other of [year - 1, year + 1]) {
      const result = await getHomeChartCounts(manager, other)
      expect(result.ok && result.data.classes.filter((row) => row.count > 0)).toEqual([{ className: other < year ? "FORM 3" : "FORM 2", count: 1 }])
    }
  })

  test("counts the same for every role that may view leads", async () => {
    const manager = await countsAs(MANAGER)
    expect(await countsAs(ADMISSIONS)).toEqual(manager)
    expect(await countsAs(ACCOUNTANT)).toEqual(manager)
  })

  test("refuses staff who may not view leads, someone signed out, and a missing year", async () => {
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await getHomeChartCounts(await signedIn(outsider), year)).toEqual({ ok: false, error: "forbidden" })
    expect(await getHomeChartCounts(anonClient(), year)).toEqual({ ok: false, error: "forbidden" })
    const { error } = await (await signedIn(MANAGER)).rpc("home_chart_counts", { year: null })
    expect(error?.message).toBe("invalid")
  })

  test("hands back counts only: a dimension, a fixed bucket and a number, never a lead", async () => {
    const { data, error } = await (await signedIn(MANAGER)).rpc("home_chart_counts", { year })
    expect(error).toBeNull()
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))
    const allowed: Record<string, readonly string[]> = { month: months, class: LEAD_CLASSES, source: APPLICATION_SOURCES }
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).toSorted()).toEqual(["application_count", "bucket", "dimension"])
      expect(allowed[row.dimension as string]).toContain(row.bucket)
      expect(Number(row.application_count)).toBeGreaterThan(0)
    }
  })
})
