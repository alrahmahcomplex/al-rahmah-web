import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { formatDate } from "@/lib/school-calendar"

import { ACCOUNTANT, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"

// A lead Enrolled from its payments (#108): the lead screen says what
// enrolled it and when, and the history says why. Reads the seeded lead only.

// Seeded: Omari Malipo, STD 1 Day 2027, Full payment of TZS 2,000,000 on
// 26 Sep 2026.
const SEEDED_FULL = "1ead0000-0000-4000-8000-000000000904"

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("a lead paid in Full shows Enrolled, the payment that enrolled it, and why in its history", async ({ page }) => {
  await signIn(page, ACCOUNTANT)
  await page.goto(leadUrl(SEEDED_FULL, "School fee"))

  // Nothing is left to do on an Enrolled lead.
  await expect(page.getByRole("region", { name: "Next step" })).toContainText("Next step: Nothing is waiting")
  const fee = page.getByRole("region", { name: "School fee" })
  await expect(fee.getByText("By the Full payment of TZS 2,000,000")).toBeVisible()
  await expect(fee.getByText(`On ${formatDate("2026-09-26")}`)).toBeVisible()

  await openLeadHistoryAsSuperAdmin(page, SEEDED_FULL)
  await expect(page.getByText("enrolled the applicant, because a school-fee payment was recorded")).toBeVisible()
  await expect(page.getByText("recorded what enrolled the applicant")).toBeVisible()
})
