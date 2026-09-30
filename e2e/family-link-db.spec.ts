import { randomInt, randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  confirmFamilyMatch,
  createLead,
  findFamilyByPhone,
  getLead,
  getLeadFamily,
  rejectFamilyMatch,
  separateFromFamily,
  type CreateLeadInput,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "./db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "./fixtures"

// The Admission form start of createLead, and settling the unconfirmed Family
// match it leaves, against local Supabase. Each test invents its own names
// and numbers, so runs never collide with one another or with the seeded
// fixtures (+255 700 000 xxx).

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
    className: "STD 3",
    enrollmentYear: thisYear + 1,
    dayOrBoarding: "Day",
    ...overrides,
  }
}

function walkIn(guardian: CreateLeadInput["guardian"], pupil: NewStudent = student()): CreateLeadInput {
  return { guardian, student: pupil, start: { kind: "walk-in", visitDate: today } }
}

function fromForm(guardian: CreateLeadInput["guardian"], pupil: NewStudent = student()): CreateLeadInput {
  return { guardian, student: pupil, start: { kind: "admission-form" } }
}

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

async function created(result: Awaited<ReturnType<typeof createLead>>) {
  if (!result.ok) throw new Error(`setup failed: ${JSON.stringify(result.error)}`)
  return result.data
}

async function contactOf(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error("setup failed: the lead could not be read")
  return lead.data.contact.id
}

async function returningFamily(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error("the lead could not be read")
  return lead.data.returningFamily
}

// A Family made at the front desk, with one child, and two children the
// Admission form then sent on one contact with the same parent's number: the
// second child shares the contact the first one's call created.
async function unconfirmedMatch() {
  const parent = contact()
  const staff = await signedIn(ADMISSIONS)
  const known = await created(await createLead(staff, walkIn({ contact: parent })))
  const familyContact = await contactOf(known.leadId)

  const form = secretClient()
  const first = await created(await createLead(form, fromForm({ contact: { ...parent, fullName: "Typed On The Form" } })))
  const formContact = await contactOf(first.leadId)
  const second = await created(await createLead(form, fromForm({ contactId: formContact })))

  return { parent, known, familyContact, first, second, formContact }
}

test.describe("the Admission form start", () => {
  test("creates an Applied lead with no Visit date, written in history by the Admission form", async () => {
    const lead = await created(await createLead(secretClient(), fromForm({ contact: contact() })))

    const read = await getLead(await signedIn(ADMISSIONS), lead.leadId)
    expect(read.ok && read.data).toMatchObject({ status: "Applied", visitDate: null, returningFamily: false })
    const history = await rows<{ actor_kind: string; actor_staff_id: string | null }>(
      "select actor_kind, actor_staff_id from public.audit_log where lead_id = $1",
      [lead.leadId],
    )
    expect(history).toEqual([{ actor_kind: "public_form", actor_staff_id: null }])
  })

  test("is refused from a staff session and from someone signed out", async () => {
    const pupil = student()
    expect(await createLead(await signedIn(MANAGER), fromForm({ contact: contact() }, pupil))).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    const signedOut = await createLead(anonClient(), fromForm({ contact: contact() }, pupil))
    expect(signedOut.ok).toBe(false)
    expect(await rows("select 1 from public.leads where student_name = $1", [pupil.fullName])).toHaveLength(0)
  })

  test("the walk-in start is refused from the secret key", async () => {
    expect(await createLead(secretClient(), walkIn({ contact: contact() }))).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
  })

  test("refuses a contact the front desk created", async () => {
    const desk = await created(await createLead(await signedIn(ADMISSIONS), walkIn({ contact: contact() })))
    expect(await createLead(secretClient(), fromForm({ contactId: await contactOf(desk.leadId) }))).toEqual({
      ok: false,
      error: { kind: "invalid", field: "contact" },
    })
  })

  test("a known phone leaves a pending match, which a second child on the same contact shares", async () => {
    const { known, first, second, formContact, familyContact } = await unconfirmedMatch()

    // Neither child joins the Family itself, but both are Returning family.
    expect(formContact).not.toBe(familyContact)
    expect(await contactOf(second.leadId)).toBe(formContact)
    expect(await returningFamily(first.leadId)).toBe(true)
    expect(await returningFamily(second.leadId)).toBe(true)

    const family = await getLeadFamily(await signedIn(ADMISSIONS), second.leadId)
    expect(family.ok && family.data.pendingMatch?.id).toBe(familyContact)
    expect(family.ok && family.data.children.map((child) => [child.id, child.unconfirmed, child.onLeadContact])).toEqual([
      [known.leadId, false, false],
      [first.leadId, true, true],
      [second.leadId, true, true],
    ])
  })

  test("a new number that matches nothing leaves no match and no Returning family", async () => {
    const lead = await created(await createLead(secretClient(), fromForm({ contact: contact() })))
    const family = await getLeadFamily(await signedIn(ADMISSIONS), lead.leadId)
    expect(family.ok && family.data.pendingMatch).toBeNull()
    expect(await returningFamily(lead.leadId)).toBe(false)
  })
})

test.describe("Family lists show unconfirmed children", () => {
  test("check-in finds the known Family with the form's children marked unconfirmed, not a second parent", async () => {
    const { parent, known, first, second, familyContact } = await unconfirmedMatch()

    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: parent.phone })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.data.contacts.map((listed) => listed.id)).toEqual([familyContact])
    expect(found.data.contacts[0].children.map((child) => [child.id, child.unconfirmed])).toEqual([
      [known.leadId, false],
      [first.leadId, true],
      [second.leadId, true],
    ])
  })
})

test.describe("confirming a match", () => {
  test("moves every child on the form's contact into the Family, keeping them Returning family", async () => {
    const { parent, known, first, second, familyContact } = await unconfirmedMatch()

    const confirmed = await confirmFamilyMatch(await signedIn(ADMISSIONS), first.leadId, [first.leadId, second.leadId])
    expect(confirmed).toEqual({ ok: true, data: null })

    expect(await contactOf(first.leadId)).toBe(familyContact)
    expect(await contactOf(second.leadId)).toBe(familyContact)
    expect(await returningFamily(first.leadId)).toBe(true)
    expect(await returningFamily(second.leadId)).toBe(true)

    const family = await getLeadFamily(await signedIn(ADMISSIONS), second.leadId)
    expect(family.ok && family.data.pendingMatch).toBeNull()
    expect(family.ok && family.data.children.map((child) => [child.id, child.unconfirmed])).toEqual([
      [known.leadId, false],
      [first.leadId, false],
      [second.leadId, false],
    ])

    // Check-in now lists one parent with three children, none unconfirmed.
    const found = await findFamilyByPhone(await signedIn(ADMISSIONS), { phone: parent.phone })
    expect(found.ok && found.data.contacts.map((listed) => listed.children.map((child) => child.unconfirmed))).toEqual([
      [false, false, false],
    ])

    // And there is nothing left to confirm.
    expect(await confirmFamilyMatch(await signedIn(ADMISSIONS), first.leadId)).toEqual({
      ok: false,
      error: { kind: "no-pending-match" },
    })
  })

  test("is refused when the children on the contact are not the ones staff were shown", async () => {
    const { first, second, formContact } = await unconfirmedMatch()

    const result = await confirmFamilyMatch(await signedIn(ADMISSIONS), first.leadId, [first.leadId])
    expect(result).toEqual({ ok: false, error: { kind: "children-changed" } })
    expect(await contactOf(second.leadId)).toBe(formContact)
  })

  test("a later submission that matches only an unconfirmed contact is matched to its Family, before and after", async () => {
    const parent = contact()
    const whatsapp = `0${nineDigits()}`
    const staff = await signedIn(ADMISSIONS)
    const known = await created(await createLead(staff, walkIn({ contact: parent })))
    const familyContact = await contactOf(known.leadId)
    // The form gives a WhatsApp number the Family's contact doesn't hold.
    const first = await created(await createLead(secretClient(), fromForm({ contact: { ...parent, whatsapp } })))

    // A second submission whose only known number is that WhatsApp number.
    const second = await created(await createLead(secretClient(), fromForm({ contact: contact({ phone: whatsapp }) })))
    const beforeConfirming = await getLeadFamily(staff, second.leadId)
    expect(beforeConfirming.ok && beforeConfirming.data.pendingMatch?.id).toBe(familyContact)

    // Once the first is confirmed, its old contact is empty, and a third
    // submission on that number still reaches the Family.
    await confirmFamilyMatch(staff, first.leadId)
    const third = await created(
      await createLead(secretClient(), fromForm({ contact: contact({ phone: `0${nineDigits()}`, whatsapp }) })),
    )
    const afterConfirming = await getLeadFamily(staff, third.leadId)
    expect(afterConfirming.ok && afterConfirming.data.pendingMatch?.id).toBe(familyContact)

    // The Family lists every unconfirmed child, with none a step further away.
    const family = await getLeadFamily(staff, known.leadId)
    expect(family.ok && family.data.children.map((child) => [child.id, child.unconfirmed])).toEqual([
      [known.leadId, false],
      [first.leadId, false],
      [second.leadId, true],
      [third.leadId, true],
    ])
  })

  test("a child who would then duplicate a lead in the Family is refused, and nothing moves", async () => {
    const parent = contact()
    const pupil = student()
    const staff = await signedIn(ADMISSIONS)
    const known = await created(await createLead(staff, walkIn({ contact: parent })))
    const familyContact = await contactOf(known.leadId)
    const applied = await created(await createLead(secretClient(), fromForm({ contact: parent }, pupil)))
    // The Family's contact now also holds a number under which the same
    // child is already on file.
    const elsewhere = contact()
    const onFile = await created(await createLead(staff, walkIn({ contact: elsewhere }, pupil)))
    await asSystem((sql) =>
      sql.query("update public.guardian_contacts set whatsapp = $2 where id = $1", [
        familyContact,
        elsewhere.phone.replace(/^0/, "+255"),
      ]),
    )

    const result = await confirmFamilyMatch(staff, applied.leadId)
    expect(result.ok === false && result.error).toMatchObject({ kind: "duplicate", lead: { id: onFile.leadId } })
    expect(await contactOf(applied.leadId)).not.toBe(familyContact)
  })
})

test.describe("rejecting a match", () => {
  test("clears the match and the Returning family badge for every child on the contact", async () => {
    const { first, second, formContact } = await unconfirmedMatch()

    expect(await rejectFamilyMatch(await signedIn(ADMISSIONS), second.leadId, [first.leadId, second.leadId])).toEqual({
      ok: true,
      data: null,
    })

    expect(await contactOf(first.leadId)).toBe(formContact)
    expect(await returningFamily(first.leadId)).toBe(false)
    expect(await returningFamily(second.leadId)).toBe(false)
    const family = await getLeadFamily(await signedIn(ADMISSIONS), first.leadId)
    expect(family.ok && family.data.pendingMatch).toBeNull()
    expect(family.ok && family.data.children.map((child) => child.id)).toEqual([first.leadId, second.leadId])
    expect(await rejectFamilyMatch(await signedIn(ADMISSIONS), first.leadId)).toEqual({
      ok: false,
      error: { kind: "no-pending-match" },
    })
  })

  test("leaves the badge on a child who also re-applied", async () => {
    const { first, second } = await unconfirmedMatch()
    // Slice 3 sets this cause when a Re-application is recorded.
    await asSystem((sql) =>
      sql.query("update public.leads set returning_family_reapplied = true where id = $1", [first.leadId]),
    )

    await rejectFamilyMatch(await signedIn(ADMISSIONS), first.leadId)

    expect(await returningFamily(first.leadId)).toBe(true)
    expect(await returningFamily(second.leadId)).toBe(false)
    const [cause] = await rows<{ returning_family_reapplied: boolean }>(
      "select returning_family_reapplied from public.leads where id = $1",
      [first.leadId],
    )
    expect(cause.returning_family_reapplied).toBe(true)
  })
})

test.describe("separating a lead from its Family", () => {
  test("gives the lead its own copy of the contact and takes its Returning family badge away", async () => {
    const parent = contact({ whatsapp: `0${nineDigits()}` })
    const staff = await signedIn(ADMISSIONS)
    const older = await created(await createLead(staff, walkIn({ contact: parent })))
    const familyContact = await contactOf(older.leadId)
    const joined = await created(await createLead(staff, walkIn({ contactId: familyContact })))
    expect(await returningFamily(joined.leadId)).toBe(true)

    expect(await separateFromFamily(staff, joined.leadId)).toEqual({ ok: true, data: null })

    const separated = await getLead(staff, joined.leadId)
    const stayed = await getLead(staff, older.leadId)
    if (!separated.ok || !stayed.ok) throw new Error("the leads could not be read")
    expect(separated.data.contact.id).not.toBe(familyContact)
    expect({ ...separated.data.contact, id: familyContact }).toEqual(stayed.data.contact)
    expect(separated.data.returningFamily).toBe(false)
    expect(stayed.data.contact.id).toBe(familyContact)

    // Alone on its contact now, there is no Family left to separate from.
    expect(await separateFromFamily(staff, joined.leadId)).toEqual({ ok: false, error: { kind: "not-shared" } })
  })

  test("separating one of the form's children leaves its sibling on the pending match", async () => {
    const { first, second, formContact, familyContact } = await unconfirmedMatch()

    await separateFromFamily(await signedIn(ADMISSIONS), second.leadId)

    expect(await contactOf(first.leadId)).toBe(formContact)
    expect(await returningFamily(first.leadId)).toBe(true)
    expect(await returningFamily(second.leadId)).toBe(false)
    const alone = await getLeadFamily(await signedIn(ADMISSIONS), second.leadId)
    expect(alone.ok && alone.data.pendingMatch).toBeNull()
    const stillPending = await getLeadFamily(await signedIn(ADMISSIONS), first.leadId)
    expect(stillPending.ok && stillPending.data.pendingMatch?.id).toBe(familyContact)
  })

  test("leaves the badge on a child who also re-applied", async () => {
    const staff = await signedIn(ADMISSIONS)
    const older = await created(await createLead(staff, walkIn({ contact: contact() })))
    const joined = await created(await createLead(staff, walkIn({ contactId: await contactOf(older.leadId) })))
    await asSystem((sql) =>
      sql.query("update public.leads set returning_family_reapplied = true where id = $1", [joined.leadId]),
    )

    await separateFromFamily(staff, joined.leadId)
    expect(await returningFamily(joined.leadId)).toBe(true)
  })
})

test.describe("who may settle a match", () => {
  test("the Accountant and someone signed out are refused, and nothing changes", async () => {
    const { first, second, formContact } = await unconfirmedMatch()

    for (const client of [await signedIn(ACCOUNTANT), anonClient()]) {
      expect(await confirmFamilyMatch(client, first.leadId)).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await rejectFamilyMatch(client, first.leadId)).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await separateFromFamily(client, second.leadId)).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await contactOf(first.leadId)).toBe(formContact)
    expect(await contactOf(second.leadId)).toBe(formContact)
    expect(await returningFamily(first.leadId)).toBe(true)
  })

  test("the Accountant can still read the Family, and someone signed out cannot", async () => {
    const { first } = await unconfirmedMatch()
    const read = await getLeadFamily(await signedIn(ACCOUNTANT), first.leadId)
    expect(read.ok && read.data.children).toHaveLength(3)
    expect(await getLeadFamily(anonClient(), first.leadId)).toEqual({ ok: false, error: "forbidden" })
  })

  test("a closed child on the contact holds the match as it is", async () => {
    const { first, second } = await unconfirmedMatch()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Archived' where id = $1", [second.leadId]))

    expect(await confirmFamilyMatch(await signedIn(ADMISSIONS), first.leadId)).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
    expect(await rejectFamilyMatch(await signedIn(ADMISSIONS), first.leadId)).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
    expect(await separateFromFamily(await signedIn(ADMISSIONS), second.leadId)).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
  })
})
