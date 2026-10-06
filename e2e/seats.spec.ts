import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { getSeats } from "@/lib/services/seats"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Seats (#111): the Accountant records a payment into a full class through
// the warning, and the Manager sees the class ranked on the Seats screen. The
// test claims a year of its own (tests/support/fee-years.ts), so the seeded
// 2027 seats are left alone.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

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

let claims: FeeYearClaim[] = []

test.afterEach(async () => {
  await Promise.all(claims.map((claim) => claim.release()))
  claims = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in KG 2 Boarding lead in `year`, interviewed and Passed.
async function passedLead(year: number): Promise<{ id: string; name: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const name = `Seat ${randomUUID().slice(0, 6)}`
  const phone = `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: name, className: "KG 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Boarding" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(admissions, created.data.leadId)
  if (!registered.ok) throw new Error(registered.error)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(recorded.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]))
  return { id: created.data.leadId, name }
}

test("a payment into a full class is recorded through the warning, and Seats ranks the class's leads", async ({ page }) => {
  const claim = await claimFeeYear()
  claims.push(claim)
  const year = claim.year
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), year, AMOUNTS)).ok) throw new Error("schedule failed")

  // One lead already holds a Deposit seat, from yesterday; the class is then
  // set to exactly the seats taken, whatever earlier runs left in the year.
  const holder = await passedLead(year)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    holder.id,
    { type: "initial_deposit", amount: 300_000, paidOn: yesterday },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(paid.error)
  const seats = await getSeats(await signedIn(MANAGER), year)
  const taken = seats.ok ? seats.data.find((entry) => entry.className === "KG 2" && entry.dayOrBoarding === "Boarding")?.taken : undefined
  if (taken === undefined) throw new Error("no seats")
  await asSystem((sql) =>
    sql.query(
      `insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, 'KG 2', 'Boarding', $2)
       on conflict (enrollment_year, class_name, day_or_boarding) do update set seats = excluded.seats`,
      [year, taken],
    ),
  )
  const lead = await passedLead(year)

  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${lead.id}`)
  const section = page.getByRole("region", { name: "School fee" })
  await section.getByRole("button", { name: "Record payment" }).click()
  const form = page.getByRole("form", { name: "Record payment" })
  await form.getByLabel("Payment type").selectOption("Initial deposit")
  await form.getByLabel("Amount (TZS)").fill("300,000")
  await form.getByRole("button", { name: "Review payment" }).click()

  const review = page.getByRole("region", { name: "Review payment" })
  const warning = review.getByRole("alert", { name: "Class full" })
  await expect(warning).toContainText(`This lead's class is full: ${taken} ${taken === 1 ? "seat" : "seats"}, ${taken} taken.`)
  await expect(warning).toContainText("You can still record it; tell the Admissions Manager.")

  await review.getByRole("button", { name: "Confirm payment" }).click()
  await expect(section.getByRole("status")).toHaveText("Payment recorded. Total paid is TZS 300,000. Seat priority: Deposit.")

  // The Manager sees the class over capacity, ranked: both Deposit, the
  // holder first because it reached Deposit a day earlier.
  await page.context().clearCookies()
  await signIn(page, MANAGER)
  await expect(page.getByRole("link", { name: "Seats", exact: true })).toHaveAttribute("href", "/staff/seats")
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/staff/seats?year=${year}`)
  await expect(page.getByRole("heading", { name: `Seats ${year}` })).toBeVisible()

  const ranking = page.getByRole("region", { name: "KG 2 Boarding ranking" })
  await expect(ranking.getByRole("heading")).toHaveText(`KG 2 Boarding: ${taken + 1} leads for ${taken} ${taken === 1 ? "seat" : "seats"}`)
  const names = await ranking.getByRole("listitem").getByRole("link").allTextContents()
  expect(names.indexOf(holder.name)).toBeGreaterThanOrEqual(0)
  expect(names.indexOf(lead.name)).toBeGreaterThan(names.indexOf(holder.name))
  // Only the lead ranked last is past the last seat.
  await expect(ranking.getByText("Past the last seat")).toHaveCount(1)

  const row = page.getByRole("table", { name: "Seats by class" }).getByRole("row").filter({ hasText: "KG 2 Boarding" })
  await expect(row).toContainText(`${taken + 1} · over capacity`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  // The grid fits too, with no scrolling inside its own box.
  const grid = page.getByRole("table", { name: "Seats by class" })
  expect(await grid.evaluate((table) => table.scrollWidth <= (table.parentElement?.clientWidth ?? 0))).toBe(true)
})
