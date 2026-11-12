import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import {
  createLead,
  LEAD_CLASSES,
  registerStudents,
  updateGuardianContact,
  type LeadClass,
  type RegisterStudentsInput,
  type RegistrationPerson,
  type RegistrationStudent,
} from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { linkSibling } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { anonClient, asSystem, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
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
  return { fullName: `Register Parent ${word()}`, phone: phone(), ...over }
}

// A father's full name of three words no other test uses: Father's name,
// Last name and Surname.
function fatherParts() {
  return { fathersName: word(), lastName: word(), surname: word() }
}

function student(
  father: { fathersName: string; lastName: string; surname?: string },
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

// Passed in a claimed year and paid in full: Enrolled at full.
async function enrolled(fatherName: string, year: number): Promise<string> {
  const leadId = await onFile(fatherName, "STD 2")
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: (await feeOf(leadId)).schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return leadId
}

const nameOf = (f: { fathersName: string; lastName: string; surname?: string }) =>
  [f.fathersName, f.lastName, f.surname].filter(Boolean).join(" ")

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

    // The name is the four fields; the father's is the three after the first.
    const dearRow = await rowOf(dear.leadId)
    expect(dearRow.father_full_name).toBe(nameOf(family))
    expect(dearRow.father_full_name_source).toBe("derived")
    expect(dearRow.student_name.endsWith(` ${nameOf(family)}`)).toBe(true)
    expect(dearRow).toMatchObject({ status: "Visited", returning_family_joined: false, previous_school_not_known: true })
  })

  test("a duplicate on student 3 saves nothing, and the error names student 3", async () => {
    const year = await registrationYear()
    const parent = person()
    const third = student(fatherParts(), year)
    const onFileAlready = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: "Already Here", relationship: "Mother", phone: (parent as { phone: string }).phone } },
      student: { fullName: `${third.firstName} ${nameOf(third)}`, className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
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

  test("one person is stored once, Mother to one child and Aunt to another, and keeps both when the person is corrected", async () => {
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
        await sql.query<{ n: number; relationship: string }>(
          "select count(*)::int as n, min(relationship::text) as relationship from public.guardian_contacts where phone = public.normalize_phone($1)",
          [(parent as { phone: string }).phone],
        )
      ).rows[0],
    )
    expect(contacts).toEqual({ n: 1, relationship: "Mother" })

    // Today's correction screen changes the person's relationship: the child
    // whose relationship was the person's follows, the niece stays.
    expect(await updateGuardianContact(await signedIn(ADMISSIONS), ownRow.guardian_contact_id, { relationship: "Guardian" })).toEqual({
      ok: true,
      data: null,
    })
    expect((await rowOf(own.leadId)).custodian_relationship).toBe("Guardian")
    expect(await rowOf(niece.leadId)).toMatchObject({ custodian_relationship: "Other", custodian_relationship_description: "Aunt" })
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
        await sql.query<{ full_name: string; relationship: string }>(
          "select full_name, relationship::text from public.guardian_contacts where phone = public.normalize_phone($1)",
          [number],
        )
      ).rows[0],
    )
    expect(contact).toEqual({ full_name: nameOf(family), relationship: "Father" })
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
      brought_by_name: "Asha Uncle",
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
    const without = student(fatherParts(), year, { lastName: " " })
    expect(await register({ people: [person()], students: [student(fatherParts(), year), without] })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "last_name", student: 2 },
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
        people: [{ fullName: "Someone", phone: number }],
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
    const right = { fathersName: "Mohamed", lastName: "Ali", surname }
    const typo = { fathersName: "Mohammed", lastName: "Ali", surname }
    const parent = person()
    // The first is dearer, so the second gets the 10% once they are siblings.
    const first = student(right, year, { className: "FORM 1" })
    const second = student(typo, year, { siblingOf: { student: 1 } })

    const asked = await register({ people: [parent], students: [first, second] })
    expect(asked).toMatchObject({
      ok: true,
      data: {
        kind: "questions",
        questions: [{ kind: "name", student: 2, fatherFullName: `Mohammed Ali ${surname}`, siblingFatherFullName: `Mohamed Ali ${surname}` }],
      },
    })
    expect(await leadsOnPhone((parent as { phone: string }).phone)).toBe(0)

    const [one, two] = await created({
      people: [parent],
      students: [first, { ...second, nameAnswer: { answer: "typo", spelling: `Mohamed Ali ${surname}` } }],
    })
    expect(two.sibling).toMatchObject({ basis: "typo_confirmed" })
    expect(await rowOf(two.leadId)).toMatchObject({ father_full_name: `Mohamed Ali ${surname}`, father_full_name_source: "typo_confirmed" })
    expect(await rowOf(one.leadId)).toMatchObject({ father_full_name: `Mohamed Ali ${surname}`, father_full_name_source: "derived" })
    expect(await feeOf(two.leadId)).toMatchObject({ discount: SIBLING })
  })

  test("different fathers' names: a note is asked, then the Sibling request goes to the Manager and nobody gets the 10%", async () => {
    const year = await registrationYear()
    const parent = person()
    const second = student(fatherParts(), year, { siblingOf: { student: 1 } })
    const students = [student(fatherParts(), year, { className: "FORM 1" }), second]

    expect(await register({ people: [parent], students })).toMatchObject({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "request-note", student: 2 }] },
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

describe("locks", () => {
  async function groupLockWaiters(sql: Client, groupId: string): Promise<number> {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_locks
       where locktype = 'advisory' and not granted and classid::int = hashtext('sibling_group') and objid::int = hashtext($1)`,
      [groupId],
    )
    return rows[0].n
  }

  test("every lock is taken before the first write, the group of an on-file child picked as Sibling of included", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const a = await onFile(nameOf(family), "STD 2")
    const b = await onFile(nameOf(family), "KG 1")
    const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: b, siblingOfLeadId: a })
    if (!linked.ok || linked.data.kind !== "linked") throw new Error("setup failed")
    const group = linked.data.groupId
    const number = phone()

    const saved = await inRolledBackTransaction(async (holder) => {
      await holder.query("select pg_advisory_xact_lock(hashtext('sibling_group'), hashtext($1))", [group])
      const running = register({
        people: [{ fullName: "Waiting Parent", phone: number }],
        students: [student(family, year, { siblingOf: { leadId: a } })],
      })
      for (let tries = 0; (await groupLockWaiters(holder, group)) === 0; tries++) {
        if (tries > 100) throw new Error("it never waited on the group lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // While it waits it holds no row: the sibling's row is free.
      const rowFree = await inRolledBackTransaction(async (other) => {
        const locked = await other.query("select id from public.leads where id = $1 for update skip locked", [a])
        return locked.rowCount === 1
      })
      expect(rowFree).toBe(true)
      await holder.query("rollback")
      await holder.query("begin")
      return running
    })
    expect(saved).toMatchObject({ ok: true, data: { kind: "created", students: [{ student: 1, sibling: { basis: "matched", groupId: group } }] } })
  })
})

describe("migration day", () => {
  test("the snapshot check passes with nothing moved, and raises when a fee moves", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const [, cheap] = await created({
      people: [person()],
      students: [student(family, year, { className: "FORM 1" }), student(family, year, { siblingOf: { student: 1 } })],
    })
    expect(await feeOf(cheap.leadId)).toMatchObject({ discount: SIBLING })

    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, [
        "public.leads",
        "public.guardian_contacts",
        "public.lead_fee_profiles",
        "public.lead_sibling_results",
        "public.sibling_groups",
        "public.sibling_group_members",
        "public.school_fee_payments",
        "public.payment_adjustments",
        "public.discount_requests",
        "public.fee_schedules",
        "public.fee_band_amounts",
      ])
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("create temp table register_students_before as select * from public.fee_snapshot()")
      await sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.register_students_before')")

      await sql.query("update public.lead_sibling_results set result = 'none', source = 'auto' where lead_id = $1", [cheap.leadId])
      await expect(sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.register_students_before')")).rejects.toThrow(
        /fee_snapshot_changed/,
      )
    })
  })
})
