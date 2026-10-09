import { expect, test, type Page } from "@playwright/test"

import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The Reopening requests queue and its navigation count (#100). It only reads
// the seeded Pending request on ADMSN-90080 Asha Kibwana, raised by Test
// Admissions; other tests raise and decide requests meanwhile, so the count
// is checked to be there, not to be a given number.

const SEEDED_PENDING_LEAD = "1ead0000-0000-4000-8000-000000000080"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const navEntry = (page: Page) => page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /Reopening requests/ })

test("the Manager sees the Pending count in the navigation and the seeded request in the queue", async ({ page }) => {
  await signIn(page, MANAGER)
  await expect(navEntry(page)).toHaveAccessibleName(/^Reopening requests\s*,\s*[1-9]\d*\s+Pending$/)

  await navEntry(page).click()
  await expect(page).toHaveURL(/\/staff\/reopenings$/)
  await expect(page.getByRole("heading", { name: "Reopening requests", level: 1 })).toBeVisible()

  const row = page.getByRole("table", { name: "Pending reopening requests" }).getByRole("row", { name: /ADMSN-90080/ })
  await expect(row).toContainText("Asha Kibwana")
  await expect(row).toContainText("Declined")
  await expect(row).toContainText(ADMISSIONS.name)
  await expect(row).toContainText("Lead screen")
  await expect(row).toContainText("The family has a new phone number and wants Asha to start in January.")

  await row.getByRole("link", { name: "ADMSN-90080" }).click()
  await expect(page).toHaveURL(new RegExp(`/staff/leads/${SEEDED_PENDING_LEAD}$`))
  await expect(page.getByRole("heading", { name: "Asha Kibwana", level: 1 })).toBeVisible()
})

test("Admissions Staff get no entry, and the page is forbidden to them", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Leads" })).toBeVisible()
  await expect(navEntry(page)).toHaveCount(0)

  await page.goto("/staff/reopenings")
  await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
  await expect(page.getByRole("table", { name: "Pending reopening requests" })).toHaveCount(0)
})
