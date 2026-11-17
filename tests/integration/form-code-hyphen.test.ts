import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { formatCode } from "@/components/guided-form/typing"
import { admissionYears, type AdmissionForm } from "@/lib/admission-form"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createPromoCode } from "@/lib/services/promo-codes"
import { estimateFormDiscountCode, getLeadReferral } from "@/lib/services/referral"

import { inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// The Admission form's code box adds a hyphen between three letters and the
// digit after them (#403, #462), so a Promo code like EID2026 arrives as
// EID-2026. The form's lookup tries the code as typed, then without that
// hyphen, and keeps agent codes as they are. Promo codes of any other shape
// (SAVE10, KARIBU2026, AS-135, $AVE) reach it exactly as typed.

const PROMO = "EID2026"
const PROMO_AMOUNT = 15000
// The seeded Approved agent's code.
const AGENT = "BJN-402"

const [, nextYear] = admissionYears()

// EID2026 is made once per database; a second run finds it already there.
async function eidPromo() {
  const made = await createPromoCode(await signedIn(MANAGER), { name: "Eid offer", code: PROMO, amount: PROMO_AMOUNT, endsOn: null, note: null })
  if (!made.ok && made.error !== "code-taken") throw new Error(`could not create ${PROMO}: ${made.error}`)
}

function form(discountCode: string): AdmissionForm {
  const firstName = `HYPHEN${randomUUID().slice(0, 6).toUpperCase()}`
  const parts = { firstName, fatherFirst: "SALIM", fatherMiddle: "OMARI", fatherLast: "MFANO" }
  return {
    submissionKey: randomUUID(),
    parent: {
      fullName: "ASHA ALI MFANO",
      nameParts: { firstName: "ASHA", middleName: "ALI", lastName: "MFANO" },
      relationship: "Mother",
      phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    },
    children: [{ fullName: `${firstName} SALIM MFANO`, nameParts: parts, className: "STD 4", enrollmentYear: nextYear, dayOrBoarding: "Day" }],
    discountCode,
  }
}

async function codeOnLead(studentName: string): Promise<string | null> {
  const rows = await inRolledBackTransaction(
    async (sql) => (await sql.query("select id from public.leads where student_name = $1", [studentName])).rows as { id: string }[],
  )
  if (rows.length !== 1) throw new Error(`expected one lead named ${studentName}, found ${rows.length}`)
  const referral = await getLeadReferral(await signedIn(ADMISSIONS), rows[0].id)
  if (!referral.ok) throw new Error("could not read the code")
  return referral.data.code
}

// The owner's examples (#462), each made once per database at the same
// amount; a second run finds them already there.
const ANY_FORMAT = ["SAVE10", "KARIBU2026", "AS-135", "$AVE", "EID2026"]

async function anyFormatPromos() {
  for (const code of ANY_FORMAT) {
    const made = await createPromoCode(await signedIn(MANAGER), { name: `Example ${code}`, code, amount: PROMO_AMOUNT, endsOn: null, note: null })
    if (!made.ok && made.error !== "code-taken") throw new Error(`could not create ${code}: ${made.error}`)
  }
}

describe("a code typed in the Admission form's box", () => {
  test.each(ANY_FORMAT)("the Promo code %s, typed in small letters, is found and kept on the application", async (promo) => {
    await anyFormatPromos()
    const typed = formatCode(promo.toLowerCase())
    expect(await estimateFormDiscountCode(secretClient(), typed)).toEqual({
      ok: true,
      data: { state: "approved", amount: STANDARD_INTERVIEW_FEE - PROMO_AMOUNT, code: promo },
    })
    const sent = form(typed)
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await codeOnLead(sent.children[0].fullName)).toBe(promo)
  })

  test("EID2026 typed in the box reads EID-2026, and the form finds the Promo code without the hyphen", async () => {
    await eidPromo()
    const typed = formatCode("eid2026")
    expect(typed).toBe("EID-2026")

    expect(await estimateFormDiscountCode(secretClient(), typed)).toEqual({
      ok: true,
      data: { state: "approved", amount: STANDARD_INTERVIEW_FEE - PROMO_AMOUNT, code: PROMO },
    })

    const sent = form(typed)
    const saved = await submitAdmissionForm(secretClient(), sent)
    expect(saved.ok).toBe(true)
    expect(await codeOnLead(sent.children[0].fullName)).toBe(PROMO)
  })

  test("an agent code keeps its hyphen, typed with or without it", async () => {
    expect(formatCode("bjn402")).toBe(AGENT)
    expect(await estimateFormDiscountCode(secretClient(), AGENT)).toEqual({ ok: true, data: expect.objectContaining({ state: "approved", code: AGENT }) })

    const sent = form(AGENT)
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await codeOnLead(sent.children[0].fullName)).toBe(AGENT)
  })

  test("a code nobody holds, either way, is kept as typed", async () => {
    const typed = formatCode(`qzx${randomInt(100_000, 999_999)}`)
    expect(await estimateFormDiscountCode(secretClient(), typed)).toEqual({
      ok: true,
      data: { state: "unknown", amount: STANDARD_INTERVIEW_FEE, code: typed },
    })

    const sent = form(typed)
    expect((await submitAdmissionForm(secretClient(), sent)).ok).toBe(true)
    expect(await codeOnLead(sent.children[0].fullName)).toBe(typed)
  })
})
