import { type Page } from "@playwright/test"

import { ACCOUNTANT, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { dayFirst } from "./kit-parts"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The Fee schedule and Seats screens in the new shell (#329). Nothing here
// saves: the seeded 2027 schedule is only read. The axe scans run nightly.

async function open(page: Page, person: FixtureStaff, path: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(path)
  await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
}

test("a due date that is not a date holds the Fee schedule back, with the field's own sentence", async ({ page }) => {
  await open(page, ACCOUNTANT, "/staff/fees/2027")
  await page.getByRole("button", { name: "Edit amounts" }).click()
  const form = page.getByRole("form", { name: "Fee schedule 2027" })
  const due = form.getByLabel("Second instalment due date")
  await expect(due).toHaveValue(dayFirst("2027-04-01"))

  await due.fill("31/02/20x7")
  await form.getByRole("button", { name: "Save" }).click()

  await expect(due).toBeFocused()
  await expect(due).toHaveAttribute("aria-invalid", "true")
  await expect(form.getByText("Type the date as day/month/year")).toBeVisible()
  await expect(form).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Fee amounts saved." })).toHaveCount(0)
})

test("the Seats year tabs go to the year and mark it", async ({ page }) => {
  await open(page, MANAGER, "/staff/seats")
  const years = page.getByRole("main").getByRole("navigation", { name: "Enrollment years" })
  await years.getByRole("link", { name: "2027", exact: true }).click()
  await expect(page).toHaveURL(/\/staff\/seats\?year=2027$/)
  await expect(page.getByRole("heading", { level: 1, name: "Seats" })).toBeVisible()
  await expect(years.getByRole("link", { name: "2027", exact: true })).toHaveAttribute("aria-current", "page")
  // The year's streams (#449): the seeded KG 2 A among them.
  await expect(page.getByRole("list", { name: "KG 2 streams" }).getByRole("listitem")).toContainText("KG 2 A")
})

const SCREENS: { path: string; person: FixtureStaff }[] = [
  { path: "/staff/fees", person: ACCOUNTANT },
  { path: "/staff/fees/2027", person: ACCOUNTANT },
  { path: "/staff/fees/2027", person: MANAGER },
  { path: "/staff/seats?year=2027", person: MANAGER },
]

// Axe may report only the accepted white on orange, at the desktop and the
// phone width.
for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const { path, person } of SCREENS) {
      test(`axe finds nothing on ${path} for the ${person.roleName}`, { tag: "@nightly" }, async ({ page }) => {
        await open(page, person, path)
        expect(await axeProblems(page)).toEqual([])
      })
    }

    test("axe finds nothing in the open Fee schedule form", { tag: "@nightly" }, async ({ page }) => {
      await open(page, ACCOUNTANT, "/staff/fees/2027")
      await page.getByRole("button", { name: "Edit amounts" }).click()
      await expect(page.getByRole("form", { name: "Fee schedule 2027" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
    })

    test("axe finds nothing in the open Academic year form", { tag: "@nightly" }, async ({ page }) => {
      await open(page, MANAGER, "/staff/fees/2027")
      await page.getByRole("button", { name: "Edit start" }).click()
      await expect(page.getByRole("form", { name: "Academic year 2027" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
    })
  })
}
