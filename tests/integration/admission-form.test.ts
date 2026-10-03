import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm, AdmissionParent } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { getLeadHistory } from "@/lib/services/audit"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { getLead } from "@/lib/services/leads"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

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
    const history = await getLeadHistory(await signedIn(ADMISSIONS), item.id)
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
