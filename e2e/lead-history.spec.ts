import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { signInOnce } from "./log-in"

// Reading a lead's history on its own screen. Only the Super Admin reads it
// (#237); everyone else keeps the status and the day it last changed. Each
// test registers its own family, so the seeded leads other tests read stay
// as they are.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
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
    await page.goto(`/staff/applicants/${lead.id}`)

    await page.getByRole("button", { name: "Edit student" }).click()
    const form = page.getByRole("form", { name: "Edit student" })
    await form.getByLabel("Class").selectOption("STD 4")
    await form.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Student details saved.")

    await openLeadHistoryAsSuperAdmin(page)
    await expect(page).toHaveURL(new RegExp(`/staff/applicants/${lead.id}/history$`))
    await expect(page.getByText(`${lead.name} · ${lead.admissionNumber}`)).toBeVisible()

    const entries = page.getByRole("list", { name: "History" }).locator(":scope > li")
    await expect(entries).toHaveCount(3)
    await expect(entries.nth(0)).toContainText(`${ADMISSIONS.name} changed the application`)
    await expect(entries.nth(0)).toContainText("Class: STD 3 → STD 4")
    await expect(entries.nth(1)).toContainText(`${ADMISSIONS.name} created the application`)
    await expect(entries.nth(1)).toContainText(`Student name: ${lead.name}`)
    await expect(entries.nth(1)).toContainText("Parent or guardian: Halima History")
    await expect(entries.nth(2)).toContainText(`${ADMISSIONS.name} added the parent or guardian Halima History`)

    await page.getByRole("link", { name: "Back to the application" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/applicants/${lead.id}$`))
  })

  for (const person of [MANAGER, ACCOUNTANT]) {
    test(`${person.roleName} sees the status and its date, no History link, and a forbidden History page`, async ({ page }) => {
      const lead = await walkInLead()
      await signIn(page, person)
      await page.goto(`/staff/applicants/${lead.id}`)
      await expect(page.getByText(/^since \d{1,2} \w{3} \d{4}$/)).toBeVisible()
      await expect(page.getByRole("link", { name: "History" })).toHaveCount(0)

      await page.goto(`/staff/applicants/${lead.id}/history`)
      await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
      await expect(page.getByRole("list", { name: "History" })).toHaveCount(0)
    })
  }
})
