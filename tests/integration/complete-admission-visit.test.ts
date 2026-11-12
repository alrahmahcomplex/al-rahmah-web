import { randomInt, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, onTestFinished, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import {
  completeAdmissionVisit,
  createLead,
  recordVisit,
  updateGuardianContact,
  type CheckInStudent,
  type CompleteAdmissionVisitInput,
  type LeadClass,
  type RegistrationPerson,
} from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { linkSibling } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { inRolledBackTransaction, lockExclusively, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Check-in of an Admission form family (#305), through the service and the
// database against local Supabase. Every name and phone is made up.

const MIGRATION = "supabase/migrations/20261217100100_complete_admission_visit.sql"
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

// A leading 067 keeps it clear of the seeded numbers and the other suites.
const phone = () => `067${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
const word = () => `V${randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "c")}`

type Father = { fathersName: string; lastName: string; surname: string }
const fatherParts = (): Father => ({ fathersName: word(), lastName: word(), surname: word() })
const nameOf = (f: Father) => `${f.fathersName} ${f.lastName} ${f.surname}`

type FormChild = { first: string; father: Father; className: LeadClass }
const child = (father: Father, className: LeadClass = "KG 1"): FormChild => ({ first: word(), father, className })

// One Admission form; returns each child's lead and the form's contact.
async function applied(children: FormChild[], year: number, relationship: "Mother" | "Father" = "Mother") {
  const sent = await submitAdmissionForm(secretClient(), {
    submissionKey: randomUUID(),
    parent: { fullName: `Form Parent ${word()}`, relationship, phone: phone() },
    children: children.map((c) => ({
      fullName: `${c.first} ${nameOf(c.father)}`,
      className: c.className,
      enrollmentYear: year,
      dayOrBoarding: "Day" as const,
    })),
  })
  if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
  const rows = await inRolledBackTransaction(async (sql) =>
    (
      await sql.query<{ id: string; admission_number: string; guardian_contact_id: string }>(
        "select id, admission_number, guardian_contact_id from public.leads where admission_number = any($1::text[])",
        [sent.data.map((o) => o.admissionNumber)],
      )
    ).rows,
  )
  return {
    leadIds: sent.data.map((o) => rows.find((r) => r.admission_number === o.admissionNumber)!.id),
    contactId: rows[0].guardian_contact_id,
  }
}

function checkIn(leadId: string, c: FormChild, over: Partial<CheckInStudent> = {}): CheckInStudent {
  return {
    leadId,
    firstName: c.first,
    ...c.father,
    custodian: { person: 1, relationship: "Mother" },
    ...over,
  }
}

async function complete(input: Omit<CompleteAdmissionVisitInput, "visitDate">) {
  return completeAdmissionVisit(await signedIn(ADMISSIONS), { visitDate: yesterday, ...input })
}

async function completed(input: Omit<CompleteAdmissionVisitInput, "visitDate">) {
  const saved = await complete(input)
  if (!saved.ok || saved.data.kind !== "completed") throw new Error(`not completed: ${JSON.stringify(saved)}`)
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
  previous_school_name: string | null
  previous_school_not_known: boolean
  status: string
  visit_date: string | null
  class_name: string
  returning_family_joined: boolean
}

async function rowOf(leadId: string): Promise<LeadRow> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query<LeadRow>("select *, visit_date::text from public.leads where id = $1", [leadId])).rows[0],
  )
}

async function membershipOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ group_id: string | null; legacy: boolean; basis: string | null; sibling_choice_made: boolean }>(
          "select group_id, legacy, basis, sibling_choice_made from public.sibling_group_members where lead_id = $1",
          [leadId],
        )
      ).rows[0] ?? null,
  )
}

async function storedResultOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ result: string; source: string; cause: string | null }>(
          `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source, r.cause
           from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
          [leadId],
        )
      ).rows[0],
  )
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

// An Admission form child taken through its visit, interview and full
// payment the old way: Enrolled at full.
async function enrol(leadId: string) {
  const admissions = await signedIn(ADMISSIONS)
  const visited = await recordVisit(admissions, leadId, yesterday)
  if (!visited.ok) throw new Error(`visit failed: ${JSON.stringify(visited.error)}`)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: (await feeOf(leadId)).schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

// A form of two: the first child Enrolled at full the old way, the second
// still Applied and holding today's legacy 10% from it.
async function legacyFamily(secondFather?: Father) {
  const year = await claimedYear()
  const family = fatherParts()
  const older = child(family, "STD 3")
  const younger = child(secondFather ?? family, "KG 1")
  const { leadIds, contactId } = await applied([older, younger], year)
  await enrol(leadIds[0])
  expect(await membershipOf(leadIds[1])).toMatchObject({ legacy: true })
  expect(await feeOf(leadIds[1])).toMatchObject({ discount: SIBLING })
  return { older, younger, olderId: leadIds[0], youngerId: leadIds[1], contactId, family }
}

describe("check-in of an Admission form family", () => {
  test("three children with a cousin: the cousin gets its own custodian, the other two form a group by name match", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const cousinsFather = fatherParts()
    const dear = child(family, "FORM 1")
    const cheap = child(family, "KG 2")
    const cousin = child(cousinsFather, "STD 1")
    const { leadIds, contactId } = await applied([dear, cheap, cousin], year)
    expect(await membershipOf(leadIds[2])).toMatchObject({ legacy: true })

    const auntsPhone = phone()
    const students = await completed({
      people: [{ contactId }, { fullName: `Aunt ${word()}`, phone: auntsPhone }],
      students: [
        checkIn(leadIds[0], dear, { previousSchool: { name: "Kisutu Primary", type: "public", region: "Dar es Salaam" } }),
        checkIn(leadIds[1], cheap, { siblingOf: { student: 1 }, broughtBy: { name: "Uncle Brought", relationship: "Uncle" } }),
        checkIn(leadIds[2], cousin, { custodian: { person: 2, relationship: "Other", relationshipDescription: "Aunt" } }),
      ],
    })

    expect(students[1].sibling).toMatchObject({ basis: "matched", requestId: null })
    const group = students[1].sibling!.groupId
    expect(await membershipOf(leadIds[0])).toMatchObject({ group_id: group, legacy: false, basis: "matched", sibling_choice_made: true })
    expect(await membershipOf(leadIds[2])).toMatchObject({ group_id: null, legacy: false, sibling_choice_made: true })
    expect(await feeOf(leadIds[1])).toMatchObject({ discount: SIBLING })
    expect((await feeOf(leadIds[0])).discount).not.toMatchObject(SIBLING)
    expect((await feeOf(leadIds[2])).discount).not.toMatchObject(SIBLING)

    const [r0, r1, r2] = await Promise.all(leadIds.map(rowOf))
    for (const r of [r0, r1, r2]) expect(r).toMatchObject({ status: "Visited", visit_date: yesterday })
    expect(r0).toMatchObject({ father_full_name: nameOf(family), previous_school_name: "Kisutu Primary", guardian_contact_id: contactId })
    expect(r1).toMatchObject({ brought_by_name: "Uncle Brought", custodian_relationship: "Mother" })
    expect(r2.guardian_contact_id).not.toBe(contactId)
    expect(r2).toMatchObject({
      custodian_relationship: "Other",
      custodian_relationship_description: "Aunt",
      custodian_relationship_own: false,
      returning_family_joined: false,
    })
    // The answers the family gave stay.
    expect(r2.class_name).toBe("STD 1")
  })

  test("two pairs of siblings on one form make two groups, each matched", async () => {
    const year = await registrationYear()
    const [x, y] = [fatherParts(), fatherParts()]
    const kids = [child(x, "KG 2"), child(x), child(y, "KG 2"), child(y)]
    const { leadIds, contactId } = await applied(kids, year)
    const students = await completed({
      people: [{ contactId }],
      students: [
        checkIn(leadIds[0], kids[0]),
        checkIn(leadIds[1], kids[1], { siblingOf: { student: 1 } }),
        checkIn(leadIds[2], kids[2], { notASibling: true }),
        checkIn(leadIds[3], kids[3], { siblingOf: { student: 3 } }),
      ],
    })
    expect(students[1].sibling).toMatchObject({ basis: "matched" })
    expect(students[3].sibling).toMatchObject({ basis: "matched" })
    expect(students[1].sibling!.groupId).not.toBe(students[3].sibling!.groupId)
    expect(await membershipOf(leadIds[2])).toMatchObject({ group_id: students[3].sibling!.groupId, basis: "matched" })
    expect(await feeOf(leadIds[1])).toMatchObject({ discount: SIBLING })
    expect(await feeOf(leadIds[3])).toMatchObject({ discount: SIBLING })
  })

  test("two siblings moved together to another custodian form their group on that person", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const kids = [child(family, "KG 2"), child(family)]
    const { leadIds, contactId } = await applied(kids, year)
    // The father is the custodian of both, a new person: the form's own
    // contact is not on the check-in.
    const students = await completed({
      people: [{ phone: phone() }],
      students: [
        checkIn(leadIds[0], kids[0], { custodian: { person: 1, father: true } }),
        checkIn(leadIds[1], kids[1], { custodian: { person: 1, father: true }, siblingOf: { student: 1 } }),
      ],
    })
    const group = students[1].sibling!.groupId
    const [r0, r1] = await Promise.all(leadIds.map(rowOf))
    expect(r0.guardian_contact_id).not.toBe(contactId)
    expect(r1.guardian_contact_id).toBe(r0.guardian_contact_id)
    expect(r0).toMatchObject({ custodian_relationship: "Father", custodian_relationship_own: false })
    expect(await membershipOf(leadIds[0])).toMatchObject({ group_id: group, basis: "matched" })
    const contacts = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ contact_ids: string[] }>("select contact_ids from public.sibling_groups where id = $1", [group])).rows[0].contact_ids,
    )
    expect(contacts).toEqual([r0.guardian_contact_id])
    const fees = await Promise.all(leadIds.map(feeOf))
    expect(fees.filter((f) => f.discount?.kind === "sibling")).toHaveLength(1)
  })

  test("a dearer child left out of the check-in stays legacy and does not take the full-fee place", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const kids = [child(family, "FORM 1"), child(family, "STD 1"), child(family)]
    const { leadIds, contactId } = await applied(kids, year)
    const students = await completed({
      people: [{ contactId }],
      // Staff answer the same-father question about the child left out.
      students: [checkIn(leadIds[1], kids[1], { notASibling: true }), checkIn(leadIds[2], kids[2], { siblingOf: { student: 1 } })],
    })
    const group = students[1].sibling!.groupId
    expect(await membershipOf(leadIds[0])).toMatchObject({ legacy: true })
    expect((await membershipOf(leadIds[0]))!.group_id).not.toBe(group)
    expect(await membershipOf(leadIds[1])).toMatchObject({ group_id: group, basis: "matched" })
    // One of the two checked-in siblings pays full and the other gets 10%.
    const fees = await Promise.all([feeOf(leadIds[1]), feeOf(leadIds[2])])
    expect(fees.filter((f) => f.discount?.kind === "sibling")).toHaveLength(1)
  })

  test("a number staff typed for the confirmed person is checked for duplicates too", async () => {
    const year = await registrationYear()
    const kid = child(fatherParts())
    const { leadIds, contactId } = await applied([kid], year)
    const otherPhone = phone()
    const onFile = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: `Other Number ${word()}`, relationship: "Mother", phone: otherPhone } },
      student: { fullName: `${kid.first} ${nameOf(kid.father)}`, className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!onFile.ok) throw new Error("setup failed")
    const result = await complete({ people: [{ contactId, alsoCheckPhones: [otherPhone] }], students: [checkIn(leadIds[0], kid)] })
    expect(result).toMatchObject({ ok: false, error: { kind: "duplicate", duplicates: [{ student: 1, id: onFile.data.leadId }] } })
    expect((await rowOf(leadIds[0])).status).toBe("Applied")
  })

  test("KG 2 and STD 1 are asked no previous school; an STD 3 child needs an answer, and Not known yet is one", async () => {
    const year = await registrationYear()
    const a = child(fatherParts(), "KG 2")
    const b = child(fatherParts(), "STD 1")
    const c = child(fatherParts(), "STD 3")
    const { leadIds, contactId } = await applied([a, b, c], year)
    const people: RegistrationPerson[] = [{ contactId }]

    expect(await complete({ people, students: [checkIn(leadIds[0], a), checkIn(leadIds[1], b), checkIn(leadIds[2], c)] })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "previous_school", student: 3, person: undefined, reason: undefined },
    })
    expect((await rowOf(leadIds[0])).status).toBe("Applied")

    await completed({
      people,
      students: [checkIn(leadIds[0], a), checkIn(leadIds[1], b), checkIn(leadIds[2], c, { previousSchool: { notKnown: true } })],
    })
    expect(await rowOf(leadIds[2])).toMatchObject({ status: "Visited", previous_school_not_known: true, previous_school_name: null })
    expect(await rowOf(leadIds[0])).toMatchObject({ status: "Visited", previous_school_not_known: false })
  })

  test("the four name fields correct the stored name and the father's full name", async () => {
    const year = await registrationYear()
    const typed = child(fatherParts())
    const { leadIds, contactId } = await applied([typed], year)
    const corrected = { ...typed, father: { ...typed.father, surname: word() } }
    await completed({ people: [{ contactId }], students: [checkIn(leadIds[0], corrected)] })
    expect(await rowOf(leadIds[0])).toMatchObject({
      student_name: `${typed.first} ${nameOf(corrected.father)}`,
      father_full_name: nameOf(corrected.father),
      father_full_name_source: "derived",
    })
  })
})

describe("leaving legacy never raises a fee", () => {
  test("a matching father's name links to the Enrolled sibling and keeps the 10%", async () => {
    const { older, younger, olderId, youngerId, contactId, family } = await legacyFamily()
    const students = await completed({
      people: [{ contactId }],
      students: [checkIn(youngerId, younger, { siblingOf: { leadId: olderId }, siblingFatherFullName: nameOf(family) })],
    })
    expect(students[0].sibling).toMatchObject({ basis: "matched" })
    expect(await membershipOf(olderId)).toMatchObject({ legacy: false, basis: "matched" })
    expect(await feeOf(youngerId)).toMatchObject({ discount: SIBLING })
    expect(await storedResultOf(youngerId)).toMatchObject({ result: "ten", source: "auto" })
    void older
  })

  test("a different father's name opens a Sibling request and the 10% stays, kept for the Accountant", async () => {
    const { olderId, youngerId, younger, contactId, family } = await legacyFamily(fatherParts())
    const requestId = randomUUID()
    const asked = await complete({
      people: [{ contactId }],
      students: [checkIn(youngerId, younger, { siblingOf: { leadId: olderId }, siblingFatherFullName: nameOf(family) })],
    })
    expect(asked).toEqual({ ok: true, data: { kind: "questions", questions: [{ kind: "request-note", student: 1, siblingLeadId: olderId }] } })
    expect((await rowOf(youngerId)).status).toBe("Applied")

    const students = await completed({
      people: [{ contactId }],
      students: [
        checkIn(youngerId, younger, {
          siblingOf: { leadId: olderId },
          siblingFatherFullName: nameOf(family),
          requestNote: "Birth certificates next week",
          requestId,
        }),
      ],
    })
    expect(students[0].sibling).toMatchObject({ basis: "request_needed", requestId: expect.any(String) })
    expect(await feeOf(youngerId)).toMatchObject({ discount: SIBLING })
    expect(await storedResultOf(youngerId)).toMatchObject({ result: "ten", source: "legacy", cause: "left_legacy" })
  })

  test("Not a sibling leaves the legacy group and keeps the 10%", async () => {
    const { youngerId, younger, contactId } = await legacyFamily(fatherParts())
    await completed({ people: [{ contactId }], students: [checkIn(youngerId, younger, { notASibling: true })] })
    expect(await membershipOf(youngerId)).toMatchObject({ group_id: null, legacy: false, sibling_choice_made: true })
    expect(await storedResultOf(youngerId)).toMatchObject({ result: "ten", source: "legacy", cause: "left_legacy" })
  })

  test("a child left out of the check-in stays legacy and its fee does not move", async () => {
    const year = await claimedYear()
    const family = fatherParts()
    const [older, a, b] = [child(family, "STD 3"), child(fatherParts()), child(family)]
    const { leadIds, contactId } = await applied([older, a, b], year)
    await enrol(leadIds[0])
    const before = await feeOf(leadIds[2])
    expect(before).toMatchObject({ discount: SIBLING })
    await completed({ people: [{ contactId }], students: [checkIn(leadIds[1], a, { notASibling: true })] })
    expect(await membershipOf(leadIds[2])).toMatchObject({ legacy: true })
    expect(await feeOf(leadIds[2])).toEqual(before)
  })
})

describe("refusals and questions", () => {
  test("a refused Sibling request holds although the check-in confirms matching names", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const [a, b] = [child(family), child(fatherParts())]
    const { leadIds, contactId } = await applied([a, b], year)
    const admissions = await signedIn(ADMISSIONS)
    // Before check-in, staff link the second child with different names and
    // the Manager refuses the request.
    const linked = await linkSibling(admissions, { leadId: leadIds[1], siblingOfLeadId: leadIds[0], siblingFatherFullName: nameOf(family) })
    expect(linked).toMatchObject({ ok: true, data: { basis: "request_needed" } })
    const requestId = randomUUID()
    const requested = await requestSiblingDiscount(admissions, { leadId: leadIds[1], note: "Proof to come", requestId })
    if (!requested.ok) throw new Error(`request failed: ${JSON.stringify(requested.error)}`)
    expect(await decideSiblingRequest(await signedIn(MANAGER), requested.data, { decision: "refuse", reason: "No proof" })).toMatchObject({
      ok: true,
    })

    const students = await completed({
      people: [{ contactId }],
      students: [checkIn(leadIds[0], a), checkIn(leadIds[1], { ...b, father: family }, { siblingOf: { student: 1 } })],
    })
    expect(students[1].sibling).toMatchObject({ basis: "refused" })
    expect((await feeOf(leadIds[1])).discount).not.toMatchObject(SIBLING)
    expect((await feeOf(leadIds[0])).discount).not.toMatchObject(SIBLING)
  })

  test("two children with the same father and no choice are asked Sibling of, and nothing is saved", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const [a, b] = [child(family), child(family)]
    const { leadIds, contactId } = await applied([a, b], year)
    expect(await complete({ people: [{ contactId }], students: [checkIn(leadIds[0], a), checkIn(leadIds[1], b)] })).toEqual({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "same-father", student: 2, otherStudent: 1 }] },
    })
    expect((await rowOf(leadIds[1])).status).toBe("Applied")
  })

  test("close fathers' names ask one question; a typing mistake answer links them", async () => {
    const year = await registrationYear()
    const family = { fathersName: "Mohamed", lastName: word(), surname: word() }
    const typo = { ...family, fathersName: "Mohammed" }
    const [a, b] = [child(family), child(typo)]
    const { leadIds, contactId } = await applied([a, b], year)
    const asked = await complete({
      people: [{ contactId }],
      students: [checkIn(leadIds[0], a), checkIn(leadIds[1], b, { siblingOf: { student: 1 } })],
    })
    expect(asked).toMatchObject({ ok: true, data: { kind: "questions", questions: [{ kind: "name", student: 2 }] } })

    const students = await completed({
      people: [{ contactId }],
      students: [
        checkIn(leadIds[0], a),
        checkIn(leadIds[1], b, { siblingOf: { student: 1 }, nameAnswer: { answer: "typo", spelling: nameOf(family) } }),
      ],
    })
    expect(students[1].sibling).toMatchObject({ basis: "typo_confirmed" })
    expect((await rowOf(leadIds[1])).father_full_name).toBe(nameOf(family))
  })
})

describe("refusals of the call", () => {
  test("only Applied children of one Admission form, for staff who record visits and edit leads", async () => {
    const year = await registrationYear()
    const a = child(fatherParts())
    const b = child(fatherParts())
    const first = await applied([a], year)
    const second = await applied([b], year)

    expect(
      await complete({ people: [{ contactId: first.contactId }], students: [checkIn(first.leadIds[0], a), checkIn(second.leadIds[0], b)] }),
    ).toMatchObject({ ok: false, error: { kind: "invalid", field: "lead_id", student: 2, reason: "other_submission" } })

    const walkIn = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: { fullName: `Walk In ${word()}`, relationship: "Mother", phone: phone() } },
      student: { fullName: `${a.first} ${nameOf(a.father)}`, className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!walkIn.ok) throw new Error("walk-in failed")
    expect(await complete({ people: [{ contactId: first.contactId }], students: [checkIn(walkIn.data.leadId, a)] })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "lead_id", student: 1, reason: "not_admission_form" },
    })

    expect(
      await completeAdmissionVisit(await signedIn(ACCOUNTANT), {
        visitDate: yesterday,
        people: [{ contactId: first.contactId }],
        students: [checkIn(first.leadIds[0], a)],
      }),
    ).toEqual({ ok: false, error: { kind: "forbidden" } })

    // Today's Record visit still works, and then the check-in has nothing to record.
    expect(await recordVisit(await signedIn(ADMISSIONS), first.leadIds[0], yesterday)).toEqual({ ok: true, data: null })
    expect(await complete({ people: [{ contactId: first.contactId }], students: [checkIn(first.leadIds[0], a)] })).toEqual({
      ok: false,
      error: { kind: "not-applied", student: 1 },
    })
  })

  test("one child already Visited and one still Applied: the Applied child completes, the Visited one is only a Sibling of choice", async () => {
    const year = await registrationYear()
    const family = fatherParts()
    const [visited, waiting] = [child(family, "STD 3"), child(family)]
    const { leadIds, contactId } = await applied([visited, waiting], year)
    expect(await recordVisit(await signedIn(ADMISSIONS), leadIds[0], yesterday)).toEqual({ ok: true, data: null })
    const before = await rowOf(leadIds[0])

    // The Visited child cannot be checked in again, and is named.
    expect(
      await complete({
        people: [{ contactId }],
        students: [checkIn(leadIds[1], waiting, { siblingOf: { student: 2 } }), checkIn(leadIds[0], visited)],
      }),
    ).toEqual({ ok: false, error: { kind: "not-applied", student: 2 } })

    // As a Sibling of choice it is a lead on file: its father's name is asked first.
    expect(await complete({ people: [{ contactId }], students: [checkIn(leadIds[1], waiting, { siblingOf: { leadId: leadIds[0] } })] })).toEqual({
      ok: true,
      data: { kind: "questions", questions: [{ kind: "sibling-father-name", student: 1, siblingLeadId: leadIds[0] }] },
    })
    const students = await completed({
      people: [{ contactId }],
      students: [checkIn(leadIds[1], waiting, { siblingOf: { leadId: leadIds[0] }, siblingFatherFullName: nameOf(family) })],
    })
    expect(students[0].sibling).toMatchObject({ basis: "matched" })
    expect(await rowOf(leadIds[1])).toMatchObject({ status: "Visited" })
    // The Visited child keeps its own record: only its link and confirmed father's name change.
    const after = await rowOf(leadIds[0])
    expect(after).toMatchObject({
      status: "Visited",
      visit_date: before.visit_date,
      student_name: before.student_name,
      father_full_name: nameOf(family),
      previous_school_name: before.previous_school_name,
      previous_school_not_known: before.previous_school_not_known,
      brought_by_name: before.brought_by_name,
    })
    expect(await membershipOf(leadIds[0])).toMatchObject({ legacy: false, basis: "matched", sibling_choice_made: false })
  })

  test("a corrected name that is already on file under the custodian's phone is a duplicate, and nothing is saved", async () => {
    const year = await registrationYear()
    const [a, b] = [child(fatherParts()), child(fatherParts())]
    const { leadIds, contactId } = await applied([a, b], year)
    const asA = { ...b, first: a.first, father: a.father }
    const result = await complete({ people: [{ contactId }], students: [checkIn(leadIds[1], asA)] })
    expect(result).toMatchObject({ ok: false, error: { kind: "duplicate", duplicates: [{ student: 1, id: leadIds[0] }] } })
    expect((await rowOf(leadIds[1])).status).toBe("Applied")
  })
})

describe("a child's own relationship", () => {
  test("survives two corrections of the person's relationship in a row", async () => {
    const year = await registrationYear()
    const [a, nephew] = [child(fatherParts()), child(fatherParts())]
    const { leadIds, contactId } = await applied([a, nephew], year)
    await completed({
      people: [{ contactId }],
      students: [
        checkIn(leadIds[0], a),
        checkIn(leadIds[1], nephew, { custodian: { person: 1, relationship: "Other", relationshipDescription: "Aunt" } }),
      ],
    })
    expect(await rowOf(leadIds[1])).toMatchObject({ custodian_relationship: "Other", custodian_relationship_own: true })

    const staff = await signedIn(ADMISSIONS)
    expect(await updateGuardianContact(staff, contactId, { relationship: "Guardian" })).toMatchObject({ ok: true })
    expect(await updateGuardianContact(staff, contactId, { relationship: "Mother" })).toMatchObject({ ok: true })
    expect(await rowOf(leadIds[1])).toMatchObject({
      custodian_relationship: "Other",
      custodian_relationship_description: "Aunt",
      custodian_relationship_own: true,
    })
    expect((await rowOf(leadIds[0])).custodian_relationship).toBe("Mother")
  })
})

// The migration's block, run again: untouched it passes, and a fee moved
// between the snapshots makes it raise.
describe("the migration", () => {
  test("raises when a fee moved between the snapshots", async () => {
    const source = readFileSync(MIGRATION, "utf8")
    const block = source.match(/do \$migration\$[\s\S]*?\n\$migration\$;/)?.[0]
    if (!block) throw new Error("migration block not found")
    const tampered = block.replace(
      "create temp table complete_visit_snapshot_before as select * from public.fee_snapshot();",
      () =>
        "create temp table complete_visit_snapshot_before as select * from public.fee_snapshot();\n" +
        "    update complete_visit_snapshot_before set value = value || '{\"school_fee\": -1}' where item like 'lead:%';",
    )
    expect(tampered).not.toBe(block)

    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.leads", "public.guardian_contacts", "public.sibling_groups", "public.sibling_group_members"])
      await sql.query("savepoint s")
      await expect(sql.query(tampered)).rejects.toThrow(/fee_snapshot_changed/)
      await sql.query("rollback to savepoint s")
      await sql.query(block)
    })
  })
})

