import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { fatherFullName, studentFullName } from "@/lib/names"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getAdmissionFormFamily, waitingChildren } from "@/lib/services/admission-form-family"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { startCheckIn } from "@/app/staff/check-in/[id]/model"
import { confirmFamilyMatch, createLead, recordVisit, separateFromFamily } from "@/lib/services/leads"
import { linkSibling } from "@/lib/services/sibling-groups"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// The Admission form family check-in starts from (#309), read through the
// service against local Supabase. Every name and phone is made up.

const today = tanzaniaToday()
const year = Number(today.slice(0, 4)) + 1
// A leading 067 keeps it clear of the seeded numbers and the other suites.
const phone = () => `067${String(randomInt(0, 10_000_000)).padStart(7, "0")}`
const word = () =>
  `F${randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 6)
    .padEnd(6, "c")}`

type Father = { fatherFirst: string; fatherMiddle: string; fatherLast: string }
const father = (): Father => ({ fatherFirst: word(), fatherMiddle: word(), fatherLast: word() })

async function sendForm(children: { first: string; father: Father; className: "KG 1" | "STD 3" }[], parentPhone = phone()) {
  const sent = await submitAdmissionForm(secretClient(), {
    submissionKey: randomUUID(),
    parent: { fullName: "", nameParts: { firstName: "Form", middleName: "Parent", lastName: word() }, relationship: "Mother", phone: parentPhone },
    children: children.map((c) => ({
      fullName: studentFullName({ firstName: c.first, ...c.father }),
      nameParts: { firstName: c.first, ...c.father },
      className: c.className,
      enrollmentYear: year,
      dayOrBoarding: "Day" as const,
    })),
  })
  if (!sent.ok) throw new Error(`form failed: ${JSON.stringify(sent.error)}`)
  const rows = await inRolledBackTransaction(
    async (sql) =>
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
    parentPhone,
  }
}

describe("admission_form_family", () => {
  test("reads the form's children in the form's order, its parent and the parent's other children", async () => {
    const dad = father()
    const kids = [
      { first: word(), father: dad, className: "STD 3" as const },
      { first: word(), father: father(), className: "KG 1" as const },
    ]
    const form = await sendForm(kids)
    const admissions = await signedIn(ADMISSIONS)
    // A child of the same parent registered at the desk is a "Sibling of" choice, not a child of the form.
    const onFile = await createLead(admissions, {
      guardian: { contactId: form.contactId },
      student: { fullName: studentFullName({ firstName: word(), ...dad }), className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!onFile.ok) throw new Error(`setup failed: ${JSON.stringify(onFile.error)}`)

    const read = await getAdmissionFormFamily(admissions, form.leadIds[1])
    if (!read.ok) throw new Error(`read failed: ${read.error}`)
    expect(read.data.sentOn).toBe(today)
    expect(read.data.contact).toMatchObject({ id: form.contactId, relationship: "Mother", familyMatch: false })
    expect(read.data.children.map((c) => c.leadId)).toEqual(form.leadIds)
    // Each child with the parent it sits on: one form puts them all on its parent.
    expect(read.data.children.map((c) => c.contactId)).toEqual([form.contactId, form.contactId])
    expect(read.data.children[0]).toMatchObject({
      studentName: studentFullName({ firstName: kids[0].first, ...dad }),
      fatherFullName: fatherFullName({ firstName: "", ...dad }),
      className: "STD 3",
      enrollmentYear: year,
      dayOrBoarding: "Day",
      status: "Applied",
      closure: null,
      previousSchool: null,
      linked: false,
    })
    expect(read.data.onFile.map((c) => c.leadId)).toEqual([onFile.data.leadId])
    // Registered at the desk, its father's name is the words after its own name: his first and last.
    expect(read.data.onFile[0].fatherFullName).toBe(`${dad.fatherFirst} ${dad.fatherLast}`.toUpperCase())
  })

  test("offers the Family a confirmed match moved the children to, not the form's first parent", async () => {
    const admissions = await signedIn(ADMISSIONS)
    const known = phone()
    const walkIn = await createLead(admissions, {
      guardian: { contact: { fullName: `Known Parent ${word()}`, relationship: "Mother", phone: known } },
      student: { fullName: `${word()} ${word()} ${word()}`, className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!walkIn.ok) throw new Error(`setup failed: ${JSON.stringify(walkIn.error)}`)
    // The form gives a number already on file: its children wait on a Family match.
    const form = await sendForm([{ first: word(), father: father(), className: "KG 1" }], known)

    const waiting = await getAdmissionFormFamily(admissions, form.leadIds[0])
    expect(waiting.ok && waiting.data.contact).toMatchObject({ id: form.contactId, familyMatch: true })

    const confirmed = await confirmFamilyMatch(admissions, form.leadIds[0], form.leadIds)
    if (!confirmed.ok) throw new Error(`setup failed: ${JSON.stringify(confirmed.error)}`)
    const read = await getAdmissionFormFamily(admissions, form.leadIds[0])
    if (!read.ok) throw new Error(`read failed: ${read.error}`)
    expect(read.data.contact?.id).not.toBe(form.contactId)
    expect(read.data.contact).toMatchObject({ familyMatch: false })
    expect(read.data.children.map((c) => c.leadId)).toEqual(form.leadIds)
    expect(read.data.onFile.map((c) => c.leadId)).toEqual([walkIn.data.leadId])
  })

  test("gives each child its own parent once one was separated, so check-in offers neither for both", async () => {
    const form = await sendForm([
      { first: word(), father: father(), className: "STD 3" },
      { first: word(), father: father(), className: "KG 1" },
    ])
    const admissions = await signedIn(ADMISSIONS)
    // The second child gets a copy of the parent, with the same name and number.
    const separated = await separateFromFamily(admissions, form.leadIds[1])
    if (!separated.ok) throw new Error(`setup failed: ${JSON.stringify(separated.error)}`)

    for (const looked of form.leadIds) {
      const read = await getAdmissionFormFamily(admissions, looked)
      if (!read.ok) throw new Error(`read failed: ${read.error}`)
      const [first, second] = read.data.children
      expect(first.contactId).toBe(form.contactId)
      expect(second.contactId).toEqual(expect.any(String))
      expect(second.contactId).not.toBe(form.contactId)
      // `contact` is the looked-up child's own, whichever child that is.
      expect(read.data.contact?.id).toBe(looked === form.leadIds[0] ? first.contactId : second.contactId)
      expect(startCheckIn(read.data, waitingChildren(read.data)).checkIn.contact).toBeNull()
    }
  })

  test("leaves a child whose visit is recorded out of the children check-in completes", async () => {
    const form = await sendForm([
      { first: word(), father: father(), className: "KG 1" },
      { first: word(), father: father(), className: "KG 1" },
    ])
    const admissions = await signedIn(ADMISSIONS)
    const visited = await recordVisit(admissions, form.leadIds[0], today)
    if (!visited.ok) throw new Error(`setup failed: ${JSON.stringify(visited.error)}`)

    const read = await getAdmissionFormFamily(admissions, form.leadIds[0])
    if (!read.ok) throw new Error(`read failed: ${read.error}`)
    expect(read.data.children.map((c) => c.status)).toEqual(["Visited", "Applied"])
    expect(waitingChildren(read.data).map((c) => c.leadId)).toEqual([form.leadIds[1]])
  })

  test("marks a child already linked as a sibling outside the old family rule", async () => {
    const dad = father()
    const form = await sendForm([
      { first: word(), father: dad, className: "KG 1" },
      { first: word(), father: dad, className: "KG 1" },
    ])
    const admissions = await signedIn(ADMISSIONS)
    const linked = await linkSibling(admissions, { leadId: form.leadIds[1], siblingOfLeadId: form.leadIds[0], siblingFatherFullName: fatherFullName({ firstName: "", ...dad }) })
    if (!linked.ok) throw new Error(`setup failed: ${JSON.stringify(linked.error)}`)

    const read = await getAdmissionFormFamily(admissions, form.leadIds[0])
    if (!read.ok) throw new Error(`read failed: ${read.error}`)
    const [a, b] = form.leadIds.map((id) => read.data.children.find((c) => c.leadId === id))
    expect(b).toMatchObject({ linked: true, groupId: expect.any(String) })
    // Both are in the one group the link made.
    expect(a?.groupId).toBe(b?.groupId)
  })

  test("tells a lead registered at the desk, and one that does not exist, from a form's", async () => {
    const admissions = await signedIn(ADMISSIONS)
    const walkIn = await createLead(admissions, {
      guardian: { contact: { fullName: `Walk In ${word()}`, relationship: "Mother", phone: phone() } },
      student: { fullName: `${word()} ${word()} ${word()}`, className: "KG 1", enrollmentYear: year, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!walkIn.ok) throw new Error(`setup failed: ${JSON.stringify(walkIn.error)}`)

    expect(await getAdmissionFormFamily(admissions, walkIn.data.leadId)).toEqual({ ok: false, error: "not-admission-form" })
    expect(await getAdmissionFormFamily(admissions, randomUUID())).toEqual({ ok: false, error: "not-found" })
  })

  test("refuses staff without leads.view, and anyone signed out", async () => {
    const form = await sendForm([{ first: word(), father: father(), className: "KG 1" }])
    const visitsOnly = await signedIn(await createThrowawayStaff(["visits.record", "leads.edit"]))
    expect(await getAdmissionFormFamily(visitsOnly, form.leadIds[0])).toEqual({ ok: false, error: "forbidden" })
    expect(await getAdmissionFormFamily(anonClient(), form.leadIds[0])).toEqual({ ok: false, error: "forbidden" })
  })
})
