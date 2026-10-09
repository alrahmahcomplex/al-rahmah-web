import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { decideDiscount, requestDiscount } from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, getLead } from "@/lib/services/leads"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Requesting, granting and refusing a Staff child or Qualified orphan
// discount, and recording Fee waived (#112). Each test makes its own Passed
// STD 2 Day lead (TZS 2,000,000) in a year it claims with a schedule of its
// own (tests/support/fee-years.ts).

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

async function passedLead(): Promise<{ id: string; admissionNumber: string }> {
  const claim = await claimFeeYear()
  claims.push(claim)
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)).ok) throw new Error("setup failed")

  const admissions = await signedIn(ADMISSIONS)
  const phone = `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Discount ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(registered.error)
  const result = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!result.ok) throw new Error(result.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, claim.year]))
  const lead = await getLead(admissions, id)
  if (!lead.ok) throw new Error(lead.error)
  return { id, admissionNumber: lead.data.admissionNumber }
}

function feeDetail(page: Page, term: string) {
  return page
    .getByRole("region", { name: "School fee" })
    .locator("dl")
    .first()
    .locator("dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]")
}

test("Admissions Staff request a Staff child discount, and the Manager grants it from Discount requests", async ({ page }) => {
  const lead = await passedLead()

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead.id}`)
  await expect(page.getByRole("link", { name: /Discount requests/ })).toHaveCount(0)
  const panel = page.getByRole("region", { name: "Discounts" })
  await panel.getByRole("button", { name: "Request discount" }).click()
  const form = panel.getByRole("form", { name: "Request discount" })
  await expect(form).toContainText("Write only what the Admissions Manager needs to decide.")
  await form.getByLabel("Discount").selectOption("Staff child (25% off)")
  await form.getByLabel("Note for the Manager").fill("Mother teaches Year 3.")
  await form.getByRole("button", { name: "Request discount" }).click()

  const pending = panel.getByRole("group", { name: "Pending discount request" })
  await expect(pending).toContainText("Staff child (25% off)")
  await expect(pending).toContainText("Requested by you on")
  await expect(pending).toContainText("Mother teaches Year 3.")
  // One request at a time.
  await expect(panel.getByRole("button", { name: "Request discount" })).toHaveCount(0)

  await signIn(page, MANAGER)
  const nav = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /Discount requests/ })
  await expect(nav).toContainText(/\d+/)
  await nav.click()
  await expect(page.getByRole("heading", { name: "Discount requests" })).toBeVisible()
  const row = page.getByRole("listitem", { name: new RegExp(lead.admissionNumber) })
  await expect(row).toContainText("Staff child (25% off)")
  await expect(row).toContainText(`Requested by ${ADMISSIONS.name}`)
  await row.getByRole("button", { name: "Grant" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Grant discount" }).click()
  await expect(row).toHaveCount(0)

  await page.goto(`/staff/leads/${lead.id}`)
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 1,500,000")
  await expect(page.getByRole("region", { name: "School fee" })).toContainText("Staff child discount, 25% off TZS 2,000,000")
  await expect(page.getByRole("region", { name: "Discounts" })).toContainText(`Granted by ${MANAGER.name}`)

  await page.goto(`/staff/leads/${lead.id}/history`)
  await expect(page.getByText("requested a Staff child discount")).toBeVisible()
  await expect(page.getByText("granted the discount request")).toBeVisible()
})

test("the Manager refuses a request on the lead with a reason, which the requester reads there", async ({ page }) => {
  const lead = await passedLead()
  const made = await requestDiscount(await signedIn(ADMISSIONS), lead.id, "staff_child", "Father drives the bus.", randomUUID())
  if (!made.ok) throw new Error(JSON.stringify(made.error))

  await signIn(page, MANAGER)
  await page.goto(`/staff/leads/${lead.id}`)
  const panel = page.getByRole("region", { name: "Discounts" })
  await panel.getByRole("button", { name: "Refuse" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Refuse request" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Write why the discount is refused.")
  await dialog.getByLabel("Why is it refused?").fill("The bus is run by a contractor.")
  await dialog.getByRole("button", { name: "Refuse request" }).click()
  await expect(dialog).toHaveCount(0)

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead.id}`)
  const decided = page.getByRole("region", { name: "Discounts" })
  await expect(decided).toContainText(`Refused by ${MANAGER.name}`)
  await expect(decided).toContainText("Reason for refusing: The bus is run by a contractor.")
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 2,000,000")
  // A new request may follow the refusal.
  await expect(decided.getByRole("button", { name: "Request discount" })).toBeVisible()
})

test("the Accountant records Fee waived on a lead with a granted Qualified orphan discount", async ({ page }) => {
  const lead = await passedLead()
  const made = await requestDiscount(await signedIn(ADMISSIONS), lead.id, "qualified_orphan", "Both parents died.", randomUUID())
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  if (!(await decideDiscount(await signedIn(MANAGER), made.data, { decision: "grant" })).ok) throw new Error("grant failed")

  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${lead.id}`)
  await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 0")
  const section = page.getByRole("region", { name: "School fee" })
  await section.getByRole("button", { name: "Record payment" }).click()
  const form = page.getByRole("form", { name: "Record payment" })
  await form.getByLabel("Payment type").selectOption("Fee waived")
  await expect(form.getByLabel("Amount (TZS)")).toHaveCount(0)
  await form.getByRole("button", { name: "Review payment" }).click()
  const review = page.getByRole("region", { name: "Review payment" })
  await expect(review).toContainText("Fee waived")
  await expect(review).toContainText("Full")
  await review.getByRole("button", { name: "Confirm payment" }).click()
  await expect(section.getByRole("status")).toContainText("Seat priority: Full.")
  await expect(feeDetail(page, "Seat priority")).toHaveText("Full")
  await expect(feeDetail(page, "Enrolled")).toHaveText("By Fee waived")
})
