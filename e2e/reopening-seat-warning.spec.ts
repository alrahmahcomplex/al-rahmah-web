import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { getSeats } from "@/lib/services/seats"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The seat warning on approving a Reopening request (#103). The test claims
// a year of its own (tests/support/fee-years.ts), so the seeded 2027 seats
// are left alone.

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

// A walk-in STD 3 Boarding lead in `year`, Passed and holding a Deposit seat.
async function seatedLead(year: number): Promise<{ id: string; name: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const name = `Reseat ${randomUUID().slice(0, 6)}`
  const phone = `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: name, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Boarding" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(registered.error)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(recorded.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  const paid = await recordPayment(await signedIn(ACCOUNTANT), id, { type: "initial_deposit", amount: 300_000, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(paid.error)
  return { id, name }
}

test("approving a reopening into a full class shows the seat warning and ranking, and still approves", async ({ page }) => {
  const claim = await claimFeeYear()
  claims.push(claim)
  const year = claim.year
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, AMOUNTS)
  if (!saved.ok) throw new Error(JSON.stringify(saved.error))

  const holder = await seatedLead(year)
  const lead = await seatedLead(year)
  const declined = await declineLead(await signedIn(MANAGER), lead.id, { reason: "Fees or cost" })
  if (!declined.ok) throw new Error(declined.error)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead.id, { reason: "A sponsor will pay the fee.", source: "lead" })
  if (!raised.ok) throw new Error(JSON.stringify(raised.error))

  // The class is full with the seats taken, whatever earlier runs left.
  const seats = await getSeats(await signedIn(MANAGER), year)
  const taken = seats.ok ? seats.data.find((entry) => entry.className === "STD 3" && entry.dayOrBoarding === "Boarding")?.taken : undefined
  if (taken === undefined) throw new Error("no seats")
  await asSystem((sql) =>
    sql.query(
      `insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, 'STD 3', 'Boarding', $2)
       on conflict (enrollment_year, class_name, day_or_boarding) do update set seats = excluded.seats`,
      [year, taken],
    ),
  )

  await signIn(page, MANAGER)
  await page.goto(`/staff/leads/${lead.id}`)
  const panel = page.getByRole("region", { name: "Reopening requests" })
  await panel.getByRole("group", { name: "Pending reopening request" }).getByRole("button", { name: "Approve" }).click()

  const dialog = page.getByRole("dialog", { name: `Approve reopening ${lead.name}?` })
  const warning = dialog.getByRole("alert", { name: "Class full" })
  await expect(warning).toContainText(`STD 3 Boarding ${year} is full: ${taken} ${taken === 1 ? "seat" : "seats"}, ${taken} taken.`)
  await expect(warning).toContainText("with its Seat priority, Deposit, so the class will have more leads than seats. You can still approve.")
  const ranking = warning.getByRole("list", { name: "Leads ranked for the seats" })
  await expect(ranking.getByRole("listitem")).toHaveCount(taken + 1)
  await expect(ranking.getByRole("listitem").filter({ hasText: holder.name })).toBeVisible()
  await expect(ranking.getByRole("listitem").filter({ hasText: `${lead.name} (this lead)` })).toBeVisible()
  // One more lead than seats: the last one ranked is past the last seat.
  await expect(ranking.getByRole("listitem").last()).toContainText("Past the last seat")
  await expect(ranking.getByText("Past the last seat")).toHaveCount(1)

  await dialog.getByLabel("Enrol without a retaken interview").check()
  await dialog.getByRole("button", { name: "Approve and reopen" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("region", { name: /^This lead is/ })).toHaveCount(0)
  await expect(panel).toContainText(`Approved by ${MANAGER.name}`)
})
