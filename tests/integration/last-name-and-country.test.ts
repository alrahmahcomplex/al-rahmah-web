import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears } from "@/lib/admission-form"
import { fatherFullName, studentFullName, type StudentNameParts } from "@/lib/names"
import { COUNTRY_NAMES } from "@/lib/places"
import { tanzaniaToday } from "@/lib/school-calendar"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { getAdmissionFormFamily } from "@/lib/services/admission-form-family"
import { correctPreviousSchool, getLeadFatherAndSchool } from "@/lib/services/lead-details"
import { completeAdmissionVisit, registerStudents, updateLeadDetails, type RegistrationStudent } from "@/lib/services/leads"

import { asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// The student's last-name choice and the previous school's country (#511),
// through the services and the database against local Supabase. Every name
// and number is made up.

const DAY = 24 * 60 * 60 * 1000
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const [, nextYear] = admissionYears()

// A leading 063 keeps it clear of the seeded numbers and the other suites.
const phone = () => `063${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
const word = () => Array.from({ length: 7 }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
const parts = (): StudentNameParts => ({ firstName: word(), fatherFirst: word(), fatherMiddle: word(), fatherLast: word() })

type Row = {
  id: string
  student_name: string
  father_full_name: string | null
  last_name_from: string | null
  previous_school_region: string | null
  previous_school_country: string | null
}

// By Admission Number or by lead id.
async function rowOf(key: string): Promise<Row> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<Row>(
          `select id, student_name, father_full_name, last_name_from::text, previous_school_region, previous_school_country
           from public.leads where admission_number = $1 or id::text = $1`,
          [key],
        )
      ).rows[0],
  )
}

function student(over: Partial<RegistrationStudent> = {}): RegistrationStudent {
  return {
    ...parts(),
    gender: "Girl",
    className: "STD 5",
    enrollmentYear: nextYear,
    dayOrBoarding: "Day",
    custodian: { person: 1, relationship: "Mother" },
    previousSchool: { name: "EXAMPLE PRIMARY SCHOOL", type: "public", region: "Dar es Salaam" },
    ...over,
  }
}

async function register(students: RegistrationStudent[]) {
  return registerStudents(await signedIn(ADMISSIONS), {
    visitDate: yesterday,
    people: [{ firstName: word(), middleName: word(), lastName: word(), phone: phone() }],
    students,
  })
}

async function registered(s: RegistrationStudent): Promise<Row> {
  const saved = await register([s])
  if (!saved.ok || saved.data.kind !== "created") throw new Error(JSON.stringify(saved))
  return rowOf(saved.data.students[0].admissionNumber)
}

describe("the country list", () => {
  test("the database's list is the app's, A to Z, without Tanzania", async () => {
    const [{ countries }] = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ countries: string[] }>("select public.previous_school_countries() as countries")).rows,
    )
    expect(countries).toEqual([...COUNTRY_NAMES])
    expect(countries.some((c) => /tanzania/i.test(c))).toBe(false)
  })

  test("no API role may call the new helpers", async () => {
    const helpers = [
      "public.previous_school_countries()",
      "public.previous_school_country(text)",
      "public.registration_last_name_from(jsonb, integer)",
      "public.registration_previous_school_country(jsonb, text, integer)",
    ]
    const rows = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ role: string; fn: string; allowed: boolean }>(
            `select r as role, f as fn, has_function_privilege(r, f, 'execute') as allowed
             from unnest(array['anon', 'authenticated', 'service_role']) r, unnest($1::text[]) f`,
            [helpers],
          )
        ).rows,
    )
    expect(rows).toHaveLength(12)
    expect(rows.filter((r) => r.allowed)).toEqual([])
  })
})

describe("Register students", () => {
  test("the father's middle name as the last name builds the student's name with it, and keeps the choice", async () => {
    const s = student({ lastNameFrom: "father_middle" })
    const row = await registered(s)
    expect(row).toMatchObject({
      student_name: studentFullName(s, "father_middle"),
      father_full_name: fatherFullName(s),
      last_name_from: "father_middle",
    })
    expect(row.student_name).toBe(`${s.firstName} ${s.fatherFirst} ${s.fatherMiddle}`)
  })

  test("left out, the last name is the father's last name, as before", async () => {
    const s = student()
    expect(await registered(s)).toMatchObject({ student_name: studentFullName(s), last_name_from: "father_last" })
  })

  test("any other choice is refused, naming the student", async () => {
    const bad = { ...student(), lastNameFrom: "mother" } as unknown as RegistrationStudent
    expect(await register([student(), bad])).toMatchObject({ ok: false, error: { kind: "invalid", field: "last_name_from", student: 2 } })
  })

  test("a school Outside Tanzania takes its country from the list, stored in the list's spelling", async () => {
    const outside = { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania" } as const
    // Left out, for now: today's screens send none, and staff must still be able to save.
    expect(await registered(student({ previousSchool: outside }))).toMatchObject({ previous_school_region: "Outside Tanzania", previous_school_country: null })
    expect(await register([student({ previousSchool: { ...outside, country: "Atlantis" } })])).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "previous_school_country", student: 1 },
    })
    expect(await registered(student({ previousSchool: { ...outside, country: "  kenya " } }))).toMatchObject({
      previous_school_region: "Outside Tanzania",
      previous_school_country: "Kenya",
    })
  })

  test("a country with a Tanzanian region is refused, and none is stored without one", async () => {
    expect(
      await register([student({ previousSchool: { name: "EXAMPLE PRIMARY SCHOOL", type: "public", region: "Pwani", country: "Kenya" } })]),
    ).toMatchObject({ ok: false, error: { kind: "invalid", field: "previous_school_country", student: 1 } })
    expect(await registered(student())).toMatchObject({ previous_school_region: "Dar es Salaam", previous_school_country: null })
  })

  test("Not known yet with a country is refused", async () => {
    const { data, error } = await (await signedIn(ADMISSIONS)).rpc("register_students", {
      visited_on: yesterday,
      people: [{ first_name: word(), middle_name: word(), last_name: word(), phone: phone() }],
      students: [
        {
          ...{ first_name: word(), father_first: word(), father_middle: word(), father_last: word() },
          gender: "Boy",
          class_name: "STD 5",
          enrollment_year: nextYear,
          day_or_boarding: "Day",
          custodian: { person: 1, relationship: "Mother" },
          previous_school: { not_known: true, country: "Kenya" },
        },
      ],
    })
    expect(data).toBeNull()
    expect(error?.message).toBe("invalid")
    expect(JSON.parse(error?.details ?? "{}")).toEqual({ student: 1, field: "previous_school" })
  })
})

describe("a walk-in made by create_lead", () => {
  test("a name in parts takes the choice; a one-box name holds none", async () => {
    const client = await signedIn(ADMISSIONS)
    const p = parts()
    const contact = () => ({ full_name: `${word()} ${word()} ${word()}`, relationship: "Mother", phone: phone() })
    const base = { start_kind: "walk_in", existing_contact_id: null, visited_on: yesterday }
    const details = { class_name: "KG 1", enrollment_year: nextYear, day_or_boarding: "Day" }

    const inParts = await client.rpc("create_lead", {
      ...base,
      new_contact: contact(),
      student_details: { ...details, first_name: p.firstName, father_first: p.fatherFirst, father_middle: p.fatherMiddle, father_last: p.fatherLast, last_name_from: "father_middle" },
    })
    expect(inParts.error).toBeNull()
    expect(await rowOf(inParts.data.admission_number)).toMatchObject({ student_name: studentFullName(p, "father_middle"), last_name_from: "father_middle" })

    const oneBox = await client.rpc("create_lead", { ...base, new_contact: contact(), student_details: { ...details, full_name: `${word()} ${word()} ${word()}` } })
    expect(oneBox.error).toBeNull()
    expect((await rowOf(oneBox.data.admission_number)).last_name_from).toBeNull()
  })
})

describe("check-in of an Admission form family", () => {
  test("the names staff confirm carry the choice, a school abroad its country, and the family read returns both", async () => {
    const kid = parts()
    const sent = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: { fullName: "", nameParts: { firstName: word(), middleName: word(), lastName: word() }, relationship: "Mother", phone: phone() },
      children: [{ fullName: studentFullName(kid), nameParts: kid, className: "STD 5", enrollmentYear: nextYear, dayOrBoarding: "Day" }],
    })
    if (!sent.ok) throw new Error(JSON.stringify(sent.error))
    const before = await rowOf(sent.data[0].admissionNumber)
    expect(before).toMatchObject({ student_name: studentFullName(kid), last_name_from: "father_last" })

    const done = await completeAdmissionVisit(await signedIn(ADMISSIONS), {
      visitDate: yesterday,
      people: [{ firstName: word(), middleName: word(), lastName: word(), phone: phone() }],
      students: [
        {
          leadId: before.id,
          ...kid,
          lastNameFrom: "father_middle",
          gender: "Boy",
          custodian: { person: 1, relationship: "Mother" },
          previousSchool: { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Uganda" },
        },
      ],
    })
    if (!done.ok || done.data.kind !== "completed") throw new Error(JSON.stringify(done))
    expect(await rowOf(sent.data[0].admissionNumber)).toMatchObject({
      student_name: studentFullName(kid, "father_middle"),
      last_name_from: "father_middle",
      previous_school_region: "Outside Tanzania",
      previous_school_country: "Uganda",
    })

    const family = await getAdmissionFormFamily(await signedIn(ADMISSIONS), before.id)
    if (!family.ok) throw new Error(JSON.stringify(family.error))
    expect(family.data.children[0]).toMatchObject({
      lastNameFrom: "father_middle",
      previousSchool: { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Uganda" },
    })
  })

  test("a school Outside Tanzania on file with no country still checks in, given again or kept", async () => {
    const kids = [parts(), parts()]
    const sent = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: { fullName: "", nameParts: { firstName: word(), middleName: word(), lastName: word() }, relationship: "Mother", phone: phone() },
      children: kids.map((kid) => ({ fullName: studentFullName(kid), nameParts: kid, className: "STD 5" as const, enrollmentYear: nextYear, dayOrBoarding: "Day" as const })),
    })
    if (!sent.ok) throw new Error(JSON.stringify(sent.error))
    const rows = [await rowOf(sent.data[0].admissionNumber), await rowOf(sent.data[1].admissionNumber)]
    // As a school saved before the country list: Outside Tanzania, no country.
    await asSystem((sql) =>
      sql.query(
        "update public.leads set previous_school_name = 'EXAMPLE SCHOOL ABROAD', previous_school_type = 'private', previous_school_region = 'Outside Tanzania' where id = any($1::uuid[])",
        [rows.map((r) => r.id)],
      ),
    )
    const done = await completeAdmissionVisit(await signedIn(ADMISSIONS), {
      visitDate: yesterday,
      people: [{ firstName: word(), middleName: word(), lastName: word(), phone: phone() }],
      students: [
        {
          leadId: rows[0].id,
          ...kids[0],
          gender: "Girl",
          custodian: { person: 1, relationship: "Mother" },
          previousSchool: { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania" },
        },
        { leadId: rows[1].id, ...kids[1], gender: "Boy", custodian: { person: 1, relationship: "Mother" } },
      ],
    })
    if (!done.ok || done.data.kind !== "completed") throw new Error(JSON.stringify(done))
    for (const r of rows) expect(await rowOf(r.id)).toMatchObject({ previous_school_region: "Outside Tanzania", previous_school_country: null })
  })
})

describe("corrections on the record", () => {
  test("the choice changes with the name it builds, and can be cleared", async () => {
    const s = student()
    const row = await registered(s)
    const client = await signedIn(ADMISSIONS)
    expect(await updateLeadDetails(client, row.id, { fullName: studentFullName(s, "father_middle"), lastNameFrom: "father_middle" })).toEqual({ ok: true, data: null })
    expect(await rowOf(row.id)).toMatchObject({ student_name: studentFullName(s, "father_middle"), last_name_from: "father_middle" })
    const read = await getLeadFatherAndSchool(client, row.id)
    expect(read.ok && read.data.lastNameFrom).toBe("father_middle")
    expect(await updateLeadDetails(client, row.id, { lastNameFrom: null })).toEqual({ ok: true, data: null })
    expect((await rowOf(row.id)).last_name_from).toBeNull()
  })

  test("a country is kept while the region stays Outside Tanzania, cleared with any other, and refused with one", async () => {
    const row = await registered(student({ previousSchool: { name: "EXAMPLE SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Kenya" } }))
    const client = await signedIn(ADMISSIONS)

    // The record's school correction sends no country yet: the one stored stays.
    expect(await correctPreviousSchool(client, row.id, { kind: "school", name: "ANOTHER SCHOOL ABROAD", type: "private", region: "Outside Tanzania" })).toEqual({ ok: true, data: null })
    expect((await rowOf(row.id)).previous_school_country).toBe("Kenya")

    expect(await correctPreviousSchool(client, row.id, { kind: "school", name: "ANOTHER SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "rwanda" })).toEqual({ ok: true, data: null })
    expect((await rowOf(row.id)).previous_school_country).toBe("Rwanda")

    // An empty country sent to the RPC keeps the stored one too.
    for (const empty of [null, "", "  "]) {
      const { error } = await client.rpc("update_lead_details", { lead_id: row.id, changes: { previous_school_country: empty } })
      expect(error).toBeNull()
      expect((await rowOf(row.id)).previous_school_country).toBe("Rwanda")
    }

    expect(await correctPreviousSchool(client, row.id, { kind: "school", name: "ANOTHER SCHOOL ABROAD", type: "private", region: "Outside Tanzania", country: "Atlantis" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "previous_school_country" },
    })
    expect(await correctPreviousSchool(client, row.id, { kind: "school", name: "A SCHOOL HERE", type: "public", region: "Mwanza", country: "Kenya" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "previous_school_country" },
    })

    expect(await correctPreviousSchool(client, row.id, { kind: "school", name: "A SCHOOL HERE", type: "public", region: "Mwanza" })).toEqual({ ok: true, data: null })
    expect(await rowOf(row.id)).toMatchObject({ previous_school_region: "Mwanza", previous_school_country: null })
  })

  test("the table refuses a country beside a Tanzanian region or off the list", async () => {
    const row = await registered(student())
    for (const [region, country] of [
      ["Dar es Salaam", "Kenya"],
      ["Outside Tanzania", "Atlantis"],
      // No school at all: a country alone is refused too.
      [null, "Kenya"],
    ]) {
      await expect(
        inRolledBackTransaction(async (sql) => {
          await sql.query("select public.set_audit_actor('system')")
          await sql.query(
            `update public.leads set previous_school_region = $2, previous_school_country = $3,
               previous_school_name = case when $2::text is null then null else previous_school_name end,
               previous_school_type = case when $2::text is null then null else previous_school_type end
             where id = $1`,
            [row.id, region, country],
          )
        }),
      ).rejects.toThrow(/leads_previous_school_country/)
    }
  })
})
