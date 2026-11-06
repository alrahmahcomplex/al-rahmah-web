import { expect, test, type Page } from "@playwright/test"

import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The shell around every staff page (#225): the grouped sidebar and its rail,
// and the phone's tab bar with its More sheet.

const MANAGER_ENTRIES = [
  "Today",
  "Check-in",
  "Register a student",
  "Leads",
  "Interviews",
  "Follow-ups",
  "Re-applications",
  "Marketing Agents",
  "WhatsApp groups",
  "Fee schedule",
  "Seats",
  "Discount requests",
  "Reopening requests",
  "Staff and roles",
]

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sidebar" })
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff" })
// A link's name starts with its label; a count follows it ("Follow-ups, 8 overdue").
const entry = (page: Page, label: string) => staffNav(page).getByRole("link", { name: new RegExp(`^${label}`) })
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("an Admissions Manager reaches every area from the grouped sidebar, and nothing scrolls sideways", async ({ page }) => {
    await signIn(page, MANAGER)

    const nav = staffNav(page)
    for (const group of ["Front desk", "Admissions", "Referrals", "Money", "Admin"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible()
    }
    for (const label of MANAGER_ENTRIES) await expect(entry(page, label)).toBeVisible()
    expect(await scrollsSideways(page)).toBe(false)

    await expect(entry(page, "Today")).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("banner")).toContainText("Today")
    await entry(page, "Staff and roles").click()
    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(entry(page, "Staff and roles")).toHaveAttribute("aria-current", "page")
    await expect(entry(page, "Today")).not.toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("banner")).toContainText("Staff and roles")
  })

  test("Admissions Staff see Front desk, Admissions, Referrals and Fee schedule, and no Admin group", async ({ page }) => {
    await signIn(page, ADMISSIONS)

    const nav = staffNav(page)
    for (const group of ["Front desk", "Admissions", "Referrals", "Money"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible()
    }
    await expect(entry(page, "Fee schedule")).toBeVisible()
    await expect(nav.getByText("Admin", { exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: /^(Seats|Discount requests|Reopening requests|Staff and roles)/ })).toHaveCount(0)
  })

  test("the rail survives a navigation and a reload", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    const aside = sidebar(page)
    await expect(aside).toHaveCSS("width", "240px")

    await page.getByRole("button", { name: "Collapse sidebar" }).click()
    await expect(aside).toHaveCSS("width", "72px")
    // The labels fold away, but every link keeps its name, and a tooltip shows it.
    await expect(entry(page, "Leads")).toBeVisible()
    await entry(page, "Leads").hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("Leads")

    await entry(page, "Leads").click()
    await expect(page).toHaveURL(/\/staff\/leads$/)
    await expect(aside).toHaveCSS("width", "72px")

    await page.reload()
    await expect(aside).toHaveCSS("width", "72px")

    await page.getByRole("button", { name: "Expand sidebar" }).click()
    await expect(aside).toHaveCSS("width", "240px")
    await page.reload()
    await expect(aside).toHaveCSS("width", "240px")
  })
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("a tab bar holds Today, Check-in and Leads, More opens the rest, and nothing scrolls sideways", async ({ page }) => {
    await signIn(page, MANAGER)

    await expect(sidebar(page)).toBeHidden()
    const tabs = staffNav(page)
    await expect(tabs.getByRole("link")).toHaveText(["Today", "Check-in", "Leads"])
    await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page")
    expect(await scrollsSideways(page)).toBe(false)

    await tabs.getByRole("button", { name: "More" }).click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toContainText(`${MANAGER.name} · ${MANAGER.roleName}`)
    const more = sheet.getByRole("navigation", { name: "More" })
    for (const label of MANAGER_ENTRIES.filter((label) => !["Today", "Check-in", "Leads"].includes(label))) {
      await expect(more.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await expect(more.getByRole("link", { name: /^(Today|Check-in|Leads)$/ })).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible()

    await more.getByRole("link", { name: "Interviews" }).click()
    await expect(page).toHaveURL(/\/staff\/interviews$/)
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("banner")).toContainText("Interviews")
    await expect(tabs.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current", "page")
    expect(await scrollsSideways(page)).toBe(false)
  })
})
