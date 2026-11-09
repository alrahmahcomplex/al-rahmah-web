import { expect, test, type Page } from "@playwright/test"

import { firstName } from "@/app/staff/_today/greeting"
import { formatLongDate, tanzaniaToday } from "@/lib/school-calendar"

import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// Today, the staff home (#226): the greeting, the two front-desk actions, the
// work waiting for the signed-in person and the newest registrations. The
// seeds plant overdue follow-ups, unreviewed re-applications, paid results
// nobody has sent, a Pending Marketing Agent and a pending Discount request;
// other tests add to those, so counts are matched loosely.

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

const main = (page: Page) => page.getByRole("main")
const greeting = (page: Page, person: FixtureStaff) =>
  page.getByRole("heading", { level: 1, name: new RegExp(`^Good (morning|afternoon), ${firstName(person.name)}$`) })
const queue = (page: Page) => page.getByRole("region", { name: "Needs you today" })
const latest = (page: Page) => page.getByRole("region", { name: "Latest registrations" })
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff" })
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("Admissions Staff land on the greeting, both actions, their queue and the latest registrations, with no statistics", async ({ page }) => {
    await signIn(page, ADMISSIONS)

    await expect(greeting(page, ADMISSIONS)).toBeVisible()
    await expect(page.getByTestId("today-summary")).toContainText(formatLongDate(tanzaniaToday()))
    await expect(page.getByTestId("today-summary")).toContainText(/overdue follow-up/)
    await expect(page.getByRole("banner")).toContainText("Today")

    await expect(main(page).getByRole("link", { name: "Check in a family" })).toHaveAttribute("href", "/staff/check-in")
    await expect(main(page).getByRole("link", { name: "Register a student" })).toHaveAttribute("href", "/staff/check-in/new")

    const overdue = queue(page).getByTestId("today-overdue")
    await expect(overdue).toContainText(/^\d[\d,]* follow-ups? (is|are) overdue/)
    await expect(overdue).toContainText("Oldest:")
    await expect(overdue).toHaveAttribute("href", "/staff/follow-ups")
    await expect(queue(page).getByTestId("today-reApplications")).toContainText(/^\d[\d,]* re-applications? to review/)
    await expect(queue(page).getByTestId("today-reApplications")).toHaveAttribute("href", "/staff/re-applications")
    const results = queue(page).getByTestId("today-results")
    await expect(results).toContainText(/^\d[\d,]* results? ready to send/)
    await expect(results).toHaveAttribute("href", /^\/staff\/interviews\?year=\d{4}&release=ready$/)
    // The Manager's decisions are not theirs to make.
    for (const key of ["agents", "discounts", "reopenings"]) await expect(queue(page).getByTestId(`today-${key}`)).toHaveCount(0)
    await expect(page.getByTestId("today-empty")).toHaveCount(0)

    // No statistics: those live on Reports now.
    await expect(page.getByRole("region", { name: "Visited applicants" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0)
    await expect(staffNav(page).getByRole("link", { name: "Reports" })).toHaveCount(0)

    const rows = latest(page).getByRole("listitem")
    await expect(rows).toHaveCount(5)
    for (let i = 0; i < 5; i++) {
      await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", /^\/staff\/applicants\/[0-9a-f-]{36}$/)
      await expect(rows.nth(i)).toContainText(/ADMSN-\d{5}/)
    }
    await expect(latest(page).getByRole("link", { name: "All applicants" })).toHaveAttribute("href", "/staff/applicants")

    // A queue row opens the screen the work is done on.
    await overdue.click()
    await expect(page).toHaveURL(/\/staff\/follow-ups$/)
    await expect(page.getByRole("heading", { name: "Follow-ups" })).toBeVisible()
  })

  test("the Admissions Manager also sees the decisions waiting for them, and Reports opens the old dashboard", async ({ page }) => {
    await signIn(page, MANAGER)
    await expect(greeting(page, MANAGER)).toBeVisible()

    await expect(queue(page).getByTestId("today-overdue")).toBeVisible()
    const agents = queue(page).getByTestId("today-agents")
    await expect(agents).toContainText(/^\d[\d,]* Marketing Agents? waiting for approval/)
    await expect(agents).toHaveAttribute("href", "/staff/agents?status=pending")
    const discounts = queue(page).getByTestId("today-discounts")
    await expect(discounts).toContainText(/^\d[\d,]* Discount requests? pending/)
    await expect(discounts).toHaveAttribute("href", "/staff/discounts")

    const reports = staffNav(page).getByRole("link", { name: "Reports" })
    await expect(reports).toBeVisible()
    await reports.click()
    await expect(page).toHaveURL(/\/staff\/reports$/)
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Visited applicants" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Applicants by enrollment class" })).toBeVisible()
    await expect(reports).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("banner")).toContainText("Reports")
  })

  test("the Accountant gets the greeting, Check in a family and the empty line, and Reports is refused", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(greeting(page, ACCOUNTANT)).toBeVisible()
    await expect(page.getByTestId("today-summary")).toHaveText(formatLongDate(tanzaniaToday()))

    await expect(main(page).getByRole("link", { name: "Check in a family" })).toBeVisible()
    await expect(main(page).getByRole("link", { name: "Register a student" })).toHaveCount(0)

    await expect(page.getByTestId("today-empty")).toHaveText("Nothing is waiting. Families you check in will appear here.")
    await expect(queue(page).getByRole("link")).toHaveCount(0)
    // They read leads to find the student being paid for.
    await expect(latest(page).getByRole("listitem")).toHaveCount(5)

    await expect(staffNav(page).getByRole("link", { name: "Reports" })).toHaveCount(0)
    await page.goto("/staff/reports")
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Visited applicants" })).toHaveCount(0)
  })
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("Today fits the screen, with the actions above the queue", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await expect(greeting(page, ADMISSIONS)).toBeVisible()
    expect(await scrollsSideways(page)).toBe(false)

    const checkIn = main(page).getByRole("link", { name: "Check in a family" })
    await expect(checkIn).toBeVisible()
    const overdue = queue(page).getByTestId("today-overdue")
    await expect(overdue).toBeVisible()

    const action = await checkIn.boundingBox()
    const row = await overdue.boundingBox()
    expect(action!.y).toBeLessThan(row!.y)
    expect(row!.x).toBeGreaterThanOrEqual(0)
    expect(row!.x + row!.width).toBeLessThanOrEqual(390)
  })
})
