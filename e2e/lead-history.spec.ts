import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "./db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "./fixtures"

// Reading a lead's history on its own screen, as staff do. Each test registers
// its own family, so the seeded leads other tests read stay as they are.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function walkInLead() {
  const name = `Neema History ${randomUUID().slice(0, 6)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Halima History", relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return { id: created.data.leadId, admissionNumber: created.data.admissionNumber, name }
}

test.describe("a lead's history", () => {
  test("shows an edit first, with who made it and the old and new value", async ({ page }) => {
    const lead = await walkInLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await page.getByRole("button", { name: "Edit student" }).click()
    const form = page.getByRole("form", { name: "Edit student" })
    await form.getByLabel("Class").selectOption("STD 4")
    await form.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Student details saved.")

    await page.getByRole("link", { name: "History" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}/history$`))
    await expect(page.getByText(`${lead.name} · ${lead.admissionNumber}`)).toBeVisible()

    const entries = page.getByRole("list", { name: "History" }).locator(":scope > li")
    await expect(entries).toHaveCount(3)
    await expect(entries.nth(0)).toContainText(`${ADMISSIONS.name} changed the lead`)
    await expect(entries.nth(0)).toContainText("Class: STD 3 → STD 4")
    await expect(entries.nth(1)).toContainText(`${ADMISSIONS.name} created the lead`)
    await expect(entries.nth(1)).toContainText(`Student name: ${lead.name}`)
    await expect(entries.nth(1)).toContainText("Parent or guardian: Halima History")
    await expect(entries.nth(2)).toContainText(`${ADMISSIONS.name} added the parent or guardian Halima History`)

    await page.getByRole("link", { name: "Back to the lead" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}$`))
  })

  test("the Accountant reads it too", async ({ page }) => {
    const lead = await walkInLead()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)
    await page.getByRole("link", { name: "History" }).click()

    await expect(page.getByRole("list", { name: "History" }).locator(":scope > li")).toHaveCount(2)
  })
})
