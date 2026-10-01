import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { asSystem, secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Recording the visit of an Applied family on the lead screen, as the front
// desk does when they arrive.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// The seeded Applied lead kept for this test, Imani Arrival.
const SEEDED_APPLIED = { id: "1ead0000-0000-4000-8000-000000000047", number: "90047", name: "Imani Arrival" }

function dayBefore(date: string, days = 1) {
  const moved = new Date(`${date}T00:00:00Z`)
  moved.setUTCDate(moved.getUTCDate() - days)
  return moved.toISOString().slice(0, 10)
}

function dayAfter(date: string) {
  return dayBefore(date, -1)
}

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// An Applied lead of the test's own, as the Admission form makes it.
async function appliedLead() {
  const name = `Applicant ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Form Parent", relationship: "Mother", phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return { id: created.data.leadId, name }
}

function detail(page: Page, term: string) {
  return page.getByRole("region", { name: "Student" }).locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]")
}

test.describe("recording the visit of an Applied family", () => {
  // Puts the seeded lead back to Applied, so the test can run again without a
  // database reset.
  test.beforeEach(async () => {
    await asSystem((sql) =>
      sql.query("update public.leads set status = 'Applied', visit_date = null where id = $1", [SEEDED_APPLIED.id]),
    )
  })

  test("staff find the seeded Applied lead by its number at check-in and record the visit", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/check-in")
    await page.getByLabel("Admission Number").fill(SEEDED_APPLIED.number)
    await page.getByRole("button", { name: "Continue" }).click()

    await expect(page).toHaveURL(new RegExp(`/staff/leads/${SEEDED_APPLIED.id}$`))
    await expect(page.getByRole("heading", { name: SEEDED_APPLIED.name, level: 1 })).toBeVisible()
    await expect(detail(page, "Status")).toHaveText("Applied")
    await expect(detail(page, "Visit date")).toHaveText("Not visited yet")

    await page.getByRole("button", { name: "Record visit" }).click()
    const form = page.getByRole("form", { name: "Record visit" })
    const visitDate = form.getByLabel("Visit date")
    // Today, unless the family came earlier.
    await expect(visitDate).toHaveValue(today)
    await expect(visitDate).toHaveAttribute("max", today)

    await visitDate.fill(dayBefore(today))
    await form.getByRole("button", { name: "Record visit" }).click()

    await expect(page.getByRole("status").filter({ hasText: "Visit recorded" })).toHaveText(
      "Visit recorded. The lead is now Visited.",
    )
    await expect(detail(page, "Status")).toHaveText("Visited")
    await expect(detail(page, "Visit date")).toHaveText(formatDate(dayBefore(today)))
    // Nothing is left to record, and the date can now be corrected instead.
    await expect(page.getByRole("button", { name: "Record visit" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Correct Visit date" })).toBeVisible()

    // The move stays after a reload.
    await page.reload()
    await expect(detail(page, "Status")).toHaveText("Visited")
    await expect(page.getByRole("button", { name: "Record visit" })).toHaveCount(0)
  })
})

test.describe("when Record visit is offered", () => {
  test("a visit someone else recorded first is refused, and the lead is left as they recorded it", async ({ page }) => {
    const lead = await appliedLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await page.getByRole("button", { name: "Record visit" }).click()
    // Another member of staff records it while this form is open.
    await asSystem((sql) =>
      sql.query("update public.leads set status = 'Visited', visit_date = $2 where id = $1", [lead.id, dayBefore(today, 2)]),
    )
    const form = page.getByRole("form", { name: "Record visit" })
    await form.getByRole("button", { name: "Record visit" }).click()

    await expect(form.getByRole("alert")).toHaveText(
      "This lead is no longer Applied, so its visit is already recorded. Reload the page to see it.",
    )
    await page.reload()
    await expect(detail(page, "Status")).toHaveText("Visited")
    await expect(detail(page, "Visit date")).toHaveText(formatDate(dayBefore(today, 2)))
  })

  test("cancelling records nothing", async ({ page }) => {
    const lead = await appliedLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await page.getByRole("button", { name: "Record visit" }).click()
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("form", { name: "Record visit" })).toHaveCount(0)
    await page.reload()
    await expect(detail(page, "Status")).toHaveText("Applied")
  })

  test("the Visit date comes from the server, not the device clock", async ({ page }) => {
    const lead = await appliedLead()
    await signIn(page, ADMISSIONS)
    // A device whose clock runs a day behind, then a day ahead.
    for (const deviceDay of [dayBefore(today), dayAfter(today)]) {
      await page.clock.setFixedTime(new Date(`${deviceDay}T09:00:00Z`))
      await page.goto(`/staff/leads/${lead.id}`)

      await page.getByRole("button", { name: "Record visit" }).click()
      const visitDate = page.getByRole("form", { name: "Record visit" }).getByLabel("Visit date")
      await expect(visitDate, deviceDay).toHaveValue(today)
      await expect(visitDate, deviceDay).toHaveAttribute("max", today)
    }
  })

  test("the Accountant, who may not record visits, is not offered it", async ({ page }) => {
    const lead = await appliedLead()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)

    await expect(page.getByRole("heading", { name: lead.name, level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Record visit" })).toHaveCount(0)
  })

  test("leads past Applied are not offered it", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    // The seeded Visited, Archived and Declined leads.
    for (const id of ["000000000002", "000000000005", "000000000006"]) {
      await page.goto(`/staff/leads/1ead0000-0000-4000-8000-${id}`)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(page.getByRole("button", { name: "Record visit" })).toHaveCount(0)
    }
  })
})
