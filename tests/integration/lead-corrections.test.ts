import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"
import { Client } from "pg"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  correctVisitDate,
  createLead,
  getLead,
  listContactChildren,
  updateGuardianContact,
  updateLeadDetails,
  type Lead,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Correcting a lead through the lead module, against local Supabase. Each test
// makes its own leads with invented names and numbers, and leaves the seeded
// fixtures alone.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function nineDigits() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function contact(overrides: Partial<NewContact> = {}): NewContact {
  return { fullName: "Test Parent", relationship: "Mother", phone: `0${nineDigits()}`, ...overrides }
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

function dayBefore(date: string, days = 1) {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() - days)
  return moved.toISOString().slice(0, 10)
}

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

// A walk-in lead, read back. With `contactId`, a sibling on that contact.
async function walkInLead(
  input: { contact?: NewContact; contactId?: string; student?: NewStudent; visitDate?: string } = {},
): Promise<Lead> {
  const staff = await signedIn(ADMISSIONS)
  const created = await createLead(staff, {
    guardian: input.contactId ? { contactId: input.contactId } : { contact: input.contact ?? contact() },
    student: input.student ?? student(),
    start: { kind: "walk-in", visitDate: input.visitDate ?? today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const lead = await getLead(staff, created.data.leadId)
  if (!lead.ok) throw new Error("setup failed: lead missing")
  return lead.data
}

async function reread(id: string): Promise<Lead> {
  const lead = await getLead(await signedIn(ADMISSIONS), id)
  if (!lead.ok) throw new Error("lead missing")
  return lead.data
}

describe("correcting the student's details", () => {
  test("changes the name, class, enrollment year and Day or boarding, and nothing else", async () => {
    const lead = await walkInLead({ visitDate: dayBefore(today, 3) })
    const newName = `Corrected ${randomUUID().slice(0, 8)}`

    const result = await updateLeadDetails(await signedIn(ADMISSIONS), lead.id, {
      fullName: `  ${newName} `,
      className: "FORM 1",
      enrollmentYear: thisYear + 2,
      dayOrBoarding: "Boarding",
    })
    expect(result).toEqual({ ok: true, data: null })

    const after = await reread(lead.id)
    expect(after).toEqual({
      ...lead,
      studentName: newName,
      className: "FORM 1",
      enrollmentYear: thisYear + 2,
      dayOrBoarding: "Boarding",
    })
  })

  test("a field left out keeps its value", async () => {
    const lead = await walkInLead()
    expect((await updateLeadDetails(await signedIn(MANAGER), lead.id, { className: "KG 1" })).ok).toBe(true)
    expect(await reread(lead.id)).toEqual({ ...lead, className: "KG 1" })
  })

  test("names the field a refusal is about, and changes nothing", async () => {
    const lead = await walkInLead()
    const staff = await signedIn(ADMISSIONS)
    const cases: [Record<string, unknown>, string][] = [
      [{ fullName: "   " }, "student_name"],
      [{ className: "STD 9" }, "class_name"],
      [{ enrollmentYear: thisYear - 1 }, "enrollment_year"],
      [{ enrollmentYear: thisYear + 3 }, "enrollment_year"],
      [{ dayOrBoarding: "Weekly" }, "day_or_boarding"],
    ]
    for (const [changes, field] of cases) {
      expect(await updateLeadDetails(staff, lead.id, changes), field).toEqual({
        ok: false,
        error: { kind: "invalid", field },
      })
    }
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("a new name that matches another child of the same parent number is refused, with that lead", async () => {
    const phone = `0${nineDigits()}`
    const existing = await walkInLead({ contact: contact({ phone }) })
    // Another family's contact, on the same number written another way.
    const lead = await walkInLead({ contact: contact({ fullName: "Other Parent", phone: `+255${phone.slice(1)}` }) })

    const result = await updateLeadDetails(await signedIn(ADMISSIONS), lead.id, {
      fullName: existing.studentName.toUpperCase().replace(" ", "   "),
    })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: existing.id, admissionNumber: existing.admissionNumber, status: "Visited", closure: null },
      },
    })
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("renaming a child to a brother or sister's name on the same contact is refused", async () => {
    const first = await walkInLead()
    const second = await walkInLead({ contactId: first.contact.id })

    const result = await updateLeadDetails(await signedIn(ADMISSIONS), second.id, { fullName: first.studentName })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: first.id, admissionNumber: first.admissionNumber, status: "Visited", closure: null },
      },
    })
    expect(await reread(second.id)).toEqual(second)
  })

  test("keeping the name, or changing only its capitals, is not a duplicate of itself", async () => {
    const lead = await walkInLead()
    const staff = await signedIn(ADMISSIONS)
    expect((await updateLeadDetails(staff, lead.id, { fullName: lead.studentName })).ok).toBe(true)
    expect((await updateLeadDetails(staff, lead.id, { fullName: lead.studentName.toUpperCase() })).ok).toBe(true)
    expect((await reread(lead.id)).studentName).toBe(lead.studentName.toUpperCase())
  })

  test("an enrollment year from an earlier year stays when other details change", async () => {
    const lead = await walkInLead()
    // A lead made last year, for this year's intake.
    await asSystem((sql) =>
      sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead.id, thisYear - 1]),
    )
    lead.enrollmentYear = thisYear - 1
    const result = await updateLeadDetails(await signedIn(ADMISSIONS), lead.id, {
      enrollmentYear: thisYear - 1,
      dayOrBoarding: "Boarding",
    })
    expect(result.ok).toBe(true)
    expect(await reread(lead.id)).toMatchObject({ enrollmentYear: thisYear - 1, dayOrBoarding: "Boarding" })
  })

  test("two corrections made at the same moment both stay", async () => {
    const lead = await walkInLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])
    const results = await Promise.all([
      updateLeadDetails(one, lead.id, { className: "KG 1" }),
      updateLeadDetails(other, lead.id, { dayOrBoarding: "Boarding" }),
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(await reread(lead.id)).toMatchObject({ className: "KG 1", dayOrBoarding: "Boarding" })
  })

  test("closed leads are read-only, and a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    // The seeded Archived and Declined leads.
    for (const id of ["1ead0000-0000-4000-8000-000000000005", "1ead0000-0000-4000-8000-000000000006"]) {
      expect(await updateLeadDetails(staff, id, { className: "STD 1" })).toEqual({ ok: false, error: { kind: "closed" } })
    }
    expect(await updateLeadDetails(staff, randomUUID(), { className: "STD 1" })).toEqual({
      ok: false,
      error: { kind: "not-found" },
    })
    expect(await updateLeadDetails(staff, "not-a-uuid", { className: "STD 1" })).toEqual({
      ok: false,
      error: { kind: "not-found" },
    })
  })
})

describe("correcting the parent/guardian contact", () => {
  test("changes the contact, with numbers normalized as at creation", async () => {
    const lead = await walkInLead()
    const digits = nineDigits()
    const whatsappDigits = nineDigits()

    const result = await updateGuardianContact(await signedIn(ADMISSIONS), lead.contact.id, {
      fullName: " Corrected Parent ",
      relationship: "Other",
      relationshipDescription: " Grandmother ",
      phone: `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
      whatsapp: `255${whatsappDigits}`,
    })
    expect(result).toEqual({ ok: true, data: null })

    expect((await reread(lead.id)).contact).toEqual({
      id: lead.contact.id,
      fullName: "Corrected Parent",
      relationship: "Other",
      relationshipDescription: "Grandmother",
      phone: `+255${digits}`,
      whatsapp: `+255${whatsappDigits}`,
    })
  })

  test("an empty WhatsApp number, or one equal to the phone, means the same as the phone", async () => {
    const lead = await walkInLead({ contact: contact({ whatsapp: `0${nineDigits()}` }) })
    const staff = await signedIn(ADMISSIONS)

    expect((await updateGuardianContact(staff, lead.contact.id, { whatsapp: "" })).ok).toBe(true)
    expect((await reread(lead.id)).contact.whatsapp).toBeNull()

    expect((await updateGuardianContact(staff, lead.contact.id, { whatsapp: lead.contact.phone })).ok).toBe(true)
    expect((await reread(lead.id)).contact.whatsapp).toBeNull()
  })

  test("leaving Other clears its description", async () => {
    const lead = await walkInLead({ contact: contact({ relationship: "Other", relationshipDescription: "Uncle" }) })
    expect((await updateGuardianContact(await signedIn(ADMISSIONS), lead.contact.id, { relationship: "Father" })).ok).toBe(
      true,
    )
    expect((await reread(lead.id)).contact).toMatchObject({ relationship: "Father", relationshipDescription: null })
  })

  test("names the field a refusal is about, and changes nothing", async () => {
    const lead = await walkInLead()
    const staff = await signedIn(ADMISSIONS)
    const cases: [Record<string, unknown>, string][] = [
      [{ fullName: "  " }, "contact_name"],
      [{ relationship: "Cousin" }, "relationship"],
      [{ relationship: "Other" }, "relationship_description"],
      [{ relationship: "Other", relationshipDescription: "  " }, "relationship_description"],
      [{ phone: "12345" }, "phone"],
      [{ phone: "" }, "phone"],
      [{ phone: "+255 712 345 6789" }, "phone"],
      [{ whatsapp: "nope" }, "whatsapp"],
    ]
    for (const [changes, field] of cases) {
      expect(await updateGuardianContact(staff, lead.contact.id, changes), field).toEqual({
        ok: false,
        error: { kind: "invalid", field },
      })
    }
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("a contact shared by siblings changes for every one of them, and each sees it", async () => {
    const first = await walkInLead()
    const second = await walkInLead({ contactId: first.contact.id })
    const third = await walkInLead({ contactId: first.contact.id })
    const digits = nineDigits()

    const children = await listContactChildren(await signedIn(ADMISSIONS), first.contact.id)
    expect(children).toEqual({
      ok: true,
      data: [first, second, third].map((lead) => ({
        id: lead.id,
        admissionNumber: lead.admissionNumber,
        studentName: lead.studentName,
        status: "Visited",
        closure: null,
      })),
    })

    expect((await updateGuardianContact(await signedIn(ADMISSIONS), second.contact.id, { phone: `0${digits}` })).ok).toBe(
      true,
    )
    for (const lead of [first, second, third]) {
      expect((await reread(lead.id)).contact.phone).toBe(`+255${digits}`)
    }
  })

  test("a new number that makes any sibling a duplicate of another family's lead is refused, with that lead", async () => {
    const takenPhone = `0${nineDigits()}`
    const existing = await walkInLead({ contact: contact({ phone: takenPhone }) })

    // A Family whose second child has the same name as the existing lead.
    const first = await walkInLead()
    const second = await walkInLead({ contactId: first.contact.id, student: student({ fullName: existing.studentName }) })
    const staff = await signedIn(ADMISSIONS)

    for (const changes of [{ phone: takenPhone }, { whatsapp: takenPhone }]) {
      expect(await updateGuardianContact(staff, first.contact.id, changes)).toEqual({
        ok: false,
        error: {
          kind: "duplicate",
          lead: { id: existing.id, admissionNumber: existing.admissionNumber, status: "Visited", closure: null },
        },
      })
    }
    expect(await reread(first.id)).toEqual(first)
    expect(await reread(second.id)).toEqual(second)
  })

  test("the duplicate check counts the other family's WhatsApp number and closed leads too", async () => {
    // Another family's lead, reached through its WhatsApp number, and then
    // archived. (Names here never end in "Fixture": the Leads screen tests
    // count the seeded ones.)
    const whatsapp = `0${nineDigits()}`
    const existing = await walkInLead({ contact: contact({ whatsapp }) })
    await asSystem((sql) => sql.query("update public.leads set closure = 'Archived' where id = $1", [existing.id]))

    const lead = await walkInLead({ student: student({ fullName: existing.studentName.toLowerCase() }) })
    const result = await updateGuardianContact(await signedIn(ADMISSIONS), lead.contact.id, { phone: whatsapp })
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: existing.id, admissionNumber: existing.admissionNumber, status: "Visited", closure: "Archived" },
      },
    })
  })

  test("a change is refused when the children on the contact are not the ones the staff member saw", async () => {
    const first = await walkInLead()
    const staff = await signedIn(ADMISSIONS)
    // The form opened with one child; a brother was registered before saving.
    const second = await walkInLead({ contactId: first.contact.id })

    expect(await updateGuardianContact(staff, first.contact.id, { fullName: "Stale" }, [first.id])).toEqual({
      ok: false,
      error: { kind: "children-changed" },
    })
    // A child the form listed who is no longer on the contact counts too.
    expect(
      await updateGuardianContact(staff, first.contact.id, { fullName: "Stale" }, [first.id, second.id, randomUUID()]),
    ).toEqual({ ok: false, error: { kind: "children-changed" } })
    expect((await reread(first.id)).contact.fullName).toBe("Test Parent")

    expect((await updateGuardianContact(staff, first.contact.id, { fullName: "Fresh" }, [second.id, first.id])).ok).toBe(true)
    expect((await reread(second.id)).contact.fullName).toBe("Fresh")
  })

  test("a sibling registered while the contact's number changes is checked against the new number", async () => {
    const takenPhone = `0${nineDigits()}`
    const existing = await walkInLead({ contact: contact({ phone: takenPhone }) })
    const family = await walkInLead()
    const [{ user_id: userId }] = await rows<{ user_id: string }>(
      "select user_id from public.staff_members where id = $1",
      [ADMISSIONS.id],
    )

    // The correction runs in its own transaction, as Admissions Staff, and
    // stays open while the sibling is registered.
    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await sql.connect()
    try {
      await sql.query("begin")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ])
      await sql.query("set local role authenticated")
      await sql.query("select public.update_guardian_contact($1, $2)", [
        family.contact.id,
        JSON.stringify({ phone: takenPhone }),
      ])

      const sibling = createLead(await signedIn(ADMISSIONS), {
        guardian: { contactId: family.contact.id },
        student: student({ fullName: existing.studentName }),
        start: { kind: "walk-in", visitDate: today },
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
      await sql.query("commit")

      expect(await sibling).toEqual({
        ok: false,
        error: {
          kind: "duplicate",
          lead: { id: existing.id, admissionNumber: existing.admissionNumber, status: "Visited", closure: null },
        },
      })
    } finally {
      await sql.query("rollback").catch(() => {})
      await sql.end()
    }
  })

  test("a contact that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await updateGuardianContact(staff, randomUUID(), { fullName: "Nobody" })).toEqual({
      ok: false,
      error: { kind: "not-found" },
    })
  })
})

describe("correcting the Visit date", () => {
  test("sets an earlier date, or today", async () => {
    const lead = await walkInLead()
    const staff = await signedIn(ADMISSIONS)

    expect(await correctVisitDate(staff, lead.id, dayBefore(today, 10))).toEqual({ ok: true, data: null })
    expect(await reread(lead.id)).toEqual({ ...lead, visitDate: dayBefore(today, 10) })

    expect((await correctVisitDate(staff, lead.id, today)).ok).toBe(true)
    expect((await reread(lead.id)).visitDate).toBe(today)
  })

  test("refuses a date later than today in Tanzania", async () => {
    const lead = await walkInLead({ visitDate: dayBefore(today) })
    const tomorrow = await rows<{ day: string }>("select (public.tanzania_today() + 1)::text as day")

    expect(await correctVisitDate(await signedIn(ADMISSIONS), lead.id, tomorrow[0].day)).toEqual({
      ok: false,
      error: { kind: "invalid", field: "visit_date" },
    })
    expect((await reread(lead.id)).visitDate).toBe(dayBefore(today))
  })

  test("an Applied lead has no visit to correct, and closed leads are read-only", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await correctVisitDate(staff, "1ead0000-0000-4000-8000-000000000001", today)).toEqual({
      ok: false,
      error: { kind: "not-visited" },
    })
    expect(await correctVisitDate(staff, "1ead0000-0000-4000-8000-000000000005", today)).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
  })
})

describe("what no correction can change", () => {
  test("the Admission Number and the status stay, even when a call asks for them", async () => {
    const lead = await walkInLead()
    const staff = await signedIn(ADMISSIONS)

    const details = await staff.rpc("update_lead_details", {
      lead_id: lead.id,
      changes: { admission_number: "ADMSN-00000", status: "Enrolled", closure: "Archived", visit_date: "2020-01-01" },
    })
    expect(details.error).toBeNull()
    const contactCall = await staff.rpc("update_guardian_contact", {
      contact_id: lead.contact.id,
      changes: { id: randomUUID(), origin: "admission_form", pending_family_match_id: randomUUID() },
    })
    expect(contactCall.error).toBeNull()

    expect(await reread(lead.id)).toEqual(lead)
    const [stored] = await rows<{ origin: string; pending_family_match_id: string | null }>(
      "select origin::text, pending_family_match_id from public.guardian_contacts where id = $1",
      [lead.contact.id],
    )
    expect(stored).toEqual({ origin: "front_desk", pending_family_match_id: null })
  })
})

describe("who may correct", () => {
  test("an Accountant is refused every correction, and nothing changes", async () => {
    const lead = await walkInLead({ visitDate: dayBefore(today) })
    const accountant = await signedIn(ACCOUNTANT)

    expect(await updateLeadDetails(accountant, lead.id, { className: "KG 1" })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await updateGuardianContact(accountant, lead.contact.id, { fullName: "Changed" })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await correctVisitDate(accountant, lead.id, today)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await reread(lead.id)).toEqual(lead)
  })

  test("leads.edit corrects details and contacts but not the Visit date, and visits.record the other way round", async () => {
    const lead = await walkInLead({ visitDate: dayBefore(today) })
    const editor = await signedIn(await createThrowawayStaff(["leads.view", "leads.edit"]))
    const visits = await signedIn(await createThrowawayStaff(["leads.view", "visits.record"]))

    expect((await updateLeadDetails(editor, lead.id, { className: "KG 1" })).ok).toBe(true)
    expect((await updateGuardianContact(editor, lead.contact.id, { fullName: "Edited Parent" })).ok).toBe(true)
    expect(await correctVisitDate(editor, lead.id, today)).toEqual({ ok: false, error: { kind: "forbidden" } })

    expect(await updateLeadDetails(visits, lead.id, { className: "KG 2" })).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await updateGuardianContact(visits, lead.contact.id, { fullName: "Other" })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect((await correctVisitDate(visits, lead.id, today)).ok).toBe(true)

    expect(await reread(lead.id)).toMatchObject({ className: "KG 1", visitDate: today, contact: { fullName: "Edited Parent" } })
  })

  test("someone signed out, and the secret key, are refused", async () => {
    const lead = await walkInLead()
    for (const client of [anonClient(), secretClient()]) {
      expect((await updateLeadDetails(client, lead.id, { className: "KG 1" })).ok).toBe(false)
      expect((await updateGuardianContact(client, lead.contact.id, { fullName: "X" })).ok).toBe(false)
      expect((await correctVisitDate(client, lead.id, today)).ok).toBe(false)
    }
    expect(await reread(lead.id)).toEqual(lead)
  })
})

describe("history", () => {
  test("each correction is recorded with the staff member, and the old and new values", async () => {
    const lead = await walkInLead({ visitDate: dayBefore(today) })
    const staff = await signedIn(ADMISSIONS)
    await updateLeadDetails(staff, lead.id, { className: "FORM 2" })
    await correctVisitDate(staff, lead.id, dayBefore(today, 2))
    await updateGuardianContact(staff, lead.contact.id, { fullName: "History Parent" })

    const entries = await rows<{ table_name: string; old_values: unknown; new_values: unknown; name: string }>(
      `select a.table_name, a.old_values, a.new_values, s.full_name as name
       from public.audit_log a
       join public.staff_members s on s.id = a.actor_staff_id
       where a.action = 'update' and (a.lead_id = $1 or a.row_id = $2)
       order by a.id`,
      [lead.id, lead.contact.id],
    )
    expect(entries).toEqual([
      { table_name: "leads", old_values: { class_name: "STD 2" }, new_values: { class_name: "FORM 2" }, name: ADMISSIONS.name },
      {
        table_name: "leads",
        old_values: { visit_date: dayBefore(today) },
        new_values: { visit_date: dayBefore(today, 2) },
        name: ADMISSIONS.name,
      },
      {
        table_name: "guardian_contacts",
        old_values: { full_name: "Test Parent" },
        new_values: { full_name: "History Parent" },
        name: ADMISSIONS.name,
      },
    ])
  })
})
