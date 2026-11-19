import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { logIn, signInOnce } from "./log-in"

// The shell around every staff page (#225): the grouped sidebar and its rail,
// and the phone's tab bar with its More sheet. Every page with a sidebar entry
// is in the new shell now (#323, #324, #328, #331), so these tests read the
// old shell on the staff 404, which it still draws (the catch-all route).

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

// An address no page answers: the staff 404, inside the old shell.
const UNKNOWN = "/staff/no-such-page"

// Signs in and opens the staff 404, the old shell's last page.
async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
  await page.goto(UNKNOWN)
  await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible()
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

    // The 404 is no entry's page.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0)
    await entry(page, "Staff and roles").click()
    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(page.getByRole("heading", { level: 1, name: "Staff and roles" })).toBeVisible()
    await expect(entry(page, "Staff and roles")).toHaveAttribute("aria-current", "page")
  })

  test("Admissions Staff see Admissions, Referrals, Fee schedule and Seats, and no Admin group", async ({ page }) => {
    await logIn(page, ADMISSIONS.email, ADMISSIONS.password)
    await expect(page).toHaveURL(/\/staff$/)
    await page.goto(UNKNOWN)
    await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible()

    const nav = staffNav(page)
    for (const group of ["Admissions", "Referrals", "Money"]) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible()
    }
    await expect(entry(page, "Fee schedule")).toBeVisible()
    // Everyone who may view payments opens Seats (#449).
    await expect(entry(page, "Seats")).toBeVisible()
    await expect(nav.getByText("Admin", { exact: true })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: /^(Discount requests|Reopening requests|Reports|Staff and roles)/ })).toHaveCount(0)
  })

  // #437: leaving the staff 404 for another page reported React error #419,
  // for every role. The console guard fails the test on any page error.
  for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
    test(`the staff 404 opens and is left with no page errors, as ${person.roleName}`, async ({ page }) => {
      await signInOnce(page, person.email, person.password)
      await expect(page).toHaveURL(/\/staff$/)
      await page.goto(UNKNOWN)
      await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible()
      await page.getByRole("button", { name: "Back to the staff area" }).click()
      await expect(page).toHaveURL(/\/staff$/)
      await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toHaveCount(0)
    })
  }

  test("the rail survives a navigation and a reload", async ({ page }) => {
    await signIn(page, MANAGER)
    // The button's name says which way the rail is: Collapse while open, Expand while folded.
    const collapse = page.getByRole("button", { name: "Collapse sidebar" })
    const expand = page.getByRole("button", { name: "Expand sidebar" })
    await expect(collapse).toBeVisible()

    await collapse.click()
    await expect(expand).toBeVisible()
    // The labels fold away, but every link keeps its name, and a tooltip shows it.
    await expect(entry(page, "Staff and roles")).toBeVisible()
    await entry(page, "Staff and roles").hover()
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("Staff and roles")

    // Away and back to the old shell's only page: the rail is still folded.
    await page.goto("/staff")
    await page.goto(UNKNOWN)
    await expect(page.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeVisible()
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
    // The 404 is no tab's page.
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

    await more.getByRole("link", { name: "Staff and roles" }).click()
    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("heading", { level: 1, name: "Staff and roles" })).toBeVisible()
  })
})
