import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm, AdmissionParent } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createLead, getLead, getLeadFamily } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, SUPER_ADMIN } from "../support/fixtures"

// The admission-form service against local Supabase, with the secret key the
// Server Action holds, read back as seeded staff. Each test invents its own
// names and numbers, clear of the seeded +255 700 000 xxx fixtures.

const [thisYear, nextYear] = admissionYears()

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function parent(overrides: Partial<AdmissionParent> = {}): AdmissionParent {
  return { fullName: "Form Parent", relationship: "Mother", phone: phone(), ...overrides }
}

function child(overrides: Partial<AdmissionChild> = {}): AdmissionChild {
  return { fullName: `Form Pupil ${randomUUID().slice(0, 8)}`, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Boarding", ...overrides }
}

function form(overrides: Partial<AdmissionForm> = {}): AdmissionForm {
  return { submissionKey: randomUUID(), parent: parent(), children: [child()], ...overrides }
}

// The leads holding a student name, read as the database owner.
async function leadsNamed(name: string): Promise<{ id: string }[]> {
  return inRolledBackTransaction(async (sql) =>
    (await sql.query("select id from public.leads where student_name = $1", [name])).rows,
  )
}

async function submissionRows(key: string) {
  return inRolledBackTransaction(async (sql) =>
    (await sql.query("select * from public.admission_submissions where submission_key = $1", [key])).rows,
  )
}

describe("the Admission form service", () => {
  test("creates one child as an Applied lead with its Admission Number, on a new contact", async () => {
    const sent = form({ parent: parent({ whatsapp: phone() }), children: [child({ enrollmentYear: thisYear })] })

    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [outcome] = result.data
    expect(result.data).toHaveLength(1)
    expect(outcome.fullName).toBe(sent.children[0].fullName)
    expect(outcome.admissionNumber).toMatch(/^ADMSN-\d{5}$/)

    const [item] = await leadsNamed(sent.children[0].fullName)
    const staff = await signedIn(ADMISSIONS)
    const lead = await getLead(staff, item.id)
    expect(lead.ok && lead.data).toMatchObject({
      admissionNumber: outcome.admissionNumber,
      studentName: sent.children[0].fullName,
      className: "KG 2",
      enrollmentYear: thisYear,
      dayOrBoarding: "Boarding",
      status: "Applied",
      closure: null,
      visitDate: null,
      returningFamily: false,
      contact: { fullName: "Form Parent", relationship: "Mother" },
    })
  })

  test("records the creation in the lead's history with actor Admission form", async () => {
    const sent = form()
    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)

    const [item] = await leadsNamed(sent.children[0].fullName)
    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), item.id)
    expect(history.ok && history.data.entries.map((e) => [e.record, e.action, e.actor])).toEqual([
      ["lead", "insert", "Admission form"],
      ["contact", "insert", "Admission form"],
    ])
  })

  test("the same key and payload twice create one lead and return the same number", async () => {
    const sent = form()
    const first = await submitAdmissionForm(secretClient(), sent)
    const second = await submitAdmissionForm(secretClient(), sent)

    expect(first.ok && second.ok).toBe(true)
    expect(second).toEqual(first)
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
  })

  test("two sends of the same form at once still create one lead", async () => {
    const sent = form()
    const [a, b] = await Promise.all([submitAdmissionForm(secretClient(), sent), submitAdmissionForm(secretClient(), sent)])

    expect(a.ok && b.ok).toBe(true)
    expect(b).toEqual(a)
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
  })

  test("the same key with a different payload gets the earlier send's children back and creates nothing", async () => {
    const sent = form()
    const first = await submitAdmissionForm(secretClient(), sent)
    if (!first.ok) throw new Error("setup failed")

    const changed = { ...sent, children: [child()] }
    expect(await submitAdmissionForm(secretClient(), changed)).toEqual({
      ok: false,
      error: { kind: "already-sent", children: first.data, complete: true },
    })
    expect(await leadsNamed(changed.children[0].fullName)).toHaveLength(0)
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
  })

  test("an edited retry after an unseen confirmation recovers the saved number and never makes a second lead", async () => {
    // The first send saved the lead, but the parent never saw the answer. They
    // change the phone and the child's name, then send again with the same key.
    const sent = form()
    const first = await submitAdmissionForm(secretClient(), sent)
    if (!first.ok) throw new Error("setup failed")

    const edited = { ...sent, parent: parent(), children: [child()] }
    for (const attempt of [edited, edited, sent]) {
      const again = await submitAdmissionForm(secretClient(), attempt)
      const recovered = again.ok ? again.data : again.error.kind === "already-sent" ? again.error.children : null
      expect(recovered).toEqual(first.data)
    }
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
    expect(await leadsNamed(edited.children[0].fullName)).toHaveLength(0)
  })

  test("an edited retry after a send that created only some children says so", async () => {
    // The second child's year is out of range, so the first send stops after
    // creating the first child. The parent fixes the year and sends again.
    const sent = form({ children: [child(), child({ enrollmentYear: 1999 })] })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(false)
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)

    const edited = { ...sent, children: [sent.children[0], { ...sent.children[1], enrollmentYear: nextYear }] }
    const again = await submitAdmissionForm(secretClient(), edited)
    expect(again.ok).toBe(false)
    if (again.ok || again.error.kind !== "already-sent") throw new Error(`expected already-sent, got ${JSON.stringify(again)}`)
    expect(again.error.complete).toBe(false)
    expect(again.error.children.map((c) => c.fullName)).toEqual([sent.children[0].fullName])
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
    expect(await leadsNamed(sent.children[1].fullName)).toHaveLength(0)
  })

  test("a key that created nothing moves to the edited payload", async () => {
    const sent = form({ parent: parent({ phone: "12345" }) })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(false)

    const fixed = { ...sent, parent: parent() }
    const second = await submitAdmissionForm(secretClient(), fixed)
    expect(second.ok).toBe(true)
    expect(await leadsNamed(fixed.children[0].fullName)).toHaveLength(1)
  })

  test("a phone the database can't read writes nothing, not even the submission", async () => {
    const sent = form({ parent: parent({ phone: "12345" }) })

    expect(await submitAdmissionForm(secretClient(), sent)).toEqual({
      ok: false,
      error: { kind: "invalid", field: "phone", child: null },
    })
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(0)
    expect(await submissionRows(sent.submissionKey)).toHaveLength(0)
  })

  test("children on one form share one parent contact", async () => {
    const sent = form({ children: [child(), child({ className: "STD 5", dayOrBoarding: "Day" })] })

    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok && result.data.map((c) => c.fullName)).toEqual(sent.children.map((c) => c.fullName))

    const staff = await signedIn(ADMISSIONS)
    const [first] = await leadsNamed(sent.children[0].fullName)
    const [second] = await leadsNamed(sent.children[1].fullName)
    const a = await getLead(staff, first.id)
    const b = await getLead(staff, second.id)
    expect(a.ok && b.ok && a.data.contact.id === b.data.contact.id).toBe(true)
  })

  test("the same child twice, past the form's own check, is refused on the second card", async () => {
    const twin = child()
    const sent = form({ children: [twin, { ...twin, fullName: twin.fullName.toUpperCase() }] })

    expect(await submitAdmissionForm(secretClient(), sent)).toEqual({
      ok: false,
      error: { kind: "invalid", field: "duplicate_child", child: 1 },
    })
    expect(await leadsNamed(twin.fullName)).toHaveLength(1)
  })

  test("a child already on file gets the same confirmation with its existing number, and no second lead", async () => {
    const sent = form()
    const first = await submitAdmissionForm(secretClient(), sent)
    expect(first.ok).toBe(true)

    const again = { ...sent, submissionKey: randomUUID() }
    expect(await submitAdmissionForm(secretClient(), again)).toEqual(first)
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
  })

  test("anon reads neither leads nor submissions, and only the secret key may submit", async () => {
    const sent = form()
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)

    const anon = anonClient()
    const leads = await anon.from("leads").select("id").eq("student_name", sent.children[0].fullName)
    expect(leads.data ?? []).toHaveLength(0)

    const submissions = await anon.from("admission_submissions").select("submission_key")
    expect(submissions.error).not.toBeNull()

    const staffSubmissions = await (await signedIn(ADMISSIONS)).from("admission_submissions").select("submission_key")
    expect(staffSubmissions.error).not.toBeNull()

    for (const client of [anon, await signedIn(ADMISSIONS)]) {
      const refused = await submitAdmissionForm(client, form())
      expect(refused).toEqual({ ok: false, error: { kind: "unavailable" } })
    }
  })
})

// The secret-key client, except that the first call for the child at
// `failAt` fails as a dropped connection would, before reaching the database.
function failingOnce(failAt: number): SupabaseClient {
  const client = secretClient()
  let failed = false
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "rpc") return Reflect.get(target, property, receiver)
      return (fn: string, args: { child_index?: number }) => {
        if (!failed && args.child_index === failAt) {
          failed = true
          return Promise.resolve({ data: null, error: { message: "fetch failed", details: null, hint: null, code: "" } })
        }
        return target.rpc(fn, args)
      }
    },
  })
}

async function leadOf(name: string) {
  const [item] = await leadsNamed(name)
  const lead = await getLead(await signedIn(ADMISSIONS), item.id)
  if (!lead.ok) throw new Error(`could not read the lead for ${name}`)
  return lead.data
}

describe("several children on one form", () => {
  test("creates each child Applied, in form order, with its own number, on one shared contact", async () => {
    const sent = form({
      children: [
        child({ className: "DAY CARE", dayOrBoarding: "Day" }),
        child({ className: "STD 4", enrollmentYear: thisYear }),
        child({ className: "FORM 2" }),
      ],
    })

    const result = await submitAdmissionForm(secretClient(), sent)
    if (!result.ok) throw new Error(`expected a confirmation, got ${JSON.stringify(result.error)}`)
    expect(result.data.map((c) => c.fullName)).toEqual(sent.children.map((c) => c.fullName))
    const numbers = result.data.map((c) => c.admissionNumber)
    expect(new Set(numbers).size).toBe(3)

    const leads = await Promise.all(sent.children.map((c) => leadOf(c.fullName)))
    expect(leads.map((l) => [l.admissionNumber, l.className, l.status, l.returningFamily])).toEqual([
      [numbers[0], "DAY CARE", "Applied", false],
      [numbers[1], "STD 4", "Applied", false],
      [numbers[2], "FORM 2", "Applied", false],
    ])
    expect(new Set(leads.map((l) => l.contact.id)).size).toBe(1)
  })

  test("every child carries the parent's relationship (#312)", async () => {
    const sent = form({
      parent: parent({ relationship: "Other", relationshipDescription: "Grandmother" }),
      children: [child(), child({ className: "STD 4" })],
    })
    const result = await submitAdmissionForm(secretClient(), sent)
    if (!result.ok) throw new Error(JSON.stringify(result.error))

    const leads = await Promise.all(sent.children.map((c) => leadOf(c.fullName)))
    for (const lead of leads) {
      expect(lead.contact).toMatchObject({ relationship: "Other", relationshipDescription: "Grandmother" })
    }
    const rows = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            `select l.custodian_relationship::text as relationship, l.custodian_relationship_description as description
             from public.leads l
             where l.id = any($1::uuid[])`,
            [leads.map((l) => l.id)],
          )
        ).rows,
    )
    expect(rows).toEqual([
      { relationship: "Other", description: "Grandmother" },
      { relationship: "Other", description: "Grandmother" },
    ])
  })

  test("a parent phone that matches a Family gives every child the same unconfirmed match and the Family cause", async () => {
    // A Family the front desk registered earlier, with one child.
    const known = parent({ relationship: "Guardian" })
    const desk = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contact: known },
      student: child({ fullName: `Desk Pupil ${randomUUID().slice(0, 8)}` }),
      start: { kind: "walk-in", visitDate: tanzaniaToday() },
    })
    if (!desk.ok) throw new Error(`setup failed: ${JSON.stringify(desk.error)}`)
    const deskLead = await getLead(await signedIn(ADMISSIONS), desk.data.leadId)
    if (!deskLead.ok) throw new Error("setup failed: the Family's lead could not be read")
    const familyContact = deskLead.data.contact.id

    // The same parent applies online for two more children.
    const sent = form({ parent: { ...known, fullName: "Typed On The Form", relationship: "Mother" }, children: [child(), child()] })
    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)

    const staff = await signedIn(ADMISSIONS)
    const [first, second] = await Promise.all(sent.children.map((c) => leadOf(c.fullName)))
    expect(first.contact.id).toBe(second.contact.id)
    expect(first.contact.id).not.toBe(familyContact)
    expect([first.returningFamily, second.returningFamily]).toEqual([true, true])
    for (const lead of [first, second]) {
      const family = await getLeadFamily(staff, lead.id)
      expect(family.ok && family.data.pendingMatch?.id).toBe(familyContact)
      // The matched parent's relationship to their first child (#312), not the form's.
      expect(family.ok && family.data.pendingMatch?.relationship).toBe("Guardian")
      expect(family.ok && family.data.children.map((c) => [c.id, c.unconfirmed])).toEqual([
        [desk.data.leadId, false],
        [first.id, true],
        [second.id, true],
      ])
    }
  })

  test("a failure after the first child, then a retry with the same key, creates only the rest and returns every number", async () => {
    const sent = form({ children: [child(), child(), child()] })

    expect(await submitAdmissionForm(failingOnce(1), sent)).toEqual({ ok: false, error: { kind: "unavailable" } })
    expect(await leadsNamed(sent.children[0].fullName)).toHaveLength(1)
    expect(await leadsNamed(sent.children[1].fullName)).toHaveLength(0)
    expect(await leadsNamed(sent.children[2].fullName)).toHaveLength(0)
    const firstNumber = (await leadOf(sent.children[0].fullName)).admissionNumber

    const retry = await submitAdmissionForm(secretClient(), sent)
    if (!retry.ok) throw new Error(`expected a confirmation, got ${JSON.stringify(retry.error)}`)
    expect(retry.data.map((c) => c.fullName)).toEqual(sent.children.map((c) => c.fullName))
    expect(retry.data[0].admissionNumber).toBe(firstNumber)
    expect(new Set(retry.data.map((c) => c.admissionNumber)).size).toBe(3)

    for (const pupil of sent.children) expect(await leadsNamed(pupil.fullName)).toHaveLength(1)
    const leads = await Promise.all(sent.children.map((c) => leadOf(c.fullName)))
    expect(leads.map((l) => l.admissionNumber)).toEqual(retry.data.map((c) => c.admissionNumber))
    // The resumed children joined the contact the first one made, not a new one.
    expect(new Set(leads.map((l) => l.contact.id)).size).toBe(1)
    // And none of them became a re-application of itself.
    expect(leads.map((l) => l.returningFamily)).toEqual([false, false, false])
  })
})

// The last-name choice (#513): sent with the name parts, the database builds
// the student's name from it and keeps it on the lead.
describe("the last-name choice on the Admission form", () => {
  // Letters only: a name part holds no digits.
  const letters = () => Array.from(randomUUID().replace(/-/g, "").slice(0, 6), (c) => String.fromCharCode(65 + (parseInt(c, 16) % 26))).join("")

  async function stored(admissionNumber: string) {
    return inRolledBackTransaction(async (sql) =>
      (await sql.query("select student_name, last_name_from::text from public.leads where admission_number = $1", [admissionNumber])).rows[0],
    )
  }

  test.each([
    ["father_middle", "middle"],
    ["father_last", "last"],
  ] as const)("with %s, stores the name it builds and the choice", async (lastNameFrom, which) => {
    const middle = `KATI${letters()}`
    const last = `MWISHO${letters()}`
    const parts = { firstName: `MWANAFUNZI${letters()}`, fatherFirst: "BABA", fatherMiddle: middle, fatherLast: last }
    const name = `${parts.firstName} BABA ${which === "middle" ? middle : last}`
    const sent = form({ parent: parent({ fullName: "FORM PARENT ONE", nameParts: { firstName: "FORM", middleName: "PARENT", lastName: "ONE" } }), children: [child({ fullName: name, nameParts: parts, lastNameFrom })] })

    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await stored(result.data[0].admissionNumber)).toEqual({ student_name: name, last_name_from: lastNameFrom })
  })

  test("left out with the name parts, stores the father's last name", async () => {
    const parts = { firstName: `MWANAFUNZI${letters()}`, fatherFirst: "BABA", fatherMiddle: "KATI", fatherLast: `MWISHO${letters()}` }
    const sent = form({ children: [child({ fullName: `${parts.firstName} BABA ${parts.fatherLast}`, nameParts: parts })] })
    const result = await submitAdmissionForm(secretClient(), sent)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await stored(result.data[0].admissionNumber)).toEqual({ student_name: `${parts.firstName} BABA ${parts.fatherLast}`, last_name_from: "father_last" })
  })
})
