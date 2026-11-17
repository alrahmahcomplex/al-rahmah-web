import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// The Reopening requests queue and its navigation count (#100), drawn in the
// new shell (#322). It only reads the seeded Pending request on ADMSN-90080
// Asha Kibwana, raised by Test Admissions; other tests raise and decide
// requests meanwhile, so the count is checked to be there, not to be a given
// number. The old shell, on Reports, still shows the count beside the
// entry; the new shell shows none.

const SEEDED_PENDING_LEAD = "1ead0000-0000-4000-8000-000000000080"

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// The staff 404 (the catch-all route), the only page the old shell still
// draws, shows the counts beside the entries; the new shell shows none
// (#323, #328, #331). Not for the Accountant: it throws React error #419 for
// them (#437).
const UNKNOWN = "/staff/no-such-page"
const UNKNOWN_404 = /^console\.error: Failed to load resource: the server responded with a status of 404 \(Not Found\) \(http:\/\/[^)]+\/staff\/no-such-page\)$/

const navEntry = (page: Page) => page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /Reopening requests/ })

test("the Manager sees the Pending count in the navigation and the seeded request in the queue", async ({ page, allowConsoleError }) => {
  await signIn(page, MANAGER)
  allowConsoleError(UNKNOWN_404, "the staff 404 may answer with a 404 status")
  await page.goto(UNKNOWN)
  await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible()
  await expect(navEntry(page)).toHaveAccessibleName(/^Reopening requests\s*,\s*[1-9]\d*\s+Pending$/)

  await navEntry(page).click()
  await expect(page).toHaveURL(/\/staff\/reopenings$/)
  await expect(page.getByRole("heading", { name: "Reopening requests", level: 1 })).toBeVisible()
  // The new shell's entry carries no count.
  await expect(navEntry(page)).toHaveAccessibleName("Reopening requests")

  const table = page.getByRole("table", { name: "Pending reopening requests" })
  const row = table.getByRole("row").filter({ hasText: "ADMSN-90080" })
  await expect(row).toContainText("Asha Kibwana")
  await expect(row).toContainText("Declined")
  await expect(row).toContainText(ADMISSIONS.name)
  await expect(row).toContainText(/28 Sept? 2026, 09:15 · From the application page/)
  await expect(row).toContainText("The family has a new phone number and wants Asha to start in January.")

  await row.getByRole("link", { name: "ADMSN-90080" }).click()
  await expect(page).toHaveURL(new RegExp(`/staff/applicants/${SEEDED_PENDING_LEAD}$`))
  await expect(page.getByRole("heading", { name: "Asha Kibwana", level: 1 })).toBeVisible()
})

test("Admissions Staff get no entry, and the page is forbidden to them", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Applicants" })).toBeVisible()
  await expect(navEntry(page)).toHaveCount(0)

  await page.goto("/staff/reopenings")
  await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
  await expect(page.getByRole("table", { name: "Pending reopening requests" })).toHaveCount(0)
})
