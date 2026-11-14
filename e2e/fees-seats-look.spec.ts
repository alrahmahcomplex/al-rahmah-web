import { type Page } from "@playwright/test"

import { ACCOUNTANT, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The Fee schedule and Seats screens in the new shell (#329): each one, and
// each edit form open, at the desktop and the phone width. Axe may report
// only the accepted white on orange. The seeded 2027 schedule is read, never
// saved.

async function open(page: Page, person: FixtureStaff, path: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(path)
  await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible()
}

const SCREENS: { path: string; person: FixtureStaff }[] = [
  { path: "/staff/fees", person: ACCOUNTANT },
  { path: "/staff/fees/2027", person: ACCOUNTANT },
  { path: "/staff/fees/2027", person: MANAGER },
  { path: "/staff/seats?year=2027", person: MANAGER },
]

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const { path, person } of SCREENS) {
      test(`axe finds nothing on ${path} for the ${person.roleName}`, async ({ page }) => {
        await open(page, person, path)
        expect(await axeProblems(page)).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      })
    }

    test("axe finds nothing in the open Fee schedule form", async ({ page }) => {
      await open(page, ACCOUNTANT, "/staff/fees/2027")
      await page.getByRole("button", { name: "Edit amounts" }).click()
      await expect(page.getByRole("form", { name: "Fee schedule 2027" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })

    test("axe finds nothing in the open Academic year and seats form", async ({ page }) => {
      await open(page, MANAGER, "/staff/fees/2027")
      await page.getByRole("button", { name: "Edit start and seats" }).click()
      await expect(page.getByRole("form", { name: "Academic year 2027" })).toBeVisible()
      expect(await axeProblems(page)).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}

test("money reads right-aligned with tabular figures in the table and in the form", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, ACCOUNTANT, "/staff/fees/2027")
  const cell = page.getByRole("region", { name: "Annual school fees" }).getByRole("row", { name: /Nursery/ }).getByRole("cell").nth(1)
  await expect(cell).toHaveCSS("text-align", "right")
  await expect(cell).toHaveCSS("font-variant-numeric", "tabular-nums")

  await page.getByRole("button", { name: "Edit amounts" }).click()
  const input = page.getByRole("form", { name: "Fee schedule 2027" }).getByLabel("Nursery Day fee")
  await expect(input).toHaveCSS("text-align", "right")
  await expect(input).toHaveCSS("font-variant-numeric", "tabular-nums")
})

// The stage's page-change rise is the only motion these screens add; under
// reduced motion no block of the page moves.
test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } })

  for (const { path, person } of [SCREENS[0], SCREENS[2], SCREENS[3]]) {
    test(`no block of ${path} moves`, async ({ page }) => {
      await open(page, person, path)
      const rise = await page.locator(".ns-page > *").evaluateAll((blocks) => blocks.map((block) => getComputedStyle(block).animationName))
      expect(rise.length).toBeGreaterThan(0)
      for (const name of rise) expect(name).toBe("none")
    })
  }
})
