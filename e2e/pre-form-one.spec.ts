import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, type LeadClass } from "@/lib/services/leads"

import { asSystem, createThrowawayStaff, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The Pre-Form One programme (#114): the seeded lead whose tick no longer
// applies in supabase/seeds/90_fees.sql, read only, and Passed Day leads of
// the test's own, in a year it claims with a schedule of its own
// (tests/support/fee-years.ts). FORM 1 Day is TZS 2,800,000; the Pre-Form
// One fee is 450,000 Day.

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

// Seeded: FORM 2, ticked while in FORM 1.
const SABRA = "1ead0000-0000-4000-8000-000000000920"

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

async function passedLead(className: LeadClass): Promise<string> {
  const claim = await claimFeeYear()
  claims.push(claim)
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)).ok) throw new Error("setup failed")

  const admissions = await signedIn(ADMISSIONS)
  const phone = `0597${String(randomInt(0, 1_000_000)).padStart(6, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Programme ${randomUUID().slice(0, 6)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
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

function detail(page: Page, region: string, term: string) {
  return page
    .getByRole("region", { name: region })
    .locator("dl")
    .first()
    .locator("dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]")
}

test("Admissions Staff tick the programme on a FORM 1 lead, and the Accountant records its fee apart from the School fee", async ({
  page,
}) => {
  const lead = await passedLead("FORM 1")

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead}`)
  const programme = page.getByRole("region", { name: "Pre-Form One programme" })
  const tick = programme.getByRole("checkbox", { name: "Pre-Form One programme" })
  await expect(tick).not.toBeChecked()
  await tick.click()
  await expect(tick).toBeChecked()
  await expect(detail(page, "Pre-Form One programme", "Pre-Form One fee")).toHaveText("TZS 450,000")
  await expect(detail(page, "Pre-Form One programme", "Pre-Form One balance")).toHaveText("TZS 450,000")

  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${lead}`)
  // The Accountant can't edit leads, so sees the tick without changing it.
  await expect(page.getByRole("region", { name: "Pre-Form One programme" }).getByRole("checkbox")).toBeDisabled()
  await page.getByRole("button", { name: "Record payment" }).click()
  const form = page.getByRole("form", { name: "Record payment" })
  await form.getByLabel("Payment type").selectOption({ label: "Pre-Form One fee" })
  await form.getByLabel("Amount (TZS)").fill("200,000")
  await form.getByRole("button", { name: "Review payment" }).click()
  const review = page.getByRole("region", { name: "Review payment" })
  await expect(review).toContainText("Pre-Form One paid after")
  await expect(review).toContainText("TZS 200,000")
  await expect(review).toContainText("Total paid TZS 0, Seat priority none")
  await review.getByRole("button", { name: "Confirm payment" }).click()
  await expect(page.getByRole("region", { name: "School fee" }).getByRole("status")).toHaveText("Pre-Form One fee recorded. It doesn't count toward the School fee or Seat priority.")

  await expect(detail(page, "Pre-Form One programme", "Pre-Form One paid")).toHaveText("TZS 200,000")
  await expect(detail(page, "Pre-Form One programme", "Pre-Form One balance")).toHaveText("TZS 250,000")
  await expect(detail(page, "School fee", "Total paid")).toHaveText("TZS 0")
  await expect(detail(page, "School fee", "Balance")).toHaveText("TZS 2,800,000")
  await expect(page.getByRole("list", { name: "Payments" })).toContainText("Pre-Form One fee")
})

test("staff who edit leads but can't view payments still tick the programme, and see no fee", async ({ page }) => {
  const lead = await passedLead("FORM 1")
  const editor = await createThrowawayStaff(["leads.view", "leads.edit"])

  await signIn(page, editor)
  await page.goto(`/staff/leads/${lead}`)
  await expect(page.getByRole("region", { name: "School fee" })).toHaveCount(0)
  const programme = page.getByRole("region", { name: "Pre-Form One programme" })
  const tick = programme.getByRole("checkbox", { name: "Pre-Form One programme" })
  await expect(tick).not.toBeChecked()
  await tick.click()
  await expect(tick).toBeChecked()
  await expect(programme).not.toContainText("TZS")
})

test("the programme isn't offered on another class, and a tick kept after a class correction shows as not applying", async ({
  page,
}) => {
  const lead = await passedLead("STD 2")

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead}`)
  await expect(page.getByRole("region", { name: "School fee" })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Pre-Form One programme" })).toHaveCount(0)

  await page.goto(`/staff/leads/${SABRA}`)
  const programme = page.getByRole("region", { name: "Pre-Form One programme" })
  await expect(programme.getByRole("checkbox", { name: "Pre-Form One programme" })).toBeChecked()
  await expect(programme).toContainText("Doesn't apply: this lead's class is no longer FORM 1.")

  // The Accountant isn't offered the Pre-Form One fee while it doesn't apply.
  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${SABRA}`)
  await page.getByRole("button", { name: "Record payment" }).click()
  await expect(page.getByRole("form", { name: "Record payment" }).getByLabel("Payment type").locator("option", { hasText: "Pre-Form One fee" })).toHaveCount(0)
})
