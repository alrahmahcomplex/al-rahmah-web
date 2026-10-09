import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Adjusting and voiding school-fee payments on the lead screen (#110). The
// test that adjusts claims a year of its own with a schedule of its own
// (tests/support/fee-years.ts); the seeded closed leads are only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Seeded: Zawadi Malipo, Declined, with an Initial deposit.
const SEEDED_DECLINED = "1ead0000-0000-4000-8000-000000000905"

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

// STD 3 Day: TZS 2,000,000, so First instalment from 800,000.
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

// A Passed STD 3 Day lead in a claimed year, with two Initial deposits of
// TZS 300,000 recorded: the second one by mistake.
async function leadWithDuplicatePayment(): Promise<string> {
  const claim = await claimFeeYear()
  claims.push(claim)
  const accountant = await signedIn(ACCOUNTANT)
  if (!(await saveFeeAmounts(accountant, claim.year, AMOUNTS)).ok) throw new Error("setup failed")

  const admissions = await signedIn(ADMISSIONS)
  const phone = `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Adjusted ${randomUUID().slice(0, 6)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(registered.error)
  const result = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!result.ok) throw new Error(result.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, claim.year]))

  for (const paidOn of ["2026-09-01", today]) {
    const paid = await recordPayment(accountant, id, { type: "initial_deposit", amount: 300_000, paidOn }, randomUUID())
    if (!paid.ok) throw new Error(paid.error)
  }
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

test("the Accountant adjusts one payment and voids a duplicate, and each shows its original entry and adjustment", async ({ page }) => {
  const id = await leadWithDuplicatePayment()

  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${id}`)
  const section = page.getByRole("region", { name: "School fee" })
  await expect(feeDetail(page, "Total paid")).toHaveText("TZS 600,000")
  const payments = section.getByRole("list", { name: "Payments" }).locator(":scope > li")
  await expect(payments).toHaveCount(2)
  // Newest first: today's duplicate, then the 1 September deposit.
  const [duplicate, first] = [payments.nth(0), payments.nth(1)]

  // Adjust the first deposit: it was really TZS 850,000.
  await first.getByRole("button", { name: "Adjust" }).click()
  const form = page.getByRole("form", { name: "Adjust payment" })
  await expect(form.getByLabel("Amount (TZS)")).toHaveValue("300,000")
  await form.getByLabel("Reason").selectOption("Wrong amount")
  await form.getByLabel("Amount (TZS)").fill("850,000")
  await form.getByLabel("Note (optional)").fill("The receipt says 850,000.")
  await form.getByRole("button", { name: "Save adjustment" }).click()
  await expect(form).toHaveCount(0)
  await expect(section.getByRole("status").filter({ hasText: "Adjustment saved" })).toHaveText(
    "Adjustment saved. Total paid is TZS 1,150,000. Seat priority: First instalment.",
  )
  await expect(feeDetail(page, "Total paid")).toHaveText("TZS 1,150,000")

  const adjusted = payments.filter({ hasText: "TZS 850,000" })
  await expect(adjusted.getByText("Adjusted", { exact: true })).toBeVisible()
  const trail = adjusted.getByRole("list", { name: "Original entry and adjustments" }).getByRole("listitem")
  await expect(trail).toHaveCount(2)
  await expect(trail.nth(0)).toContainText("Original entry: Initial deposit, TZS 300,000")
  await expect(trail.nth(0)).toContainText(`Recorded by ${ACCOUNTANT.name}`)
  await expect(trail.nth(1)).toContainText("Wrong amount: Initial deposit, TZS 850,000")
  await expect(trail.nth(1)).toContainText(`Adjusted by ${ACCOUNTANT.name}`)
  await expect(trail.nth(1)).toContainText("Note: The receipt says 850,000.")

  // Void the duplicate.
  await duplicate.getByRole("button", { name: "Adjust" }).click()
  await form.getByLabel("Reason").selectOption("Duplicate entry")
  await expect(form.getByLabel("Amount (TZS)")).toHaveCount(0)
  await form.getByRole("button", { name: "Void payment" }).click()
  await expect(form).toHaveCount(0)
  await expect(feeDetail(page, "Total paid")).toHaveText("TZS 850,000")
  await expect(feeDetail(page, "Seat priority")).toHaveText("First instalment")

  const voided = payments.filter({ has: page.getByText("Void", { exact: true }) })
  await expect(voided).toHaveCount(1)
  await expect(voided).toContainText("No longer counts toward Total paid.")
  const voidTrail = voided.getByRole("list", { name: "Original entry and adjustments" }).getByRole("listitem")
  await expect(voidTrail.nth(0)).toContainText("Original entry: Initial deposit, TZS 300,000")
  await expect(voidTrail.nth(1)).toContainText("Duplicate entry: voided.")

  // A voided payment comes back only with Data-entry correction.
  await voided.getByRole("button", { name: "Adjust" }).click()
  await expect(page.getByRole("heading", { name: "Restore payment" })).toBeVisible()
  await expect(form.getByLabel("Reason").locator("option:not([disabled])")).toHaveText(["Data-entry correction"])
  await form.getByRole("button", { name: "Cancel" }).click()

  // The history says what each adjustment did.
  await page.goto(`/staff/leads/${id}/history`)
  await expect(page.getByText("voided a school-fee payment")).toBeVisible()
  await expect(page.getByText("adjusted a school-fee payment")).toBeVisible()
  await expect(page.getByText("changed the Seat priority, because a payment was adjusted")).toBeVisible()
})

test("a Declined lead's payment offers Adjust to the Accountant, and Admissions Staff see no Adjust", async ({ page }) => {
  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${SEEDED_DECLINED}`)
  const section = page.getByRole("region", { name: "School fee" })
  await expect(section.getByRole("button", { name: "Record payment" })).toHaveCount(0)
  await expect(section.getByRole("list", { name: "Payments" }).getByRole("button", { name: "Adjust" })).toHaveCount(1)

  await page.context().clearCookies()
  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${SEEDED_DECLINED}`)
  await expect(page.getByRole("region", { name: "School fee" }).getByRole("list", { name: "Payments" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Adjust" })).toHaveCount(0)
})
