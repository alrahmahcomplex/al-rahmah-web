import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"

import { createThrowawayStaff } from "../tests/support/db"
import { MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The dashboard on the staff home. Counts are read for Enrollment year 2031,
// the dashboard's own fixtures (supabase/seeds/95_dashboard.sql), so other
// tests' leads never shift them.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const visitedPanel = (page: Page) => page.getByRole("region", { name: "Visited leads" })

async function choose(page: Page, select: string, option: string) {
  await page.getByRole("combobox", { name: select, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

test("the Visited leads tile shows all time by default, under the welcome and notices", async ({ page }) => {
  await signIn(page, MANAGER)

  const panel = visitedPanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId("visited-period")).toHaveText("All time · All years")
  await expect(panel.getByTestId("visited-count")).toHaveText(/^\d[\d,]*$/)
  await expect(panel.getByRole("link", { name: "Show all time and all years" })).toHaveCount(0)

  const welcome = await page.getByText(`Welcome, ${MANAGER.name}.`).boundingBox()
  const tile = await panel.boundingBox()
  expect(welcome!.y).toBeLessThan(tile!.y)
})

test("filters chosen from the filter icon go into the address, survive a reload and clear in one click", async ({ page }) => {
  await signIn(page, MANAGER)
  const panel = visitedPanel(page)

  await panel.getByRole("button", { name: "Filter Visited leads" }).click()
  await choose(page, "Enrollment year", "2031")
  await expect(page).toHaveURL(/[?&]visited_year=2031/)
  await expect(panel.getByTestId("visited-period")).toHaveText("All time · Enrollment year 2031")
  await expect(panel.getByTestId("visited-count")).toHaveText("10")

  // A new period starts on the one containing today.
  await choose(page, "Period", "Week")
  await expect(panel.getByTestId("visited-period")).toHaveText(/^Week of .+ · Enrollment year 2031$/)
  await choose(page, "Period", "Date")
  await expect(panel.getByTestId("visited-period")).toHaveText(`${formatDate(tanzaniaToday())} · Enrollment year 2031`)

  await choose(page, "Period", "Month")
  await choose(page, "Month", "September")
  await choose(page, "Year", "2026")
  await expect(page).toHaveURL(/[?&]visited=month%3A2026-09-01/)
  await expect(panel.getByTestId("visited-period")).toHaveText("September 2026 · Enrollment year 2031")
  await expect(panel.getByTestId("visited-count")).toHaveText("6")

  await page.keyboard.press("Escape")
  await page.reload()
  await expect(panel.getByTestId("visited-period")).toHaveText("September 2026 · Enrollment year 2031")
  await expect(panel.getByTestId("visited-count")).toHaveText("6")

  await panel.getByRole("link", { name: "Show all time and all years" }).click()
  await expect(page).toHaveURL(/\/staff$/)
  await expect(panel.getByTestId("visited-period")).toHaveText("All time · All years")
})

test("a shared address opens the same view, with the week named by its Monday", async ({ page }) => {
  await signIn(page, MANAGER)
  // Thursday 24 September 2026.
  await page.goto("/staff?visited=week:2026-09-24&visited_year=2031")

  const panel = visitedPanel(page)
  await expect(panel.getByTestId("visited-period")).toHaveText("Week of 21 Sept 2026 · Enrollment year 2031")
  await expect(panel.getByTestId("visited-count")).toHaveText("4")
})

test("an unreadable address falls back to All time and All years", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff?visited=fortnight:2026-02-30&visited_year=next")

  await expect(visitedPanel(page).getByTestId("visited-period")).toHaveText("All time · All years")
})

test("a role without leads.view sees the staff home and no dashboard", async ({ page }) => {
  const person = await createThrowawayStaff(["payments.view"])
  await signIn(page, person)

  await expect(page.getByText(`Welcome, ${person.name}.`)).toBeVisible()
  await expect(visitedPanel(page)).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0)
})

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test("the tile and its filter fit the screen", async ({ page }) => {
    await signIn(page, MANAGER)
    const panel = visitedPanel(page)
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

    await panel.getByRole("button", { name: "Filter Visited leads" }).click()
    await choose(page, "Period", "Year")
    await expect(panel.getByTestId("visited-period")).toHaveText(`${tanzaniaToday().slice(0, 4)} · All years`)
    const filter = await page.getByRole("combobox", { name: "Enrollment year" }).boundingBox()
    expect(filter!.x + filter!.width).toBeLessThanOrEqual(375)
  })
})
