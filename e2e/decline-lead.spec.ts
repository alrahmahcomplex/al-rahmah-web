import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Declining a lead from the lead screen (#97). Each test declines a lead of
// its own; the seeded ones are only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 8's seeded lead declined after its interview, and slice 2's Archived
// lead.
const DECLINED_FROM_INTERVIEWED = "1ead0000-0000-4000-8000-000000000082"
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in lead of the test's own: Visited.
async function newLead() {
  const name = `Decline ${randomUUID().slice(0, 6)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Decline Parent", relationship: "Mother", phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return { id: created.data.leadId, name, admissionNumber: created.data.admissionNumber }
}

const declineButton = (page: Page) =>
  page.getByRole("region", { name: "Decline", exact: true }).getByRole("button", { name: "Decline", exact: true })

test.describe("declining a lead", () => {
  test("Admissions Staff decline with Other, explained, after confirming, and the banner tells the story", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await declineButton(page).click()
    const dialog = page.getByRole("dialog", { name: `Decline ${lead.name}`, exact: true })
    await dialog.getByLabel("Reason").selectOption("Other")
    await dialog.getByRole("button", { name: "Continue" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Write an explanation for Other.")

    await dialog.getByLabel("Explanation").fill("The family is moving to Arusha.")
    await dialog.getByRole("button", { name: "Continue" }).click()

    const confirm = page.getByRole("dialog", { name: `Decline ${lead.name}?`, exact: true })
    await expect(confirm).toContainText("This lead becomes read-only. Bringing it back needs a Manager's approval.")
    await expect(confirm).toContainText(lead.admissionNumber)
    await expect(confirm).toContainText("Other")
    await expect(confirm).toContainText("The family is moving to Arusha.")
    await confirm.getByRole("button", { name: "Decline lead" }).click()

    const banner = page.getByRole("region", { name: "This lead is Declined" })
    await expect(banner).toContainText("Other")
    await expect(banner).toContainText("The family is moving to Arusha.")
    await expect(banner).toContainText(ADMISSIONS.name)
    await expect(banner).toContainText("Visited")
    await expect(page.getByRole("region", { name: "Decline", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit student" })).toHaveCount(0)

    await page.getByRole("link", { name: "History" }).click()
    await expect(page.getByText("declined the lead").first()).toBeVisible()
  })

  test("Back keeps the choice, and Cancel leaves the lead as it was", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await declineButton(page).click()
    const dialog = page.getByRole("dialog", { name: `Decline ${lead.name}`, exact: true })
    await dialog.getByLabel("Reason").selectOption("Fees or cost")
    await dialog.getByRole("button", { name: "Continue" }).click()
    await page.getByRole("dialog", { name: `Decline ${lead.name}?`, exact: true }).getByRole("button", { name: "Back" }).click()
    await expect(dialog.getByLabel("Reason")).toHaveValue("Fees or cost")
    await dialog.getByRole("button", { name: "Cancel" }).click()

    await page.reload()
    await expect(declineButton(page)).toBeVisible()
    await expect(page.getByRole("region", { name: /^This lead is/ })).toHaveCount(0)
  })

  test("No seat available is offered to the Manager only", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await declineButton(page).click()
    const options = page.getByRole("dialog").getByLabel("Reason").locator("option")
    await expect(options).toContainText(["Fees or cost", "Other"])
    await expect(options.filter({ hasText: "No seat available" })).toHaveCount(0)

    await page.context().clearCookies()
    await signIn(page, MANAGER)
    await page.goto(`/staff/leads/${lead.id}`)
    await declineButton(page).click()
    await expect(page.getByRole("dialog").getByLabel("Reason").locator("option", { hasText: "No seat available" })).toHaveCount(1)
  })

  test("the Accountant gets no Decline, and a closed lead offers none", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(page.getByRole("heading", { name: lead.name })).toBeVisible()
    await expect(page.getByRole("button", { name: "Decline", exact: true })).toHaveCount(0)

    await page.context().clearCookies()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${ARCHIVED}`)
    await expect(page.getByRole("region", { name: "This lead is Archived" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Decline", exact: true })).toHaveCount(0)
  })

  test("a lead declined after its interview shows its reason, explanation, who and when", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${DECLINED_FROM_INTERVIEWED}`)
    const banner = page.getByRole("region", { name: "This lead is Declined" })
    await expect(banner).toContainText("Did not pass interview")
    await expect(banner).toContainText("Scored below the pass mark")
    await expect(banner).toContainText(ADMISSIONS.name)
    await expect(banner).toContainText(/15 Sept? 2026/)
    await expect(banner).toContainText("Interviewed")
  })
})
