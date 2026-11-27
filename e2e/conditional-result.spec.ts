import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { markAgreementSigned, recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { releaseResult } from "@/lib/services/result-release"
import { recordPayment } from "@/lib/services/school-fee-payments"

import { asSystem, createThrowawayStaff, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"

// The Conditional interview result (prototype v7, 2026-11-27): recording it,
// the head of school marking its agreement signed, and the Accountant's
// warning while it isn't.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: Pick<FixtureStaff, "email" | "password">) {
  await signInOnce(page, person.email, person.password)
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

// A walk-in lead of the test's own, registered for interview with its fee
// Paid, in a fee year it claims with a schedule of its own.
async function registeredLead(): Promise<{ id: string; interviewId: string }> {
  const claim = await claimFeeYear()
  claims.push(claim)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error("setup failed")
  const admissions = await signedIn(ADMISSIONS)
  const phone = `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Candidate ${randomUUID().slice(0, 6)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(admissions, created.data.leadId)
  if (!registered.ok) throw new Error(registered.error)
  const paid = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), registered.data.interviewId, "paid")
  if (!paid.ok) throw new Error(paid.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, claim.year]))
  return { id: created.data.leadId, interviewId: registered.data.interviewId }
}

// Conditional, and the result sent, so the agreement is the next step.
async function conditionalLead() {
  const lead = await registeredLead()
  const admissions = await signedIn(ADMISSIONS)
  const recorded = await recordInterviewResult(admissions, lead.interviewId, { interviewDate: today, result: "Conditional", score: 47 })
  if (!recorded.ok) throw new Error(recorded.error)
  const sent = await releaseResult(admissions, lead.interviewId, "sms", { officePhone: "+255 673 526 644" })
  if (!sent.ok) throw new Error(sent.error)
  return lead
}

const panel = (page: Page) => page.getByRole("region", { name: "Interview" })
const nextStep = (page: Page) => page.getByRole("region", { name: "Next step" })

test.describe("a Conditional interview result", () => {
  test("Admissions Staff record it, with the note about the agreement", async ({ page }) => {
    const lead = await registeredLead()
    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))

    await panel(page).getByRole("button", { name: "Record result" }).click()
    const form = panel(page).getByRole("form", { name: "Record result" })
    await expect(form.getByText("The family signs it before paying the School fee.")).toHaveCount(0)
    await form.locator("label").filter({ hasText: "Conditional" }).click()
    await expect(form.getByText("Below the pass mark, taken on an agreement. The family signs it before paying the School fee.")).toBeVisible()
    await form.getByLabel("Score (%)").fill("47")
    await form.getByRole("button", { name: "Save result" }).click()

    await expect(panel(page).getByRole("status")).toHaveText("Result recorded. The applicant is Interviewed.")
    await expect(panel(page).getByText("Sign the agreement, then complete enrollment", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Not signed yet", { exact: true })).toBeVisible()
  })

  test("other staff wait for the agreement; the head of school marks it signed", async ({ page, browser }) => {
    const lead = await conditionalLead()
    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id))
    await expect(nextStep(page)).toContainText("Next step: Waiting for the agreement")
    await expect(nextStep(page)).toContainText("The family signs at the Head of Primary School's office.")
    await expect(nextStep(page).getByRole("button", { name: "Mark agreement signed" })).toHaveCount(0)

    const head = await createThrowawayStaff(["leads.view", "agreements.mark"])
    const headPage = await (await browser.newContext()).newPage()
    await signIn(headPage, head)
    await headPage.goto(leadUrl(lead.id))
    await expect(nextStep(headPage)).toContainText("Next step: Get the agreement signed")
    await nextStep(headPage).getByRole("button", { name: "Mark agreement signed" }).click()
    await expect(nextStep(headPage).getByRole("status")).toHaveText("Agreement marked signed.")
    await expect(nextStep(headPage)).toContainText("Next step: Collect the School fee")

    await headPage.goto(leadUrl(lead.id, "Interview"))
    await expect(panel(headPage)).toContainText(`Signed on ${formatDate(today)}`)
    await expect(panel(headPage)).toContainText(`marked by ${head.name}`)
  })

  test("the head can still mark it once a full payment has enrolled the student", async ({ page }) => {
    const lead = await conditionalLead()
    const paid = await recordPayment(await signedIn(ACCOUNTANT), lead.id, { type: "full_payment", amount: 2_000_000, paidOn: today }, randomUUID())
    if (!paid.ok) throw new Error(paid.error)

    const head = await createThrowawayStaff(["leads.view", "agreements.mark"])
    await signIn(page, head)
    await page.goto(leadUrl(lead.id))
    await expect(nextStep(page)).toContainText("Next step: Nothing is waiting")
    await nextStep(page).getByRole("button", { name: "Mark agreement signed" }).click()
    await expect(nextStep(page).getByRole("status")).toHaveText("Agreement marked signed.")
    await expect(nextStep(page).getByRole("button", { name: "Mark agreement signed" })).toHaveCount(0)
  })

  test("the Accountant is warned while the agreement isn't marked, and may still take the payment", async ({ page }) => {
    const lead = await conditionalLead()
    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(lead.id, "School fee"))
    const section = page.getByRole("region", { name: "School fee" })
    await section.getByRole("button", { name: "Record payment" }).click()
    const warning = "Conditional result: the agreement isn't marked as signed yet. Check the family has signed it before you take the payment."
    await expect(section.getByRole("form", { name: "Record payment" }).getByText(warning)).toBeVisible()

    const head = await createThrowawayStaff(["leads.view", "agreements.mark"])
    const marked = await markAgreementSigned(await signedIn(head), lead.interviewId)
    if (!marked.ok) throw new Error(marked.error)
    await page.reload()
    await section.getByRole("button", { name: "Record payment" }).click()
    await expect(section.getByRole("form", { name: "Record payment" })).toBeVisible()
    await expect(section.getByText(warning)).toHaveCount(0)
  })
})
