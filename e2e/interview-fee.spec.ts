import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { leadUrl, openLeadTab } from "./lead-page"

// Marking the interview fee Paid or Not Paid on the lead screen's interview
// panel.

const thisYear = Number(tanzaniaToday().slice(0, 4))

// Slice 5's seeded Passed lead, Neema Interview, whose fee is Paid.
const PAID = "1ead0000-0000-4000-8000-000000000503"
// ADMSN-90918 Rukia Maandalizi (seeds/90_fees.sql): Passed, fee Not Paid.
const RUKIA = "1ead0000-0000-4000-8000-000000000918"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead of the test's own as the Admission form makes it, registered for
// interview, with no result yet and its fee Not Paid.
async function registeredLead() {
  const name = `Candidate ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Fee Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { id: created.data.leadId, name, admissionNumber: created.data.admissionNumber }
}

const panel = (page: Page) => page.getByRole("region", { name: "Interview" })

test.describe("the interview fee", () => {
  test("the Accountant finds the lead by its Admission Number, marks the fee Paid and sees the amount locked", async ({ page }) => {
    const lead = await registeredLead()
    await signIn(page, ACCOUNTANT)

    // Slice 2's lead search, as at the counter.
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Leads" }).click()
    await page.getByLabel("Search leads").fill(lead.admissionNumber)
    await page.getByRole("button", { name: "Search" }).click()
    await page.getByRole("link", { name: lead.name }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}$`))
    await openLeadTab(page, "Interview")

    // The fee as it comes to now, before any interview has happened.
    await expect(panel(page)).toContainText("No result yet")
    await expect(panel(page)).toContainText("Not Paid")
    await expect(panel(page)).toContainText("Amount to pay")
    await expect(panel(page).getByText("TZS 50,000", { exact: true })).toBeVisible()
    // Nothing to type, and nothing but the fee to change.
    await expect(panel(page).getByRole("textbox")).toHaveCount(0)
    await expect(panel(page).getByRole("spinbutton")).toHaveCount(0)
    for (const name of ["Register for interview", "Record result", "Correct result"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }

    await panel(page).getByRole("button", { name: "Mark paid" }).click()
    await expect(panel(page).getByRole("status")).toHaveText("Marked Paid. TZS 50,000 is locked as the amount paid.")
    await expect(panel(page)).toContainText("Amount paid")
    await expect(panel(page)).toContainText("Locked when the fee was marked Paid.")
    await expect(panel(page).getByRole("button", { name: "Mark paid" })).toHaveCount(0)

    // A wrong click is undone, which releases the lock.
    await panel(page).getByRole("button", { name: "Mark not paid" }).click()
    await expect(panel(page).getByRole("status")).toHaveText("Marked Not Paid. The amount is no longer locked.")
    await expect(panel(page)).toContainText("Amount to pay")
    await expect(panel(page).getByRole("button", { name: "Mark paid" })).toBeVisible()

    await openLeadHistoryAsSuperAdmin(page, lead.id)
    await expect(page.getByText("marked the interview fee Paid")).toBeVisible()
    await expect(page.getByText("marked the interview fee Not Paid")).toBeVisible()
  })

  test("the Next step on a Visited lead whose fee is Not Paid takes the Accountant to the fee", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(RUKIA))
    await expect(page.getByRole("region", { name: "Next step" })).toContainText(
      "Next step: Collect the interview fee, TZS 50,000",
    )
    await page.getByRole("link", { name: "Record interview fee" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${RUKIA}\\?tab=interview#lead-interview$`))
    await expect(panel(page).getByRole("button", { name: "Mark paid" })).toBeVisible()

    // Admissions Staff, who can't mark it, are pointed at the tab instead.
    await page.context().clearCookies()
    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(RUKIA))
    await expect(page.getByRole("region", { name: "Next step" })).toContainText("Collect the interview fee")
    await expect(page.getByRole("link", { name: "Record interview fee" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Open Interview" })).toBeVisible()
  })

  test("Admissions Staff see the fee and the amount paid, with no control to change it", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(PAID, "Interview"))

    await expect(panel(page)).toContainText("Paid")
    await expect(panel(page)).toContainText("Amount paid")
    await expect(panel(page).getByText("TZS 50,000", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Mark not paid" })).toHaveCount(0)

    // The Referral code panel agrees with the amount paid, not the fee as it
    // would come to now.
    await openLeadTab(page, "Overview")
    const referral = page.getByRole("region", { name: "Referral code" })
    await expect(referral.getByLabel("Interview fee paid")).toHaveText("TZS 50,000")
    await expect(referral.getByLabel("Expected interview fee")).toHaveCount(0)
  })

  test("a closed lead keeps showing its fee, with no control for the Accountant", async ({ page }) => {
    const lead = await registeredLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = $1", [lead.id]))
    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(lead.id, "Interview"))

    await expect(panel(page)).toContainText("Not Paid")
    await expect(page.getByRole("button", { name: "Mark paid" })).toHaveCount(0)
  })
})
