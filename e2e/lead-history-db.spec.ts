import { randomInt, randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory, type LeadHistory } from "@/lib/services/audit"
import { createLead, getLead, updateGuardianContact, updateLeadDetails, type Lead } from "@/lib/services/leads"

import { anonClient, asStaffActor, asSystem, createThrowawayStaff, secretClient, signedIn } from "./db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "./fixtures"

// A lead's history through the audit module, against local Supabase. Each test
// registers its own family with invented names and numbers, and leaves the
// seeded fixtures alone.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead, registered by Admissions Staff. With `contactId`, a sibling
// on that contact.
async function walkInLead(contactId?: string): Promise<Lead> {
  const staff = await signedIn(ADMISSIONS)
  const created = await createLead(staff, {
    guardian: contactId ? { contactId } : { contact: { fullName: "History Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const lead = await getLead(staff, created.data.leadId)
  if (!lead.ok) throw new Error("setup failed: lead missing")
  return lead.data
}

async function historyOf(leadId: string, as = ADMISSIONS): Promise<LeadHistory> {
  const history = await getLeadHistory(await signedIn(as), leadId)
  if (!history.ok) throw new Error(`history refused: ${history.error}`)
  return history.data
}

test.describe("a lead's history", () => {
  test("starts with the creation of the lead and its contact, by the staff member who registered it", async () => {
    const lead = await walkInLead()

    const { entries, contactNames } = await historyOf(lead.id)
    expect(entries.map((e) => [e.record, e.action, e.actor])).toEqual([
      ["lead", "insert", ADMISSIONS.name],
      ["contact", "insert", ADMISSIONS.name],
    ])
    expect(entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "student_name", from: null, to: lead.studentName },
        { field: "status", from: null, to: "Visited" },
        { field: "visit_date", from: null, to: today },
        { field: "guardian_contact_id", from: null, to: lead.contact.id },
      ]),
    )
    expect(entries[1]).toMatchObject({ recordId: lead.contact.id })
    expect(entries[1].changes).toEqual(expect.arrayContaining([{ field: "phone", from: null, to: lead.contact.phone }]))
    expect(contactNames).toEqual({ [lead.contact.id]: "History Parent" })
  })

  test("shows an edit newest first, with each changed field's old and new value", async () => {
    const lead = await walkInLead()
    expect((await updateLeadDetails(await signedIn(MANAGER), lead.id, { className: "STD 3", dayOrBoarding: "Boarding" })).ok).toBe(true)

    const [latest, ...earlier] = (await historyOf(lead.id)).entries
    expect(latest).toMatchObject({ record: "lead", recordId: lead.id, action: "update", actor: MANAGER.name })
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "class_name", from: "STD 2", to: "STD 3" },
        { field: "day_or_boarding", from: "Day", to: "Boarding" },
      ]),
    )
    expect(earlier.map((e) => e.action)).toEqual(["insert", "insert"])
    expect(Date.parse(latest.at)).toBeGreaterThanOrEqual(Date.parse(earlier[0].at))
  })

  test("a change to a contact shared by siblings shows on both siblings' history", async () => {
    const first = await walkInLead()
    const second = await walkInLead(first.contact.id)
    const corrected = await updateGuardianContact(await signedIn(ADMISSIONS), first.contact.id, { fullName: "Renamed Parent" })
    expect(corrected.ok).toBe(true)

    for (const lead of [first, second]) {
      const { entries, contactNames } = await historyOf(lead.id)
      expect(entries[0]).toMatchObject({ record: "contact", recordId: first.contact.id, action: "update", actor: ADMISSIONS.name })
      expect(entries[0].changes).toEqual([{ field: "full_name", from: "History Parent", to: "Renamed Parent" }])
      expect(contactNames[first.contact.id]).toBe("Renamed Parent")
    }
  })

  test("keeps showing a contact the lead was linked to before it was separated", async () => {
    const lead = await walkInLead()
    const before = lead.contact.id
    await updateGuardianContact(await signedIn(ADMISSIONS), before, { fullName: "Earlier Parent" })

    // A separation as the lead module will make it: a copy of the contact,
    // and the lead moved onto it.
    const after = await asStaffActor(MANAGER.id, async (sql) => {
      const copy = await sql.query<{ id: string }>(
        `insert into public.guardian_contacts (full_name, relationship, phone, origin)
         select full_name, relationship, phone, origin from public.guardian_contacts where id = $1
         returning id`,
        [before],
      )
      await sql.query("update public.leads set guardian_contact_id = $2 where id = $1", [lead.id, copy.rows[0].id])
      return copy.rows[0].id
    })

    // The lead's own history of its contact link still names the old
    // contact, so the old contact's entries stay on the lead's history.
    const { entries, contactNames } = await historyOf(lead.id)
    expect(entries.map((e) => [e.record, e.recordId, e.action])).toEqual([
      ["lead", lead.id, "update"],
      ["contact", after, "insert"],
      ["contact", before, "update"],
      ["lead", lead.id, "insert"],
      ["contact", before, "insert"],
    ])
    expect(entries[0].changes).toEqual([{ field: "guardian_contact_id", from: before, to: after }])
    expect(contactNames).toEqual({ [before]: "Earlier Parent", [after]: "Earlier Parent" })
  })

  test("names a staff member who has since been deactivated", async () => {
    const lead = await walkInLead()
    await asStaffActor(DEACTIVATED.id, (sql) =>
      sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead.id, thisYear + 2]),
    )

    const [latest] = (await historyOf(lead.id)).entries
    expect(latest).toMatchObject({ action: "update", actor: DEACTIVATED.name })
    expect(latest.changes).toEqual([{ field: "enrollment_year", from: thisYear + 1, to: thisYear + 2 }])
  })

  test("names the Admission form as the actor of a lead it created", async () => {
    const created = await createLead(secretClient(), {
      guardian: { contact: { fullName: "Form Parent", relationship: "Father", phone: phone() } },
      student: { fullName: `Applicant ${randomUUID().slice(0, 8)}`, className: "KG 1", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "admission-form" },
    })
    if (!created.ok) throw new Error("setup failed")

    const { entries } = await historyOf(created.data.leadId)
    expect(entries.map((e) => e.actor)).toEqual(["Admission form", "Admission form"])
  })

  test("reads a field or an action kind it does not know, under its raw name", async () => {
    const lead = await walkInLead()
    // What a later slice might write: an action event of a new kind, with
    // details this slice has never heard of.
    await asSystem((sql) =>
      sql.query(
        `insert into public.audit_log (lead_id, action, new_values, scope, actor_kind)
         values ($1, 'interview_booked', '{"slot": "morning", "room": 4}', 'lead', 'system')`,
        [lead.id],
      ),
    )

    const [latest] = (await historyOf(lead.id)).entries
    expect(latest).toMatchObject({ record: null, recordId: null, action: "interview_booked", actor: "System" })
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "slot", from: null, to: "morning" },
        { field: "room", from: null, to: 4 },
      ]),
    )
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getLeadHistory(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await getLeadHistory(staff, "not-a-uuid")).toEqual({ ok: false, error: "not-found" })
  })
})

test.describe("who may read a lead's history", () => {
  test("the Accountant may, as anyone who may view leads", async () => {
    const lead = await walkInLead()
    expect((await historyOf(lead.id, ACCOUNTANT)).entries).toHaveLength(2)
  })

  test("a role that may not view leads is refused", async () => {
    const lead = await walkInLead()
    const outsider = await createThrowawayStaff(["payments.view"])
    expect(await getLeadHistory(await signedIn(outsider), lead.id)).toEqual({ ok: false, error: "forbidden" })
  })

  test("visitors who are not signed in are refused", async () => {
    const lead = await walkInLead()
    expect(await getLeadHistory(anonClient(), lead.id)).toEqual({ ok: false, error: "forbidden" })
  })
})
