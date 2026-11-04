import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm } from "@/lib/admission-form"
import { admissionYears } from "@/lib/admission-form"
import { FORM_NOTICE_VERSION, STAFF_REMINDER_VERSION } from "@/lib/referral-notice"
import { tanzaniaToday } from "@/lib/school-calendar"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createLead } from "@/lib/services/leads"
import { applyFormDiscountCode, setLeadReferralCode } from "@/lib/services/referral"

import { inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// Which version of the code-holder notice a lead's family saw (#182), against
// local Supabase: the Admission form's version through the admission-form
// service with the secret key, `staff_reminder` for a code staff set, and none
// for a re-application. Each test invents its own families.

const PENDING = "ZNM-401"
const APPROVED = "BJN-402"

const [, nextYear] = admissionYears()

function child(): AdmissionChild {
  return { fullName: `Notice Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: nextYear, dayOrBoarding: "Day" }
}

function form(overrides: Partial<AdmissionForm> = {}): AdmissionForm {
  return {
    submissionKey: randomUUID(),
    parent: { fullName: "Notice Parent", relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    children: [child()],
    ...overrides,
  }
}

async function leadOf(name: string): Promise<{ id: string; code: string | null; version: string | null }> {
  const rows = await inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query(
          "select id, referral_code as code, referral_notice_version as version from public.leads where student_name = $1",
          [name],
        )
      ).rows as { id: string; code: string | null; version: string | null }[],
  )
  if (rows.length !== 1) throw new Error(`expected one lead named ${name}, found ${rows.length}`)
  return rows[0]
}

async function versionOf(leadId: string): Promise<string | null> {
  const rows = await inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select referral_notice_version as version from public.leads where id = $1", [leadId])).rows as {
        version: string | null
      }[],
  )
  return rows[0].version
}

async function walkIn(): Promise<string> {
  const today = tanzaniaToday()
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Walk-in Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Walk-in ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: nextYear, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

describe("the notice version on leads the Admission form creates", () => {
  test("every child's lead records the version the form showed with its code", async () => {
    const sent = form({ children: [child(), child()], discountCode: APPROVED, noticeVersion: FORM_NOTICE_VERSION })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)

    for (const c of sent.children) {
      expect(await leadOf(c.fullName)).toMatchObject({ code: APPROVED, version: FORM_NOTICE_VERSION })
    }
  })

  test("a code sent without a version, as from a page loaded before the notice, records none", async () => {
    const sent = form({ discountCode: PENDING })
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: PENDING, version: null })
  })

  test("a form without a code records no version", async () => {
    const sent = form()
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
  })

  test("a retry that spans a deploy, with and without the version, is the same send", async () => {
    // The first send comes from a page loaded before the notice existed.
    const before = form({ discountCode: APPROVED })
    const first = await submitAdmissionForm(secretClient(), before)
    expect(first.ok).toBe(true)

    // The retry comes from the new page, which adds the version.
    const retried = await submitAdmissionForm(secretClient(), { ...before, noticeVersion: FORM_NOTICE_VERSION })
    expect(retried).toEqual(first)
    // The code was already on the lead, so nothing is rewritten.
    expect(await leadOf(before.children[0].fullName)).toMatchObject({ code: APPROVED, version: null })
  })

  test("a re-application carries no version onto the lead it matched", async () => {
    const sent = form()
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)

    const again = await submitAdmissionForm(secretClient(), {
      ...sent,
      submissionKey: randomUUID(),
      discountCode: APPROVED,
      noticeVersion: FORM_NOTICE_VERSION,
    })
    expect(again.ok).toBe(true)
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
  })
})

describe("apply_form_discount_code with a notice version", () => {
  test("the old two-argument call still works and records no version", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    const { data, error } = await secretClient().rpc("apply_form_discount_code", { lead_id: id, code: APPROVED })
    expect(error).toBeNull()
    expect(data).toBe(APPROVED)
    expect(await versionOf(id)).toBeNull()
  })

  test("the new argument has no default, so naming it picks the new version", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    const { error } = await secretClient().rpc("apply_form_discount_code", {
      lead_id: id,
      code: APPROVED,
      notice_version: FORM_NOTICE_VERSION,
    })
    expect(error).toBeNull()
    expect(await versionOf(id)).toBe(FORM_NOTICE_VERSION)
  })

  test("a version the database doesn't know is refused, and the code isn't written", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    const { error } = await secretClient().rpc("apply_form_discount_code", { lead_id: id, code: APPROVED, notice_version: "form_v0" })
    expect(error?.message).toBe("invalid")
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
  })

  test("the form may not claim the staff reminder", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    expect(await applyFormDiscountCode(secretClient(), id, APPROVED, STAFF_REMINDER_VERSION)).toEqual({ ok: false, error: "invalid" })
    expect(await versionOf(id)).toBeNull()
  })

  test("a lead that already carries a code keeps its version", async () => {
    const sent = form({ discountCode: PENDING, noticeVersion: FORM_NOTICE_VERSION })
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    expect(await applyFormDiscountCode(secretClient(), id, APPROVED, null)).toEqual({ ok: true, data: { code: PENDING } })
    expect(await versionOf(id)).toBe(FORM_NOTICE_VERSION)
  })
})

describe("the notice version on codes staff set", () => {
  test("a code staff enter records the staff reminder, and clearing it clears the version", async () => {
    const lead = await walkIn()
    expect(await versionOf(lead)).toBeNull()

    expect((await setLeadReferralCode(await signedIn(ADMISSIONS), lead, APPROVED)).ok).toBe(true)
    expect(await versionOf(lead)).toBe(STAFF_REMINDER_VERSION)

    expect((await setLeadReferralCode(await signedIn(ADMISSIONS), lead, null)).ok).toBe(true)
    expect(await versionOf(lead)).toBeNull()
  })

  test("staff correcting a code the form sent record the reminder they gave", async () => {
    const sent = form({ discountCode: "QQQ-000", noticeVersion: FORM_NOTICE_VERSION })
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    expect((await setLeadReferralCode(await signedIn(ADMISSIONS), id, PENDING)).ok).toBe(true)
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: PENDING, version: STAFF_REMINDER_VERSION })
  })
})

describe("the referral_notice_version column", () => {
  test("is nullable, documented and limited to the known versions", async () => {
    const rows = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query(
            `select c.is_nullable, col_description('public.leads'::regclass, c.ordinal_position) as comment
             from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'leads' and c.column_name = 'referral_notice_version'`,
          )
        ).rows as { is_nullable: string; comment: string | null }[],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].is_nullable).toBe("YES")
    expect(rows[0].comment).toMatch(/null/i)

    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("update public.leads set referral_notice_version = 'something_else' where id = '1ead0000-0000-4000-8000-000000000431'")
      }),
    ).rejects.toThrow(/leads_referral_notice_version_known/)
  })
})
