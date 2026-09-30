import { randomInt, randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  createLead,
  findFamilyByPhone,
  getLead,
  type CreateLeadInput,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"

import { anonClient, createThrowawayStaff, secretClient, signedIn } from "./db"
import { ACCOUNTANT, ADMISSIONS } from "./fixtures"

// Matching a walk-in parent to a known Family, against local Supabase. Each
// test invents its own names and numbers, so runs never collide with one
// another or with the seeded fixtures (+255 700 000 xxx).

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function nineDigits() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function contact(overrides: Partial<NewContact> = {}): NewContact {
  return { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `0${nineDigits()}`, ...overrides }
}

function student(overrides: Partial<NewStudent> = {}): NewStudent {
  return {
    fullName: `Pupil ${randomUUID().slice(0, 8)}`,
    className: "STD 2",
    enrollmentYear: thisYear + 1,
    dayOrBoarding: "Day",
    ...overrides,
  }
}

function walkIn(guardian: CreateLeadInput["guardian"], pupil: NewStudent = student()): CreateLeadInput {
  return { guardian, student: pupil, start: { kind: "walk-in", visitDate: today } }
}

// A Family made at the front desk: one contact and the children given.
async function family(parent: NewContact, children: NewStudent[] = [student()]) {
  const staff = await signedIn(ADMISSIONS)
  const first = await createLead(staff, walkIn({ contact: parent }, children[0]))
  if (!first.ok) throw new Error(`Could not create the first child: ${JSON.stringify(first.error)}`)
  const lead = await getLead(staff, first.data.leadId)
  if (!lead.ok) throw new Error("The first child could not be read")
  const contactId = lead.data.contact.id
  const leads = [{ id: first.data.leadId, admissionNumber: first.data.admissionNumber }]
  for (const child of children.slice(1)) {
    const next = await createLead(staff, walkIn({ contactId }, child))
    if (!next.ok) throw new Error(`Could not create a sibling: ${JSON.stringify(next.error)}`)
    leads.push({ id: next.data.leadId, admissionNumber: next.data.admissionNumber })
  }
  return { contactId, leads }
}

test.describe("finding a Family by phone", () => {
  test("matches a contact by its direct number, however it is typed, with its children", async () => {
    const digits = nineDigits()
    const parent = contact({ phone: `0${digits}`, relationship: "Father" })
    const [older, younger] = [student({ className: "STD 4" }), student({ className: "KG 1", dayOrBoarding: "Boarding" })]
    const known = await family(parent, [older, younger])

    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: `+255 ${digits.slice(0, 3)} ${digits.slice(3)}` })

    expect(found).toEqual({
      ok: true,
      data: {
        phone: `+255${digits}`,
        whatsapp: null,
        contacts: [
          {
            id: known.contactId,
            fullName: parent.fullName,
            relationship: "Father",
            relationshipDescription: null,
            phone: `+255${digits}`,
            whatsapp: null,
            children: [
              {
                id: known.leads[0].id,
                admissionNumber: known.leads[0].admissionNumber,
                studentName: older.fullName,
                className: "STD 4",
                enrollmentYear: thisYear + 1,
                status: "Visited",
                closure: null,
              },
              {
                id: known.leads[1].id,
                admissionNumber: known.leads[1].admissionNumber,
                studentName: younger.fullName,
                className: "KG 1",
                enrollmentYear: thisYear + 1,
                status: "Visited",
                closure: null,
              },
            ],
          },
        ],
      },
    })
  })

  test("matches a stored WhatsApp number, given as either the phone or the WhatsApp number", async () => {
    const whatsapp = nineDigits()
    const known = await family(contact({ whatsapp: `0${whatsapp}` }))
    const staff = await signedIn(ADMISSIONS)

    const asPhone = await findFamilyByPhone(staff, { phone: `0${whatsapp}` })
    expect(asPhone.ok && asPhone.data.contacts.map((c) => c.id)).toEqual([known.contactId])

    const asWhatsapp = await findFamilyByPhone(staff, { phone: `0${nineDigits()}`, whatsapp: `255${whatsapp}` })
    expect(asWhatsapp.ok && asWhatsapp.data.contacts.map((c) => c.id)).toEqual([known.contactId])
  })

  test("returns every contact that holds either number, oldest first, and never compares names", async () => {
    const shared = nineDigits()
    const other = nineDigits()
    const name = `Asha ${randomUUID().slice(0, 6)}`
    const first = await family(contact({ fullName: name, phone: `0${shared}` }))
    const second = await family(contact({ fullName: "Someone Else", phone: `0${nineDigits()}`, whatsapp: `0${shared}` }))
    const third = await family(contact({ fullName: "Another Parent", phone: `0${other}` }))
    // The same name on an unrelated number is not a match.
    await family(contact({ fullName: name, phone: `0${nineDigits()}` }))

    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: `0${shared}`, whatsapp: `0${other}` })
    expect(found.ok && found.data.contacts.map((c) => c.id)).toEqual([first.contactId, second.contactId, third.contactId])
  })

  test("shows a closed child with its status and closure mark", async () => {
    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: "0700 000 104" })
    expect(found.ok && found.data.contacts).toMatchObject([
      {
        fullName: "Omari Fixture",
        relationship: "Guardian",
        children: [{ admissionNumber: "ADMSN-90005", studentName: "Hamisi Fixture", status: "Visited", closure: "Archived" }],
      },
    ])
  })

  test("a number nobody holds matches nothing", async () => {
    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: `0${nineDigits()}` })
    expect(found.ok && found.data.contacts).toEqual([])
  })

  test("a number that is not a phone number is refused, naming the field", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await findFamilyByPhone(staff, { phone: "12345" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "phone" },
    })
    expect(await findFamilyByPhone(staff, { phone: `0${nineDigits()}`, whatsapp: "nope" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "whatsapp" },
    })
  })

  test("needs leads.view: an Accountant may look, a role without it and someone signed out may not", async () => {
    expect((await findFamilyByPhone(await signedIn(ACCOUNTANT), { phone: "0700 000 104" })).ok).toBe(true)

    const without = await createThrowawayStaff(["leads.create", "visits.record"])
    expect(await findFamilyByPhone(await signedIn(without), { phone: "0700 000 104" })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })

    const signedOut = await findFamilyByPhone(anonClient(), { phone: "0700 000 104" })
    expect(signedOut.ok).toBe(false)
  })
})

test.describe("registering a sibling on a confirmed contact", () => {
  test("the new lead joins the Family and is flagged Returning family", async () => {
    const known = await family(contact())
    const staff = await signedIn(ADMISSIONS)

    const sibling = await createLead(staff, walkIn({ contactId: known.contactId }))
    expect(sibling.ok).toBe(true)
    if (!sibling.ok) return

    const lead = await getLead(staff, sibling.data.leadId)
    expect(lead.ok && lead.data).toMatchObject({ status: "Visited", returningFamily: true, contact: { id: known.contactId } })
  })

  test("\"Not the same person\" makes a new contact and sets no flag, even on a known number", async () => {
    const parent = contact()
    const known = await family(parent)
    const staff = await signedIn(ADMISSIONS)

    const created = await createLead(staff, walkIn({ contact: contact({ phone: parent.phone }) }))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const lead = await getLead(staff, created.data.leadId)
    expect(lead.ok && lead.data.returningFamily).toBe(false)
    expect(lead.ok && lead.data.contact.id).not.toBe(known.contactId)
  })

  test("a child on file under another number staff typed is refused, though the confirmed contact doesn't hold it", async () => {
    const pupil = student()
    const confirmed = await family(contact())
    const otherDigits = nineDigits()
    const other = await family(contact({ phone: `0${otherDigits}` }), [pupil])
    const staff = await signedIn(ADMISSIONS)
    const confirmedLead = await getLead(staff, confirmed.leads[0].id)
    if (!confirmedLead.ok) throw new Error("lead missing")

    // Staff typed the confirmed contact's phone and the other number as
    // WhatsApp, then kept the stored details.
    const again = await createLead(
      staff,
      walkIn({ contactId: confirmed.contactId, alsoCheckPhones: [confirmedLead.data.contact.phone, `+255 ${otherDigits}`] }, pupil),
    )
    expect(again).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: other.leads[0].id, admissionNumber: other.leads[0].admissionNumber, status: "Visited", closure: null },
      },
    })

    // Without them, the check covers only the stored numbers.
    expect((await createLead(staff, walkIn({ contactId: confirmed.contactId, alsoCheckPhones: [] }, pupil))).ok).toBe(true)
  })

  test("typed numbers are only for a walk-in joining an existing contact", async () => {
    // The seeded Amani Fixture contact came from the Admission form, so the
    // form may join it, but not with typed numbers.
    const result = await createLead(secretClient(), {
      guardian: { contactId: "c0c0c0c0-0000-4000-8000-000000000001", alsoCheckPhones: [`0${nineDigits()}`] },
      student: student(),
      start: { kind: "admission-form" },
    })
    expect(result).toEqual({ ok: false, error: { kind: "invalid", field: "contact" } })
  })

  test("a child already on that contact is refused as a duplicate, even when the list was skipped", async () => {
    const pupil = student()
    const known = await family(contact(), [pupil])

    const again = await createLead(
      await signedIn(ADMISSIONS),
      walkIn({ contactId: known.contactId }, { ...pupil, fullName: `  ${pupil.fullName.toUpperCase()} ` }),
    )
    expect(again).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: known.leads[0].id, admissionNumber: known.leads[0].admissionNumber, status: "Visited", closure: null },
      },
    })
  })
})
