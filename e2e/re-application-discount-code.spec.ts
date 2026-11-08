import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { secretClient } from "../tests/support/db"
import { ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// A Discount code on a Re-application (#84): the review view compares it with
// the lead's Referral code, Apply moves a recognised code onto the lead, and
// an Unrecognised code offers no Apply. Each test records a lead and a
// re-application of its own, so reruns never meet a code an earlier run
// applied.

const nextYear = admissionYears()[1]

// The seeded agents (supabase/seeds/40_agents.sql).
const PENDING_CODE = "ZNM-401"
const APPROVED_CODE = "BJN-402"

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// A leading 7 keeps it clear of the seeded 700 000 numbers.
const localPhone = () => `07${String(randomInt(10_000_000, 100_000_000))}`

// A lead from the Admission form carrying the Pending agent's code, then the
// same child sent again with `code`: only the code differs.
async function reApplied(code: string) {
  const contact = { full_name: "Mama Punguzo", relationship: "Mother", phone: localPhone() }
  const student = {
    full_name: `Mtoto Punguzo ${randomUUID().slice(0, 6)}`,
    class_name: "STD 3",
    enrollment_year: nextYear,
    day_or_boarding: "Day",
  }
  const supabase = secretClient()

  const created = await supabase.rpc("create_lead", {
    start_kind: "admission_form",
    existing_contact_id: null,
    new_contact: contact,
    student_details: student,
  })
  if (created.error || created.data?.result !== "created") throw new Error(`could not create a lead: ${created.error?.message}`)
  const leadId = created.data.lead_id as string
  const coded = await supabase.rpc("apply_form_discount_code", { lead_id: leadId, code: PENDING_CODE, notice_version: "form_v1" })
  if (coded.error) throw new Error(`could not put a code on the lead: ${coded.error.message}`)
  const recorded = await supabase.rpc("record_re_application", {
    lead_id: leadId,
    submission_key: randomUUID(),
    submitted: { contact, student: { ...student, discount_code: code } },
  })
  if (recorded.error) throw new Error(`could not record a re-application: ${recorded.error.message}`)
  return { id: recorded.data as string, leadId }
}

const comparison = (page: Page) => page.getByRole("table", { name: "Compared with the lead" })
const codeRow = (page: Page) => comparison(page).getByRole("row", { name: /^Discount code/ })

test.describe("a Discount code on a re-application", () => {
  test("differs from the lead's code, and Apply makes a recognised code the lead's Referral code", async ({ page }) => {
    const mine = await reApplied(APPROVED_CODE.toLowerCase())
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/re-applications/${mine.id}`)

    await expect(page.getByRole("main")).toContainText("1 field differs from the lead.")
    await expect(codeRow(page)).toContainText(PENDING_CODE)
    await expect(codeRow(page)).toContainText(APPROVED_CODE)
    await expect(codeRow(page)).toContainText("Differs")
    await expect(comparison(page).getByRole("button", { name: /^Apply/ })).toHaveCount(1)

    await codeRow(page).getByRole("button", { name: "Apply Discount code" }).click()
    await expect(codeRow(page)).toContainText("Matches now")
    await expect(codeRow(page).getByRole("button")).toHaveCount(0)

    await page.goto(`/staff/leads/${mine.leadId}`)
    const referral = page.getByRole("region", { name: "Referral code" })
    await expect(referral).toContainText(APPROVED_CODE)
    await expect(referral).not.toContainText(PENDING_CODE)
  })

  test("an Unrecognised code offers no Apply, and says why", async ({ page }) => {
    const code = `NOPE-${randomInt(100_000, 1_000_000)}`
    const mine = await reApplied(code)
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/re-applications/${mine.id}`)

    await expect(codeRow(page)).toContainText(code)
    await expect(codeRow(page)).toContainText("Differs")
    await expect(codeRow(page)).toContainText("No Marketing Agent has this code, so it can't be applied.")
    await expect(codeRow(page).getByRole("button")).toHaveCount(0)
  })
})
