import { randomInt } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { saveFeeAmounts } from "@/lib/services/fees"

import { inRolledBackTransaction, signedIn } from "../tests/support/db"
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

  test("the Admissions Manager sets the Academic-year start and seats, and a date outside January is refused", async ({
    page,
  }) => {
    // A year of its own, created by the Accountant, so reruns start empty.
    const year = await unusedYear()
    const created = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, {
      bands: {
        nursery: { day: 1_100_000, boarding: 3_000_000 },
        primary_lower: { day: 2_000_000, boarding: 3_000_000 },
        primary_upper: { day: 2_100_000, boarding: 3_300_000 },
        secondary: { day: 2_800_000, boarding: 4_300_000 },
      },
      split: { first: 40, second: 40, third: 20 },
      dueDates: { first: `${year - 1}-11-01`, second: `${year}-04-01`, third: `${year}-06-01` },
      minimumDeposit: 300_000,
      preFormOne: { day: 450_000, boarding: 580_000 },
    })
    expect(created.ok).toBe(true)

    await signIn(page, MANAGER)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Fee schedule" }).click()
    await expect(page.getByRole("heading", { name: "Fee schedule", exact: true })).toBeVisible()
    await page.goto(`/staff/fees/${year}`)

    const section = page.getByRole("region", { name: "Academic year and seats" })
    await expect(section.getByText("Not set yet")).toBeVisible()
    await expect(section.getByRole("row", { name: /^STD 1/ })).toContainText("Seats not set")

    await section.getByRole("button", { name: "Edit start and seats" }).click()
    const form = page.getByRole("form", { name: `Academic year ${year}` })
    await form.getByLabel("STD 1 Day seats").fill("30")
    await form.getByLabel("STD 1 Boarding seats").fill("15")
    await form.getByLabel("FORM 1 Day seats").fill("0")

    // February is outside January.
    await form.getByLabel("Academic-year start").fill(`${year}-02-01`)
    await form.getByRole("button", { name: "Save" }).click()
    await expect(form.getByRole("alert")).toContainText(`Choose an Academic-year start in January ${year}.`)
    await expect(form.getByLabel("Academic-year start")).toHaveAttribute("aria-invalid", "true")

    await form.getByLabel("Academic-year start").fill(`${year}-01-11`)
    await form.getByRole("button", { name: "Save" }).click()
    await expect(section.getByRole("status")).toHaveText("Start and seats saved.")

    await expect(section.getByText(`11 Jan ${year}`)).toBeVisible()
    const std1 = section.getByRole("row", { name: /^STD 1/ })
    await expect(std1.getByRole("cell").nth(1)).toHaveText("30")
    await expect(std1.getByRole("cell").nth(2)).toHaveText("15")
    await expect(section.getByRole("row", { name: /^FORM 1/ }).getByRole("cell").nth(1)).toHaveText("0")
    await expect(section.getByRole("row", { name: /^FORM 1/ }).getByRole("cell").nth(2)).toHaveText("Seats not set")
  })

  test("the Accountant reads the 2027 start and seats but can't change them", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/fees/2027")

    const section = page.getByRole("region", { name: "Academic year and seats" })
    await expect(section.getByRole("row", { name: /^KG 2/ }).getByRole("cell").nth(2)).toHaveText("2")
    await expect(section.getByRole("row", { name: /^STD 2/ })).toContainText("Seats not set")
    await expect(section.getByRole("button", { name: "Edit start and seats" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit amounts" })).toBeVisible()
  })
})
