import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { addDays, mondayOf, shortDay, shortRange } from "@/app/staff/_home/stats"
import { tanzaniaToday } from "@/lib/school-calendar"

import { unusedAdmissionNumber } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"

// Home (#323): Today, Check-in and Register students in one page. The search
// bar finds a family by Admission Number, Register students opens today's
// New Student form until #308, the stat cards show a past day or week and
// Reset brings back today and this week, and old Check-in links land here.

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
}

const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff" })
const searchBar = (page: Page) => page.getByRole("search", { name: "Check in a family" })
const statCard = (page: Page, label: string | RegExp) => page.getByRole("region", { name: label })
const quickActions = (page: Page) => page.getByRole("region", { name: "Quick actions" })

async function lookUp(page: Page, typed: string) {
  await page.goto("/staff")
  await searchBar(page).getByLabel("Admission Number").fill(typed)
  await searchBar(page).getByRole("button", { name: "Find the family" }).click()
}

test.describe("finding a family from the search bar", () => {
  test("goes straight to their record, however the number is typed", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    for (const typed of ["ADMSN-90002", "  admsn-90002 ", "90002"]) {
      await lookUp(page, typed)
      await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000002$/)
      await expect(page.getByRole("heading", { name: "Baraka Fixture", level: 1 })).toBeVisible()
    }
  })

  test("goes to an Archived lead itself, not the reopening hand-off", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await lookUp(page, "ADMSN-90005")
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000005$/)
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
  })

  test("a number that matches nothing says so under the bar, and Home stays", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await lookUp(page, await unusedAdmissionNumber())
    await expect(searchBar(page).getByRole("alert")).toHaveText("No applicant with this Admission Number")
    await expect(page).toHaveURL(/\/staff$/)

    // Typing again clears it, and the right number goes through.
    const field = searchBar(page).getByLabel("Admission Number")
    await field.fill("90001")
    await expect(searchBar(page).getByRole("alert")).toHaveText("")
    await field.press("Enter")
    await expect(page.getByRole("heading", { name: "Zawadi Fixture", level: 1 })).toBeVisible()
  })

  test("a lookup that never comes back says so, not that there is no lead", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: Failed to load resource: net::ERR_CONNECTION_FAILED \(http:\/\/[^)]+\/staff\)$/, "this test drops the first lookup")
    await signIn(page, ADMISSIONS)

    let dropped = false
    await page.route("**/staff", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true
        await route.abort("connectionfailed")
        return
      }
      await route.continue()
    })

    const field = searchBar(page).getByLabel("Admission Number")
    await field.fill("ADMSN-90002")
    await searchBar(page).getByRole("button", { name: "Find the family" }).click()
    await expect(searchBar(page).getByRole("alert")).toHaveText("The lookup could not be completed. Check your connection and try again.")
    await expect(field).toHaveValue("ADMSN-90002")

    await searchBar(page).getByRole("button", { name: "Find the family" }).click()
    await expect(page.getByRole("heading", { name: "Baraka Fixture", level: 1 })).toBeVisible()
  })

  test("an Accountant can look a lead up, and is not offered Register students", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(page.getByRole("link", { name: "Register students" })).toHaveCount(0)
    await lookUp(page, "ADMSN-90004")
    await expect(page.getByRole("heading", { name: "Salma Fixture", level: 1 })).toBeVisible()
  })
})

test.describe("Register students and the old links", () => {
  test("Register students opens today's New Student form", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.getByRole("link", { name: "Register students" }).click()
    await expect(page).toHaveURL(/\/staff\/check-in\/new$/)
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
  })

  test("Home is the first sidebar entry, and an old Check-in link lands on Home", async ({ page }) => {
    await signIn(page, MANAGER)
    const links = staffNav(page).getByRole("link")
    await expect(links.first()).toHaveAccessibleName("Home")
    await expect(links.first()).toHaveAttribute("aria-current", "page")
    await expect(staffNav(page).getByRole("link", { name: /^(Today|Check-in|Register a student)$/ })).toHaveCount(0)
    await expect(staffNav(page).getByText("Front desk", { exact: true })).toHaveCount(0)

    await page.goto("/staff/check-in")
    await expect(page).toHaveURL(/\/staff$/)
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible()
  })
})

test.describe("the stat cards", () => {
  test("a past day and a past week show their own numbers, and Reset brings back today and this week", async ({ page }) => {
    const today = tanzaniaToday()
    const day = addDays(today, -9)
    const week = addDays(mondayOf(today), -14)
    await signIn(page, ADMISSIONS)
    await expect(statCard(page, "Interviews today")).toBeVisible()
    await expect(statCard(page, "Applied this week")).toBeVisible()
    // Nothing to reset while today and this week show.
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0)

    await page.goto(`/staff?day=${day}&week=${addDays(week, 3)}`)
    const pastDay = statCard(page, `Interviews on ${shortDay(day)}`)
    const pastWeek = statCard(page, `Applied ${shortRange(week, addDays(week, 6))}`)
    await expect(pastDay).toBeVisible()
    await expect(pastWeek).toBeVisible()
    await expect(pastDay.getByRole("img", { name: /^Last 7 days\./ })).toHaveAccessibleName(new RegExp(`${shortDay(day)}: \\d+$`))

    await pastDay.hover()
    await pastDay.getByRole("button", { name: "Back to today" }).click()
    await expect(statCard(page, "Interviews today")).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/staff\\?week=${addDays(week, 3)}$`))

    await pastWeek.hover()
    await pastWeek.getByRole("button", { name: "Back to this week" }).click()
    await expect(statCard(page, "Applied this week")).toBeVisible()
    await expect(page).toHaveURL(/\/staff$/)
  })

  test("the calendar picks a past day, and the filter a past week in the calendar's week mode", async ({ page }) => {
    // The 10th of last month, wherever today falls.
    const today = tanzaniaToday()
    const [year, month] = today.split("-").map(Number)
    const last = new Date(Date.UTC(year, month - 2, 10))
    const day = last.toISOString().slice(0, 10)
    // The calendar names a day "10 October 2026", and a week "Week of 10 October 2026".
    const dayName = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(last)
    await signIn(page, ADMISSIONS)

    await statCard(page, "Interviews today").getByRole("button", { name: "Open the calendar" }).click()
    const days = page.getByRole("dialog", { name: "Choose a date" })
    await days.getByRole("button", { name: "Previous month" }).click()
    await days.getByRole("button", { name: dayName }).click()
    await expect(statCard(page, `Interviews on ${shortDay(day)}`)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/staff\\?day=${day}$`))

    await statCard(page, "Applied this week").getByRole("button", { name: "Show another week" }).click()
    const weeks = page.getByRole("dialog", { name: "Choose a week" })
    await weeks.getByRole("button", { name: "Previous month" }).click()
    await weeks.getByRole("button", { name: `Week of ${dayName}` }).click()
    const monday = mondayOf(day)
    await expect(statCard(page, `Applied ${shortRange(monday, addDays(monday, 6))}`)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/staff\\?day=${day}&week=${monday}$`))
  })

  test("a day or week that has not passed yet shows today and this week", async ({ page }) => {
    const today = tanzaniaToday()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff?day=${addDays(today, 3)}&week=${addDays(today, 14)}`)
    await expect(statCard(page, "Interviews today")).toBeVisible()
    await expect(statCard(page, "Applied this week")).toBeVisible()
  })
})

test.describe("Quick actions", () => {
  test("Admissions Staff get Call a family back; the Manager also gets Request a discount", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await expect(quickActions(page).getByRole("link", { name: /^Call a family back/ })).toHaveAttribute("href", "/staff/follow-ups")
    await expect(quickActions(page).getByRole("link", { name: /^Request a discount/ })).toHaveCount(0)

    await page.context().clearCookies()
    await signIn(page, MANAGER)
    await expect(quickActions(page).getByRole("link", { name: /^Call a family back/ })).toBeVisible()
    await quickActions(page).getByRole("link", { name: /^Request a discount/ }).click()
    await expect(page).toHaveURL(/\/staff\/discounts$/)
  })
})

for (const [label, size] of [
  ["a desktop", { width: 1280, height: 800 }],
  ["a phone", { width: 390, height: 844 }],
] as const) {
  test(`axe finds nothing but the accepted findings on Home at ${label}`, { tag: "@nightly" }, async ({ page }) => {
    await page.setViewportSize(size)
    await signIn(page, MANAGER)
    expect(await axeProblems(page)).toEqual([])
  })
}
