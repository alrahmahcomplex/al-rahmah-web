import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { chooseOption } from "./kit-parts"
import { signInOnce } from "./log-in"

// The Applicants screen, as staff use it, against the seeded leads. No other
// test makes a lead named "... Fixture", so a search for it finds exactly the
// six seeded ones. The search is the top bar's; a row opens the side sheet.

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

function searchBox(page: Page) {
  return page.getByRole("search").getByRole("textbox", { name: "Search applicants" })
}

async function searchFor(page: Page, typed: string) {
  await searchBox(page).fill(typed)
  await searchBox(page).press("Enter")
}

// The rows of the results table, without its header.
function resultRows(page: Page) {
  return page.getByRole("table", { name: "Applicants" }).locator("tbody tr")
}

function closure(page: Page) {
  return page.getByRole("main").getByRole("combobox", { name: "Closure" })
}

function statusPill(page: Page, status: string) {
  return page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: status, exact: true })
}

test.describe("the Applicants screen", () => {
  test("opens from the staff navigation, for Admissions Staff and Accountants alike", async ({ page }) => {
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      await page.context().clearCookies()
      await signIn(page, person)
      await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Applicants" }).click()
      await expect(page).toHaveURL(/\/staff\/applicants$/)
      await expect(page.getByRole("heading", { name: "Applicants", level: 1 })).toBeVisible()
    }
  })

  test("finds a lead by its Admission Number, closed or not, and opens it in the sheet, then the full record", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    await searchFor(page, " admsn-90005 ")
    await expect(page).toHaveURL(/q=\+?admsn-90005/)
    await expect(page.getByRole("main").getByText("Search: admsn-90005", { exact: true })).toBeVisible()
    const rows = resultRows(page)
    await expect(rows).toHaveCount(1)
    const hamisi = rows.first()
    for (const text of ["ADMSN-90005", "Hamisi Fixture", "STD 5", "Omari Fixture", "Visited", "Archived"]) {
      await expect(hamisi.getByText(text, { exact: true })).toBeVisible()
    }

    await hamisi.click()
    const sheet = page.getByRole("dialog", { name: "Hamisi Fixture" })
    await expect(sheet.getByRole("heading", { name: "Student" })).toBeVisible()
    for (const text of ["ADMSN-90005", "2027", "Day", "Omari Fixture", "Guardian"]) {
      await expect(sheet.getByText(text, { exact: true })).toBeVisible()
    }
    // A closed lead has no next step.
    await expect(sheet.getByText(/^Next step:/)).toHaveCount(0)

    await sheet.getByRole("link", { name: "Open full record" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000005$/)
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
  })

  test("a row opens with Enter, the sheet shows the next step, and closing it puts focus back on the row", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/applicants?q=ADMSN-90002")

    const row = page.getByRole("row", { name: /Baraka Fixture/ })
    await row.focus()
    await page.keyboard.press("Enter")
    const sheet = page.getByRole("dialog", { name: "Baraka Fixture" })
    await expect(sheet.getByText(/^Next step: .+\.$/)).toBeVisible()
    const said = (await sheet.getByText(/^Next step: .+\.$/).textContent())!.replace(/^Next step: (.+)\.$/, "$1")
    // Staff who may view payments see the School fee; those who may record one get a link to the record's School fee tab.
    await expect(sheet.getByRole("heading", { name: "School fee" })).toBeVisible()
    await expect(sheet.getByRole("heading", { name: "Custodian" })).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Record payment" })).toHaveAttribute(
      "href",
      "/staff/applicants/1ead0000-0000-4000-8000-000000000002?tab=school-fee#lead-school-fee",
    )

    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(row).toBeFocused()
    // The row's Next step column says what the sheet said (#415).
    await expect(row.getByRole("cell", { name: said, exact: true })).toBeVisible()
  })

  test("Record payment shows only to staff who may record one, and only on an open application", async ({ page }) => {
    // Admissions Staff see the fee but don't record payments.
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants?q=ADMSN-90002")
    await page.getByRole("row", { name: /Baraka Fixture/ }).click()
    const baraka = page.getByRole("dialog", { name: "Baraka Fixture" })
    await expect(baraka.getByRole("heading", { name: "School fee" })).toBeVisible()
    await expect(baraka.getByRole("link", { name: "Record payment" })).toHaveCount(0)

    // The Accountant records payments, but not on a closed application.
    await page.context().clearCookies()
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/applicants?q=ADMSN-90005")
    await page.getByRole("row", { name: /Hamisi Fixture/ }).click()
    const hamisi = page.getByRole("dialog", { name: "Hamisi Fixture" })
    await expect(hamisi.getByRole("heading", { name: "School fee" })).toBeVisible()
    await expect(hamisi.getByRole("link", { name: "Record payment" })).toHaveCount(0)
  })

  test("finds leads by part of a name, with closed leads badged and last", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    await searchFor(page, "  FIXTURE ")
    const rows = resultRows(page)
    await expect(rows).toHaveCount(6)
    await expect(rows.locator("th b")).toHaveText([
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
    await expect(page.getByText("No applicant matches this name.")).toBeVisible()

    // Clear returns to the everyday list.
    await page.getByRole("main").getByRole("link", { name: "Clear" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants$/)
    await expect(searchBox(page)).toHaveValue("")
  })

  test("the list leaves out closed leads until a filter asks for them", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    const rows = resultRows(page)
    await expect(rows.first()).toBeVisible()
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(0)
    await expect(rows.getByText("Inactive", { exact: true })).toHaveCount(0)
    await expect(closure(page)).toHaveText("Without a closure mark")
    await expect(statusPill(page, "All")).toHaveAttribute("aria-pressed", "true")

    await chooseOption(closure(page), "Archived")
    await expect(page).toHaveURL(/closure=Archived/)
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(count)

    await statusPill(page, "Visited").click()
    await expect(page).toHaveURL(/status=Visited/)
    await expect(page).toHaveURL(/closure=Archived/)
    await expect(statusPill(page, "Visited")).toHaveAttribute("aria-pressed", "true")
    await expect(closure(page)).toHaveText("Archived")
    await expect(rows.getByText("Archived", { exact: true })).toHaveCount(await rows.count())

    await chooseOption(closure(page), "Without a closure mark")
    await statusPill(page, "Declined").click()
    await expect(page).toHaveURL(/\/staff\/applicants\?status=Declined$/)
    await expect(rows.first()).toBeVisible()
    await expect(rows.getByText("Declined", { exact: true })).toHaveCount(await rows.count())
  })

  test("a search made straight after a filter change keeps that filter for Clear", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    // The filter's page is held back until the search has gone, so the search
    // is made while the address still has the old filters.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let holding = false
    const filterPage = /\/staff\/applicants\?closure=Inactive(&_rsc=|$)/
    await page.route(filterPage, async (route) => {
      holding = true
      await held
      await route.continue().catch(() => {})
    })
    await chooseOption(closure(page), "Inactive")
    await expect.poll(() => holding).toBe(true)
    await searchFor(page, "Fixture")
    await expect(page).toHaveURL(/q=Fixture/)
    release()
    await page.unroute(filterPage)
    await expect(resultRows(page)).toHaveCount(6)

    await page.getByRole("main").getByRole("link", { name: "Clear" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\?closure=Inactive$/)
    await expect(closure(page)).toHaveText("Inactive")
    await expect(searchBox(page)).toHaveValue("")

    // Back and forward bring the box to the search each page shows.
    await page.goBack()
    await expect(page).toHaveURL(/q=Fixture/)
    await expect(searchBox(page)).toHaveValue("Fixture")
    await page.goForward()
    await expect(page).toHaveURL(/\/staff\/applicants\?closure=Inactive$/)
    await expect(searchBox(page)).toHaveValue("")
    await expect(closure(page)).toHaveText("Inactive")
  })

  test("a filter left with Back is not carried by the next search", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    await statusPill(page, "Applied").click()
    await expect(page).toHaveURL(/\/staff\/applicants\?status=Applied$/)
    // Choosing what is already shown changes nothing.
    await statusPill(page, "Applied").click()
    await page.goBack()
    await expect(page).toHaveURL(/\/staff\/applicants$/)

    await searchFor(page, "Fixture")
    await expect(page).toHaveURL(/\/staff\/applicants\?q=Fixture$/)
    await page.getByRole("main").getByRole("link", { name: "Clear" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants$/)
  })

  test("the last filter chosen wins, even before the first one's page arrives", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    // Applied's page is held back while All is chosen again.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let holding = false
    const appliedPage = /\/staff\/applicants\?status=Applied(&_rsc=|$)/
    await page.route(appliedPage, async (route) => {
      holding = true
      await held
      await route.continue().catch(() => {})
    })
    await statusPill(page, "Applied").click()
    await expect.poll(() => holding).toBe(true)
    await statusPill(page, "All").click()
    await expect(statusPill(page, "All")).toHaveAttribute("aria-pressed", "true")
    release()
    await page.unroute(appliedPage)
    // The list stays on All once Applied's page is let through.
    await expect(page).toHaveURL(/\/staff\/applicants$/)
    await expect(statusPill(page, "All")).toHaveAttribute("aria-pressed", "true")

    await searchFor(page, "Fixture")
    await expect(page).toHaveURL(/\/staff\/applicants\?q=Fixture$/)
    await page.getByRole("main").getByRole("link", { name: "Clear" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants$/)
  })

  test("opening Applicants again forgets a filter whose page never came", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/applicants")

    // Inactive's page is held back; the sidebar's Applicants comes instead.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let holding = false
    const filterPage = /\/staff\/applicants\?closure=Inactive(&_rsc=|$)/
    await page.route(filterPage, async (route) => {
      holding = true
      await held
      await route.continue().catch(() => {})
    })
    await chooseOption(closure(page), "Inactive")
    await expect.poll(() => holding).toBe(true)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Applicants" }).click()
    await expect(closure(page)).toHaveText("Without a closure mark")
    release()
    await page.unroute(filterPage)
    await expect(page).toHaveURL(/\/staff\/applicants$/)

    await searchFor(page, "Fixture")
    await expect(page).toHaveURL(/\/staff\/applicants\?q=Fixture$/)
  })

  test("old /staff/leads addresses go to the same place under /staff/applicants", async ({ page, request }) => {
    const moved = await request.get("/staff/leads/1ead0000-0000-4000-8000-000000000005?tab=interview", { maxRedirects: 0 })
    expect(moved.status()).toBe(308)
    expect(moved.headers().location).toBe("/staff/applicants/1ead0000-0000-4000-8000-000000000005?tab=interview")

    await signIn(page, ADMISSIONS)
    await page.goto("/staff/leads?closure=Inactive")
    await expect(page).toHaveURL(/\/staff\/applicants\?closure=Inactive$/)
    await expect(closure(page)).toHaveText("Inactive")
  })

  test("someone signed out is sent to sign in", async ({ page }) => {
    await page.goto("/staff/applicants?q=Fixture")
    await expect(page).toHaveURL(/\/login/)
  })
})

// Axe (@nightly) on the list, a filtered list, the empty state, the side
// sheet and the Import and Export sheets, at desktop and phone widths. Set
// AP_SHOTS to a folder to keep a capture of each, for a PR's evidence.
async function shot(page: Page, file: string) {
  if (process.env.AP_SHOTS) await page.screenshot({ path: `${process.env.AP_SHOTS}/${file}.png`, fullPage: true })
}

for (const width of [1280, 390]) {
  test.describe(`axe at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("the list, a filtered list and the empty state", { tag: "@nightly" }, async ({ page }) => {
      await signIn(page, MANAGER)
      await page.goto("/staff/applicants")
      await expect(resultRows(page).first()).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `${width}-list`)

      await statusPill(page, "Visited").click()
      await expect(page).toHaveURL(/status=Visited/)
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `${width}-filtered`)

      await searchFor(page, "Nobody Fixture Here")
      await expect(page.getByText("No applicant matches this name.")).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
      await shot(page, `${width}-empty`)
    })

    test("the side sheet and the Import and Export sheets", { tag: "@nightly" }, async ({ page }) => {
      await signIn(page, MANAGER)
      await page.goto("/staff/applicants?q=ADMSN-90002")
      await page.getByRole("row", { name: /Baraka Fixture/ }).click()
      const sheet = page.getByRole("dialog", { name: "Baraka Fixture" })
      await expect(sheet.getByText(/^Next step:/)).toBeVisible()
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      await shot(page, `${width}-sheet`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      for (const [button, name] of [
        ["Export", "Export applicants"],
        ["Import", "Import applicants"],
      ]) {
        await page.getByRole("button", { name: button, exact: true }).click()
        await expect(page.getByRole("dialog", { name })).toBeVisible()
        expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
        await shot(page, `${width}-${button.toLowerCase()}`)
        await page.keyboard.press("Escape")
        await expect(page.getByRole("dialog")).toHaveCount(0)
      }
    })
  })
}
