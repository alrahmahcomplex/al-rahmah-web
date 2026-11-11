import { randomInt, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import type { AdmissionChild, AdmissionForm } from "@/lib/admission-form"
import { admissionYears, parseAdmissionForm } from "@/lib/admission-form"
import { FORM_NOTICE_V1_VERSION, FORM_NOTICE_VERSION, STAFF_REMINDER_VERSION } from "@/lib/referral-notice"
import { tanzaniaToday } from "@/lib/school-calendar"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createLead } from "@/lib/services/leads"
import { applyFormDiscountCode, setLeadReferralCode } from "@/lib/services/referral"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

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

  test("a page from the build before #282 that posts form_v1 keeps its code and records no version", async () => {
    // Through the same parser the Server Action uses: this server shows
    // form_v2, so it vouches for no other notice.
    const posted = { ...form({ children: [child(), child()], discountCode: APPROVED }), noticeVersion: FORM_NOTICE_V1_VERSION }
    const parsed = parseAdmissionForm(JSON.stringify(posted), admissionYears())
    if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
    expect((await submitAdmissionForm(secretClient(), parsed.data)).ok).toBe(true)

    for (const c of posted.children) {
      expect(await leadOf(c.fullName)).toMatchObject({ code: APPROVED, version: null })
    }
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
  // #196 dropped the two-argument version, so a build from before #182 that
  // still sends only lead_id and code is refused as a missing function.
  test("the two-argument call is gone: PGRST202, and nothing is written", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    const { data, error } = await secretClient().rpc("apply_form_discount_code", { lead_id: id, code: APPROVED })
    expect(error?.code).toBe("PGRST202")
    expect(data).toBeNull()
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
  })

  test("the three-argument version is the only one the API exposes", async () => {
    const signatures = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ args: string }>(
        `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'apply_form_discount_code'
         order by 1`,
      )
      return rows.map((row) => row.args)
    })
    expect(signatures).toEqual(["lead_id uuid, code text, notice_version text"])
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

  test("a page from the build before #282 may still record form_v1, the words it showed", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    expect(await applyFormDiscountCode(secretClient(), id, APPROVED, FORM_NOTICE_V1_VERSION)).toEqual({ ok: true, data: { code: APPROVED } })
    expect(await versionOf(id)).toBe(FORM_NOTICE_V1_VERSION)
  })

  test.each(["form_v0", "form_v3", "", "FORM_V2"])("the unknown version %j is refused, and the code isn't written", async (version) => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    const { error } = await secretClient().rpc("apply_form_discount_code", { lead_id: id, code: APPROVED, notice_version: version })
    expect(error?.message).toBe("invalid")
    expect(JSON.parse(error?.details ?? "null")).toEqual({ field: "notice_version" })
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
  })

  test("the form may not claim the staff reminder", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    expect(await applyFormDiscountCode(secretClient(), id, APPROVED, STAFF_REMINDER_VERSION)).toEqual({ ok: false, error: "invalid" })
    expect(await versionOf(id)).toBeNull()
  })

  test("only the secret key may call it: no visitor and no staff member", async () => {
    const sent = form()
    await submitAdmissionForm(secretClient(), sent)
    const { id } = await leadOf(sent.children[0].fullName)

    for (const client of [anonClient(), await signedIn(MANAGER), await signedIn(ADMISSIONS)]) {
      expect(await applyFormDiscountCode(client, id, APPROVED, FORM_NOTICE_VERSION)).toEqual({ ok: false, error: "unavailable" })
    }
    expect(await leadOf(sent.children[0].fullName)).toMatchObject({ code: null, version: null })
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

  test("staff without leads.edit can't set a code, so no version is recorded", async () => {
    const lead = await walkIn()
    expect((await setLeadReferralCode(await signedIn(ACCOUNTANT), lead, APPROVED)).ok).toBe(false)
    expect(await versionOf(lead)).toBeNull()
  })

  test("a retired or unknown code is still refused, and records no version", async () => {
    const lead = await walkIn()
    expect(await setLeadReferralCode(await signedIn(ADMISSIONS), lead, "QQQ-000")).toMatchObject({ ok: false })
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

    // Both Admission form versions and the staff reminder are known: rows
    // saved with form_v1 before #282 stay valid beside new form_v2 ones.
    for (const version of [FORM_NOTICE_V1_VERSION, FORM_NOTICE_VERSION, STAFF_REMINDER_VERSION]) {
      await inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.leads set referral_notice_version = $1 where id = '1ead0000-0000-4000-8000-000000000431'", [version])
      })
    }
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("update public.leads set referral_notice_version = 'form_v9' where id = '1ead0000-0000-4000-8000-000000000431'")
      }),
    ).rejects.toThrow(/leads_referral_notice_version_known/)
  })

  test("the form_v2 migration keeps a row that already recorded form_v1", async () => {
    // Replays the migration's constraint change, in a rolled-back
    // transaction, over a row saved with form_v1, as hosted rows were before
    // #282. Re-adding the constraint checks every existing row.
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261205400100_referral_notice_form_v2.sql"), "utf8")
    const constraintChange = migration.match(/alter table public\.leads[\s\S]*?;/)?.[0]
    expect(constraintChange).toMatch(/'form_v1', 'form_v2', 'staff_reminder'/)

    const version = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.leads set referral_notice_version = 'form_v1' where id = '1ead0000-0000-4000-8000-000000000431'")
      await sql.query(constraintChange!)
      const { rows } = await sql.query<{ version: string }>(
        "select referral_notice_version as version from public.leads where id = '1ead0000-0000-4000-8000-000000000431'",
      )
      return rows[0].version
    })
    expect(version).toBe(FORM_NOTICE_V1_VERSION)
  })

  test("holds a version only beside a code", async () => {
    // The seeded lead carries BJN-402, so a version beside it is accepted.
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.leads set referral_notice_version = 'form_v1' where id = '1ead0000-0000-4000-8000-000000000431'")
    })

    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(
          "update public.leads set referral_code = null, referral_notice_version = 'staff_reminder' where id = '1ead0000-0000-4000-8000-000000000431'",
        )
      }),
    ).rejects.toThrow(/leads_referral_notice_version_needs_code/)

    // Clearing the code while a version stays is refused too.
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.leads set referral_notice_version = 'form_v1' where id = '1ead0000-0000-4000-8000-000000000431'")
        await sql.query("update public.leads set referral_code = null where id = '1ead0000-0000-4000-8000-000000000431'")
      }),
    ).rejects.toThrow(/leads_referral_notice_version_needs_code/)
  })
})
