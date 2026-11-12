import type { Page } from "@playwright/test"

import { SUPER_ADMIN } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// Reports, Staff and roles and Audit in the kit (#331): axe on each screen
// and on each sheet and popover it opens, at 1280px and 390px. Nightly only,
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
