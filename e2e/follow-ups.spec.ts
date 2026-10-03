import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The Follow-ups panel on the lead screen (#90): scheduling, changing the
// date with a reason, and who sees the actions.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 7's seeded follow-ups.
const SALMA = "1ead0000-0000-4000-8000-000000000004"
const BARAKA = "1ead0000-0000-4000-8000-000000000002"
// Slice 2's seeded Archived lead, with a follow-up planned before it closed.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function newLead() {
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Follow-up Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

const panel = (page: Page) => page.getByRole("region", { name: "Follow-ups" })

test.describe("the Follow-ups panel", () => {
  test("Admissions Staff schedule a follow-up, then change its date with a reason that shows in history", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)

    await expect(panel(page)).toContainText("No follow-up scheduled.")
    await panel(page).getByRole("button", { name: "Schedule follow-up" }).click()

    const schedule = page.getByRole("dialog", { name: "Schedule follow-up" })
    // The date starts at tomorrow.
    await expect(schedule.getByLabel("Follow-up date")).toHaveValue(addDays(today, 1))
    await schedule.getByLabel("Note (optional)").fill("Ask whether they need the school bus.")
    await schedule.getByRole("button", { name: "Schedule follow-up" }).click()

    await expect(panel(page).getByRole("status")).toHaveText(`Follow-up scheduled for ${formatDate(addDays(today, 1))}.`)
    await expect(panel(page).getByLabel("Follow-up date")).toHaveText(formatDate(addDays(today, 1)))
    await expect(panel(page)).toContainText("Due tomorrow")
    await expect(panel(page)).toContainText("Ask whether they need the school bus.")
    await expect(panel(page).getByRole("button", { name: "Schedule follow-up" })).toHaveCount(0)

    await panel(page).getByRole("button", { name: "Change date" }).click()
    const change = page.getByRole("dialog", { name: "Change date" })
    await change.getByLabel("New date").fill(addDays(today, 5))
    await change.getByLabel("Reason").fill("The parent is travelling.")
    await change.getByRole("button", { name: "Change date" }).click()

    await expect(panel(page).getByRole("status")).toHaveText(`Follow-up moved to ${formatDate(addDays(today, 5))}.`)
    await expect(panel(page).getByLabel("Follow-up date")).toHaveText(formatDate(addDays(today, 5)))
    // The note carries over, and the earlier date stays with its reason.
    await expect(panel(page)).toContainText("Ask whether they need the school bus.")
    await expect(panel(page)).toContainText(`${formatDate(addDays(today, 1))} moved to ${formatDate(addDays(today, 5))}`)
    await expect(panel(page)).toContainText("Reason: The parent is travelling.")

    await page.goto(`/staff/leads/${lead}/history`)
    const history = page.getByRole("list", { name: "History" })
    await expect(history.getByText("changed the follow-up date")).toBeVisible()
    await expect(history).toContainText(`Follow-up date: ${formatDate(addDays(today, 1))} → ${formatDate(addDays(today, 5))}`)
    await expect(history).toContainText("Reason for the change: The parent is travelling.")
    await expect(history.getByText("scheduled a follow-up")).toBeVisible()
  })

  test("a refused date is explained in a plain sentence", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)

    await panel(page).getByRole("button", { name: "Schedule follow-up" }).click()
    const schedule = page.getByRole("dialog", { name: "Schedule follow-up" })
    // Past the form's own bounds, as a stale screen or a typed date could send.
    await schedule.getByLabel("Follow-up date").evaluate((input: HTMLInputElement) => input.removeAttribute("max"))
    await schedule.getByLabel("Follow-up date").fill(addDays(today, 400))
    await schedule.getByRole("button", { name: "Schedule follow-up" }).click()

    await expect(schedule.getByRole("alert")).toHaveText("Pick a date from today to one year ahead.")
  })

  test("shows an overdue follow-up as overdue", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${BARAKA}`)
    // Seeded four days before the seed ran.
    await expect(panel(page)).toContainText(/Overdue by \d+ days/)
  })

  test("the Accountant sees the follow-up and its earlier date, with no actions", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${SALMA}`)
    await expect(panel(page).getByLabel("Follow-up date")).toBeVisible()
    await expect(panel(page)).toContainText("Reason: The parent is travelling until next week.")
    await expect(panel(page).getByRole("button")).toHaveCount(0)
  })

  test("a closed lead shows its follow-up with no actions", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${ARCHIVED}`)
    await expect(panel(page)).toContainText("Last planned follow-up")
    await expect(panel(page).getByLabel("Follow-up date")).toBeVisible()
    await expect(panel(page)).not.toContainText(/Overdue|Due/)
    await expect(panel(page).getByRole("button")).toHaveCount(0)
  })
})
