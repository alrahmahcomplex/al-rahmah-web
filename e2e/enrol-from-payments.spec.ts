import { expect, test, type Page } from "@playwright/test"

import { formatDate } from "@/lib/school-calendar"

import { ACCOUNTANT, type FixtureStaff } from "../tests/support/fixtures"

// A lead Enrolled from its payments (#108): the lead screen says what
// enrolled it and when, and the history says why. Reads the seeded lead only.

// Seeded: Omari Malipo, STD 1 Day 2027, Full payment of TZS 2,000,000 on
// 26 Sep 2026.
const SEEDED_FULL = "1ead0000-0000-4000-8000-000000000904"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

test("a lead paid in Full shows Enrolled, the payment that enrolled it, and why in its history", async ({ page }) => {
  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${SEEDED_FULL}`)

  const fee = page.getByRole("region", { name: "School fee" })
  await expect(fee.getByText("By the Full payment of TZS 2,000,000")).toBeVisible()
  await expect(fee.getByText(`On ${formatDate("2026-09-26")}`)).toBeVisible()

  await page.goto(`/staff/leads/${SEEDED_FULL}/history`)
  await expect(page.getByText("enrolled the lead, because a school-fee payment was recorded")).toBeVisible()
  await expect(page.getByText("recorded what enrolled the lead")).toBeVisible()
})
