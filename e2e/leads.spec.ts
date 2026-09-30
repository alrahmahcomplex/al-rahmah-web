import { expect, test, type Page } from "@playwright/test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "./fixtures"

// The Leads screen, as staff use it, against the seeded leads. No other test
// makes a lead named "... Fixture", so a search for it finds exactly the six
// seeded ones.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function searchFor(page: Page, typed: string) {
  await page.getByLabel("Search leads").fill(typed)
  await page.getByRole("button", { name: "Search" }).click()
}

// The rows of the results table, without its header.
function resultRows(page: Page) {
  return page.getByRole("table", { name: "Leads" }).locator("tbody tr")
}

test.describe("the Leads screen", () => {
  test("opens from the staff navigation, for Admissions Staff and Accountants alike", async ({ page }) => {
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      await page.context().clearCookies()
      await signIn(page, person)
      await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Leads" }).click()
      await expect(page).toHaveURL(/\/staff\/leads$/)
      await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible()
    }
  })

  test("finds a lead by its Admission Number, closed or not, and opens it", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/leads")

    await searchFor(page, " admsn-90005 ")
    await expect(page).toHaveURL(/q=admsn-90005/)
    const rows = resultRows(page)
    await expect(rows).toHaveCount(1)
    const hamisi = rows.first()
    for (const text of ["ADMSN-90005", "Hamisi Fixture", "STD 5", "2027", "Day", "Visited", "Archived"]) {
      await expect(hamisi.getByText(text, { exact: true })).toBeVisible()
    }

    await hamisi.getByRole("link", { name: "Hamisi Fixture" }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/1ead0000-0000-4000-8000-000000000005$/)
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
  })

  test("finds leads by part of a name, with closed leads badged and last", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/leads")

    await searchFor(page, "  FIXTURE ")
    const rows = resultRows(page)
    await expect(rows).toHaveCount(6)
    const studentLinks = rows.getByRole("link")
    await expect(studentLinks).toHaveText([
      "Baraka Fixture",
      "Neema Fixture",
      "Rehema Fixture",
      "Salma Fixture",
      "Zawadi Fixture",
      "Hamisi Fixture",
    ])
    await expect(rows.nth(2).getByText("Declined", { exact: true })).toBeVisible()
    await expect(rows.nth(5).getByText("Archived", { exact: true })).toBeVisible()
    await expect(rows.nth(1).getByText("Returning family", { exact: true })).toBeVisible()
    await expect(rows.nth(0).getByText("Returning family", { exact: true })).toHaveCount(0)

    // A name that matches nothing says so.
    await searchFor(page, "Nobody Fixture Here")
    await expect(resultRows(page)).toHaveCount(0)
    await expect(page.getByText("No lead matches this name.")).toBeVisible()

    // Clearing the search returns to the everyday list.
    await page.getByRole("link", { name: "Clear search" }).click()
    await expect(page).toHaveURL(/\/staff\/leads$/)
    await expect(page.getByLabel("Search leads")).toHaveValue("")
  })

  test("the list leaves out closed leads until a filter asks for them", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/leads")

    const rows = resultRows(page)
    await expect(rows.first()).toBeVisible()
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(0)
    await expect(rows.getByText("Inactive", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Closure")).toHaveValue("open")

    await page.getByLabel("Closure").selectOption("Archived")
    await expect(page).toHaveURL(/closure=Archived/)
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(count)

    await page.getByLabel("Status").selectOption("Visited")
    await expect(page).toHaveURL(/status=Visited/)
    await expect(page).toHaveURL(/closure=Archived/)
    await expect(page.getByLabel("Closure")).toHaveValue("Archived")
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(await rows.count())

    await page.getByLabel("Closure").selectOption("open")
    await page.getByLabel("Status").selectOption("Declined")
    await expect(page).toHaveURL(/\/staff\/leads\?status=Declined$/)
    await expect(rows.first()).toBeVisible()
    await expect(rows.getByText("Declined", { exact: true })).toHaveCount(await rows.count())
  })

  test("someone signed out is sent to sign in", async ({ page }) => {
    await page.goto("/staff/leads?q=Fixture")
    await expect(page).toHaveURL(/\/login/)
  })
})
