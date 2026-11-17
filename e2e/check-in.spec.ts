import { randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// Reading leads at the front desk. Registering a family is in
// register-students.spec.ts (#308).

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test.describe("who sees what", () => {
  test("an Accountant can read a lead", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/applicants/1ead0000-0000-4000-8000-000000000004")
    await expect(page.getByRole("heading", { name: "Salma Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("+255700000104")).toHaveCount(0)
    await expect(page.getByText("+255700000103")).toBeVisible()
    await expect(page.getByText("+255700000113")).toBeVisible()
  })

  test("a lead that does not exist is not found", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    // The application page streams behind its loading skeleton, so the
    // status is already sent when the lookup finds nothing. Next marks the
    // page noindex; what staff see is the staff 404 inside the shell.
    await page.goto(`/staff/applicants/${randomUUID()}`)
    await expect(page.getByRole("heading", { name: "This page does not exist", level: 1 })).toBeVisible()
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
  })

  test("someone signed out is sent to sign in", async ({ page }) => {
    await page.goto("/staff/check-in")
    await expect(page).toHaveURL(/\/login/)
  })
})
