import type { Page } from "@playwright/test"

import { SUPER_ADMIN } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { chooseOption, dayFirst } from "./kit-parts"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// Reports, Staff and roles and Audit in the kit (#331). The Audit filters
// keep what they posted before the kit form parts; then axe on each screen
// and on each sheet and popover it opens, at 1280px and 390px, nightly only,
// as every axe scan is. Nothing here changes data: every sheet is opened and
// closed again. The pointer leaves the button it clicked before each scan of
// an overlay, so axe reads the colours at rest, not a hover.

async function open(page: Page, path: string, heading: string) {
  await signInOnce(page, SUPER_ADMIN.email, SUPER_ADMIN.password)
  await page.goto(path)
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible()
}

async function overlayProblems(page: Page) {
  await page.mouse.move(0, 0)
  return axeProblems(page, '[role="dialog"]')
}

test("an Audit date that cannot be read stops the search and is never sent as an empty filter", async ({ page }) => {
  await open(page, "/staff/audit", "Audit")
  const from = page.getByLabel("From")
  await from.fill("31/02/2026")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page.getByText("Type the date as day/month/year, for example 25/09/2026.")).toBeVisible()
  await expect(page).toHaveURL(/\/staff\/audit$/)

  await from.fill(dayFirst("2026-09-05"))
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/[?&]from=2026-09-05(&|$)/)
  await expect(from).toHaveValue(dayFirst("2026-09-05"))
})

test("Audit Who sends the chosen actor, and Anyone sends no one", async ({ page }) => {
  await open(page, "/staff/audit", "Audit")
  const who = page.getByRole("combobox", { name: "Who" })
  await chooseOption(who, "System")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/[?&]actor=system(&|$)/)

  await chooseOption(page.getByRole("combobox", { name: "Who" }), "Anyone")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/[?&]actor=(&|$)/)
  await expect(page.getByRole("combobox", { name: "Who" })).toHaveText("Anyone")
})

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("Reports and its filter popovers have no axe findings", { tag: "@nightly" }, async ({ page }) => {
      await open(page, "/staff/reports", "Reports")
      await expect(page.getByRole("region", { name: "Visited applicants" }).getByTestId("visited-count")).toBeVisible()
      expect(await axeProblems(page)).toEqual([])

      await page.getByRole("button", { name: "Filter Visited applicants" }).click()
      await expect(page.getByRole("dialog", { name: "Visited applicants" })).toBeVisible()
      expect(await overlayProblems(page)).toEqual([])
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      await page.getByRole("button", { name: "Filter Seats by class" }).click()
      await expect(page.getByRole("dialog", { name: "Seats by class" })).toBeVisible()
      expect(await overlayProblems(page)).toEqual([])
    })

    test("Staff and roles, its Move to… popover and its name sheet have no axe findings", { tag: "@nightly" }, async ({ page }) => {
      await open(page, "/staff/roles", "Staff and roles")
      await page.getByRole("button", { name: "History" }).click()
      await expect(page.getByRole("list", { name: "History" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])

      await page.getByRole("button", { name: "Rename" }).click()
      const sheet = page.getByRole("dialog", { name: /^Rename / })
      await expect(sheet).toBeVisible()
      expect(await overlayProblems(page)).toEqual([])
      await sheet.getByRole("button", { name: "Cancel" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)

      await page.getByRole("list", { name: /^People in / }).getByRole("button", { name: "Move to…", disabled: false }).first().click()
      await expect(page.getByRole("dialog", { name: "Move to…" })).toBeVisible()
      expect(await overlayProblems(page)).toEqual([])
    })

    test("Audit has no axe findings", { tag: "@nightly" }, async ({ page }) => {
      await open(page, "/staff/audit", "Audit")
      await expect(page.getByRole("list", { name: "Audit entries" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
    })
  })
}
