import type { Page } from "@playwright/test"

import { SUPER_ADMIN } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// Reports, Staff and roles and Audit in the kit (#331): axe on each screen
// and on each sheet and popover it opens, at 1280px and 390px, and the
// sheets under reduced motion. Nothing here changes data: every sheet is
// opened and closed again.

// Axe reads colours at rest, so the pointer leaves the button it clicked before each scan.
async function open(page: Page, path: string, heading: string) {
  await signInOnce(page, SUPER_ADMIN.email, SUPER_ADMIN.password)
  await page.goto(path)
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible()
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("Reports and its filter popovers have no axe findings", async ({ page }) => {
      await open(page, "/staff/reports", "Reports")
      await expect(page.getByRole("region", { name: "Visited applicants" }).getByTestId("visited-count")).toBeVisible()
      expect(await axeProblems(page, "main")).toEqual([])

      await page.getByRole("button", { name: "Filter Visited applicants" }).click()
      await expect(page.getByRole("dialog", { name: "Visited applicants" })).toBeVisible()
      await page.mouse.move(0, 0)
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      const seats = page.getByRole("button", { name: "Filter Seats by class" })
      if ((await seats.count()) > 0) {
        await seats.click()
        await expect(page.getByRole("dialog", { name: "Seats by class" })).toBeVisible()
        await page.mouse.move(0, 0)
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      }
    })

    test("Staff and roles, its Move to… popover and its name sheet have no axe findings", async ({ page }) => {
      await open(page, "/staff/roles", "Staff and roles")
      await page.getByRole("button", { name: "History" }).click()
      await expect(page.getByRole("list", { name: "History" })).toBeVisible()
      expect(await axeProblems(page, "main")).toEqual([])

      await page.getByRole("button", { name: "Rename" }).click()
      const sheet = page.getByRole("dialog", { name: /^Rename / })
      await expect(sheet).toBeVisible()
      await page.mouse.move(0, 0)
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      await sheet.getByRole("button", { name: "Cancel" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)

      const move = page.getByRole("list", { name: /^People in / }).getByRole("button", { name: "Move to…", disabled: false }).first()
      await move.click()
      await expect(page.getByRole("dialog", { name: "Move to…" })).toBeVisible()
      await page.mouse.move(0, 0)
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("Audit has no axe findings", async ({ page }) => {
      await open(page, "/staff/audit", "Audit")
      await expect(page.getByRole("list", { name: "Audit entries" })).toBeVisible()
      expect(await axeProblems(page, "main")).toEqual([])
    })
  })
}

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("the name sheet fades in place on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, "/staff/roles", "Staff and roles")
    await page.getByRole("button", { name: "Rename" }).click()
    const sheet = page.getByRole("dialog", { name: /^Rename / })
    await expect(sheet).toHaveCSS("transition-property", "opacity")
    await expect(sheet).toHaveCSS("transform", "none")
  })
})
