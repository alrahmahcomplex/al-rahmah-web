import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm, AdmissionParent } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { getLeadsByClass } from "@/lib/services/dashboard"
import { getLead } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  lockExclusively,
  secretClient,
  signedIn,
  unusedAdmissionNumber,
} from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// Re-applications (#76): an Admission form child who is already on file,
// against local Supabase. Each test makes its own leads, with invented names
// and numbers clear of the seeded +255 700 000 xxx fixtures, so recording a
// re-application never flags a seeded lead.

const [, nextYear] = admissionYears()

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// The +255 form the database stores a 07... number as.
const stored = (local: string) => `+255${local.slice(1)}`

type Status = "Applied" | "Visited" | "Interviewed" | "Enrolled" | "Declined"
type Closure = "Inactive" | "Archived" | null

type OnFile = {
  id: string
  admissionNumber: string
  studentName: string
  parent: AdmissionParent
}

// A lead already on file, written straight into the database as the system
// actor, in any status and closure mark: Visited, Mother, STD 3, Day.
async function onFile(status: Status = "Visited", closure: Closure = null): Promise<OnFile> {
  const parent: AdmissionParent = { fullName: "Mama Marudio", relationship: "Mother", phone: phone() }
  const studentName = `Mtoto Marudio ${randomUUID().slice(0, 8)}`
  const admissionNumber = await unusedAdmissionNumber()
  const id = await asSystem(async (sql) => {
    const contact = await sql.query<{ id: string }>(
      `insert into public.guardian_contacts (full_name, relationship, phone, origin)
       values ($1, 'Mother', $2, 'admission_form') returning id`,
      [parent.fullName, stored(parent.phone)],
    )
    const lead = await sql.query<{ id: string }>(
      `insert into public.leads (
         admission_number, student_name, class_name, enrollment_year, day_or_boarding,
         status, closure, closure_reason, visit_date, guardian_contact_id, declined_reason, status_before_decline
       ) values ($1, $2, 'STD 3', $3, 'Day', $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        admissionNumber,
        studentName,
        nextYear,
        status,
        closure,
        // A closure mark always carries its reason (#98).
        closure === null ? null : "No longer pursuing admission",
        status === "Applied" ? null : "2026-09-01",
        contact.rows[0].id,
        status === "Declined" ? "Family changed plans" : null,
        status === "Declined" ? "Visited" : null,
      ],
    )
    return lead.rows[0].id
  })
  return { id, admissionNumber, studentName, parent }
}

// The same child as `lead`, as a parent would send it again.
function sameChild(lead: OnFile, overrides: Partial<AdmissionChild> = {}): AdmissionChild {
  return { fullName: lead.studentName, className: "STD 3", enrollmentYear: nextYear, dayOrBoarding: "Day", ...overrides }
}

function newChild(): AdmissionChild {
  return { fullName: `Mtoto Mpya ${randomUUID().slice(0, 8)}`, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Boarding" }
}

function form(parent: AdmissionParent, children: AdmissionChild[]): AdmissionForm {
  return { submissionKey: randomUUID(), parent, children }
}

// The lead's row as the database owner sees it.
async function leadRow(id: string): Promise<Record<string, unknown>> {
  return inRolledBackTransaction(async (sql) => (await sql.query("select * from public.leads where id = $1", [id])).rows[0])
}

async function reApplications(leadId: string): Promise<Record<string, unknown>[]> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select * from public.re_applications where lead_id = $1 order by received_at", [leadId])).rows,
  )
}

async function leadsNamed(name: string): Promise<{ id: string }[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query("select id from public.leads where student_name = $1", [name])).rows)
}

describe("a child already on file", () => {
  const marks: [Status, Closure][] = [
    ["Applied", null],
    ["Visited", null],
    ["Interviewed", null],
    ["Enrolled", null],
    ["Declined", null],
    ["Visited", "Inactive"],
    ["Visited", "Archived"],
  ]

  for (const [status, closure] of marks) {
    test(`is recorded as a re-application on a ${closure ?? status} lead, which keeps its details`, async () => {
      const lead = await onFile(status, closure)
      const before = await leadRow(lead.id)

      // Same child and phone; a new class, a new parent name and a WhatsApp number.
      const whatsapp = phone()
      const sent = form({ ...lead.parent, fullName: "Mama M. Marudio", whatsapp }, [sameChild(lead, { className: "STD 4" })])
      const result = await submitAdmissionForm(secretClient(), sent)
      expect(result).toEqual({ ok: true, data: [{ fullName: lead.studentName, admissionNumber: lead.admissionNumber }] })

      const after = await leadRow(lead.id)
      expect(after).toEqual({ ...before, returning_family_reapplied: true })
      expect(await leadsNamed(lead.studentName)).toHaveLength(1)

      const [row, ...more] = await reApplications(lead.id)
      expect(more).toHaveLength(0)
      expect(row).toMatchObject({
        submission_key: sent.submissionKey,
        contact_name: "Mama M. Marudio",
        relationship: "Mother",
        relationship_description: null,
        phone_as_sent: lead.parent.phone,
        phone: stored(lead.parent.phone),
        whatsapp_as_sent: whatsapp,
        whatsapp: stored(whatsapp),
        student_name: lead.studentName,
        class_name: "STD 4",
        enrollment_year: nextYear,
        day_or_boarding: "Day",
        differing_fields: ["class_name", "contact_name", "whatsapp"],
        reviewed_at: null,
        reviewed_by: null,
      })
    })
  }

  test("sent exactly as on file differs in nothing", async () => {
    const lead = await onFile()
    const result = await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))
    expect(result.ok).toBe(true)
    const [row] = await reApplications(lead.id)
    expect(row.differing_fields).toEqual([])
  })

  test("names every field that differs, matched on the parent's WhatsApp number", async () => {
    const lead = await onFile()
    // The parent's old phone is now their WhatsApp; the name is spelt in a new
    // case but spaced the same once trimmed.
    const sent = form(
      { fullName: "Bibi Marudio", relationship: "Other", relationshipDescription: "Grandmother", phone: phone(), whatsapp: lead.parent.phone },
      [sameChild(lead, { fullName: `  ${lead.studentName.toUpperCase()}  `, enrollmentYear: 2031, dayOrBoarding: "Boarding" })],
    )
    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok && result.data[0].admissionNumber).toBe(lead.admissionNumber)

    const [row] = await reApplications(lead.id)
    expect(row.differing_fields).toEqual([
      "student_name",
      "enrollment_year",
      "day_or_boarding",
      "contact_name",
      "relationship",
      "relationship_description",
      "phone",
      "whatsapp",
    ])
    expect(row.relationship_description).toBe("Grandmother")
  })

  test("shows the Returning family badge when the re-application is its only cause", async () => {
    const lead = await onFile()
    const staff = await signedIn(ADMISSIONS)
    const before = await getLead(staff, lead.id)
    expect(before.ok && before.data.returningFamily).toBe(false)

    expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))).ok).toBe(true)

    const read = await getLead(staff, lead.id)
    expect(read.ok && read.data.returningFamily).toBe(true)
    const row = await leadRow(lead.id)
    expect(row).toMatchObject({ returning_family_joined: false, returning_family_reapplied: true })
  })

  test("a second re-application keeps the cause and records its own row", async () => {
    const lead = await onFile()
    for (let i = 0; i < 2; i++) {
      expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))).ok).toBe(true)
    }
    expect(await reApplications(lead.id)).toHaveLength(2)
    expect((await leadRow(lead.id)).returning_family_reapplied).toBe(true)
  })
})

describe("a form with new and matched children", () => {
  test("creates the new ones and records the matched ones, in form order", async () => {
    const lead = await onFile()
    const fresh = newChild()
    const later = newChild()
    const sent = form(lead.parent, [fresh, sameChild(lead), later])

    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((c) => c.fullName)).toEqual([fresh.fullName, lead.studentName, later.fullName])
    expect(result.data[1].admissionNumber).toBe(lead.admissionNumber)
    expect(result.data[0].admissionNumber).not.toBe(lead.admissionNumber)
    expect(result.data[2].admissionNumber).not.toBe(result.data[0].admissionNumber)

    expect(await leadsNamed(fresh.fullName)).toHaveLength(1)
    expect(await leadsNamed(later.fullName)).toHaveLength(1)
    expect(await leadsNamed(lead.studentName)).toHaveLength(1)
    expect(await reApplications(lead.id)).toHaveLength(1)

    // The new siblings share the contact the first of them made.
    const staff = await signedIn(ADMISSIONS)
    const [a] = await leadsNamed(fresh.fullName)
    const [b] = await leadsNamed(later.fullName)
    const first = await getLead(staff, a.id)
    const second = await getLead(staff, b.id)
    expect(first.ok && second.ok && first.data.contact.id === second.data.contact.id).toBe(true)
  })

  test("a matched child first leaves the new one its own contact", async () => {
    const lead = await onFile()
    const fresh = newChild()
    const result = await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead), fresh]))
    expect(result.ok && result.data.map((c) => c.admissionNumber)[0]).toBe(lead.admissionNumber)
    const [made] = await leadsNamed(fresh.fullName)
    expect(made).toBeDefined()
    expect(await reApplications(lead.id)).toHaveLength(1)
  })
})

describe("sending the same form again", () => {
  test("with the same key and payload replays the confirmation and records nothing more", async () => {
    const lead = await onFile()
    const sent = form(lead.parent, [sameChild(lead), newChild()])
    const first = await submitAdmissionForm(secretClient(), sent)
    const second = await submitAdmissionForm(secretClient(), sent)
    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect(await reApplications(lead.id)).toHaveLength(1)
  })

  test("twice at once records one re-application", async () => {
    const lead = await onFile()
    const sent = form(lead.parent, [sameChild(lead)])
    const [a, b] = await Promise.all([submitAdmissionForm(secretClient(), sent), submitAdmissionForm(secretClient(), sent)])
    expect(a.ok).toBe(true)
    expect(b).toEqual(a)
    expect(await reApplications(lead.id)).toHaveLength(1)
  })

  test("edited, after a re-application, gets it back as already sent and writes nothing", async () => {
    const lead = await onFile()
    const sent = form(lead.parent, [sameChild(lead)])
    const first = await submitAdmissionForm(secretClient(), sent)
    if (!first.ok) throw new Error("setup failed")

    const edited = { ...sent, children: [sameChild(lead, { className: "STD 5" }), newChild()] }
    expect(await submitAdmissionForm(secretClient(), edited)).toEqual({
      ok: false,
      error: { kind: "already-sent", children: first.data, complete: true },
    })
    expect(await reApplications(lead.id)).toHaveLength(1)
    expect(await leadsNamed(edited.children[1].fullName)).toHaveLength(0)
  })

  test("with a new child the earlier send created never turns it into a re-application of itself", async () => {
    const parent: AdmissionParent = { fullName: "Mama Mpya", relationship: "Mother", phone: phone() }
    const sent = form(parent, [newChild()])
    const first = await submitAdmissionForm(secretClient(), sent)
    expect(await submitAdmissionForm(secretClient(), sent)).toEqual(first)
    const [made] = await leadsNamed(sent.children[0].fullName)
    expect(await reApplications(made.id)).toHaveLength(0)
    expect((await leadRow(made.id)).returning_family_reapplied).toBe(false)
  })
})

describe("the re-application in the lead's history", () => {
  test("shows with actor Admission form, with the re-applied cause", async () => {
    const lead = await onFile()
    expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead, { className: "STD 4" })]))).ok).toBe(true)

    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead.id)
    if (!history.ok) throw new Error(history.error)
    const [flag, recorded] = history.data.entries
    expect([recorded.record, recorded.action, recorded.actor]).toEqual(["re_applications", "insert", "Admission form"])
    expect(recorded.changes).toContainEqual({ field: "differing_fields", from: null, to: ["class_name"] })
    expect([flag.record, flag.action, flag.actor]).toEqual(["lead", "update", "Admission form"])
    expect(flag.changes).toEqual([{ field: "returning_family_reapplied", from: false, to: true }])
  })
})

describe("who may read and write re-applications", () => {
  test("anon reads nothing; staff who may view leads read them; staff who may not read nothing", async () => {
    const lead = await onFile()
    expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))).ok).toBe(true)

    const anon = await anonClient().from("re_applications").select("id").eq("lead_id", lead.id)
    expect(anon.data ?? []).toHaveLength(0)

    const staff = await (await signedIn(ADMISSIONS)).from("re_applications").select("id, differing_fields").eq("lead_id", lead.id)
    expect(staff.error).toBeNull()
    expect(staff.data).toHaveLength(1)

    const outsider = await createThrowawayStaff([])
    const none = await (await signedIn(outsider)).from("re_applications").select("id").eq("lead_id", lead.id)
    expect(none.data ?? []).toHaveLength(0)
  })

  test("nobody writes them through the API, the secret key included", async () => {
    const lead = await onFile()
    expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))).ok).toBe(true)
    const [row] = await reApplications(lead.id)

    for (const client of [anonClient(), await signedIn(MANAGER), secretClient()]) {
      await client.from("re_applications").update({ class_name: "FORM 4" }).eq("id", row.id)
      await client.from("re_applications").delete().eq("id", row.id)
      const inserted = await client.from("re_applications").insert({ ...row, id: randomUUID(), submission_key: randomUUID() })
      expect(inserted.error).not.toBeNull()
    }
    expect(await reApplications(lead.id)).toEqual([row])
  })

  test("deletes are refused, even to the database owner", async () => {
    const lead = await onFile()
    expect((await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)]))).ok).toBe(true)
    const message = await inRolledBackTransaction(async (sql) => {
      try {
        await sql.query("delete from public.re_applications where lead_id = $1", [lead.id])
        return null
      } catch (error) {
        return (error as Error).message
      }
    })
    expect(message).not.toBeNull()
    expect(await reApplications(lead.id)).toHaveLength(1)
  })

  test("record_re_application is refused to staff and anon", async () => {
    const lead = await onFile()
    const submitted = {
      contact: { full_name: "Mama Marudio", relationship: "Mother", phone: lead.parent.phone },
      student: { full_name: lead.studentName, class_name: "STD 3", enrollment_year: nextYear, day_or_boarding: "Day" },
    }
    for (const client of [anonClient(), await signedIn(ADMISSIONS), await signedIn(MANAGER)]) {
      const { error } = await client.rpc("record_re_application", { lead_id: lead.id, submission_key: randomUUID(), submitted })
      expect(error?.code).toBe("42501")
    }
    expect(await reApplications(lead.id)).toHaveLength(0)
  })

  test("record_re_application records once per lead and submission key", async () => {
    const lead = await onFile()
    const key = randomUUID()
    const submitted = {
      contact: { full_name: "Mama Marudio", relationship: "Mother", phone: lead.parent.phone },
      student: { full_name: lead.studentName, class_name: "STD 3", enrollment_year: nextYear, day_or_boarding: "Day" },
    }
    const first = await secretClient().rpc("record_re_application", { lead_id: lead.id, submission_key: key, submitted })
    const second = await secretClient().rpc("record_re_application", { lead_id: lead.id, submission_key: key, submitted })
    expect(first.error).toBeNull()
    expect(second.data).toBe(first.data)
    expect(await reApplications(lead.id)).toHaveLength(1)

    const refused = await secretClient().rpc("record_re_application", {
      lead_id: lead.id,
      submission_key: randomUUID(),
      submitted: { ...submitted, contact: { ...submitted.contact, phone: "12345" } },
    })
    expect(refused.error?.message).toBe("invalid")
    expect(JSON.parse(refused.error?.details ?? "{}")).toEqual({ field: "phone" })
  })
})

describe("the closed lead guard's re-application path", () => {
  test("lets a closed lead take the re-applied cause and nothing else", async () => {
    const lead = await onFile("Visited", "Archived")
    const answers = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const attempt = async (statement: string) => {
        await sql.query("savepoint each")
        try {
          await sql.query("select public.set_lead_lifecycle_override('re_application')")
          await sql.query(statement, [lead.id])
          return null
        } catch (error) {
          return (error as Error).message
        } finally {
          await sql.query("rollback to savepoint each")
        }
      }
      return {
        flag: await attempt("update public.leads set returning_family_reapplied = true where id = $1"),
        flagAndClass: await attempt("update public.leads set returning_family_reapplied = true, class_name = 'STD 1' where id = $1"),
        reopen: await attempt("update public.leads set closure = null where id = $1"),
        unflag: await attempt("update public.leads set returning_family_reapplied = false where id = $1"),
      }
    })
    expect(answers).toEqual({ flag: null, flagAndClass: "lead_closed", reopen: "lead_closed", unflag: "lead_closed" })
  })
})

describe("Leads by enrollment class", () => {
  test("a 2031 re-application adds nothing to the dashboard", async () => {
    const manager = await signedIn(MANAGER)
    const today = { kind: "date" as const, anchor: tanzaniaToday() }
    const count = async () => {
      const result = await getLeadsByClass(manager, { period: today, enrollmentYear: 2031 })
      if (!result.ok) throw new Error(result.error)
      return result.data
    }
    const lead = await onFile()
    const before = await count()
    const result = await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead, { enrollmentYear: 2031 })]))
    expect(result.ok).toBe(true)
    expect(await count()).toEqual(before)
  })

  test("the seeded 2031 re-application is not counted", async () => {
    const manager = await signedIn(MANAGER)
    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.leads"])
      const seeded = await sql.query("select 1 from public.re_applications where enrollment_year = 2031")
      expect(seeded.rowCount).toBeGreaterThan(0)
      const leads = await sql.query<{ count: string }>("select count(*) from public.leads where enrollment_year = 2031")
      const counted = await getLeadsByClass(manager, { period: { kind: "all" }, enrollmentYear: 2031 })
      expect(counted.ok && counted.data.total).toBe(Number(leads.rows[0].count))
    })
  })
})

describe("the seeded re-applications", () => {
  test("one unreviewed, one reviewed, and one on the seeded Archived lead", async () => {
    const rows = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query(
          `select l.admission_number, l.closure, l.returning_family_reapplied, r.reviewed_at is not null as reviewed
           from public.re_applications r join public.leads l on l.id = r.lead_id
           where l.admission_number in ('ADMSN-90301', 'ADMSN-90302', 'ADMSN-90005')
             -- The seed's own, by their submission keys: the review tests
             -- (#77) add more on the Archived lead.
             and r.submission_key::text like 'f0f0f0f0-%'
           order by l.admission_number`,
        )
      ).rows,
    )
    expect(rows).toEqual([
      { admission_number: "ADMSN-90005", closure: "Archived", returning_family_reapplied: true, reviewed: false },
      { admission_number: "ADMSN-90301", closure: null, returning_family_reapplied: true, reviewed: false },
      { admission_number: "ADMSN-90302", closure: null, returning_family_reapplied: true, reviewed: true },
    ])
  })
})
