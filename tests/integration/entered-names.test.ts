import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears, type AdmissionChild, type AdmissionForm, type AdmissionParent } from "@/lib/admission-form"
import { fatherFullName, personFullName, studentFullName, type PersonNameParts, type StudentNameParts } from "@/lib/names"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createLead, registerStudents, updateLeadDetails, type RegistrationStudent } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import { inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// Names as prototype v38 enters them (#400): the student's own name plus the
// father's three names, and a person's three names, all required and stored
// in capitals, through the Admission form, the staff register RPC and
// today's walk-in start. Every name and number is made up for the test.

const DAY = 24 * 60 * 60 * 1000
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const [, nextYear] = admissionYears()

// A leading 064 keeps it clear of the seeded numbers and the other suites.
const phone = () => `064${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
// A word of letters only, in lower case, so capitals show the database
// stored it as the rule says.
const word = () => Array.from({ length: 7 }, () => String.fromCharCode(97 + randomInt(0, 26))).join("")

const studentParts = (): StudentNameParts => ({ firstName: word(), fatherFirst: word(), fatherMiddle: word(), fatherLast: word() })
const personParts = (): PersonNameParts => ({ firstName: word(), middleName: word(), lastName: word() })

type NameRow = {
  student_name: string
  father_full_name: string | null
  father_full_name_source: string | null
  contact_name: string
}

async function namesOf(admissionNumber: string): Promise<NameRow> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<NameRow>(
          `select l.student_name, l.father_full_name, l.father_full_name_source::text, g.full_name as contact_name
           from public.leads l join public.guardian_contacts g on g.id = l.guardian_contact_id
           where l.admission_number = $1`,
          [admissionNumber],
        )
      ).rows[0],
  )
}

function partsParent(parts: PersonNameParts = personParts()): AdmissionParent {
  return { fullName: personFullName(parts), nameParts: parts, relationship: "Mother", phone: phone() }
}

function partsChild(parts: StudentNameParts = studentParts()): AdmissionChild {
  return { fullName: studentFullName(parts), nameParts: parts, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Day" }
}

function form(parent: AdmissionParent, children: AdmissionChild[]): AdmissionForm {
  return { submissionKey: randomUUID(), parent, children }
}

describe("the Admission form in parts", () => {
  test("the student's name leaves out the father's middle name, the father's keeps all three, and every name is in capitals", async () => {
    const parent = personParts()
    const kid = { ...studentParts(), firstName: `  ${word()}   ` }
    const sent = await submitAdmissionForm(secretClient(), form(partsParent(parent), [partsChild(kid)]))
    if (!sent.ok) throw new Error(JSON.stringify(sent.error))

    const expected = [kid.firstName.trim(), kid.fatherFirst, kid.fatherLast].join(" ").toUpperCase()
    expect(sent.data).toEqual([{ fullName: expected, admissionNumber: expect.any(String) }])
    expect(await namesOf(sent.data[0].admissionNumber)).toEqual({
      student_name: expected,
      father_full_name: [kid.fatherFirst, kid.fatherMiddle, kid.fatherLast].join(" ").toUpperCase(),
      father_full_name_source: "entered",
      contact_name: [parent.firstName, parent.middleName, parent.lastName].join(" ").toUpperCase(),
    })
    expect(fatherFullName(kid)).toBe((await namesOf(sent.data[0].admissionNumber)).father_full_name)
  })

  test("each missing part is refused with its box named, and nothing is created", async () => {
    for (const key of ["firstName", "fatherFirst", "fatherMiddle", "fatherLast"] as const) {
      const kid = { ...studentParts(), [key]: "   " }
      const part = { firstName: "first_name", fatherFirst: "father_first", fatherMiddle: "father_middle", fatherLast: "father_last" }[key]
      const parent = partsParent()
      expect(await submitAdmissionForm(secretClient(), form(parent, [partsChild(), partsChild(kid)]))).toEqual({
        ok: false,
        error: { kind: "invalid", field: "student_name", child: 1, part },
      })
    }
    for (const key of ["firstName", "middleName", "lastName"] as const) {
      const parent = partsParent({ ...personParts(), [key]: "" })
      const part = { firstName: "contact_first_name", middleName: "contact_middle_name", lastName: "contact_last_name" }[key]
      expect(await submitAdmissionForm(secretClient(), form(parent, [partsChild()]))).toEqual({
        ok: false,
        error: { kind: "invalid", field: "contact_name", child: null, part },
      })
    }
  })

  test("the live form's one box still works, stored as typed with the father's name derived", async () => {
    const name = `${word()} ${word()} ${word()}`
    const sent = await submitAdmissionForm(
      secretClient(),
      form({ fullName: "One Box Parent", relationship: "Mother", phone: phone() }, [
        { fullName: name, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Day" },
      ]),
    )
    if (!sent.ok) throw new Error(JSON.stringify(sent.error))
    expect(await namesOf(sent.data[0].admissionNumber)).toEqual({
      student_name: name,
      father_full_name: name.split(" ").slice(1).join(" "),
      father_full_name_source: "derived",
      contact_name: "One Box Parent",
    })
  })

  test("a child on file sent again in parts is a Re-application holding the built names", async () => {
    const parent = partsParent()
    const kid = studentParts()
    const first = await submitAdmissionForm(secretClient(), form(parent, [partsChild(kid)]))
    if (!first.ok) throw new Error(JSON.stringify(first.error))
    const again = await submitAdmissionForm(secretClient(), form(parent, [partsChild(kid)]))
    if (!again.ok) throw new Error(JSON.stringify(again.error))
    expect(again.data[0].admissionNumber).toBe(first.data[0].admissionNumber)
    const recorded = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ student_name: string; contact_name: string; differing_fields: string[] }>(
            `select r.student_name, r.contact_name, r.differing_fields
             from public.re_applications r join public.leads l on l.id = r.lead_id
             where l.admission_number = $1`,
            [first.data[0].admissionNumber],
          )
        ).rows,
    )
    expect(recorded).toEqual([{ student_name: studentFullName(kid), contact_name: parent.fullName, differing_fields: [] }])
  })
})

describe("the father's name typed in its boxes", () => {
  test("a later correction of the student's name keeps the father's three names", async () => {
    const kid = studentParts()
    const sent = await submitAdmissionForm(secretClient(), form(partsParent(), [partsChild(kid)]))
    if (!sent.ok) throw new Error(JSON.stringify(sent.error))
    const leadId = await inRolledBackTransaction(
      async (sql) =>
        (await sql.query<{ id: string }>("select id from public.leads where admission_number = $1", [sent.data[0].admissionNumber])).rows[0].id,
    )
    const renamed = `${word()} ${kid.fatherFirst} ${kid.fatherLast}`.toUpperCase()
    expect(await updateLeadDetails(await signedIn(ADMISSIONS), leadId, { fullName: renamed })).toEqual({ ok: true, data: null })
    expect(await namesOf(sent.data[0].admissionNumber)).toMatchObject({
      student_name: renamed,
      father_full_name: fatherFullName(kid),
      father_full_name_source: "entered",
    })
  })
})

describe("the staff register RPC", () => {
  const year = nextYear

  function student(over: Partial<RegistrationStudent> = {}): RegistrationStudent {
    return {
      ...studentParts(),
      className: "KG 1",
      enrollmentYear: year,
      dayOrBoarding: "Day",
      custodian: { person: 1, relationship: "Mother" },
      ...over,
    }
  }

  async function register(people: Parameters<typeof registerStudents>[1]["people"], students: RegistrationStudent[]) {
    // The seeds give next year a fee schedule; the RPC allows this year and the next two.
    return registerStudents(await signedIn(ADMISSIONS), { visitDate: yesterday, people, students })
  }

  test("a person's three names in capitals, and a one-box name refused", async () => {
    const parts = personParts()
    const number = phone()
    const saved = await register([{ ...parts, phone: number }], [student()])
    if (!saved.ok || saved.data.kind !== "created") throw new Error(JSON.stringify(saved))
    expect((await namesOf(saved.data.students[0].admissionNumber)).contact_name).toBe(personFullName(parts))

    const refused = await registerStudents(await signedIn(ADMISSIONS), {
      visitDate: yesterday,
      people: [{ phone: phone() }],
      students: [student()],
    })
    expect(refused).toMatchObject({ ok: false, error: { kind: "invalid", field: "contact_name", person: 1 } })
  })

  test("each missing part of a person is refused with the person's number", async () => {
    for (const [key, field] of [
      ["firstName", "contact_first_name"],
      ["middleName", "contact_middle_name"],
      ["lastName", "contact_last_name"],
    ] as const) {
      expect(await register([{ ...personParts(), [key]: " ", phone: phone() }], [student()])).toMatchObject({
        ok: false,
        error: { kind: "invalid", field, person: 1 },
      })
    }
  })

  test("each missing part of a student is refused with the student's number", async () => {
    for (const [key, field] of [
      ["firstName", "first_name"],
      ["fatherFirst", "father_first"],
      ["fatherMiddle", "father_middle"],
      ["fatherLast", "father_last"],
    ] as const) {
      expect(await register([{ ...personParts(), phone: phone() }], [student(), student({ [key]: "" })])).toMatchObject({
        ok: false,
        error: { kind: "invalid", field, student: 2 },
      })
    }
  })

  test("who brought them: at least two names, stored in capitals", async () => {
    expect(
      await register([{ ...personParts(), phone: phone() }], [student({ broughtBy: { name: "  Juma  " } })]),
    ).toMatchObject({ ok: false, error: { kind: "invalid", field: "brought_by_name", student: 1, reason: "one_name" } })

    const saved = await register([{ ...personParts(), phone: phone() }], [student({ broughtBy: { name: "juma  hassan" } })])
    if (!saved.ok || saved.data.kind !== "created") throw new Error(JSON.stringify(saved))
    const leadId = saved.data.students[0].leadId
    const brought = await inRolledBackTransaction(
      async (sql) =>
        (await sql.query<{ brought_by_name: string }>("select brought_by_name from public.leads where id = $1", [leadId])).rows[0]
          .brought_by_name,
    )
    expect(brought).toBe("JUMA HASSAN")
  })

  test("an on-file father's name without its middle name is close: staff get the name question, not a Sibling request", async () => {
    // An older or imported lead: the father's name is the student's name
    // after its first word, two parts with no middle name.
    const father = studentParts()
    const onFile = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: "On File Parent", relationship: "Mother", phone: phone() } },
      student: { fullName: `${word()} ${father.fatherFirst} ${father.fatherLast}`, className: "STD 2", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!onFile.ok) throw new Error(JSON.stringify(onFile.error))

    const asked = await register(
      [{ ...personParts(), phone: phone() }],
      [student({ ...father, firstName: word(), siblingOf: { leadId: onFile.data.leadId } })],
    )
    expect(asked).toMatchObject({
      ok: true,
      data: {
        kind: "questions",
        questions: [
          {
            kind: "name",
            student: 1,
            fatherFullName: fatherFullName(father),
            siblingFatherFullName: `${father.fatherFirst} ${father.fatherLast}`,
            siblingLeadId: onFile.data.leadId,
          },
        ],
      },
    })
  })
})
