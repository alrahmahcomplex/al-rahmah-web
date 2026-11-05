import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm, AdmissionParent } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { applyReApplicationField } from "@/lib/services/re-application-apply"
import { getReApplication, listReApplications } from "@/lib/services/re-applications"

import { asSystem, inRolledBackTransaction, secretClient, signedIn, unusedAdmissionNumber } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// A Discount code the Admission form sends for a child already on file (#84),
// against local Supabase. The code stays on the Re-application and never
// reaches the lead from the form; staff Apply it through the lead's Referral
// code rules. Each test makes its own leads, with invented names and numbers
// clear of the seeded +255 700 000 xxx fixtures.

const [, nextYear] = admissionYears()

// The seeded agents (supabase/seeds/40_agents.sql).
const PENDING_CODE = "ZNM-401"
const APPROVED_CODE = "BJN-402"

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

const stored = (local: string) => `+255${local.slice(1)}`

// A code no agent holds, fresh for each test.
const unrecognised = () => `NOPE-${randomInt(100_000, 1_000_000)}`

type OnFile = { id: string; studentName: string; parent: AdmissionParent }

// A Visited lead already on file, written as the system actor, with an
// optional Referral code and closure mark.
async function onFile({ referralCode = null, closure = null }: { referralCode?: string | null; closure?: "Archived" | null } = {}) {
  const parent: AdmissionParent = { fullName: "Mama Punguzo", relationship: "Mother", phone: phone() }
  const studentName = `Mtoto Punguzo ${randomUUID().slice(0, 8)}`
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
         status, closure, closure_reason, visit_date, guardian_contact_id, referral_code
       ) values ($1, $2, 'STD 3', $3, 'Day', 'Visited', $4, $5, '2026-09-01', $6, $7) returning id`,
      [
        admissionNumber,
        studentName,
        nextYear,
        closure,
        closure ? "No longer pursuing admission" : null,
        contact.rows[0].id,
        referralCode,
      ],
    )
    return lead.rows[0].id
  })
  return { id, studentName, parent } satisfies OnFile
}

const sameChild = (lead: OnFile): AdmissionChild => ({
  fullName: lead.studentName,
  className: "STD 3",
  enrollmentYear: nextYear,
  dayOrBoarding: "Day",
})

const newChild = (): AdmissionChild => ({
  fullName: `Mtoto Mpya ${randomUUID().slice(0, 8)}`,
  className: "KG 2",
  enrollmentYear: nextYear,
  dayOrBoarding: "Boarding",
})

function form(parent: AdmissionParent, children: AdmissionChild[], discountCode?: string): AdmissionForm {
  return { submissionKey: randomUUID(), parent, children, discountCode, noticeVersion: discountCode ? "form_v1" : undefined }
}

async function leadCode(id: string): Promise<{ referral_code: string | null; referral_notice_version: string | null }> {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select referral_code, referral_notice_version from public.leads where id = $1", [id])).rows[0],
  )
}

async function leadNamed(name: string): Promise<string> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query<{ id: string }>("select id from public.leads where student_name = $1", [name])).rows[0].id,
  )
}

// The one re-application on a lead, as staff read it.
async function onlyReApplication(leadId: string) {
  const id = await inRolledBackTransaction(
    async (sql) => (await sql.query<{ id: string }>("select id from public.re_applications where lead_id = $1", [leadId])).rows,
  )
  expect(id).toHaveLength(1)
  const read = await getReApplication(await signedIn(ADMISSIONS), id[0].id)
  if (!read.ok) throw new Error(read.error)
  return read.data
}

// The form sends `lead`'s child again, with `code`, and the re-application it
// records.
async function reApplyWith(lead: OnFile, code: string | undefined) {
  const sent = await submitAdmissionForm(secretClient(), form(lead.parent, [sameChild(lead)], code))
  expect(sent.ok).toBe(true)
  return onlyReApplication(lead.id)
}

describe("a Discount code sent for a child already on file", () => {
  test("is kept on the re-application, normalized, and never put on the lead", async () => {
    const lead = await onFile()

    const entry = await reApplyWith(lead, APPROVED_CODE.toLowerCase())

    expect(entry.submitted.discountCode).toBe(APPROVED_CODE)
    expect(entry.differingFields).toEqual(["discount_code"])
    expect(await leadCode(lead.id)).toEqual({ referral_code: null, referral_notice_version: null })
  })

  test("leaves a code the lead already holds alone, and differs from it", async () => {
    const lead = await onFile({ referralCode: PENDING_CODE })

    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(entry.submitted.discountCode).toBe(APPROVED_CODE)
    expect(entry.leadReferralCode).toBe(PENDING_CODE)
    expect(entry.differingFields).toEqual(["discount_code"])
    expect((await leadCode(lead.id)).referral_code).toBe(PENDING_CODE)
  })

  test("is not a difference when it is the code the lead holds", async () => {
    const lead = await onFile({ referralCode: APPROVED_CODE })

    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(entry.submitted.discountCode).toBe(APPROVED_CODE)
    expect(entry.differingFields).toEqual([])
  })

  test("a form with no code records none, and no difference from the lead's code", async () => {
    const lead = await onFile({ referralCode: APPROVED_CODE })

    const entry = await reApplyWith(lead, undefined)

    expect(entry.submitted.discountCode).toBeNull()
    expect(entry.differingFields).toEqual([])
    expect((await leadCode(lead.id)).referral_code).toBe(APPROVED_CODE)
  })

  test("an Unrecognised code is kept on the re-application too", async () => {
    const lead = await onFile()
    const code = unrecognised()

    const entry = await reApplyWith(lead, code)

    expect(entry.submitted.discountCode).toBe(code)
    expect(entry.differingFields).toEqual(["discount_code"])
    expect((await leadCode(lead.id)).referral_code).toBeNull()
  })

  test("on one form, a new child's lead gets the code and a matched child's lead does not", async () => {
    const lead = await onFile()
    const fresh = newChild()

    const sent = await submitAdmissionForm(secretClient(), form(lead.parent, [fresh, sameChild(lead)], APPROVED_CODE))
    expect(sent.ok).toBe(true)

    expect(await leadCode(await leadNamed(fresh.fullName))).toEqual({
      referral_code: APPROVED_CODE,
      referral_notice_version: "form_v1",
    })
    expect(await leadCode(lead.id)).toEqual({ referral_code: null, referral_notice_version: null })
    const entry = await onlyReApplication(lead.id)
    expect(entry.submitted.discountCode).toBe(APPROVED_CODE)
    expect(entry.differingFields).toEqual(["discount_code"])
  })

  test("counts among the differing fields the queue shows", async () => {
    const lead = await onFile()
    const sent = await submitAdmissionForm(
      secretClient(),
      form(lead.parent, [{ ...sameChild(lead), className: "STD 4" }], APPROVED_CODE),
    )
    expect(sent.ok).toBe(true)
    const entry = await onlyReApplication(lead.id)

    const staff = await signedIn(ADMISSIONS)
    let summary
    for (let page = 1; !summary; page++) {
      const list = await listReApplications(staff, { filter: "unreviewed", page })
      if (!list.ok) throw new Error(list.error)
      summary = list.data.reApplications.find((row) => row.id === entry.id)
      if (page >= list.data.pageCount) break
    }
    expect(summary?.differingFields).toEqual(["class_name", "discount_code"])
  })

  test("a value that is not a code is refused as invalid, and nothing is recorded", async () => {
    const lead = await onFile()
    const { error } = await secretClient().rpc("record_re_application", {
      lead_id: lead.id,
      submission_key: randomUUID(),
      submitted: {
        contact: { full_name: lead.parent.fullName, relationship: "Mother", phone: lead.parent.phone },
        student: { ...{ full_name: lead.studentName, class_name: "STD 3", enrollment_year: nextYear, day_or_boarding: "Day" }, discount_code: "not a code!" },
      },
    })
    expect(error?.message).toBe("invalid")
    expect(JSON.parse(error?.details ?? "{}")).toEqual({ field: "discount_code" })
    const rows = await inRolledBackTransaction(
      async (sql) => (await sql.query("select id from public.re_applications where lead_id = $1", [lead.id])).rows,
    )
    expect(rows).toHaveLength(0)
  })
})

describe("Apply on a re-application's Discount code", () => {
  test("puts a recognised code on the lead, as the staff member's Referral code", async () => {
    const lead = await onFile({ referralCode: PENDING_CODE })
    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(await applyReApplicationField(await signedIn(ADMISSIONS), entry.id, "discount_code")).toEqual({ ok: true, data: null })

    expect(await leadCode(lead.id)).toEqual({ referral_code: APPROVED_CODE, referral_notice_version: "staff_reminder" })
    expect((await onlyReApplication(lead.id)).leadReferralCode).toBe(APPROVED_CODE)
  })

  test("refuses an Unrecognised code, and the lead keeps its code", async () => {
    const lead = await onFile({ referralCode: PENDING_CODE })
    const entry = await reApplyWith(lead, unrecognised())

    expect(await applyReApplicationField(await signedIn(ADMISSIONS), entry.id, "discount_code")).toEqual({
      ok: false,
      error: { kind: "unknown-code" },
    })
    expect((await leadCode(lead.id)).referral_code).toBe(PENDING_CODE)
  })

  test("is refused without leads.edit", async () => {
    const lead = await onFile()
    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(await applyReApplicationField(await signedIn(ACCOUNTANT), entry.id, "discount_code")).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect((await leadCode(lead.id)).referral_code).toBeNull()
  })

  test("is refused on a closed lead", async () => {
    const lead = await onFile({ closure: "Archived" })
    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(await applyReApplicationField(await signedIn(MANAGER), entry.id, "discount_code")).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
    expect((await leadCode(lead.id)).referral_code).toBeNull()
  })

  test("has nothing to apply when the code matched the lead's on arrival", async () => {
    const lead = await onFile({ referralCode: APPROVED_CODE })
    const entry = await reApplyWith(lead, APPROVED_CODE)

    expect(await applyReApplicationField(await signedIn(ADMISSIONS), entry.id, "discount_code")).toEqual({
      ok: false,
      error: { kind: "not-differing" },
    })
  })
})
