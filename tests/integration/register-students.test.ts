import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { onFileQuestion, payload, type Answers, type OnFileFee, type OnFileLink } from "@/app/staff/check-in/new/model"
import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import {
  createLead,
  getFathersOfLeads,
  getLeadCreatedAt,
  LEAD_CLASSES,
  registerStudents,
  updateGuardianContact,
  type ContactChanges,
  type LeadClass,
  type RegisterStudentsInput,
  type RegistrationPerson,
  type RegistrationStudent,
} from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { explainSiblingGroup } from "@/lib/services/sibling-counts"
import { editSiblingFee, linkSibling } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { anonClient, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The staff New Student form's one save (#304), through the service and the
// database against local Supabase. Students register in an Enrollment year
// with a fee schedule (the seeded one); siblings on file live in a year each
// test claims. Every name and phone is made up for the test.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))
const SIBLING = { kind: "sibling", percent: 10 }

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

// The first year staff may choose that has a fee schedule (the seeds give
// next year one).
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

async function claimedYear(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

// A leading 068 keeps it clear of the seeded numbers and the other suites.
const phone = () => `068${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
const word = () => `R${randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "b")}`

function person(over: Partial<Extract<RegistrationPerson, { phone: string }>> = {}): RegistrationPerson {
  return { firstName: "Register", middleName: "Parent", lastName: word(), phone: phone(), ...over }
}

// A father's three names no other test uses.
type Father = { fatherFirst: string; fatherMiddle: string; fatherLast: string }

function fatherParts(): Father {
  return { fatherFirst: word(), fatherMiddle: word(), fatherLast: word() }
}

function student(
  father: Father,
  year: number,
  over: Partial<RegistrationStudent> = {},
): RegistrationStudent {
  const className: LeadClass = over.className ?? "KG 1"
  return {
    firstName: word(),
    ...father,
    className,
    enrollmentYear: year,
    dayOrBoarding: "Day",
    custodian: { person: 1, relationship: "Mother" },
    ...(LEAD_CLASSES.indexOf(className) >= LEAD_CLASSES.indexOf("STD 2") ? { previousSchool: { notKnown: true } } : {}),
    ...over,
  }
}

async function register(input: Omit<RegisterStudentsInput, "visitDate">) {
  return registerStudents(await signedIn(ADMISSIONS), { visitDate: yesterday, ...input })
}

async function created(input: Omit<RegisterStudentsInput, "visitDate">) {
  const saved = await register(input)
  if (!saved.ok || saved.data.kind !== "created") throw new Error(`not created: ${JSON.stringify(saved)}`)
  return saved.data.students
}

type LeadRow = {
  student_name: string
  father_full_name: string | null
  father_full_name_source: string | null
  guardian_contact_id: string
  custodian_relationship: string
  custodian_relationship_description: string | null
  custodian_relationship_own: boolean
  brought_by_name: string | null
  brought_by_phone: string | null
  previous_school_name: string | null
  previous_school_region: string | null
  previous_school_not_known: boolean
  status: string
  returning_family_joined: boolean
}

async function rowOf(leadId: string): Promise<LeadRow> {
  return inRolledBackTransaction(async (sql) => (await sql.query<LeadRow>("select * from public.leads where id = $1", [leadId])).rows[0])
}

type Membership = {
  group_id: string | null
  legacy: boolean
  basis: string | null
  sibling_of_lead_id: string | null
  sibling_choice_made: boolean
} | null

async function membershipOf(leadId: string): Promise<Membership> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<NonNullable<Membership>>(
          "select group_id, legacy, basis, sibling_of_lead_id, sibling_choice_made from public.sibling_group_members where lead_id = $1",
          [leadId],
        )
      ).rows[0] ?? null,
  )
}

async function fullPayerOf(groupId: string): Promise<string | null> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select full_payer_lead_id from public.sibling_groups where id = $1", [groupId])).rows[0].full_payer_lead_id,
  )
}

async function leadsOnPhone(number: string): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from public.leads l join public.guardian_contacts g on g.id = l.guardian_contact_id
       where g.phone = public.normalize_phone($1)`,
      [number],
    )
    return rows[0].n
  })
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

async function storedResultOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ result: string; source: string; locked_result: string | null }>(
          `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source, r.locked_result::text as locked_result
           from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
          [leadId],
        )
      ).rows[0],
  )
}

// A child on file through today's one-student form, on a new contact or on
// `contactId`, with the father's name the student's name gives.
async function onFile(fatherName: string, className: LeadClass, contactId?: string): Promise<string> {
  const made = await createLead(await signedIn(ADMISSIONS), {
    guardian: contactId ? { contactId } : { contact: { fullName: `On File ${word()}`, relationship: "Mother", phone: phone() } },
    student: { fullName: `${word()} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!made.ok) throw new Error(`setup failed: ${JSON.stringify(made.error)}`)
  return made.data.leadId
}

async function contactOf(leadId: string): Promise<string> {
  return (await rowOf(leadId)).guardian_contact_id
}

// Passed, in a claimed year.
async function passed(fatherName: string, year: number, className: LeadClass = "STD 2"): Promise<string> {
  const leadId = await onFile(fatherName, className)
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  return leadId
}

async function pay(leadId: string, type: "first_instalment" | "second_instalment" | "third_instalment", amount: number) {
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type, amount, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

// Passed in a claimed year and paid in full: Enrolled at full.
async function enrolled(fatherName: string, year: number): Promise<string> {
  const leadId = await passed(fatherName, year)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: (await feeOf(leadId)).schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return leadId
}

// The father's full name as stored: all three of his names, in capitals.
const nameOf = (f: Father) => [f.fatherFirst, f.fatherMiddle, f.fatherLast].join(" ").toUpperCase()
// The student's full name as stored: the student's name and the father's
// first and last names, in capitals.
const studentNameOf = (s: { firstName: string } & Father) => [s.firstName, s.fatherFirst, s.fatherLast].join(" ").toUpperCase()

describe("one save for the whole form", () => {
  test("three children, two with the same father and a friend's: one group of two where the dearer pays full, and the friend's child alone", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const friend = fatherParts()
    // The friend's child is student 1 (failure case 4).
    const [friendsChild, dear, cheap] = await created({
      people: [person(), person()],
      students: [
        student(friend, year, { custodian: { person: 2, relationship: "Other", relationshipDescription: "Family friend" } }),
        student(family, year, { className: "FORM 1" }),
        student(family, year, { className: "KG 1", siblingOf: { student: 2 } }),
      ],
    })

    expect(cheap.sibling).toMatchObject({ basis: "matched", requestId: null })
    const group = cheap.sibling!.groupId
    expect(await membershipOf(dear.leadId)).toMatchObject({ group_id: group, basis: "matched", sibling_choice_made: true })
    expect(await fullPayerOf(group)).toBe(dear.leadId)
    expect(await feeOf(dear.leadId)).toMatchObject({ discount: null })
    expect(await feeOf(cheap.leadId)).toMatchObject({ discount: SIBLING })

    expect(friendsChild.sibling).toBeNull()
    expect(await membershipOf(friendsChild.leadId)).toMatchObject({ group_id: null, sibling_choice_made: true })
    expect(await feeOf(friendsChild.leadId)).toMatchObject({ discount: null })
    const friendsRow = await rowOf(friendsChild.leadId)
    expect(friendsRow.guardian_contact_id).not.toBe((await rowOf(dear.leadId)).guardian_contact_id)
    expect(friendsRow).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Family friend" })

    // The student's name leaves out the father's middle name; the father's
    // keeps all three, typed in their boxes (#400).
    const dearRow = await rowOf(dear.leadId)
    expect(dearRow.father_full_name).toBe(nameOf(family))
    expect(dearRow.father_full_name_source).toBe("entered")
    expect(dearRow.student_name).toMatch(new RegExp(`^[A-Z]+ ${family.fatherFirst.toUpperCase()} ${family.fatherLast.toUpperCase()}$`))
    expect(dearRow).toMatchObject({ status: "Visited", returning_family_joined: false, previous_school_not_known: true })
  })

  test("a duplicate on student 3 saves nothing, and the error names student 3", async () => {
    const year = await registrationYear()
    const parent = person()
    const third = student(fatherParts(), year)
    const onFileAlready = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: "Already Here", relationship: "Mother", phone: (parent as { phone: string }).phone } },
      student: { fullName: studentNameOf(third).toLowerCase(), className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!onFileAlready.ok) throw new Error("setup failed")

    const saved = await register({
      people: [parent],
      students: [student(fatherParts(), year), student(fatherParts(), year), third],
    })
    expect(saved).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        duplicates: [
          { student: 3, id: onFileAlready.data.leadId, admissionNumber: onFileAlready.data.admissionNumber, status: "Visited", closure: null },
        ],
      },
    })
    expect(await leadsOnPhone((parent as { phone: string }).phone)).toBe(1)
  })

  test("the same child twice on one form, once under a known person and once under a new person with that phone, is refused", async () => {
    const year = await registrationYear()
    const known = await onFile(`${word()} ${word()}`, "KG 1")
    const contactId = await contactOf(known)
    const knownPhone = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ phone: string }>("select phone from public.guardian_contacts where id = $1", [contactId])).rows[0].phone,
    )
    const twice = student(fatherParts(), year)
    expect(
      await register({
        people: [{ contactId }, { firstName: "Same", middleName: "Phone", lastName: "Person", phone: knownPhone }],
        students: [twice, { ...twice, custodian: { person: 2, relationship: "Mother" }, notASibling: true }],
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalid", field: "student_name", student: 2, reason: "repeated_on_form" } })
  })

  test("a 9th student is refused, and so is an empty form", async () => {
    const year = await registrationYear()
    const nine = Array.from({ length: 9 }, () => student(fatherParts(), year))
    expect(await register({ people: [person()], students: nine })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "students", reason: "too_many", student: undefined, person: undefined },
    })
    expect(await register({ people: [person()], students: [] })).toMatchObject({ ok: false, error: { kind: "invalid", field: "students" } })

    const eight = await created({ people: [person()], students: Array.from({ length: 8 }, () => student(fatherParts(), year)) })
    expect(eight).toHaveLength(8)
  })

  test("one person is stored once, Mother to one child and Aunt to another, and a correction reaches only the children sharing one", async () => {
    const year = await registrationYear()
    const parent = person({ whatsapp: phone() })
    const [own, niece] = await created({
      people: [parent],
      students: [
        student(fatherParts(), year),
        student(fatherParts(), year, { custodian: { person: 1, relationship: "Other", relationshipDescription: "Aunt" } }),
      ],
    })
    const ownRow = await rowOf(own.leadId)
    const nieceRow = await rowOf(niece.leadId)
    expect(nieceRow.guardian_contact_id).toBe(ownRow.guardian_contact_id)
    expect(ownRow).toMatchObject({ custodian_relationship: "Mother", custodian_relationship_description: null })
    expect(nieceRow).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Aunt" })
    const contacts = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ n: number }>("select count(*)::int as n from public.guardian_contacts where phone = public.normalize_phone($1)", [
          (parent as { phone: string }).phone,
        ])
      ).rows[0],
    )
    expect(contacts).toEqual({ n: 1 })
    expect(await rowOf(own.leadId)).toMatchObject({ custodian_relationship_own: false })
    expect(await rowOf(niece.leadId)).toMatchObject({ custodian_relationship_own: true })

    // A correction from the first child's page (#312) reaches the children
    // holding its relationship: the niece stays.
    const staff = await signedIn(ADMISSIONS)
    const fromOwn = (changes: ContactChanges) =>
      updateGuardianContact(staff, ownRow.guardian_contact_id, changes, undefined, undefined, own.leadId)
    expect(await fromOwn({ relationship: "Guardian" })).toEqual({ ok: true, data: null })
    expect((await rowOf(own.leadId)).custodian_relationship).toBe("Guardian")
    expect(await rowOf(niece.leadId)).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Aunt" })

    // From the niece's page, only the niece changes.
    expect(
      await updateGuardianContact(staff, ownRow.guardian_contact_id, { relationship: "Mother" }, undefined, undefined, niece.leadId),
    ).toEqual({ ok: true, data: null })
    expect(await rowOf(niece.leadId)).toMatchObject({ custodian_relationship: "Mother", custodian_relationship_description: null })
    expect((await rowOf(own.leadId)).custodian_relationship).toBe("Guardian")

    // Once the two hold the same relationship, a correction reaches both.
    expect(await fromOwn({ relationship: "Mother" })).toEqual({ ok: true, data: null })
    expect(await fromOwn({ relationship: "Other", relationshipDescription: "Aunt" })).toEqual({ ok: true, data: null })
    for (const id of [own.leadId, niece.leadId]) {
      expect(await rowOf(id)).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Aunt" })
    }
  })

  test("the father as custodian: the person takes the father's full name, and the relationship is Father", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const number = phone()
    const [first, second] = await created({
      people: [{ phone: number }],
      students: [
        student(family, year, { custodian: { person: 1, father: true } }),
        student(family, year, { custodian: { person: 1, father: true }, siblingOf: { student: 1 } }),
      ],
    })
    const contact = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ full_name: string }>(
          "select full_name from public.guardian_contacts where phone = public.normalize_phone($1)",
          [number],
        )
      ).rows[0],
    )
    expect(contact).toEqual({ full_name: nameOf(family) })
    expect((await rowOf(first.leadId)).custodian_relationship).toBe("Father")
    expect(second.sibling).toMatchObject({ basis: "matched" })
  })

  test("who brought them and the previous school are saved per student", async () => {
    const year = await registrationYear()
    const broughtPhone = phone()
    const [small, older] = await created({
      people: [person()],
      students: [
        student(fatherParts(), year, { className: "KG 2", broughtBy: { name: "Asha Uncle", phone: broughtPhone, relationship: "Uncle" } }),
        student(fatherParts(), year, {
          className: "STD 4",
          previousSchool: { name: "Mwenge Primary", type: "public", region: "dar es salaam" },
        }),
      ],
    })
    expect(await rowOf(small.leadId)).toMatchObject({
      brought_by_name: "ASHA UNCLE",
      previous_school_name: null,
      previous_school_not_known: false,
    })
    expect((await rowOf(small.leadId)).brought_by_phone).toMatch(/^\+255/)
    expect(await rowOf(older.leadId)).toMatchObject({ previous_school_name: "Mwenge Primary", previous_school_region: "Dar es Salaam" })
  })
})

describe("refusals name the student or person", () => {
  test("a missing field, an unused person, an answer from STD 2 up, and an on-file sibling that is gone or closed", async () => {
    const year = await registrationYear()
    const without = student(fatherParts(), year, { fatherMiddle: " " })
    expect(await register({ people: [person()], students: [student(fatherParts(), year), without] })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "father_middle", student: 2 },
    })
    expect(
      await register({ people: [person(), person()], students: [student(fatherParts(), year), student(fatherParts(), year)] }),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "person", person: 2, reason: "unused" },
    })
    const noSchool = student(fatherParts(), year, { className: "STD 3" })
    delete noSchool.previousSchool
    expect(await register({ people: [person()], students: [student(fatherParts(), year), noSchool] })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "previous_school", student: 2 },
    })
    expect(
      await register({ people: [person()], students: [student(fatherParts(), year), student(fatherParts(), year, { siblingOf: { leadId: randomUUID() } })] }),
    ).toMatchObject({ ok: false, error: { kind: "invalid", field: "sibling_of", student: 2, reason: "not_found" } })

    const family = fatherParts()
    const declined = await onFile(nameOf(family), "KG 1")
    expect((await declineLead(await signedIn(MANAGER), declined, { reason: "Other", explanation: "For the test." })).ok).toBe(true)
    const number = phone()
    expect(
      await register({
        people: [{ firstName: "Some", middleName: "One", lastName: "Else", phone: number }],
        students: [student(fatherParts(), year), student(family, year, { siblingOf: { leadId: declined } })],
      }),
    ).toEqual({ ok: false, error: { kind: "lead-closed", student: 2 } })
    expect(await leadsOnPhone(number)).toBe(0)
  })

  test("staff without the permissions save nothing", async () => {
    const year = await registrationYear()
    const input = { visitDate: yesterday, people: [person()], students: [student(fatherParts(), year)] }
    expect(await registerStudents(anonClient(), input)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await registerStudents(await signedIn(ACCOUNTANT), input)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await leadsOnPhone((input.people[0] as { phone: string }).phone)).toBe(0)
  })
})

describe("questions before saving", () => {
  test("close fathers' names: one question and nothing saved; the typing-mistake answer writes the right spelling", async () => {
    const year = await registrationYear()
    const surname = word()
    const S = surname.toUpperCase()
    const right = { fatherFirst: "Mohamed", fatherMiddle: "Ali", fatherLast: surname }
    const typo = { fatherFirst: "Mohammed", fatherMiddle: "Ali", fatherLast: surname }
    const parent = person()
    // The first is dearer, so the second gets the 10% once they are siblings.
    const first = student(right, year, { className: "FORM 1" })
    const second = student(typo, year, { siblingOf: { student: 1 } })

    const asked = await register({ people: [parent], students: [first, second] })
    expect(asked).toMatchObject({
      ok: true,
      data: {
        kind: "questions",
        questions: [
          { kind: "name", student: 2, fatherFullName: `MOHAMMED ALI ${S}`, siblingFatherFullName: `MOHAMED ALI ${S}`, siblingStudent: 1 },
        ],
      },
    })
    expect(await leadsOnPhone((parent as { phone: string }).phone)).toBe(0)

    const [one, two] = await created({
      people: [parent],
      students: [first, { ...second, nameAnswer: { answer: "typo", spelling: `MOHAMED ALI ${S}` } }],
    })
    expect(two.sibling).toMatchObject({ basis: "typo_confirmed" })
    expect(await rowOf(two.leadId)).toMatchObject({ father_full_name: `MOHAMED ALI ${S}`, father_full_name_source: "typo_confirmed" })
    expect(await rowOf(one.leadId)).toMatchObject({ father_full_name: `MOHAMED ALI ${S}`, father_full_name_source: "entered" })
    expect(await feeOf(two.leadId)).toMatchObject({ discount: SIBLING })
  })

  test("different fathers' names: a note is asked, then the Sibling request goes to the Manager and nobody gets the 10%", async () => {
    const year = await registrationYear()
    const parent = person()
    const second = student(fatherParts(), year, { siblingOf: { student: 1 } })
    const students = [student(fatherParts(), year, { className: "FORM 1" }), second]

    expect(await register({ people: [parent], students })).toMatchObject({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "request-note", student: 2, siblingStudent: 1 }] },
    })
    expect(await leadsOnPhone((parent as { phone: string }).phone)).toBe(0)

    const requestId = randomUUID()
    const [, two] = await created({
      people: [parent],
      students: [students[0], { ...second, requestNote: "Both birth certificates name the same mother.", requestId }],
    })
    expect(two.sibling).toMatchObject({ basis: "request_needed" })
    const request = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query("select id, state, kind, lead_id, request_id from public.discount_requests where id = $1", [two.sibling!.requestId])
      ).rows[0],
    )
    expect(request).toMatchObject({ state: "pending", kind: "sibling", lead_id: two.leadId, request_id: requestId })
    expect(await feeOf(two.leadId)).toMatchObject({ discount: null })
  })

  test("the same father with no sibling choice is asked about first; Not a sibling saves them apart", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const parent = person()
    const students = [student(family, year), student(family, year)]
    expect(await register({ people: [parent], students })).toMatchObject({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "same-father", student: 2, otherStudent: 1 }] },
    })
    const [one, two] = await created({ people: [parent], students: [students[0], { ...students[1], notASibling: true }] })
    expect(one.sibling).toBeNull()
    expect(two.sibling).toBeNull()
    expect(await membershipOf(two.leadId)).toMatchObject({ group_id: null })
  })

  test("an on-file sibling whose father's name nobody confirmed: it is asked, and the link ends its old Family status", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    // Two children on one contact through today's form: a legacy Family group.
    const older = await onFile(nameOf(family), "STD 2")
    const contactId = await contactOf(older)
    await onFile(word() + " " + word(), "KG 1", contactId)
    expect(await membershipOf(older)).toMatchObject({ legacy: true })

    const newcomer = student(family, year, { siblingOf: { leadId: older } })
    expect(await register({ people: [{ contactId }], students: [newcomer] })).toMatchObject({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "sibling-father-name", student: 1, siblingLeadId: older }] },
    })
    const [joined] = await created({ people: [{ contactId }], students: [{ ...newcomer, siblingFatherFullName: nameOf(family) }] })
    expect(joined.sibling).toMatchObject({ basis: "matched" })
    expect(await membershipOf(older)).toMatchObject({ legacy: false, basis: "matched", group_id: joined.sibling!.groupId })
    expect((await rowOf(joined.leadId)).returning_family_joined).toBe(true)
  })
})

describe("siblings on file", () => {
  test("two students linked to one unconfirmed on-file sibling both answer its father's name, and the form saves", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const older = await onFile(nameOf(family), "STD 2")
    const contactId = await contactOf(older)
    await onFile(`${word()} ${word()}`, "KG 1", contactId)
    const answered = { siblingOf: { leadId: older }, siblingFatherFullName: nameOf(family) }
    const saved = await created({
      people: [{ contactId }],
      students: [student(family, year, answered), student(family, year, { ...answered, className: "KG 2" })],
    })
    expect(saved.map((s) => s.sibling?.basis)).toEqual(["matched", "matched"])
    expect(await membershipOf(older)).toMatchObject({ legacy: false, basis: "matched" })
  })

  // #367, second case: the on-file sibling's name holds a typing mistake,
  // and every new student answers it as stored and then "typing mistake".
  test("two students give the same typo answer for one on-file sibling, as they saw it, and the form saves", async () => {
    const year = await registrationYear()
    const [last, sur] = [word(), word()]
    const right = { fatherFirst: "Mohammed", fatherMiddle: last, fatherLast: sur }
    const typed = `Mohamed ${last} ${sur}`
    const older = await onFile(typed, "STD 2")
    const contactId = await contactOf(older)
    await onFile(`${word()} ${word()}`, "KG 1", contactId)
    const answered: Partial<RegistrationStudent> = {
      siblingOf: { leadId: older },
      siblingFatherFullName: typed,
      nameAnswer: { answer: "typo", spelling: nameOf(right) },
    }
    const saved = await created({
      people: [{ contactId }],
      students: [student(right, year, answered), student(right, year, { ...answered, className: "KG 2" })],
    })
    expect(saved.map((s) => s.sibling?.basis)).toEqual(["typo_confirmed", "matched"])
    expect(saved[1].sibling!.groupId).toBe(saved[0].sibling!.groupId)
    expect(await rowOf(older)).toMatchObject({ father_full_name: nameOf(right), father_full_name_source: "typo_confirmed" })
  })

  test("the replaced spelling is recognised whatever characters the name holds, a semicolon included", async () => {
    const year = await registrationYear()
    const [last, sur] = [word(), word()]
    const right = { fatherFirst: "Mohamed", fatherMiddle: last, fatherLast: sur }
    const typed = `Mohamed; ${last} ${sur}`
    const older = await onFile(typed, "STD 2")
    const contactId = await contactOf(older)
    await onFile(`${word()} ${word()}`, "KG 1", contactId)
    const answered: Partial<RegistrationStudent> = {
      siblingOf: { leadId: older },
      siblingFatherFullName: typed,
      nameAnswer: { answer: "typo", spelling: nameOf(right) },
    }
    const saved = await created({
      people: [{ contactId }],
      students: [student(right, year, answered), student(right, year, { ...answered, className: "KG 2" })],
    })
    expect(saved.map((s) => s.sibling?.basis)).toEqual(["typo_confirmed", "matched"])
    expect((await rowOf(older)).father_full_name).toBe(nameOf(right))
  })

  test("a later student's answer that is neither the stored name nor the replaced spelling is still refused", async () => {
    const year = await registrationYear()
    const [last, sur] = [word(), word()]
    const right = { fatherFirst: "Mohammed", fatherMiddle: last, fatherLast: sur }
    const typed = `Mohamed ${last} ${sur}`
    const older = await onFile(typed, "STD 2")
    const contactId = await contactOf(older)
    await onFile(`${word()} ${word()}`, "KG 1", contactId)
    const first: Partial<RegistrationStudent> = {
      siblingOf: { leadId: older },
      siblingFatherFullName: typed,
      nameAnswer: { answer: "typo", spelling: nameOf(right) },
    }
    const result = await register({
      people: [{ contactId }],
      students: [
        student(right, year, first),
        student(right, year, { ...first, className: "KG 2", siblingFatherFullName: `Juma ${word()} ${word()}` }),
      ],
    })
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid", field: "sibling_father_full_name", student: 2 } })
    expect((await rowOf(older)).father_full_name).toBe(typed)
  })

  test("a child linked to an Enrolled sibling gets the 10%, and the Enrolled sibling's fee does not move", async () => {
    const family = fatherParts()
    const anchor = await enrolled(nameOf(family), await claimedYear())
    const before = await feeOf(anchor)
    expect(await storedResultOf(anchor)).toMatchObject({ locked_result: "full" })

    const [newcomer] = await created({
      people: [person()],
      students: [student(family, await registrationYear(), { siblingOf: { leadId: anchor } })],
    })
    expect(newcomer.sibling).toMatchObject({ basis: "matched" })
    expect(await feeOf(newcomer.leadId)).toMatchObject({ discount: SIBLING })
    expect(await feeOf(anchor)).toEqual(before)
    expect(await storedResultOf(anchor)).toMatchObject({ result: "full", source: "locked", locked_result: "full" })
    expect((await rowOf(anchor)).status).toBe("Enrolled")
  })

  test("a link that gives an on-file sibling the 10% can enrol it: it locks at the 10%, and the new dearer child pays full", async () => {
    const family = fatherParts()
    // KG 1 is 1,100,000 a year here. 990,000 is paid: the whole fee once
    // the 10% applies, not before.
    const cheaper = await passed(nameOf(family), await claimedYear(), "KG 1")
    await pay(cheaper, "first_instalment", 396_000)
    await pay(cheaper, "second_instalment", 396_000)
    await pay(cheaper, "third_instalment", 198_000)
    expect((await rowOf(cheaper)).status).not.toBe("Enrolled")

    const [dearer] = await created({
      people: [person()],
      students: [student(family, await registrationYear(), { className: "FORM 1", siblingOf: { leadId: cheaper } })],
    })
    // With the 10% the fee is 990,000, which is paid in full.
    expect((await rowOf(cheaper)).status).toBe("Enrolled")
    expect(await storedResultOf(cheaper)).toMatchObject({ result: "ten", source: "locked", locked_result: "ten" })
    expect(await fullPayerOf(dearer.sibling!.groupId)).toBe(dearer.leadId)
    expect(await feeOf(dearer.leadId)).toMatchObject({ discount: null })
  })

  test("a group with a manually edited fee: linking a new sibling leaves the manual fee as the Accountant set it", async () => {
    const family = fatherParts()
    const dear = await onFile(nameOf(family), "STD 2")
    const cheap = await onFile(nameOf(family), "KG 1")
    const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: cheap, siblingOfLeadId: dear })
    if (!linked.ok || linked.data.kind !== "linked") throw new Error("setup failed")
    expect(await feeOf(cheap)).toMatchObject({ discount: SIBLING })
    const edited = await editSiblingFee(
      await signedIn(ACCOUNTANT),
      { leadId: cheap, value: "full", reason: "data_entry_correction", note: "Invoiced at full." },
      randomUUID(),
    )
    if (!edited.ok) throw new Error(`edit failed: ${JSON.stringify(edited.error)}`)
    expect(await storedResultOf(cheap)).toMatchObject({ result: "full", source: "manual" })

    const [newcomer] = await created({
      people: [person()],
      students: [student(family, await registrationYear(), { siblingOf: { leadId: dear } })],
    })
    expect(newcomer.sibling).toMatchObject({ basis: "matched", groupId: linked.data.groupId })
    expect(await storedResultOf(cheap)).toMatchObject({ result: "full", source: "manual" })
    expect(await feeOf(cheap)).toMatchObject({ discount: null })
  })

  test("a child on a known custodian never joins the Family's old group, not even when today's form adds another child later", async () => {
    const year = await registrationYear()
    const first = await onFile(`${word()} ${word()}`, "STD 2")
    const contactId = await contactOf(first)
    await onFile(`${word()} ${word()}`, "KG 1", contactId)
    const group = (await membershipOf(first))!.group_id

    const [registered] = await created({ people: [{ contactId }], students: [student(fatherParts(), year)] })
    expect(await membershipOf(registered.leadId)).toEqual({
      group_id: null,
      legacy: false,
      basis: null,
      sibling_of_lead_id: null,
      sibling_choice_made: true,
    })
    const later = await onFile(`${word()} ${word()}`, "KG 2", contactId)
    expect(await membershipOf(later)).toMatchObject({ group_id: group, legacy: true })
    expect(await membershipOf(registered.leadId)).toMatchObject({ group_id: null })
  })

  test("a refusal stands: linking a new child to a refused member leaves it refused and without the 10%", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const counted = await onFile(nameOf(family), "STD 2")
    const refused = await onFile(`${word()} ${word()}`, "KG 1")
    const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: refused, siblingOfLeadId: counted })
    expect(linked).toMatchObject({ ok: true, data: { kind: "linked", basis: "request_needed" } })
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
      leadId: refused,
      note: "The family says they are half-siblings.",
      requestId: randomUUID(),
    })
    if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
    expect(await decideSiblingRequest(await signedIn(MANAGER), asked.data, { decision: "refuse", reason: "No proof brought." })).toEqual({
      ok: true,
      data: null,
    })
    expect(await membershipOf(refused)).toMatchObject({ basis: "refused" })

    // A new child with the counted member's father links through the refused one.
    const [newcomer] = await created({ people: [person()], students: [student(family, year, { siblingOf: { leadId: refused } })] })
    expect(newcomer.sibling).toMatchObject({ basis: "matched" })
    expect(await membershipOf(refused)).toMatchObject({ basis: "refused" })
    expect((await storedResultOf(refused)).result).not.toBe("ten")
  })
})

// #308 review round 5: the Register students form sends what its own model
// builds. These feed that payload to the save for a child on file whose group
// counts by another father's name, which the child itself waits on.
describe("the form's own payload, for a child on file that waits on a Sibling request", () => {
  // One new child with the waiting child's father's name, and Yes to that child.
  function yesTo(waiting: string, father: Father, links?: Record<number, OnFileLink>): Answers {
    return {
      students: [{ key: 1, name: { firstName: word(), ...father }, className: "KG 1", board: "Day" }],
      custodians: {
        1: { kind: "new", name: { firstName: "Register", middleName: "Parent", lastName: word() }, phone: phone(), whatsapp: "", relationship: "Mother", description: "" },
      },
      onFileAsks: [{ student: 1, leadId: waiting, name: "ON FILE", admissionNumber: "ADMSN-00000", father: nameOf(father), fromSave: true }],
      onFile: { 1: { leadId: waiting, yes: true, ...(links ? { links } : {}) } },
    }
  }

  // What readOnFileSibling gives the form, from the same two reads.
  async function readOf(leadId: string): Promise<OnFileFee> {
    const admissions = await signedIn(ADMISSIONS)
    const explained = await explainSiblingGroup(admissions, leadId)
    if (!explained.ok) throw new Error(`no group: ${explained.error}`)
    const members = explained.data.members
    const fathers = await getFathersOfLeads(admissions, members.map((m) => m.leadId))
    if (!fathers.ok) throw new Error("no fathers")
    const created = await getLeadCreatedAt(admissions, leadId)
    if (!created.ok) throw new Error("no record date")
    const self = members.find((m) => m.leadId === leadId)!
    const counts = (basis: string | null) => basis === "matched" || basis === "typo_confirmed" || basis === "granted"
    return {
      leadId,
      createdAt: created.data,
      name: self.studentName,
      className: self.className,
      status: self.status,
      fee: null,
      pays: null,
      anchorName: null,
      fullPayerName: null,
      groupId: explained.data.groupId,
      father: fathers.data[leadId] ?? null,
      counted: members
        .filter((m) => m.leadId !== leadId && !m.legacy && counts(m.basis))
        .map((m) => ({ leadId: m.leadId, name: m.studentName, father: fathers.data[m.leadId] })),
      selfCounts: !self.legacy && counts(self.basis),
      mayPayFull: false,
    }
  }

  async function save(a: Answers, year: number, reads: Record<string, OnFileFee> = {}) {
    return register(payload(a, year, reads))
  }

  test("different names: a plain Yes is asked for a note, and the form's request answer saves as a Sibling request", async () => {
    const year = await registrationYear()
    const [theirs, ours] = [fatherParts(), fatherParts()]
    const counted = await onFile(nameOf(theirs), "STD 2")
    const waiting = await onFile(nameOf(ours), "KG 1")
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: waiting, siblingOfLeadId: counted })).toMatchObject({
      ok: true,
      data: { kind: "linked", basis: "request_needed" },
    })

    // A Yes with no answer: the save compares with the counting member, not with the child that waits.
    expect(await save(yesTo(waiting, ours), year)).toMatchObject({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "request-note", student: 1, siblingLeadId: waiting }] },
    })

    // The form reads the group and asks the same thing before it saves.
    const reads = { [waiting]: await readOf(waiting) }
    expect(reads[waiting]).toMatchObject({ selfCounts: false, counted: [{ leadId: counted, father: nameOf(theirs) }] })
    expect(onFileQuestion(yesTo(waiting, ours), reads, 1)).toMatchObject({ student: 1, compared: { tier: "different", theirs: nameOf(theirs) } })

    const requestId = randomUUID()
    const answered = yesTo(waiting, ours, { 1: { kind: "request", note: "", requestId, close: false, against: nameOf(theirs) } })
    expect(onFileQuestion(answered, reads, 1)).toBeNull()
    const saved = await save(answered, year, reads)
    if (!saved.ok || saved.data.kind !== "created") throw new Error(`not created: ${JSON.stringify(saved)}`)
    const [newcomer] = saved.data.students
    expect(newcomer.sibling).toMatchObject({ basis: "request_needed" })
    expect(await membershipOf(newcomer.leadId)).toMatchObject({ basis: "request_needed", sibling_of_lead_id: waiting })
    const request = await inRolledBackTransaction(async (sql) =>
      (await sql.query("select state, kind, lead_id, note from public.discount_requests where request_id = $1", [requestId])).rows[0],
    )
    expect(request).toMatchObject({ state: "pending", kind: "sibling", lead_id: newcomer.leadId, note: "Fathers' names don't match." })
    expect(await feeOf(newcomer.leadId)).toMatchObject({ discount: null })
  })

  test("close names: a plain Yes is asked one name or two, and the form's typing-mistake answer saves the child as a sibling", async () => {
    const year = await registrationYear()
    const ours = fatherParts()
    const theirs: Father = { ...ours, fatherLast: `${ours.fatherLast}a` }
    const counted = await onFile(nameOf(theirs), "STD 2")
    const waiting = await onFile(nameOf(ours), "KG 1")
    // The child on file was called another man's child: it waits on a request.
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: waiting, siblingOfLeadId: counted, answer: "different" })).toMatchObject({
      ok: true,
      data: { kind: "linked", basis: "request_needed" },
    })

    expect(await save(yesTo(waiting, ours), year)).toMatchObject({
      ok: true,
      data: {
        kind: "questions",
        questions: [{ kind: "name", student: 1, fatherFullName: nameOf(ours), siblingFatherFullName: nameOf(theirs), siblingLeadId: counted }],
      },
    })

    const reads = { [waiting]: await readOf(waiting) }
    expect(onFileQuestion(yesTo(waiting, ours), reads, 1)).toMatchObject({ student: 1, compared: { tier: "close", theirs: nameOf(theirs) } })

    const answered = yesTo(waiting, ours, { 1: { kind: "typo", spelling: nameOf(theirs), against: nameOf(theirs) } })
    expect(onFileQuestion(answered, reads, 1)).toBeNull()
    const saved = await save(answered, year, reads)
    if (!saved.ok || saved.data.kind !== "created") throw new Error(`not created: ${JSON.stringify(saved)}`)
    const [newcomer] = saved.data.students
    expect(newcomer.sibling).toMatchObject({ basis: "typo_confirmed" })
    // The right spelling is on the new child, and on the waiting child that held the replaced one.
    expect((await rowOf(newcomer.leadId)).father_full_name).toBe(nameOf(theirs))
    expect((await rowOf(waiting)).father_full_name).toBe(nameOf(theirs))
    expect(await membershipOf(waiting)).toMatchObject({ basis: "request_needed" })
  })
})

describe("locks", () => {
  // The backend waiting on this advisory lock: (class, key) as lock_families
  // and lock_sibling_groups take it.
  async function waiterOn(sql: Client, lockClass: string, key: string): Promise<number | null> {
    const { rows } = await sql.query<{ pid: number }>(
      `select pid from pg_locks
       where locktype = 'advisory' and not granted and classid::int = hashtext($1) and objid::int = hashtext($2)`,
      [lockClass, key],
    )
    return rows[0]?.pid ?? null
  }

  async function waitForWaiter(sql: Client, lockClass: string, key: string): Promise<number> {
    for (let tries = 0; tries <= 100; tries++) {
      const pid = await waiterOn(sql, lockClass, key)
      if (pid !== null) return pid
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`it never waited on the ${lockClass} lock`)
  }

  // What the waiting save holds: the Family locks it has, whether it has
  // written any row (a row write takes RowExclusiveLock on its table), the
  // phone locks it has, and whether it holds the rows it will later lock.
  async function heldBy(sql: Client, pid: number, contacts: string[], phones: string[], leadId: string) {
    const families = await sql.query<{ contact: string }>(
      `select c::text as contact from unnest($2::uuid[]) c
       where exists (select 1 from pg_locks l where l.pid = $1 and l.granted and l.locktype = 'advisory'
                     and l.classid::int = hashtext('lead_family') and l.objid::int = hashtext(c::text))`,
      [pid, contacts],
    )
    const writes = await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_locks l
       where l.pid = $1 and l.locktype = 'relation' and l.mode = 'RowExclusiveLock'
         and l.relation in ('public.leads'::regclass, 'public.guardian_contacts'::regclass,
                            'public.sibling_group_members'::regclass, 'public.sibling_groups'::regclass,
                            'public.discount_requests'::regclass, 'public.lead_sibling_results'::regclass)`,
      [pid],
    )
    const phoneLocks = await sql.query<{ n: number }>(
      `select count(*)::int as n
       from unnest($2::text[]) p
       cross join lateral (select hashtextextended('lead-phone:' || public.normalize_phone(p), 0) as k) x
       join pg_locks l on l.pid = $1 and l.granted and l.locktype = 'advisory' and l.objsubid = 1
            and l.classid = ((x.k >> 32) & 4294967295)::oid and l.objid = (x.k & 4294967295)::oid`,
      [pid, phones],
    )
    const rowsFree = await inRolledBackTransaction(async (other) => {
      const lead = await other.query("select id from public.leads where id = $1 for update skip locked", [leadId])
      const people = await other.query("select id from public.guardian_contacts where id = any ($1::uuid[]) for update skip locked", [contacts])
      return lead.rowCount === 1 && people.rowCount === contacts.length
    })
    return { families: families.rows.map((r) => r.contact).sort(), writes: writes.rows[0].n, phoneLocks: phoneLocks.rows[0].n, rowsFree }
  }

  // A known person (on file with a child of another father), a new person,
  // and an on-file sibling in a group of two on two other contacts.
  async function setup() {
    const year = await registrationYear()
    const family = fatherParts()
    const a = await onFile(nameOf(family), "STD 2")
    const b = await onFile(nameOf(family), "KG 1")
    const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: b, siblingOfLeadId: a })
    if (!linked.ok || linked.data.kind !== "linked") throw new Error("setup failed")
    const knownContact = await contactOf(await onFile(`${word()} ${word()}`, "KG 2"))
    const knownPhone = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ phone: string }>("select phone from public.guardian_contacts where id = $1", [knownContact])).rows[0].phone,
    )
    const newPhone = phone()
    const input = {
      people: [{ contactId: knownContact }, { firstName: "Waiting", middleName: "For", lastName: "Parent", phone: newPhone }],
      students: [
        student(family, year, { siblingOf: { leadId: a } }),
        student(fatherParts(), year, { custodian: { person: 2, relationship: "Mother" } }),
      ],
    }
    return { a, group: linked.data.groupId, aContact: await contactOf(a), knownContact, phones: [knownPhone, newPhone], input }
  }

  test("every lock is taken before the first write, the group of an on-file child picked as Sibling of included", async () => {
    const { a, group, aContact, knownContact, phones, input } = await setup()

    const saved = await inRolledBackTransaction(async (holder) => {
      await holder.query("select pg_advisory_xact_lock(hashtext('sibling_group'), hashtext($1))", [group])
      const running = register(input)
      const pid = await waitForWaiter(holder, "sibling_group", group)
      // Waiting on the group: every Family lock is held, and nothing else yet.
      expect(await heldBy(holder, pid, [aContact, knownContact], phones, a)).toEqual({
        families: [aContact, knownContact].sort(),
        writes: 0,
        phoneLocks: 0,
        rowsFree: true,
      })
      await holder.query("rollback")
      await holder.query("begin")
      return running
    })
    expect(saved).toMatchObject({ ok: true, data: { kind: "created", students: [{ student: 1, sibling: { basis: "matched", groupId: group } }, { student: 2 }] } })
  })

  test("waiting on a known person's Family lock, the save has written nothing and holds no phone or row", async () => {
    const { a, aContact, knownContact, phones, input } = await setup()

    const saved = await inRolledBackTransaction(async (holder) => {
      await holder.query("select pg_advisory_xact_lock(hashtext('lead_family'), hashtext($1))", [knownContact])
      const running = register(input)
      const pid = await waitForWaiter(holder, "lead_family", knownContact)
      const held = await heldBy(holder, pid, [aContact, knownContact], phones, a)
      expect(held).toMatchObject({ writes: 0, phoneLocks: 0, rowsFree: true })
      expect(held.families).not.toContain(knownContact)
      await holder.query("rollback")
      await holder.query("begin")
      return running
    })
    expect(saved).toMatchObject({ ok: true, data: { kind: "created" } })
  })
})

