import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { asSystem, secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Registering a lead for interview on the lead screen's interview panel.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 5's seeded registration, Amani Interview: S/N 1 for 2027.
const REGISTERED = "1ead0000-0000-4000-8000-000000000501"
// Slice 2's seeded Declined lead.
const DECLINED = "1ead0000-0000-4000-8000-000000000006"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead of the test's own, as the Admission form makes it: Applied.
async function newLead() {
  const name = `Candidate ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Interview Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return { id: created.data.leadId, name, admissionNumber: created.data.admissionNumber }
}

const panel = (page: Page) => page.getByRole("region", { name: "Interview" })

test.describe("registering a lead for interview", () => {
  test("Admissions Staff register a lead and see its S/N, apart from the Admission Number", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await panel(page).getByRole("button", { name: "Register for interview" }).click()

    const confirmation = panel(page).getByRole("status")
    await expect(confirmation).toHaveText(new RegExp(`^Registered for interview\\. The S/N is \\d+ for ${thisYear + 1}\\.$`))
    const serial = (await confirmation.textContent())!.match(/S\/N is (\d+)/)![1]
    await expect(panel(page).getByLabel("Interview S/N")).toHaveText(serial)
    await expect(panel(page)).toContainText(`It is not the Admission Number, which stays ${lead.admissionNumber}.`)
    await expect(panel(page).getByRole("button", { name: "Register for interview" })).toHaveCount(0)

    // It stays after a reload, and the history shows it.
    await page.reload()
    await expect(panel(page).getByLabel("Interview S/N")).toHaveText(serial)
    await page.goto(`/staff/leads/${lead.id}/history`)
    await expect(page.getByText("registered the lead for interview")).toBeVisible()
  })

  test("a registration someone else made first is refused in a plain sentence", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    // Another member of staff registers it while this screen is open.
    await asSystem(async (sql) => {
      const counter = await sql.query<{ n: number }>(
        `insert into public.interview_serial_counters as c (enrollment_year, last_number) values ($1, 1)
         on conflict (enrollment_year) do update set last_number = c.last_number + 1 returning last_number as n`,
        [thisYear + 1],
      )
      await sql.query(
        "insert into public.interviews (lead, serial_number, serial_year, registered_by) values ($1, $2, $3, $4)",
        [lead.id, counter.rows[0].n, thisYear + 1, ADMISSIONS.id],
      )
    })
    await panel(page).getByRole("button", { name: "Register for interview" }).click()

    await expect(panel(page).getByRole("alert")).toHaveText(
      "This lead is already registered for interview. Reload the page to see its S/N.",
    )
  })
})

test.describe("who is offered Register for interview", () => {
  test("the Accountant sees the S/N but no register button", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ACCOUNTANT)

    await page.goto(`/staff/leads/${REGISTERED}`)
    await expect(panel(page).getByLabel("Interview S/N")).toHaveText("1")
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(panel(page)).toContainText("Not registered for interview.")
    await expect(page.getByRole("button", { name: "Register for interview" })).toHaveCount(0)
  })

  test("a closed lead offers no registration", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${DECLINED}`)
    await expect(panel(page)).toContainText("Not registered for interview.")
    await expect(page.getByRole("button", { name: "Register for interview" })).toHaveCount(0)
  })
})
