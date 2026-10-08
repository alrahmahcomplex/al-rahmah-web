import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { scheduleFollowUp } from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { createThrowawayStaff, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Declining the lead as the outcome of a recorded contact (#94), from the
// Follow-ups panel. Each test makes a lead of its own.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

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

// A walk-in lead, Visited, with a follow-up due today.
async function leadWithFollowUp() {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Declining Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const planned = await scheduleFollowUp(await signedIn(ADMISSIONS), created.data.leadId, { dueOn: today })
  if (!planned.ok) throw new Error("schedule failed")
  return created.data.leadId
}

const panel = (page: Page) => page.getByRole("region", { name: "Follow-ups" })
const DECLINE_OUTCOME = "The family will not proceed: decline the lead"

async function openRecord(page: Page) {
  await panel(page).getByRole("button", { name: "Record follow-up" }).click()
  return page.getByRole("dialog", { name: "Record follow-up" })
}

test.describe("declining the lead from Record follow-up", () => {
  test("Admissions Staff record the call and decline the lead together, and both show in history", async ({ page }) => {
    const lead = await leadWithFollowUp()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)

    const record = await openRecord(page)
    await record.getByLabel("Comment").fill("The father says they have chosen a school nearer home.")
    await record.getByLabel(DECLINE_OUTCOME).check()
    // A decline takes a reason instead of a next date.
    await expect(record.getByLabel("Next follow-up date")).toHaveCount(0)
    await expect(record).toContainText("This lead becomes read-only. Bringing it back needs a Manager's approval.")
    // Only staff who may set the seats see No seat available.
    const reasons = await record.getByLabel("Declined reason").locator("option").allTextContents()
    expect(reasons).toContain("Enrolled elsewhere")
    expect(reasons).not.toContain("No seat available")

    await record.getByLabel("Declined reason").selectOption("Other")
    await record.getByRole("button", { name: "Record and decline" }).click()
    await expect(record.getByRole("alert")).toHaveText("Write an explanation for Other.")

    await record.getByLabel("Explanation").fill("The family is moving abroad.")
    await record.getByRole("button", { name: "Record and decline" }).click()

    const banner = page.getByRole("region", { name: "This lead is Declined" })
    await expect(banner).toContainText("Other")
    await expect(banner).toContainText("The family is moving abroad.")
    await expect(banner).toContainText(ADMISSIONS.name)
    const contacts = panel(page).getByRole("list", { name: "Contacts" })
    await expect(contacts).toContainText("The father says they have chosen a school nearer home.")
    await expect(contacts).toContainText("The family will not proceed: lead declined")
    // The contact closed the follow-up; nothing else closed it with the lead.
    await expect(contacts).not.toContainText("Closed with the lead")
    await expect(panel(page).getByRole("button")).toHaveCount(0)

    await page.goto(`/staff/leads/${lead}/history`)
    const history = page.getByRole("list", { name: "History" })
    await expect(history.getByText("recorded a follow-up")).toBeVisible()
    await expect(history.getByText("declined the lead")).toBeVisible()
    await expect(history).not.toContainText("closed the follow-up with the lead")
  })

  test("the Manager may pick No seat available", async ({ page }) => {
    const lead = await leadWithFollowUp()
    await signIn(page, MANAGER)
    await page.goto(`/staff/leads/${lead}`)

    const record = await openRecord(page)
    await record.getByLabel("Comment").fill("The class is full for this year.")
    await record.getByLabel(DECLINE_OUTCOME).check()
    await record.getByLabel("Declined reason").selectOption("No seat available")
    await record.getByRole("button", { name: "Record and decline" }).click()

    await expect(page.getByRole("region", { name: "This lead is Declined" })).toContainText("No seat available")
  })

  test("staff who may not decline leads plan the next date with no decline outcome", async ({ page }) => {
    const recorder = await createThrowawayStaff(["leads.view", "follow_ups.record"])
    const lead = await leadWithFollowUp()
    await signIn(page, recorder)
    await page.goto(`/staff/leads/${lead}`)

    const record = await openRecord(page)
    await expect(record.getByText(DECLINE_OUTCOME)).toHaveCount(0)
    await expect(record.getByLabel("Declined reason")).toHaveCount(0)
    await expect(record.getByLabel("Next follow-up date")).toHaveValue(addDays(today, 7))
  })
})
