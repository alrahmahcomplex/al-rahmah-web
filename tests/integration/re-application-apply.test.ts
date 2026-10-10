import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import { getLead } from "@/lib/services/leads"
import { applyReApplicationField } from "@/lib/services/re-application-apply"

import { asSystem, createThrowawayStaff, secretClient, signedIn, unusedAdmissionNumber } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Apply on a Re-application (#78), against local Supabase: it writes what the
// family sent through the lead module's corrections. Each test records a lead
// and a re-application of its own, with invented names and numbers clear of
// the seeded +255 700 000 xxx fixtures.

const [, nextYear] = admissionYears()

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

const international = (local: string) => `+255${local.slice(1)}`

type Lead = { id: string; contactId: string; studentName: string; phone: string }

// A lead on file, Visited, Mother, STD 3, Day, written as the system actor.
async function onFile(closure: "Archived" | null = null): Promise<Lead> {
  const studentName = `Mtoto Linganisha ${randomUUID().slice(0, 8)}`
  const local = phone()
  const admissionNumber = await unusedAdmissionNumber()
  return asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin)
       values ('Mama Linganisha', 'Mother', $1, 'admission_form') returning id`,
      [international(local)],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (
         admission_number, student_name, class_name, enrollment_year, day_or_boarding,
         status, closure, closure_reason, visit_date, guardian_contact_id
       ) values ($1, $2, 'STD 3', $3, 'Day', 'Visited', $4, $5, '2026-09-01', $6) returning id`,
      [admissionNumber, studentName, nextYear, closure, closure ? "No longer pursuing admission" : null, contact.rows[0].id],
    )
    return { id: lead.rows[0].id, contactId: contact.rows[0].id, studentName, phone: local }
  })
}

// The Admission form sending the child again, asking for STD 4 from a new
// phone number: the class and the phone differ.
async function reApply(lead: Lead, newPhone: string): Promise<string> {
  const { data, error } = await secretClient().rpc("record_re_application", {
    lead_id: lead.id,
    submission_key: randomUUID(),
    submitted: {
      contact: { full_name: "Mama Linganisha", relationship: "Mother", phone: newPhone },
      student: { full_name: lead.studentName, class_name: "STD 4", enrollment_year: nextYear, day_or_boarding: "Day" },
    },
  })
  if (error) throw new Error(`could not record a re-application: ${error.message}`)
  return data as string
}

async function stored(leadId: string) {
  const read = await getLead(await signedIn(MANAGER), leadId)
  if (!read.ok) throw new Error(read.error)
  return read.data
}

describe("Apply on a re-application", () => {
  test("writes the class sent to the lead, as the staff member's edit in its history", async () => {
    const lead = await onFile()
    const id = await reApply(lead, phone())

    expect(await applyReApplicationField(await signedIn(ADMISSIONS), id, "class_name")).toEqual({ ok: true, data: null })

    const now = await stored(lead.id)
    expect(now.className).toBe("STD 4")
    expect(now.contact.phone).toBe(international(lead.phone))
    const history = await getLeadHistory(await signedIn(MANAGER), lead.id)
    if (!history.ok) throw new Error(history.error)
    const [edit] = history.data.entries
    expect(edit).toMatchObject({ actor: ADMISSIONS.name, record: "lead", recordId: lead.id, action: "update" })
    expect(edit.changes).toEqual([{ field: "class_name", from: "STD 3", to: "STD 4" }])
  })

  test("writes the phone sent to the contact, as the staff member's edit in its history", async () => {
    const lead = await onFile()
    const sentPhone = phone()
    const id = await reApply(lead, sentPhone)

    expect(await applyReApplicationField(await signedIn(MANAGER), id, "phone", [lead.id])).toEqual({ ok: true, data: null })

    const now = await stored(lead.id)
    expect(now.contact.phone).toBe(international(sentPhone))
    expect(now.className).toBe("STD 3")
    const history = await getLeadHistory(await signedIn(MANAGER), lead.id)
    if (!history.ok) throw new Error(history.error)
    const [edit] = history.data.entries
    expect(edit).toMatchObject({ actor: MANAGER.name, record: "contact", recordId: lead.contactId, action: "update" })
    expect(edit.changes).toEqual([{ field: "phone", from: international(lead.phone), to: international(sentPhone) }])
  })

  test("is refused on a closed lead, and changes nothing", async () => {
    const lead = await onFile("Archived")
    const id = await reApply(lead, phone())
    const staff = await signedIn(ADMISSIONS)

    for (const field of ["class_name", "phone"] as const) {
      expect(await applyReApplicationField(staff, id, field)).toEqual({ ok: false, error: { kind: "closed" } })
    }
    const now = await stored(lead.id)
    expect(now.className).toBe("STD 3")
    expect(now.contact.phone).toBe(international(lead.phone))
  })

  test("is refused on a closed lead whose contact an open sibling still holds", async () => {
    const lead = await onFile("Archived")
    const siblingNumber = await unusedAdmissionNumber()
    await asSystem((sql) =>
      sql.query(
        `insert into public.leads (
           admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, guardian_contact_id
         ) values ($1, $2, 'KG 1', $3, 'Day', 'Applied', $4)`,
        [siblingNumber, `Ndugu Linganisha ${randomUUID().slice(0, 8)}`, nextYear, lead.contactId],
      ),
    )
    const id = await reApply(lead, phone())

    expect(await applyReApplicationField(await signedIn(ADMISSIONS), id, "phone")).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
    expect((await stored(lead.id)).contact.phone).toBe(international(lead.phone))
  })

  test("needs leads.edit: the Accountant and staff with leads.view alone are refused", async () => {
    const lead = await onFile()
    const id = await reApply(lead, phone())
    const viewer = await createThrowawayStaff(["leads.view"])

    for (const client of [await signedIn(ACCOUNTANT), await signedIn(viewer)]) {
      for (const field of ["class_name", "phone"] as const) {
        expect(await applyReApplicationField(client, id, field)).toEqual({ ok: false, error: { kind: "forbidden" } })
      }
    }
    const now = await stored(lead.id)
    expect(now.className).toBe("STD 3")
    expect(now.contact.phone).toBe(international(lead.phone))
  })

  test("applies only a field that differed on arrival", async () => {
    const lead = await onFile()
    const id = await reApply(lead, phone())
    expect(await applyReApplicationField(await signedIn(ADMISSIONS), id, "student_name")).toEqual({
      ok: false,
      error: { kind: "not-differing" },
    })
  })

  test("a contact change is refused once the children it reaches differ from the ones shown", async () => {
    const lead = await onFile()
    const id = await reApply(lead, phone())
    expect(await applyReApplicationField(await signedIn(ADMISSIONS), id, "phone", [lead.id, randomUUID()])).toEqual({
      ok: false,
      error: { kind: "children-changed" },
    })
  })

  test("a re-application that doesn't exist, or a malformed id, is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect(await applyReApplicationField(staff, id, "class_name")).toEqual({ ok: false, error: { kind: "not-found" } })
    }
  })
})
