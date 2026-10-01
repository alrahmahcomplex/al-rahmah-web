import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { createLead } from "@/lib/services/leads"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The School fee section on the lead screen. Each test gives its lead an
// enrollment year of its own, with or without a schedule it saves itself, so
// no other test's schedule changes what it sees.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A year no schedule holds yet, that a lead can still hold (up to 2100).
async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const year = randomInt(2030, 2100)
      const taken = await sql.query("select 1 from public.fee_schedules where enrollment_year = $1", [year])
      if (taken.rowCount === 0) return year
    }
  })
}

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

// A walk-in STD 3 Day lead, moved into `year`.
async function leadIn(year: number): Promise<string> {
  const phone = `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: `Fee ${randomUUID().slice(0, 6)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]))
  return created.data.leadId
}

function feeDetail(page: Page, term: string) {
  return page.getByRole("region", { name: "School fee" }).locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]")
}

test.describe("a lead's School fee", () => {
  test("Admissions Staff see the fee, Total paid, balance and instalments, and a corrected class changes it", async ({ page }) => {
    const year = await unusedYear()
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, AMOUNTS)
    if (!saved.ok) throw new Error("setup failed")
    const id = await leadIn(year)

    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${id}`)

    const section = page.getByRole("region", { name: "School fee" })
    await expect(section.getByText("Primary STD 1 to STD 4, Day")).toBeVisible()
    await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 2,000,000")
    await expect(feeDetail(page, "Total paid")).toHaveText("TZS 0")
    await expect(feeDetail(page, "Balance")).toHaveText("TZS 2,000,000")
    const rows = section.getByRole("row")
    await expect(rows.nth(1)).toHaveText(/First\s*1 Nov 2026\s*800,000/)
    await expect(rows.nth(2)).toHaveText(/Second\s*1 Apr 2027\s*800,000/)
    await expect(rows.nth(3)).toHaveText(/Third\s*1 Jun 2027\s*400,000/)
    // Phone width: nothing runs off the side of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

    await page.getByRole("button", { name: "Edit student" }).click()
    const form = page.getByRole("form", { name: "Edit student" })
    await form.getByLabel("Class").selectOption("FORM 2")
    await form.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Student details saved.")

    await expect(section.getByText("Secondary, Day")).toBeVisible()
    await expect(feeDetail(page, "Annual fee")).toHaveText("TZS 2,800,000")
    await expect(rows.nth(3)).toHaveText(/Third\s*1 Jun 2027\s*560,000/)
  })

  test("a lead whose year has no schedule says so, with no amount", async ({ page }) => {
    const year = await unusedYear()
    const id = await leadIn(year)

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${id}`)
    const section = page.getByRole("region", { name: "School fee" })
    await expect(section).toContainText(`No fee schedule for ${year} yet.`)
    await expect(section).not.toContainText("TZS")
  })

  test("staff without payments.view see no School fee", async ({ page }) => {
    const id = await leadIn(await unusedYear())
    const viewer = await createThrowawayStaff(["leads.view"])

    await signIn(page, viewer)
    await page.goto(`/staff/leads/${id}`)
    await expect(page.getByRole("region", { name: "Student" })).toBeVisible()
    await expect(page.getByRole("region", { name: "School fee" })).toHaveCount(0)
  })
})
