import { randomInt, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, test, vi } from "vitest"

import { admissionYears, type AdmissionChild, type AdmissionForm } from "@/lib/admission-form"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { APPLICATION_SOURCES, getAdmissionYears, getHomeChartCounts, type HomeChartCounts } from "@/lib/services/home-charts"
import { createLead, LEAD_CLASSES, LEAD_STATUSES, type LeadClass, type LeadStatus } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn, unusedAdmissionNumber } from "../support/db"
import { discountPhone, freshCode } from "../support/discount-codes"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

vi.mock("server-only", () => ({}))

// Home's chart counts (#405, #518) against local Supabase: every applicant
// enrolling in the year asked for, imported records counted like the rest,
// and the years Home's year list offers. The test moves
// the leads it makes into two enrollment years of its own in 2001–2023, which
// no seed and no other test uses, and reads only those. Each lead is placed
// at a time of day in Tanzania, which the database turns into an instant
// itself, so no UTC offset is written here.

const [, nextYear] = admissionYears()
// The seeded Approved agent's code.
const AGENT_CODE = "BJN-402"

let year: number

// The first of two enrollment years in 2002–2022 with no lead in them, nor
// in the years either side, picked at random from those still free. Each run
// fills two years, so after many runs without a reset none may be left.
async function emptyYears(): Promise<number> {
  const free = await inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ year: number }>(
      `select y as year from generate_series(2002, 2022) as y
       where not exists (select 1 from public.leads l where l.enrollment_year between y - 1 and y + 2)`,
    )
    return rows.map((row) => row.year)
  })
  if (free.length === 0) throw new Error("No free enrollment years in 2001–2023 for the chart counts test: run `npm run db:reset`.")
  return free[randomInt(0, free.length)]
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

// A lead brought in by a student import, with its Visit date from the file
// (or none), its code (or none), its status and its enrollment year. It is
// created now, the import day. A Declined lead is closed to edits, so it goes
// straight into its year.
async function imported(className: LeadClass, visitDate: string | null, code: string | null = null, status?: LeadStatus, enrollmentYear = 2027): Promise<string> {
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const batch = await sql.query<{ id: string }>(
      `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
       values ('students', 'charts.csv', $1, 1, 1, 0, 0) returning id`,
      [MANAGER.id],
    )
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, phone, origin) values ('Mzazi Chati', $1, 'front_desk') returning id`,
      [discountPhone()],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
           guardian_contact_id, referral_code, import_batch_id, custodian_relationship, declined_reason)
       values ($1, $2, $3, $9, 'Day', $4, $5, $6, $7, $8, 'Mother',
           case when $4::public.lead_status = 'Declined' then 'Family changed plans'::public.declined_reason end) returning id`,
      [
        admissionNumber,
        `Chart Import ${randomUUID().slice(0, 8)}`,
        className,
        status ?? (visitDate ? "Visited" : "Applied"),
        visitDate,
        contact.rows[0].id,
        code,
        batch.rows[0].id,
        enrollmentYear,
      ],
    )
    return lead.rows[0].id
  })
}

type At = [year: number, month: number, day: number, hour: number, minute: number]

// Moves the lead into `enrollmentYear` and, given `at`, places it at that
// Tanzania date and time.
async function place(leadId: string, enrollmentYear: number, at?: At) {
  await asSystem(async (sql) => {
    await sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, enrollmentYear])
    if (at) {
      await sql.query("update public.leads set created_at = make_timestamptz($2, $3, $4, $5, $6, 0, 'Africa/Dar_es_Salaam') where id = $1", [leadId, ...at])
    }
  })
}

// Writes as the database owner under another audit actor, as the form's
// later steps (a re-application, a family match) do.
async function asActor<T>(actor: "public_form", work: (sql: Parameters<Parameters<typeof asSystem>[0]>[0]) => Promise<T>): Promise<T> {
  return asSystem(async (sql) => {
    await sql.query("select public.set_audit_actor($1)", [actor])
    return work(sql)
  })
}

async function countsAs(person: { email: string; password: string }, of = year): Promise<HomeChartCounts> {
  const result = await getHomeChartCounts(await signedIn(person), of)
  if (!result.ok) throw new Error(`count refused: ${result.error}`)
  return result.data
}

const nonZero = (rows: { count: number }[], key: (row: never) => string) =>
  Object.fromEntries(rows.filter((row) => row.count > 0).map((row) => [key(row as never), row.count]))
const monthsOf = (counts: HomeChartCounts) => Object.fromEntries(counts.months.map((row) => [row.month, row.count]))

beforeAll(async () => {
  year = await emptyYears()
  console.info(`home-charts: planted in enrollment years ${year} and ${year + 1}`)
  const before = year - 1
  const promo = freshCode("C")
  await asSystem((sql) => sql.query("insert into public.promo_codes (code, name, amount) values ($1, 'Chart promo', 5000)", [promo]))

  // The year asked for, applied for mostly in the calendar year before it.
  const formPlain = await fromForm("STD 4")
  const formAgent = await fromForm("STD 4", AGENT_CODE)
  const deskPlain = await atDesk("STD 2")
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

  await place(formPlain, year, [before, 6, 1, 0, 0])
  await place(formAgent, year, [before, 9, 10, 9, 0])
  await place(deskPlain, year, [before, 9, 20, 9, 0])
  await place(deskThenForm, year, [before, 10, 2, 9, 0])
  // 23:59 on 31 October in Tanzania is 20:59 UTC: still October.
  await place(formPromo, year, [before, 10, 31, 23, 59])
  await place(deskAgent, year, [year, 1, 4, 0, 0])

  // Imported records: by their Visit date, never the import day; by their code's source, or the desk.
  await imported("FORM 1", `${before - 1}-03-15`, null, "Declined", year)
  await place(await imported("FORM 1", `${before}-08-05`, AGENT_CODE), year)
  await place(await imported("STD 2", `${before}-08-06`, promo), year)
  // No Visit date in the file: the import day is its own date.
  await place(await imported("FORM 1", null), year, [before, 11, 11, 9, 0])

  // The next enrollment year, applied for in the same months.
  await place(await atDesk("FORM 2"), year + 1, [before, 9, 1, 9, 0])
  await place(await imported("FORM 3", `${before}-09-02`), year + 1)
})

describe("home_chart_counts", () => {
  test("counts every applicant by enrollment year, imported records with the rest, whatever year they applied in", async () => {
    expect((await countsAs(MANAGER)).total).toBe(10)
    const next = await countsAs(MANAGER, year + 1)
    expect(next.total).toBe(2)
    expect(nonZero(next.classes, (row: { className: string }) => row.className)).toEqual({ "FORM 2": 1, "FORM 3": 1 })
    expect(nonZero(next.sources, (row: { source: string }) => row.source)).toEqual({ walk_in: 2 })
    expect(monthsOf(next)).toEqual({ [`${year - 1}-09`]: 2 })
  })

  test("counts them by month in Tanzania time, an imported record in the month of its own Visit date", async () => {
    const counts = await countsAs(MANAGER)
    const before = year - 1
    expect(counts.months.map((row) => row.month)).toEqual(counts.months.map((row) => row.month).toSorted())
    expect(monthsOf(counts)).toEqual({
      [`${before - 1}-03`]: 1,
      [`${before}-06`]: 1,
      [`${before}-08`]: 2,
      [`${before}-09`]: 2,
      [`${before}-10`]: 2,
      [`${before}-11`]: 1,
      [`${year}-01`]: 1,
    })
  })

  test("counts them by their current class, every class listed", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.classes.map((row) => row.className)).toEqual([...LEAD_CLASSES])
    expect(nonZero(counts.classes, (row: { className: string }) => row.className)).toEqual({
      "KG 1": 2,
      "KG 2": 1,
      "STD 2": 2,
      "STD 4": 2,
      "FORM 1": 3,
    })
  })

  test("counts them by their current status, every status listed, imported records with the rest", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.statuses.map((row) => row.status)).toEqual([...LEAD_STATUSES])
    const direct = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ status: string; n: number }>(
        "select status::text as status, count(*)::int as n from public.leads where enrollment_year = $1 group by status",
        [year],
      )
      return Object.fromEntries(rows.map((row) => [row.status, row.n]))
    })
    expect(nonZero(counts.statuses, (row: { status: string }) => row.status)).toEqual(direct)
    expect(direct.Declined).toBe(1)
  })

  test("sorts them by source: a Promo code, an agent's code, the Admission form, or else the desk", async () => {
    const counts = await countsAs(MANAGER)
    expect(counts.sources.map((row) => row.source)).toEqual([...APPLICATION_SOURCES])
    expect(nonZero(counts.sources, (row: { source: string }) => row.source)).toEqual({
      admission_form: 1,
      // From the form, from the desk and from an import.
      agent_code: 3,
      // From the form and from an import.
      promo_code: 2,
      // Registered by staff, one later touched by the form: never the form.
      // And imported with no code, with a Visit date or without.
      walk_in: 4,
    })
  })

  test("adds up to a direct count of the year's leads in every dimension", async () => {
    const counts = await countsAs(MANAGER)
    const direct = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.leads where enrollment_year = $1", [year])
      return rows[0].n
    })
    const sum = (rows: { count: number }[]) => rows.reduce((total, row) => total + row.count, 0)
    expect(counts.total).toBe(direct)
    expect(sum(counts.months)).toBe(direct)
    expect(sum(counts.classes)).toBe(direct)
    expect(sum(counts.statuses)).toBe(direct)
    expect(sum(counts.sources)).toBe(direct)
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
    const allowed: Record<string, (bucket: string) => boolean> = {
      month: (bucket) => /^\d{4}-(0[1-9]|1[0-2])$/.test(bucket),
      class: (bucket) => (LEAD_CLASSES as readonly string[]).includes(bucket),
      status: (bucket) => (LEAD_STATUSES as readonly string[]).includes(bucket),
      source: (bucket) => (APPLICATION_SOURCES as readonly string[]).includes(bucket),
    }
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).toSorted()).toEqual(["application_count", "bucket", "dimension"])
      expect(allowed[row.dimension as string](row.bucket as string)).toBe(true)
      expect(Number(row.application_count)).toBeGreaterThan(0)
    }
  })
})

describe("home_admission_years", () => {
  test("lists every year with an applicant, newest first, each once", async () => {
    const result = await getAdmissionYears(await signedIn(MANAGER))
    if (!result.ok) throw new Error(`years refused: ${result.error}`)
    expect(result.data).toContain(year)
    expect(result.data).toContain(year + 1)
    expect(result.data).toEqual([...new Set(result.data)].toSorted((a, b) => b - a))
    // The years either side of the two planted ones have no lead (emptyYears).
    expect(result.data).not.toContain(year - 1)
    expect(result.data).not.toContain(year + 2)
  })

  test("is the same for every role that may view leads, and refused to anyone else", async () => {
    const manager = await getAdmissionYears(await signedIn(MANAGER))
    expect(await getAdmissionYears(await signedIn(ADMISSIONS))).toEqual(manager)
    expect(await getAdmissionYears(await signedIn(ACCOUNTANT))).toEqual(manager)
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await getAdmissionYears(await signedIn(outsider))).toEqual({ ok: false, error: "forbidden" })
    expect(await getAdmissionYears(anonClient())).toEqual({ ok: false, error: "forbidden" })
  })
})
