import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Recording and correcting an interview result on the lead screen's
// interview panel.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 5's seeded Passed lead, Neema Interview.
const PASSED = "1ead0000-0000-4000-8000-000000000503"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead of the test's own as the Admission form makes it, Applied, and
// registered for interview.
async function registeredLead() {
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Result Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Candidate ${randomUUID().slice(0, 6)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return created.data.leadId
}

const panel = (page: Page) => page.getByRole("region", { name: "Interview" })

test.describe("recording an interview result", () => {
  test("Admissions Staff record a result on an Applied lead, then correct it", async ({ page }) => {
    const lead = await registeredLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)
    await expect(panel(page)).toContainText("No result yet")

    // The first recording: the date starts at today in Tanzania.
    await panel(page).getByRole("button", { name: "Record result" }).click()
    const form = panel(page).getByRole("form", { name: "Record result" })
    await expect(form.getByLabel("Interview date")).toHaveValue(today)
    await form.getByLabel("Passed").check()
    await form.getByLabel("Score (%)").fill("64.5")
    await form.getByRole("button", { name: "Save result" }).click()

    await expect(panel(page).getByRole("status")).toHaveText("Result recorded. The lead is Interviewed.")
    await expect(panel(page).getByText("64.5%", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Complete enrollment", { exact: true })).toBeVisible()
    await expect(page.getByText("Interviewed", { exact: true }).first()).toBeVisible()

    // The correction starts from what was recorded.
    await panel(page).getByRole("button", { name: "Correct result" }).click()
    const correction = panel(page).getByRole("form", { name: "Correct result" })
    await expect(correction.getByLabel("Passed")).toBeChecked()
    await expect(correction.getByLabel("Score (%)")).toHaveValue("64.5")
    await correction.getByLabel("Failed").check()
    await correction.getByLabel("Score (%)").fill("38")
    await correction.getByRole("button", { name: "Save correction" }).click()

    await expect(panel(page).getByRole("status")).toHaveText("Result corrected. The history keeps the earlier values.")
    await expect(panel(page).getByText("38%", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Contact the admissions office", { exact: true })).toBeVisible()

    // The history keeps both, and the visit the first recording made.
    await page.goto(`/staff/leads/${lead}/history`)
    await expect(page.getByText("recorded the interview result")).toBeVisible()
    await expect(page.getByText("corrected the interview result")).toBeVisible()
    await expect(page.getByText("recorded a visit")).toBeVisible()
    await expect(page.getByText("moved the lead to Interviewed")).toBeVisible()
  })

  test("a refusal reads as a plain sentence", async ({ page }) => {
    const lead = await registeredLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)
    await panel(page).getByRole("button", { name: "Record result" }).click()
    const form = panel(page).getByRole("form", { name: "Record result" })
    await form.getByLabel("Failed").check()
    await form.getByLabel("Score (%)").fill("20")

    // The lead is closed while the form is open.
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [lead]))
    await form.getByRole("button", { name: "Save result" }).click()

    await expect(form.getByRole("alert")).toHaveText("This lead is closed, so its interview result can't be changed.")
  })
})

test.describe("who is offered Record result", () => {
  test("the Accountant sees the result and Next action but cannot record or correct", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${PASSED}`)

    await expect(panel(page).getByText("78.5%", { exact: true })).toBeVisible()
    await expect(panel(page).getByText("Complete enrollment", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Correct result" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Record result" })).toHaveCount(0)
  })

  test("a closed lead keeps its result but offers no correction", async ({ page }) => {
    const lead = await registeredLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = $1", [lead]))
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)

    await expect(panel(page)).toContainText("No result yet")
    await expect(page.getByRole("button", { name: "Record result" })).toHaveCount(0)
  })
})
