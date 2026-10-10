import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"

import { createThrowawayStaff } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

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
  await expect(panel.getByTestId("visited-count")).toHaveText("22")

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

test("the interview tiles each keep their own filters in the address", async ({ page }) => {
  await signIn(page, MANAGER)
  const interviewed = page.getByRole("region", { name: "Interviewed leads" })
  const passed = page.getByRole("region", { name: "Passed interviews" })
  const failed = page.getByRole("region", { name: "Failed interviews" })
  for (const [panel, key] of [
    [interviewed, "interviewed"],
    [passed, "passed"],
    [failed, "failed"],
  ] as const) {
    await expect(panel.getByTestId(`${key}-period`)).toHaveText("All time · All years")
    await expect(panel.getByTestId(`${key}-count`)).toHaveText(/^\d[\d,]*$/)
  }

  // Three different views side by side, from one shared address.
  await page.goto("/staff?interviewed=week:2026-09-30&interviewed_year=2031&passed=month:2026-09-01&passed_year=2031&failed_year=2031")
  await expect(interviewed.getByTestId("interviewed-period")).toHaveText("Week of 28 Sept 2026 · Enrollment year 2031")
  await expect(interviewed.getByTestId("interviewed-count")).toHaveText("6")
  await expect(passed.getByTestId("passed-period")).toHaveText("September 2026 · Enrollment year 2031")
  await expect(passed.getByTestId("passed-count")).toHaveText("3")
  await expect(failed.getByTestId("failed-period")).toHaveText("All time · Enrollment year 2031")
  await expect(failed.getByTestId("failed-count")).toHaveText("6")

  // Changing the Failed interviews filter leaves the other two alone.
  await failed.getByRole("button", { name: "Filter Failed interviews" }).click()
  await choose(page, "Period", "Year")
  await choose(page, "Year", "2025")
  await expect(page).toHaveURL(/[?&]failed=year%3A2025-01-01/)
  await expect(failed.getByTestId("failed-period")).toHaveText("2025 · Enrollment year 2031")
  await expect(failed.getByTestId("failed-count")).toHaveText("1")
  await expect(interviewed.getByTestId("interviewed-count")).toHaveText("6")
  await expect(passed.getByTestId("passed-count")).toHaveText("3")
})

const enrolledPanel = (page: Page) => page.getByRole("region", { name: "Enrolled students" })

test("the Enrolled students tile keeps its own filters in the address", async ({ page }) => {
  await signIn(page, MANAGER)
  const enrolled = enrolledPanel(page)
  await expect(enrolled.getByTestId("enrolled-period")).toHaveText("All time · All years")
  await expect(enrolled.getByTestId("enrolled-count")).toHaveText(/^\d[\d,]*$/)
  await expect(enrolled.getByText("Counted by the date Enrolled was triggered")).toBeVisible()

  // August 2026 for 2031: one paid in full, one Archived; the reverted and
  // Declined leads are left out.
  await page.goto("/staff?enrolled=month:2026-08-01&enrolled_year=2031&visited_year=2031")
  await expect(enrolled.getByTestId("enrolled-period")).toHaveText("August 2026 · Enrollment year 2031")
  await expect(enrolled.getByTestId("enrolled-count")).toHaveText("2")

  await enrolled.getByRole("button", { name: "Filter Enrolled students" }).click()
  await choose(page, "Period", "Year")
  await choose(page, "Year", "2025")
  await expect(page).toHaveURL(/[?&]enrolled=year%3A2025-01-01/)
  await expect(enrolled.getByTestId("enrolled-period")).toHaveText("2025 · Enrollment year 2031")
  await expect(enrolled.getByTestId("enrolled-count")).toHaveText("1")
  await expect(page).toHaveURL(/[?&]visited_year=2031/)
  await expect(visitedPanel(page).getByTestId("visited-count")).toHaveText("22")

  // A lead enrolled on the Academic-year start counts on the start date.
  await page.keyboard.press("Escape")
  await page.goto("/staff?enrolled=date:2031-01-08&enrolled_year=2031")
  await expect(enrolled.getByTestId("enrolled-period")).toHaveText(`${formatDate("2031-01-08")} · Enrollment year 2031`)
  await expect(enrolled.getByTestId("enrolled-count")).toHaveText("1")
})

const classesPanel = (page: Page) => page.getByRole("region", { name: "Leads by enrollment class" })

test("Leads by enrollment class lists every class in school order, zeros included, with the total", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff?classes_year=2031")

  const panel = classesPanel(page)
  await expect(panel.getByTestId("classes-period")).toHaveText("All time · Enrollment year 2031")
  const classes = await panel.locator("tbody tr td:first-child").allTextContents()
  expect(classes).toEqual(["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3", "FORM 4"])
  await expect(panel.getByTestId("classes-count-STD 1")).toHaveText("3")
  await expect(panel.getByTestId("classes-count-FORM 4")).toHaveText("0")
  await expect(panel.getByTestId("classes-total")).toHaveText("26")
})

test("changing the Leads by enrollment class filters leaves the Visited leads tile alone", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff?visited=month:2026-09-01&visited_year=2031")
  const visited = visitedPanel(page)
  const classes = classesPanel(page)
  await expect(visited.getByTestId("visited-count")).toHaveText("6")

  await classes.getByRole("button", { name: "Filter Leads by enrollment class" }).click()
  await choose(page, "Enrollment year", "2031")
  await expect(page).toHaveURL(/[?&]classes_year=2031/)
  await choose(page, "Period", "Year")
  await choose(page, "Year", "2025")
  await expect(page).toHaveURL(/[?&]classes=year%3A2025-01-01/)
  await expect(classes.getByTestId("classes-period")).toHaveText("2025 · Enrollment year 2031")
  await expect(classes.getByTestId("classes-total")).toHaveText("11")
  await expect(classes.getByTestId("classes-count-DAY CARE")).toHaveText("1")

  await expect(page).toHaveURL(/[?&]visited=month%3A2026-09-01/)
  await expect(visited.getByTestId("visited-period")).toHaveText("September 2026 · Enrollment year 2031")
  await expect(visited.getByTestId("visited-count")).toHaveText("6")

  // A lead created at 00:30 on Monday 28 September counts on that Monday.
  await page.keyboard.press("Escape")
  await page.goto("/staff?classes=date:2026-09-28&classes_year=2031")
  await expect(classes.getByTestId("classes-period")).toHaveText("28 Sept 2026 · Enrollment year 2031")
  await expect(classes.getByTestId("classes-total")).toHaveText("1")

  await classes.getByRole("link", { name: "Show all time and all years" }).click()
  await expect(page).toHaveURL(/\/staff$/)
  await expect(classes.getByTestId("classes-period")).toHaveText("All time · All years")
})

test("a role without leads.view sees the staff home and no dashboard", async ({ page }) => {
  const person = await createThrowawayStaff(["payments.view"])
  await signIn(page, person)

  await expect(page.getByText(`Welcome, ${person.name}.`)).toBeVisible()
  await expect(visitedPanel(page)).toHaveCount(0)
  await expect(classesPanel(page)).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0)
})

const seatsPanel = (page: Page) => page.getByRole("region", { name: "Seats by class" })
const seatsRow = (page: Page, row: string) => seatsPanel(page).getByTestId(`seats-row-${row}`)

test("the Manager sees Seats by class for 2031, counts only, with the link to the Seats screen", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff?seats_year=2031")

  const panel = seatsPanel(page)
  await expect(panel.getByTestId("seats-period")).toHaveText("Now · Enrollment year 2031")
  const rows = await panel.locator("tbody tr td:first-child").allTextContents()
  expect(rows.slice(0, 4)).toEqual(["DAY CARE Day", "DAY CARE Boarding", "KG 1 Day", "KG 1 Boarding"])
  expect(rows).toHaveLength(28)

  // Over-full: never a negative number left.
  const over = seatsRow(page, "STD 2 Day")
  await expect(over.getByTestId("seats-set")).toHaveText("3")
  await expect(over.getByTestId("seats-taken")).toHaveText("4")
  await expect(over.getByTestId("seats-priorities")).toHaveText("Full 2 · First instalment 1 · Deposit 1")
  await expect(over.getByTestId("seats-left")).toHaveText("Over by 1")

  // The Declined lead in STD 3 Day takes no seat.
  const room = seatsRow(page, "STD 3 Day")
  await expect(room.getByTestId("seats-taken")).toHaveText("2")
  await expect(room.getByTestId("seats-left")).toHaveText("1")

  // No seat number, with the taken seats (an Archived lead's among them)
  // still counted.
  const unset = seatsRow(page, "STD 4 Day")
  await expect(unset.getByTestId("seats-set")).toHaveText("Seats not set")
  await expect(unset.getByTestId("seats-taken")).toHaveText("3")
  await expect(unset.getByTestId("seats-left")).toHaveText(/Seats not set/)

  await expect(panel).not.toContainText("Takwimu")
  await expect(panel).not.toContainText("ADMSN-")

  const link = panel.getByRole("link", { name: "Open the Seats screen" })
  await expect(link).toHaveAttribute("href", "/staff/seats?year=2031")
  await link.click()
  await expect(page).toHaveURL(/\/staff\/seats\?year=2031$/)
  await expect(page.getByRole("heading", { name: "Seats 2031" })).toBeVisible()
})

test("Seats by class opens on the latest year with a Fee schedule and keeps a chosen year in the address", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff?visited_year=2031")
  const panel = seatsPanel(page)
  await expect(panel.getByTestId("seats-period")).toHaveText(/^Now · Enrollment year \d{4}$/)
  const opened = Number((await panel.getByTestId("seats-period").textContent())!.slice(-4))

  // The years with a Fee schedule, newest first; the panel opened on the first.
  await panel.getByRole("button", { name: "Filter Seats by class" }).click()
  await page.getByRole("combobox", { name: "Enrollment year", exact: true }).click()
  const years = (await page.getByRole("option").allTextContents()).map(Number)
  expect(years).toContain(2027)
  expect(years).toContain(2031)
  expect(years).toEqual([...years].sort((a, b) => b - a))
  expect(opened).toBe(years[0])
  await page.getByRole("option", { name: "2027", exact: true }).click()

  await expect(page).toHaveURL(/[?&]seats_year=2027/)
  await expect(page).toHaveURL(/[?&]visited_year=2031/)
  await expect(panel.getByTestId("seats-period")).toHaveText("Now · Enrollment year 2027")
  await expect(visitedPanel(page).getByTestId("visited-period")).toHaveText("All time · Enrollment year 2031")

  await page.keyboard.press("Escape")
  await page.reload()
  await expect(panel.getByTestId("seats-period")).toHaveText("Now · Enrollment year 2027")
})

for (const person of [ADMISSIONS, ACCOUNTANT]) {
  test(`${person.roleName} sees Seats by class without the Seats screen link`, async ({ page }) => {
    await signIn(page, person)
    await page.goto("/staff?seats_year=2031")
    await expect(seatsRow(page, "STD 2 Day").getByTestId("seats-left")).toHaveText("Over by 1")
    await expect(seatsPanel(page).getByRole("link")).toHaveCount(0)
  })
}

test("staff without payments.view see the dashboard without Seats by class", async ({ page }) => {
  const person = await createThrowawayStaff(["leads.view"])
  await signIn(page, person)

  await expect(visitedPanel(page)).toBeVisible()
  await expect(seatsPanel(page)).toHaveCount(0)
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

  test("the Enrolled students tile fits the screen", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff?enrolled=month:2026-08-01&enrolled_year=2031")
    const panel = enrolledPanel(page)
    await expect(panel.getByTestId("enrolled-count")).toHaveText("2")

    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test("the Leads by enrollment class table fits the screen", async ({ page }) => {
    await signIn(page, MANAGER)
    const panel = classesPanel(page)
    await expect(panel.getByTestId("classes-total")).toBeVisible()

    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    const total = await panel.getByTestId("classes-total").boundingBox()
    expect(total!.x + total!.width).toBeLessThanOrEqual(box!.x + box!.width)
  })

  test("the Seats by class table fits the screen", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff?seats_year=2031")
    const panel = seatsPanel(page)
    await expect(seatsRow(page, "STD 2 Day").getByTestId("seats-left")).toHaveText("Over by 1")

    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    for (const id of ["seats-priorities", "seats-left"]) {
      const cell = await seatsRow(page, "STD 2 Day").getByTestId(id).boundingBox()
      expect(cell!.x + cell!.width).toBeLessThanOrEqual(box!.x + box!.width)
    }
  })
})
