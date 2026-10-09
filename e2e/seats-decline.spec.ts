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

// Declining a ranked lead from Seats with No seat available (#115). The test
// claims a year of its own (tests/support/fee-years.ts), so the seeded 2027
// seats are left alone.

const today = tanzaniaToday()
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

// A walk-in KG 2 Boarding lead in `year`, Passed, holding a Deposit seat.
async function depositLead(year: number): Promise<{ id: string; name: string }> {
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
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    created.data.leadId,
    { type: "initial_deposit", amount: 300_000, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(paid.error)
  return { id: created.data.leadId, name }
}

test("the Manager declines a ranked lead from Seats with No seat available", async ({ page }) => {
  const claim = await claimFeeYear()
  claims.push(claim)
  const year = claim.year
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), year, AMOUNTS)).ok) throw new Error("schedule failed")

  // Two leads hold Deposit seats; the class is then set one seat short of
  // the seats taken, whatever earlier runs left in the year.
  await depositLead(year)
  const lead = await depositLead(year)
  const seats = await getSeats(await signedIn(MANAGER), year)
  const taken = seats.ok ? seats.data.find((entry) => entry.className === "KG 2" && entry.dayOrBoarding === "Boarding")?.taken : undefined
  if (taken === undefined) throw new Error("no seats")
  await asSystem((sql) =>
    sql.query(
      `insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, 'KG 2', 'Boarding', $2)
       on conflict (enrollment_year, class_name, day_or_boarding) do update set seats = excluded.seats`,
      [year, taken - 1],
    ),
  )

  await signIn(page, MANAGER)
  await page.goto(`/staff/seats?year=${year}`)
  const ranking = page.getByRole("region", { name: "KG 2 Boarding ranking" })
  const row = ranking.getByRole("listitem").filter({ hasText: lead.name })
  const link = row.getByRole("link", { name: `Decline ${lead.name}: No seat available` })
  await expect(link).toHaveText("Decline: No seat available")
  await link.click()

  // The lead screen opens Decline with No seat available chosen.
  await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}\\?decline=No\\+seat\\+available$`))
  const dialog = page.getByRole("dialog", { name: `Decline ${lead.name}`, exact: true })
  await expect(dialog.getByLabel("Reason")).toHaveValue("No seat available")
  await dialog.getByRole("button", { name: "Continue" }).click()

  const confirm = page.getByRole("dialog", { name: `Decline ${lead.name}?`, exact: true })
  await expect(confirm).toContainText("No seat available")
  await confirm.getByRole("button", { name: "Decline lead" }).click()

  const banner = page.getByRole("region", { name: "This lead is Declined" })
  await expect(banner).toContainText("No seat available")
  await expect(banner).toContainText(MANAGER.name)

  // The seat is released: the class holds one lead fewer, and the lead is
  // ranked no more.
  await page.goto(`/staff/seats?year=${year}`)
  const grid = page.getByRole("table", { name: "Seats by class" }).getByRole("row").filter({ hasText: "KG 2 Boarding" })
  await expect(grid.getByRole("cell").nth(2)).toContainText(String(taken - 1))
  await expect(page.getByText(lead.name)).toHaveCount(0)
})

test("a decline link opens nothing for staff who can't use its reason", async ({ page }) => {
  const claim = await claimFeeYear()
  claims.push(claim)
  if (!(await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)).ok) throw new Error("schedule failed")
  const lead = await depositLead(claim.year)

  // Admissions Staff may decline, but not with No seat available.
  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead.id}?decline=No+seat+available`)
  await expect(page.getByRole("region", { name: "Decline", exact: true })).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})
