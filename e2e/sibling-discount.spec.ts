import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The Sibling discount (#113): the seeded confirmed and unconfirmed Families
// in supabase/seeds/90_fees.sql, read only, and the prior-sibling tick on a
// Passed STD 2 Day lead (TZS 2,000,000) of the test's own, in a year it claims
// with a schedule of its own (tests/support/fee-years.ts).

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

// The seeded Families.
const BAHATI = "1ead0000-0000-4000-8000-000000000913"
const FURAHA = "1ead0000-0000-4000-8000-000000000914"
const ZUBERI = "1ead0000-0000-4000-8000-000000000917"

let claims: FeeYearClaim[] = []

test.afterEach(async () => {
  await Promise.all(claims.map((claim) => claim.release()))
  claims = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.context().clearCookies()
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function passedLead(): Promise<string> {
  const claim = await claimFeeYear()
  claims.push(claim)
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)).ok) throw new Error("setup failed")

  const admissions = await signedIn(ADMISSIONS)
  const phone = `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Sibling ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(registered.error)
  const result = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!result.ok) throw new Error(result.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, claim.year]))
  return id
}

function feeDetail(page: Page, term: string) {
  return page
    .getByRole("region", { name: "School fee" })
    .locator("dl")
    .first()
    .locator("dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]")
}

test("a confirmed Family's second child shows the Sibling discount; the first child and an unconfirmed Family's child don't", async ({
  page,
}) => {
  await signIn(page, ADMISSIONS)

  await page.goto(`/staff/leads/${FURAHA}`)
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 1,800,000")
  await expect(page.getByRole("region", { name: "School fee" })).toContainText("Sibling discount, 10% off TZS 2,000,000")

  await page.goto(`/staff/leads/${BAHATI}`)
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 2,100,000")
  await expect(page.getByRole("region", { name: "School fee" })).not.toContainText("discount")

  await page.goto(`/staff/leads/${ZUBERI}`)
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 1,100,000")
  await expect(page.getByRole("region", { name: "School fee" })).not.toContainText("discount")
})

test("Admissions Staff tick Has a sibling already at Al-Rahmah, which gives the discount, and clear it", async ({ page }) => {
  const lead = await passedLead()

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead}`)
  const panel = page.getByRole("region", { name: "Discounts" })
  const tick = panel.getByRole("checkbox", { name: "Has a sibling already at Al-Rahmah" })
  await expect(tick).not.toBeChecked()
  await tick.click()
  const form = panel.getByRole("form", { name: "Sibling already at Al-Rahmah" })
  await form.getByRole("button", { name: "Save" }).click()
  await expect(form.getByLabel("Sibling's name")).toBeFocused()
  await form.getByLabel("Sibling's name").fill("Amina Older")
  await form.getByLabel("Sibling's class").selectOption("STD 6")
  await form.getByRole("button", { name: "Save" }).click()

  await expect(form).toHaveCount(0)
  await expect(tick).toBeChecked()
  await expect(panel).toContainText("Amina Older, STD 6")
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 1,800,000")
  await expect(page.getByRole("region", { name: "School fee" })).toContainText("Sibling discount, 10% off TZS 2,000,000")

  // Staff without leads.edit see the tick and the sibling, and can't change them.
  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${lead}`)
  const readOnly = page.getByRole("region", { name: "Discounts" }).getByRole("checkbox", { name: "Has a sibling already at Al-Rahmah" })
  await expect(readOnly).toBeChecked()
  await expect(readOnly).toBeDisabled()
  await expect(page.getByRole("region", { name: "Discounts" })).toContainText("Amina Older, STD 6")

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead}/history`)
  await expect(page.getByText("ticked Has a sibling already at Al-Rahmah")).toBeVisible()

  await page.goto(`/staff/leads/${lead}`)
  await page.getByRole("region", { name: "Discounts" }).getByRole("checkbox", { name: "Has a sibling already at Al-Rahmah" }).click()
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 2,000,000")
  await expect(page.getByRole("region", { name: "Discounts" })).not.toContainText("Amina Older")
})
