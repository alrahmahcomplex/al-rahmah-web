import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// The shell around every staff page (#225): the grouped sidebar and its rail,
// and the phone's tab bar with its More sheet. Home and Applicants are in the
// new shell (#323, #324), so each test starts on Interviews, which keeps the
// old one.

const MANAGER_ENTRIES = [
  "Home",
  "Applicants",
  "Interviews",
  "Follow-ups",
  "Re-applications",
  "Marketing Agents",
  "WhatsApp groups",
  "Fee schedule",
  "Seats",
  "Discount requests",
  "Reopening requests",
  "Reports",
  "Staff and roles",
]

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
  await page.goto("/staff/interviews")
  await expect(page.getByRole("heading", { level: 1, name: "Interviews" })).toBeVisible()
}

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sidebar" })
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff" })
// A link's name starts with its label; a count follows it ("Follow-ups, 8 overdue").
const entry = (page: Page, label: string) => staffNav(page).getByRole("link", { name: new RegExp(`^${label}`) })

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("an Admissions Manager reaches every area from the grouped sidebar", async ({ page }) => {
    await signIn(page, MANAGER)

    const nav = staffNav(page)
    for (const group of ["Admissions", "Referrals", "Money", "Admin"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible()
    }
    for (const label of MANAGER_ENTRIES) await expect(entry(page, label)).toBeVisible()
    await expect(nav.getByText("Front desk", { exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: /^(Today|Check-in|Register a student)/ })).toHaveCount(0)

    await expect(entry(page, "Interviews")).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("banner")).toContainText("Interviews")
    await entry(page, "Staff and roles").click()
    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(entry(page, "Staff and roles")).toHaveAttribute("aria-current", "page")
    await expect(entry(page, "Interviews")).not.toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("banner")).toContainText("Staff and roles")
  })

  test("Admissions Staff see Admissions, Referrals and Fee schedule, and no Admin group", async ({ page }) => {
    await signIn(page, ADMISSIONS)

    const nav = staffNav(page)
    for (const group of ["Admissions", "Referrals", "Money"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible()
    }
    await expect(entry(page, "Fee schedule")).toBeVisible()
    await expect(nav.getByText("Admin", { exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: /^(Seats|Discount requests|Reopening requests|Reports|Staff and roles)/ })).toHaveCount(0)
  })

  test("the rail survives a navigation and a reload", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    // The button's name says which way the rail is: Collapse while open, Expand while folded.
    const collapse = page.getByRole("button", { name: "Collapse sidebar" })
    const expand = page.getByRole("button", { name: "Expand sidebar" })
    await expect(collapse).toBeVisible()

    await collapse.click()
    await expect(expand).toBeVisible()
    // The labels fold away, but every link keeps its name, and a tooltip shows it.
    // Follow-ups is still drawn in the old shell, whose rail this is.
    await expect(entry(page, "Follow-ups")).toBeVisible()
    await entry(page, "Follow-ups").hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText(/^Follow-ups/)

    await entry(page, "Follow-ups").click()
    await expect(page).toHaveURL(/\/staff\/follow-ups$/)
    await expect(expand).toBeVisible()

    await page.reload()
    await expect(expand).toBeVisible()

    await expand.click()
    await expect(collapse).toBeVisible()
    await page.reload()
    await expect(collapse).toBeVisible()
  })
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("a tab bar holds Home and Applicants, and More opens the rest", async ({ page }) => {
    await signIn(page, MANAGER)

    await expect(sidebar(page)).toBeHidden()
    const tabs = staffNav(page)
    await expect(tabs.getByRole("link")).toHaveText(["Home", "Applicants"])
    // Interviews is behind More, so no tab is the current page.
    await expect(tabs.getByRole("link", { name: "Applicants" })).not.toHaveAttribute("aria-current", "page")

    await tabs.getByRole("button", { name: "More" }).click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toContainText(`${MANAGER.name} · ${MANAGER.roleName}`)
    const more = sheet.getByRole("navigation", { name: "More" })
    for (const label of MANAGER_ENTRIES.filter((label) => !["Home", "Applicants"].includes(label))) {
      await expect(more.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await expect(more.getByRole("link", { name: /^(Home|Applicants)$/ })).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible()

    // Reports keeps the old shell, with its tab bar.
    await more.getByRole("link", { name: "Reports" }).click()
    await expect(page).toHaveURL(//staff/reports$/)
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("banner")).toContainText("Reports")
    await expect(tabs.getByRole("link", { name: "Applicants" })).not.toHaveAttribute("aria-current", "page")
  })
})
