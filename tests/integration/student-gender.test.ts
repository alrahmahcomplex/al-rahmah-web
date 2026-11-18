import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears, type AdmissionChild, type AdmissionParent } from "@/lib/admission-form"
import { studentFullName } from "@/lib/names"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import {
  completeAdmissionVisit,
  createLead,
  registerStudents,
  updateLeadDetails,
  type StudentGender,
} from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import {
  anonClient,
  asSystem,
  inRolledBackTransaction,
  secretClient,
  signedIn,
  unusedAdmissionNumber,
} from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// Boy or girl on each child (#449, slice 1), through the services and the
// database against local Supabase. Every name and phone is made up.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))
const [, nextYear] = admissionYears()

// A leading 069 keeps it clear of the seeded numbers and the other suites.
const phone = () => `069${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
const stored = (local: string) => `+255${local.slice(1)}`
const word = () => `G${randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "d")}`
const father = () => ({ fatherFirst: word(), fatherMiddle: word(), fatherLast: word() })

async function genderOf(leadId: string): Promise<StudentGender | null> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ gender: StudentGender | null }>("select gender from public.leads where id = $1", [leadId]),
  )
  return rows[0].gender
}

async function leadOf(admissionNumber: string): Promise<string> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.leads where admission_number = $1", [admissionNumber]),
  )
  return rows[0].id
}

// The first year staff may choose that has a fee schedule.
async function registrationYear(): Promise<number> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ year: number }>(
      "select min(enrollment_year)::int as year from public.fee_schedules where enrollment_year between $1 and $1 + 2",
      [thisYear],
    ),
  )
  if (rows[0].year === null) throw new Error("no fee schedule in the years staff may choose")
  return rows[0].year
}

async function walkIn(gender?: StudentGender) {
  return createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: `Gender Parent ${word()}`, relationship: "Mother", phone: phone() } },
    student: {
      fullName: `Pupil ${word()} Baba`,
      className: "KG 1",
      enrollmentYear: nextYear,
      dayOrBoarding: "Day",
      ...(gender ? { gender } : {}),
    },
    start: { kind: "walk-in", visitDate: today },
  })
}

function parentOf(): AdmissionParent {
  return { fullName: "", nameParts: { firstName: "Form", middleName: "Parent", lastName: word() }, relationship: "Mother", phone: phone() }
}

function formChild(
  year: number,
  gender?: StudentGender,
  f: ReturnType<typeof father> = father(),
): AdmissionChild & { first: string; father: ReturnType<typeof father> } {
  const first = word()
  return {
    first,
    father: f,
    fullName: studentFullName({ firstName: first, ...f }),
    nameParts: { firstName: first, ...f },
    className: "KG 1",
    enrollmentYear: year,
    dayOrBoarding: "Day",
    ...(gender ? { gender } : {}),
  }
}

// A child already on file, written as the system actor, with or without an
// answer and in any status: STD 3, Day, Mother.
async function onFile(
  gender: StudentGender | null,
  status: "Visited" | "Declined" = "Visited",
  closure: "Inactive" | "Archived" | null = null,
) {
  const parent: AdmissionParent = { fullName: "Mama Jinsia", relationship: "Mother", phone: phone() }
  const studentName = `Mtoto Jinsia ${randomUUID().slice(0, 8)}`
  const admissionNumber = await unusedAdmissionNumber()
  const id = await asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin)
       values ($1, 'Mother', $2, 'admission_form') returning id`,
      [parent.fullName, stored(parent.phone)],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (
         admission_number, student_name, class_name, enrollment_year, day_or_boarding,
         status, visit_date, guardian_contact_id, declined_reason, status_before_decline, gender,
         closure, closure_reason
       ) values ($1, $2, 'STD 3', $3, 'Day', $4, '2026-09-01', $5, $6, $7, $8, $9, $10) returning id`,
      [
        admissionNumber,
        studentName,
        nextYear,
        status,
        contact.rows[0].id,
        status === "Declined" ? "Family changed plans" : null,
        status === "Declined" ? "Visited" : null,
        gender,
        closure,
        closure === null ? null : "No longer pursuing admission",
      ],
    )
    return lead.rows[0].id
  })
  return { id, admissionNumber, studentName, parent }
}

async function sendAgain(lead: Awaited<ReturnType<typeof onFile>>, gender?: StudentGender) {
  const sent = await submitAdmissionForm(secretClient(), {
    submissionKey: randomUUID(),
    parent: lead.parent,
    children: [
      { fullName: lead.studentName, className: "STD 3", enrollmentYear: nextYear, dayOrBoarding: "Day", ...(gender ? { gender } : {}) },
    ],
  })
  if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
  // The child on file, not a new lead.
  expect(sent.data[0].admissionNumber).toBe(lead.admissionNumber)
}

describe("a new child's answer", () => {
  test("the front desk stores it, and a lead without one has none", async () => {
    const boy = await walkIn("Boy")
    const none = await walkIn()
    if (!boy.ok || !none.ok) throw new Error("create failed")
    expect(await genderOf(boy.data.leadId)).toBe("Boy")
    expect(await genderOf(none.data.leadId)).toBeNull()
  })

  test("the Admission form stores each child's answer", async () => {
    const year = nextYear
    const sent = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: parentOf(),
      children: [formChild(year, "Girl"), formChild(year, "Boy"), formChild(year)],
    })
    if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
    const ids = await Promise.all(sent.data.map((o) => leadOf(o.admissionNumber)))
    expect(await Promise.all(ids.map(genderOf))).toEqual(["Girl", "Boy", null])
  })

  test("the Admission form refuses an answer other than Boy or Girl on that student's question", async () => {
    const sent = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: parentOf(),
      children: [{ ...formChild(nextYear), gender: "Other" as StudentGender }],
    })
    expect(sent).toEqual({ ok: false, error: { kind: "invalid", field: "gender", child: 0 } })
  })

  test("a form sent before the question has the same retry key as before", async () => {
    // A retry of a form sent just before the release carries no answer; its
    // key must still match, so it replays instead of being refused.
    const parent = parentOf()
    const child = formChild(nextYear)
    const submissionKey = randomUUID()
    const first = await submitAdmissionForm(secretClient(), { submissionKey, parent, children: [child] })
    const again = await submitAdmissionForm(secretClient(), { submissionKey, parent, children: [child] })
    if (!first.ok || !again.ok) throw new Error("form failed")
    expect(again.data[0].admissionNumber).toBe(first.data[0].admissionNumber)
  })

  test("Register students stores each student's answer and refuses anything but Boy or Girl", async () => {
    const year = await registrationYear()
    const staff = await signedIn(ADMISSIONS)
    const student = (gender?: string) => ({
      firstName: word(),
      ...father(),
      className: "KG 1" as const,
      enrollmentYear: year,
      dayOrBoarding: "Day" as const,
      custodian: { person: 1, relationship: "Mother" as const },
      ...(gender ? { gender: gender as StudentGender } : {}),
    })
    const people = [{ firstName: "Register", middleName: "Gender", lastName: word(), phone: phone() }]

    const saved = await registerStudents(staff, { visitDate: yesterday, people, students: [student("Boy"), student()] })
    if (!saved.ok || saved.data.kind !== "created") throw new Error(`not created: ${JSON.stringify(saved)}`)
    const ids = saved.data.students.map((s) => s.leadId)
    expect(await Promise.all(ids.map(genderOf))).toEqual(["Boy", null])

    const refused = await registerStudents(staff, {
      visitDate: yesterday,
      people: [{ ...people[0], lastName: word(), phone: phone() }],
      students: [student("Girl"), student("Other")],
    })
    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid", field: "gender", student: 2 } })
  })
})

describe("check-in of an Admission form child", () => {
  test("keeps the family's answer unless staff give one, and stores staff's when the family gave none", async () => {
    const year = await registrationYear()
    // Brothers and sisters: one father, so check-in asks no sibling question.
    const dad = father()
    const kept = formChild(year, "Girl", dad)
    const changed = formChild(year, "Girl", dad)
    const filled = formChild(year, undefined, dad)
    const sent = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: parentOf(),
      children: [kept, changed, filled],
    })
    if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
    const ids = await Promise.all(sent.data.map((o) => leadOf(o.admissionNumber)))
    const contactId = (
      await inRolledBackTransaction((sql) =>
        sql.query<{ guardian_contact_id: string }>("select guardian_contact_id from public.leads where id = $1", [ids[0]]),
      )
    ).rows[0].guardian_contact_id
    const checkIn = (i: number, c: typeof kept, gender?: StudentGender) => ({
      leadId: ids[i],
      firstName: c.first,
      ...c.father,
      custodian: { person: 1, relationship: "Mother" as const },
      ...(i > 0 ? { siblingOf: { student: 1 } } : {}),
      ...(gender ? { gender } : {}),
    })

    const done = await completeAdmissionVisit(await signedIn(ADMISSIONS), {
      visitDate: yesterday,
      people: [{ contactId }],
      students: [checkIn(0, kept), checkIn(1, changed, "Boy"), checkIn(2, filled, "Girl")],
    })
    if (!done.ok || done.data.kind !== "completed") throw new Error(`not completed: ${JSON.stringify(done)}`)
    expect(await Promise.all(ids.map(genderOf))).toEqual(["Girl", "Boy", "Girl"])
  })
})

describe("correcting the answer", () => {
  test("staff give or change it, and can't clear it or set anything else", async () => {
    const created = await walkIn()
    if (!created.ok) throw new Error("create failed")
    const id = created.data.leadId
    const staff = await signedIn(ADMISSIONS)

    expect(await updateLeadDetails(staff, id, { gender: "Girl" })).toEqual({ ok: true, data: null })
    expect(await genderOf(id)).toBe("Girl")
    expect(await updateLeadDetails(staff, id, { gender: "Boy" })).toEqual({ ok: true, data: null })
    expect(await genderOf(id)).toBe("Boy")

    for (const bad of [null, "Other"]) {
      const { error } = await staff.rpc("update_lead_details", { lead_id: id, changes: { gender: bad } })
      expect(error?.message).toBe("invalid")
      expect(JSON.parse(error?.details ?? "{}")).toEqual({ field: "gender" })
    }
    expect(await genderOf(id)).toBe("Boy")
  })

  test("a correction leaves the other details alone", async () => {
    const created = await walkIn("Girl")
    if (!created.ok) throw new Error("create failed")
    const before = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select to_jsonb(l) - 'gender' - 'updated_at' as row from public.leads l where id = $1", [created.data.leadId])).rows[0].row,
    )
    expect(await updateLeadDetails(await signedIn(ADMISSIONS), created.data.leadId, { gender: "Boy" })).toEqual({ ok: true, data: null })
    const after = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select to_jsonb(l) - 'gender' - 'updated_at' as row from public.leads l where id = $1", [created.data.leadId])).rows[0].row,
    )
    expect(after).toEqual(before)
  })
})

describe("a Re-application", () => {
  test("fills a missing answer", async () => {
    const lead = await onFile(null)
    await sendAgain(lead, "Girl")
    expect(await genderOf(lead.id)).toBe("Girl")
  })

  test("never overwrites an answer already there", async () => {
    const lead = await onFile("Boy")
    await sendAgain(lead, "Girl")
    expect(await genderOf(lead.id)).toBe("Boy")
  })

  test("fills a missing answer on a Declined child, and changes nothing else on it", async () => {
    const lead = await onFile(null, "Declined")
    const before = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select status, closure, declined_reason from public.leads where id = $1", [lead.id])).rows[0],
    )
    await sendAgain(lead, "Boy")
    expect(await genderOf(lead.id)).toBe("Boy")
    const after = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select status, closure, declined_reason from public.leads where id = $1", [lead.id])).rows[0],
    )
    expect(after).toEqual(before)
  })

  test("fills it on a child already marked re-applied, as the public form, with the change in the history", async () => {
    const lead = await onFile(null)
    await sendAgain(lead)
    const flagged = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select returning_family_reapplied as r from public.leads where id = $1", [lead.id])).rows[0].r,
    )
    expect(flagged).toBe(true)
    expect(await genderOf(lead.id)).toBeNull()

    await sendAgain(lead, "Girl")
    expect(await genderOf(lead.id)).toBe("Girl")
    const audit = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ actor_kind: string; actor_staff_id: string | null; old_gender: string | null; new_gender: string }>(
          `select a.actor_kind, a.actor_staff_id, a.old_values ->> 'gender' as old_gender, a.new_values ->> 'gender' as new_gender
           from public.audit_log a
           where a.table_name = 'leads' and a.row_id = $1 and a.new_values ->> 'gender' is not null
           order by a.created_at desc, a.id desc limit 1`,
          [lead.id],
        )
      ).rows,
    )
    expect(audit).toEqual([{ actor_kind: "public_form", actor_staff_id: null, old_gender: null, new_gender: "Girl" }])
  })

  test.each(["Inactive", "Archived"] as const)("fills a missing answer on an %s child, and keeps its mark", async (closure) => {
    const lead = await onFile(null, "Visited", closure)
    await sendAgain(lead, "Boy")
    const row = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select gender, closure, status from public.leads where id = $1", [lead.id])).rows[0],
    )
    expect(row).toEqual({ gender: "Boy", closure, status: "Visited" })
  })

  test("the closed-lead guard still refuses changing an answer on a Declined child", async () => {
    const lead = await onFile("Boy", "Declined")
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_lead_lifecycle_override('re_application')")
        await sql.query(
          "update public.leads set gender = 'Girl', returning_family_reapplied = true where id = $1",
          [lead.id],
        )
      }),
    ).rejects.toThrow("lead_closed")
  })
})

describe("the Boy / Girl check", () => {
  test("is granted to no API role", async () => {
    for (const client of [anonClient(), secretClient(), await signedIn(ADMISSIONS)]) {
      const { error } = await client.rpc("student_gender_of", { answer: "Boy", student: null })
      expect(error).not.toBeNull()
    }
  })
})
