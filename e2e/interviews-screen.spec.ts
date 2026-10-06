import { expect, test, type Page } from "@playwright/test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The Interviews screen. Slice 5's seeded registrations hold S/N 1 to 3 for
// 2027, so they head the 2027 list whatever the other tests register after
// them: ADMSN-90501 with no result yet and Not Paid, ADMSN-90503 Passed and
// Paid (the seed marks it Paid as the Accountant), and ADMSN-90504 Failed and
// Not Paid. Tests only read these three.

// 2001 is before any intake the tests or seeds register interviews for.
const EMPTY_YEAR = 2001

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const list = (page: Page) => page.getByRole("table", { name: "Interviews for 2027" })
// The data rows, without the header.
const rows = (page: Page) => list(page).getByRole("row").filter({ has: page.getByRole("cell") })
const filter = (page: Page, group: string, option: string) =>
  page.getByRole("navigation", { name: group }).getByRole("link", { name: option, exact: true })

test.describe("the Interviews screen", () => {
  test("Admissions Staff open it from the navigation, walk the result filters and open a lead", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Interviews" }).click()
    await expect(page.getByRole("heading", { name: "Interviews", exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/staff\/interviews$/)

    await filter(page, "Enrollment year", "2027").click()
    await expect(page).toHaveURL(/\/staff\/interviews\?year=2027$/)
    await expect(filter(page, "Enrollment year", "2027")).toHaveAttribute("aria-current", "page")
    // In S/N order, each with its details.
    await expect(rows(page).nth(0)).toContainText("1ADMSN-90501Amani InterviewSTD 5DayNo result yet–Not Paid")
    await expect(rows(page).nth(1)).toContainText("2ADMSN-90503Neema InterviewSTD 1DayPassed78.5%Paid")
    await expect(rows(page).nth(2)).toContainText("3ADMSN-90504Baraka InterviewFORM 1BoardingFailed41%Not Paid")

    await filter(page, "Result", "No result yet").click()
    await expect(page).toHaveURL(/year=2027&result=none$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90501")
    await expect(list(page)).not.toContainText("ADMSN-90503")
    await expect(list(page)).not.toContainText("ADMSN-90504")

    await filter(page, "Result", "Passed").click()
    await expect(page).toHaveURL(/year=2027&result=passed$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90503")
    await expect(list(page)).not.toContainText("ADMSN-90501")
    await expect(list(page)).not.toContainText("ADMSN-90504")

    await filter(page, "Result", "Failed").click()
    await expect(page).toHaveURL(/year=2027&result=failed$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90504")
    await expect(list(page)).not.toContainText("ADMSN-90503")

    await filter(page, "Result", "Any result").click()
    await expect(page).toHaveURL(/\/staff\/interviews\?year=2027$/)
    await list(page).getByRole("link", { name: "Amani Interview" }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/1ead0000-0000-4000-8000-000000000501$/)
  })

  test("the Accountant filters to Not Paid to see who still owes, at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/interviews?year=2027")

    await filter(page, "Interview fee", "Not Paid").click()
    await expect(page).toHaveURL(/year=2027&fee=not-paid$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90501")
    await expect(list(page)).toContainText("ADMSN-90504")
    await expect(list(page).getByText("ADMSN-90503")).toHaveCount(0)
    for (const fee of await rows(page).locator("td:last-child").allTextContents()) expect(fee).toBe("Not Paid")
    // The table scrolls inside its frame; the page itself doesn't.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

    // Paid lists the seeded Paid lead first, by S/N, and only Paid rows.
    await filter(page, "Interview fee", "Paid").click()
    await expect(page).toHaveURL(/year=2027&fee=paid$/)
    await expect(rows(page).nth(0)).toContainText("2ADMSN-90503Neema Interview")
    await expect(rows(page).nth(0).locator("td:last-child")).toHaveText("Paid")
    for (const fee of await rows(page).locator("td:last-child").allTextContents()) expect(fee).toBe("Paid")
    await expect(list(page).getByText("ADMSN-90501")).toHaveCount(0)
    await expect(list(page).getByText("ADMSN-90504")).toHaveCount(0)
  })

  test("says plainly when a year has no registrations, and when nothing matches the filters", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${EMPTY_YEAR}`)
    await expect(page.getByText(`No one is registered for interview for ${EMPTY_YEAR} yet.`)).toBeVisible()
    await expect(page.getByRole("table")).toHaveCount(0)

    await filter(page, "Result", "Passed").click()
    await expect(page.getByText("No interviews match these filters.")).toBeVisible()
    await page.getByRole("link", { name: `Show every interview for ${EMPTY_YEAR}` }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/interviews\\?year=${EMPTY_YEAR}$`))
  })
})
