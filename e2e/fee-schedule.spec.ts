import { randomInt } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { inRolledBackTransaction } from "../tests/support/db"
import { ACCOUNTANT, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The Fee schedule screen, as the Accountant and the Admissions Manager use
// it. The Accountant's test creates a year of its own, far from the seeded
// 2027, so reruns never meet an earlier run's schedule.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const year = randomInt(2100, 3000)
      const taken = await sql.query("select 1 from public.fee_schedules where enrollment_year = $1", [year])
      if (taken.rowCount === 0) return year
    }
  })
}

test.describe("the Fee schedule", () => {
  test("the Accountant creates a year's schedule, and a split that isn't 100% is refused first", async ({ page }) => {
    const year = await unusedYear()
    await signIn(page, ACCOUNTANT)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Fee schedule" }).click()
    await expect(page.getByRole("heading", { name: "Fee schedule", exact: true })).toBeVisible()

    const newSchedule = page.getByRole("form", { name: "New schedule" })
    await newSchedule.getByLabel("Enrollment year").fill(String(year))
    await newSchedule.getByRole("button", { name: "Open year" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/fees/${year}$`))
    await expect(page.getByText(`No fee schedule for ${year} yet.`)).toBeVisible()

    const form = page.getByRole("form", { name: `Fee schedule ${year}` })
    const fees: [string, string, string][] = [
      ["Nursery", "1,100,000", "3,000,000"],
      ["Primary STD 1 to STD 4", "2,000,000", "3,000,000"],
      ["Primary STD 5 to STD 7", "2,100,000", "3,300,000"],
      ["Secondary", "2,800,000", "4,300,000"],
    ]
    for (const [band, day, boarding] of fees) {
      await form.getByLabel(`${band} Day fee`).fill(day)
      await form.getByLabel(`${band} Boarding fee`).fill(boarding)
    }
    await form.getByLabel("First instalment due date").fill(`${year - 1}-11-01`)
    await form.getByLabel("Second instalment due date").fill(`${year}-04-01`)
    await form.getByLabel("Third instalment due date").fill(`${year}-06-01`)
    await form.getByLabel("Minimum Initial deposit").fill("300000")
    await form.getByLabel("Pre-Form One programme Day fee").fill("450000")
    await form.getByLabel("Pre-Form One programme Boarding fee").fill("580000")

    // 40 + 40 + 30 is 110%.
    await form.getByLabel("Third instalment share (%)").fill("30")
    await form.getByRole("button", { name: "Create schedule" }).click()
    await expect(form.getByRole("alert")).toContainText("The three instalment shares must add up to 100%.")
    await expect(form.getByLabel("Third instalment share (%)")).toHaveAttribute("aria-invalid", "true")

    await form.getByLabel("Third instalment share (%)").fill("20")
    await form.getByRole("button", { name: "Create schedule" }).click()
    await expect(page.getByRole("status")).toHaveText(`The ${year} Fee schedule is saved.`)

    const annual = page.getByRole("region", { name: "Annual school fees" })
    await expect(annual.getByRole("row", { name: /Secondary/ })).toContainText("2,800,000")
    await expect(annual.getByRole("row", { name: /Secondary/ })).toContainText("4,300,000")
    await expect(page.getByRole("region", { name: "Instalments" }).getByRole("row", { name: /Third/ })).toContainText("20%")
    await expect(page.getByRole("button", { name: "Edit amounts" })).toBeVisible()

    // The new year is listed.
    await page.getByRole("link", { name: "All years" }).click()
    await expect(page.getByRole("list", { name: "Enrollment years" }).getByRole("link", { name: new RegExp(`^${year}`) })).toBeVisible()
  })

  test("the Admissions Manager reads the 2027 amounts but can't change them", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/fees/2027")

    await expect(page.getByRole("heading", { name: "Fee schedule 2027" })).toBeVisible()
    const annual = page.getByRole("region", { name: "Annual school fees" })
    await expect(annual.getByRole("row", { name: /Nursery/ })).toContainText("1,100,000")
    await expect(annual.getByRole("row", { name: /Nursery/ })).toContainText("3,000,000")
    await expect(page.getByRole("button", { name: "Edit amounts" })).toHaveCount(0)
    await expect(page.getByRole("form")).toHaveCount(0)

    await page.goto("/staff/fees")
    await expect(page.getByRole("form", { name: "New schedule" })).toHaveCount(0)
  })
})
