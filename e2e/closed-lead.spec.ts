import { expect, test, type Page } from "@playwright/test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// A closed lead on the lead screen (#96). Reads the seeded leads only:
// ADMSN-90005 Archived, ADMSN-90006 Declined, and ADMSN-90081, an open child
// whose parent is shared with a Declined sister.

const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
const OPEN_WITH_CLOSED_SISTER = "1ead0000-0000-4000-8000-000000000081"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const WORK_ACTIONS = ["Edit student", "Edit parent or guardian", "Record visit", "Separate from this Family", "Confirm match"]

test.describe("a closed lead", () => {
  test("shows the banner, hides the work actions and offers Request reopening", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${ARCHIVED}`)

    const banner = page.getByRole("region", { name: "This lead is Archived" })
    await expect(banner).toContainText("read-only")
    for (const name of WORK_ACTIONS) await expect(page.getByRole("button", { name })).toHaveCount(0)

    await banner.getByRole("link", { name: "Request reopening" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${ARCHIVED}/reopen\\?source=lead$`))
    await expect(page.getByRole("heading", { name: "Hamisi Fixture" })).toBeVisible()
  })

  test("names a Declined lead's state", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${DECLINED}`)
    await expect(page.getByRole("region", { name: "This lead is Declined" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Edit student" })).toHaveCount(0)
  })

  test("the Accountant sees the banner without Request reopening", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${ARCHIVED}`)
    await expect(page.getByRole("region", { name: "This lead is Archived" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Request reopening" })).toHaveCount(0)
  })

  test("an open sister keeps her screen as before, with the shared parent editable", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${OPEN_WITH_CLOSED_SISTER}`)
    await expect(page.getByRole("heading", { name: "Daudi Kibwana" })).toBeVisible()
    await expect(page.getByRole("region", { name: /^This lead is/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit student" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Edit parent or guardian" })).toBeVisible()
  })
})
