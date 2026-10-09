import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, getLead } from "@/lib/services/leads"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Recording school-fee payments on the lead screen, and the Seat priority on
// the lead and the lead list. A test that records claims a year of its own
// with a schedule of its own (tests/support/fee-years.ts); the seeded #107
// leads are only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Seeded: Juma Malipo, STD 2 Day 2027, Initial deposit 300,000 on 25 Sep 2026.
const SEEDED_DEPOSIT = "1ead0000-0000-4000-8000-000000000902"
// Slice 2's seeded Archived lead, in 2027.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

let claims: FeeYearClaim[] = []

test.afterEach(async () => {
  await Promise.all(claims.map((claim) => claim.release()))
  claims = []
})

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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  claims.push(claim)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error("setup failed")
  return claim.year
}

// A walk-in STD 3 Day lead in `year`, interviewed with the given result.
async function interviewedLead(year: number, result: "Passed" | "Failed"): Promise<{ id: string; admissionNumber: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const phone = `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Payer ${randomUUID().slice(0, 6)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(admissions, created.data.leadId)
  if (!registered.ok) throw new Error(registered.error)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result,
    score: result === "Passed" ? 80 : 20,
  })
  if (!recorded.ok) throw new Error(recorded.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]))
  return { id: created.data.leadId, admissionNumber: created.data.admissionNumber }
}

// A detail of the fee itself, not of the payment under review.
function feeDetail(page: Page, term: string) {
  return page
    .getByRole("region", { name: "School fee" })
    .locator("dl")
    .first()
    .locator("dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]")
}

test.describe("recording a school-fee payment", () => {
  test("the Accountant records a payment through the preview, and the lead and the lead list show its Seat priority", async ({ page }) => {
    const lead = await interviewedLead(await yearWithSchedule(), "Passed")

    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)
    const section = page.getByRole("region", { name: "School fee" })
    await expect(feeDetail(page, "Seat priority")).toHaveText("None yet")
    await expect(section.getByText("No payments recorded yet.")).toBeVisible()

    await section.getByRole("button", { name: "Record payment" }).click()
    const form = page.getByRole("form", { name: "Record payment" })
    await expect(form.getByLabel("Payment date")).toHaveValue(today)
    await form.getByLabel("Payment type").selectOption("Initial deposit")
    await form.getByLabel("Amount (TZS)").fill("850,000")
    await form.getByRole("button", { name: "Review payment" }).click()

    // The preview: a deposit that reaches 40% counts as First instalment.
    const review = page.getByRole("region", { name: "Review payment" })
    await expect(review).toContainText("Initial deposit, TZS 850,000")
    await expect(review).toContainText("TZS 850,000now TZS 0")
    await expect(review).toContainText("TZS 1,150,000")
    await expect(review).toContainText("First instalmentnow none")
    // Nothing is recorded until Confirm.
    await expect(feeDetail(page, "Total paid")).toHaveText("TZS 0")

    await review.getByRole("button", { name: "Confirm payment" }).click()
    await expect(section.getByRole("status")).toHaveText(
      "Payment recorded. Total paid is TZS 850,000. Seat priority: First instalment.",
    )
    await expect(feeDetail(page, "Total paid")).toHaveText("TZS 850,000")
    await expect(feeDetail(page, "Balance")).toHaveText("TZS 1,150,000")
    await expect(feeDetail(page, "Seat priority")).toHaveText("First instalment")
    await expect(section.locator("dt", { hasText: "Seat priority" })).toContainText(`Since ${formatDate(today)}`)
    const payments = section.getByRole("list", { name: "Payments" }).getByRole("listitem")
    await expect(payments).toHaveCount(1)
    await expect(payments.first()).toContainText("Initial deposit")
    await expect(payments.first()).toContainText("TZS 850,000")
    await expect(payments.first()).toContainText(`Recorded by ${ACCOUNTANT.name}`)

    // The lead list shows the badge on the lead's row.
    await page.goto(`/staff/leads?q=${lead.admissionNumber}`)
    const row = page.getByRole("table", { name: "Leads" }).locator("tbody tr")
    await expect(row).toHaveCount(1)
    await expect(row.locator("td").last()).toHaveText("First instalment")

    // The payment is in the lead's history.
    await page.goto(`/staff/leads/${lead.id}/history`)
    await expect(page.getByText("recorded a school-fee payment")).toBeVisible()
  })

  test("a lead whose interview wasn't Passed is refused in a plain sentence, and nothing is recorded", async ({ page }) => {
    const lead = await interviewedLead(await yearWithSchedule(), "Failed")

    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)
    const section = page.getByRole("region", { name: "School fee" })
    await section.getByRole("button", { name: "Record payment" }).click()
    const form = page.getByRole("form", { name: "Record payment" })
    await form.getByLabel("Payment type").selectOption("Full payment")
    await form.getByLabel("Amount (TZS)").fill("2000000")
    await form.getByRole("button", { name: "Review payment" }).click()
    await expect(form.getByRole("alert")).toHaveText(
      "Payments can be recorded only once the lead's current interview result is Passed, or a reopening approved it to enrol without a retaken interview.",
    )
    await expect(page.getByRole("region", { name: "Review payment" })).toHaveCount(0)
    await expect(section.getByText("No payments recorded yet.")).toBeVisible()
  })

  test("a closed lead shows its School fee without Record payment", async ({ page }) => {
    const archived = await getLead(await signedIn(ADMISSIONS), ARCHIVED)
    expect(archived.ok && archived.data.closure).toBe("Archived")

    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${ARCHIVED}`)
    const section = page.getByRole("region", { name: "School fee" })
    await expect(feeDetail(page, "Annual fee")).toBeVisible()
    await expect(section.getByRole("region", { name: "Payments" })).toBeVisible()
    await expect(section.getByRole("button", { name: "Record payment" })).toHaveCount(0)
  })
})

test.describe("staff who can't record payments", () => {
  test("Admissions Staff see the fee, the payments and the Seat priority, but no Record payment", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${SEEDED_DEPOSIT}`)

    const section = page.getByRole("region", { name: "School fee" })
    await expect(feeDetail(page, "Total paid")).toHaveText("TZS 300,000")
    await expect(feeDetail(page, "Seat priority")).toHaveText("Deposit")
    const payments = section.getByRole("list", { name: "Payments" }).getByRole("listitem")
    await expect(payments).toHaveCount(1)
    await expect(payments.first()).toContainText("Initial deposit")
    await expect(payments.first()).toContainText(`Paid ${formatDate("2026-09-25")}`)
    await expect(section.getByRole("button", { name: "Record payment" })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})
