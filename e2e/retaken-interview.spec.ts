import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { approveReopeningRequest, declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// A retaken interview after a Retake reopening (#71), on the lead screen's
// interview panel. The test that registers and records a retake reopens a
// lead of its own the way slice 8's seeded ADMSN-90087 Musa Kisanga was
// reopened, since an interview can never be deleted and a registered seed
// would refuse the next run. The seeded leads are only looked at.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 8's seed: reopened after a Failed interview (S/N issued 2026-09-15).
const SEEDED_RETAKE = "1ead0000-0000-4000-8000-000000000087"
const SEEDED_ENROL_WITHOUT_RETAKE = "1ead0000-0000-4000-8000-000000000086"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in lead that Failed its interview today, was declined for Did not
// pass interview and reopened with Retake the interview, as the seed's Musa.
async function reopenedForRetake() {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: {
      // A leading 4 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Retake Parent", relationship: "Father", phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Retake ${randomUUID().slice(0, 6)}`, className: "STD 5", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const lead = created.data.leadId
  const first = await registerForInterview(admissions, lead)
  if (!first.ok) throw new Error(`registration failed: ${first.error}`)
  const recorded = await recordInterviewResult(admissions, first.data.interviewId, { interviewDate: today, result: "Failed", score: 39 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  const manager = await signedIn(MANAGER)
  const declined = await declineLead(manager, lead, { reason: "Did not pass interview" })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(admissions, lead, { reason: "Unwell on the interview day.", source: "lead" })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(manager, raised.data, { enrolWithoutRetake: false })
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
  return { id: lead, firstSerial: first.data.serialNumber }
}

const panel = (page: Page) => page.getByRole("region", { name: "Interview", exact: true })
const current = (page: Page) => panel(page).getByRole("group", { name: "Current interview" })

test("Admissions Staff register and record a retaken interview, and the earlier one stays below it", async ({ page }) => {
  const lead = await reopenedForRetake()
  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${lead.id}`)

  await expect(current(page).getByLabel("Interview S/N")).toHaveText(String(lead.firstSerial))
  await panel(page).getByRole("button", { name: "Register retaken interview" }).click()

  const confirmation = panel(page).getByRole("status")
  await expect(confirmation).toHaveText(new RegExp(`^Registered for a retaken interview\\. The S/N is \\d+ for ${thisYear + 1}\\.$`))
  const serial = (await confirmation.textContent())!.match(/S\/N is (\d+)/)![1]
  expect(Number(serial)).toBeGreaterThan(lead.firstSerial)
  await expect(panel(page).getByRole("button", { name: "Register retaken interview" })).toHaveCount(0)

  // The retake is current, Not Paid with no result; the first is below it.
  await expect(current(page).getByLabel("Interview S/N")).toHaveText(serial)
  await expect(current(page)).toContainText("Not Paid")
  await expect(current(page)).toContainText("No result yet")
  const earlier = panel(page).getByRole("article", { name: `S/N ${lead.firstSerial}, earlier interview` })
  await expect(earlier).toContainText("Failed")
  await expect(earlier).toContainText("39%")

  // Recording the retake's result keeps the lead Interviewed.
  await current(page).getByRole("button", { name: "Record result" }).click()
  const form = current(page).getByRole("form", { name: "Record result" })
  await form.getByLabel("Passed").check()
  await form.getByLabel("Score (%)").fill("71.5")
  await form.getByRole("button", { name: "Save result" }).click()
  await expect(current(page).getByRole("status")).toHaveText("Result recorded. The lead is Interviewed.")
  await expect(current(page).getByText("71.5%", { exact: true })).toBeVisible()
  await expect(current(page).getByText("Complete enrollment", { exact: true })).toBeVisible()
  await expect(earlier).toContainText("39%")

  // The history names both interviews.
  await page.goto(`/staff/leads/${lead.id}/history`)
  await expect(page.getByText(`registered the lead for a retaken interview (S/N ${serial})`)).toBeVisible()
  await expect(page.getByText(`recorded the interview result (S/N ${serial})`)).toBeVisible()
  await expect(page.getByText(`recorded the interview result (S/N ${lead.firstSerial})`)).toBeVisible()
})

test("the seeded leads: Register retaken interview for the Retake one only, and never for the Accountant", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${SEEDED_RETAKE}`)
  await expect(panel(page).getByRole("button", { name: "Register retaken interview" })).toBeVisible()
  await expect(panel(page)).toContainText("This lead was reopened to retake the interview.")

  await page.goto(`/staff/leads/${SEEDED_ENROL_WITHOUT_RETAKE}`)
  await expect(current(page)).toContainText("Failed")
  await expect(panel(page).getByRole("button", { name: /^Register/ })).toHaveCount(0)

  await page.context().clearCookies()
  await signIn(page, ACCOUNTANT)
  await page.goto(`/staff/leads/${SEEDED_RETAKE}`)
  await expect(current(page)).toContainText("Failed")
  await expect(panel(page).getByRole("button", { name: /^Register/ })).toHaveCount(0)
})
