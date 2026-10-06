import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Reviewing Re-applications (#77): the queue and its count, opening one, and
// Mark reviewed. The Admissions Staff test records a re-application of its
// own, the way the Admission form does, and reviews that one, so reruns never
// meet a seeded re-application an earlier run reviewed.

const nextYear = admissionYears()[1]

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead from the Admission form, then the same child sent again asking for
// STD 4: one field differs.
async function reApplied() {
  const studentName = `Mtoto Mapitio ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const contact = { full_name: "Mama Mapitio", relationship: "Mother", phone }
  const student = { full_name: studentName, class_name: "STD 3", enrollment_year: nextYear, day_or_boarding: "Day" }
  const supabase = secretClient()

  const created = await supabase.rpc("create_lead", {
    start_kind: "admission_form",
    existing_contact_id: null,
    new_contact: contact,
    student_details: student,
  })
  if (created.error || created.data?.result !== "created") throw new Error(`could not create a lead: ${created.error?.message}`)
  const recorded = await supabase.rpc("record_re_application", {
    lead_id: created.data.lead_id,
    submission_key: randomUUID(),
    submitted: { contact, student: { ...student, class_name: "STD 4" } },
  })
  if (recorded.error) throw new Error(`could not record a re-application: ${recorded.error.message}`)
  return { leadId: created.data.lead_id as string, admissionNumber: created.data.admission_number as string, studentName }
}

async function unreviewedInDatabase(): Promise<number> {
  const { count, error } = await secretClient()
    .from("re_applications")
    .select("id", { count: "exact", head: true })
    .is("reviewed_at", null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

const reApplicationsLink = (page: Page) =>
  page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Re-applications/ })

async function navCount(page: Page): Promise<number> {
  const name = (await reApplicationsLink(page).textContent()) ?? ""
  const match = /(\d+)\s*unreviewed/.exec(name)
  return match ? Number(match[1]) : 0
}

test.describe("Re-applications", () => {
  test("Admissions Staff open the queue, open an entry and mark one reviewed, which leaves the queue", async ({ page }) => {
    const mine = await reApplied()
    await signIn(page, ADMISSIONS)

    // The count is the unreviewed re-applications, as the database holds them.
    await expect.poll(async () => (await navCount(page)) === (await unreviewedInDatabase())).toBe(true)
    await reApplicationsLink(page).click()
    await expect(page.getByRole("heading", { name: "Re-applications", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Show reviewed" })).toBeVisible()

    // Oldest first, so the seeded unreviewed ones lead the first page; the
    // seeded reviewed one isn't there.
    const queue = page.getByRole("table", { name: "Re-applications" })
    const zuberi = queue.getByRole("row", { name: /ADMSN-90301/ })
    await expect(zuberi).toContainText("Zuberi Marudio")
    await expect(zuberi).toContainText("Applied")
    await expect(zuberi).toContainText("2 fields differ")
    const hamisi = queue.getByRole("row", { name: /ADMSN-90005/ })
    await expect(hamisi).toContainText("Archived")
    await expect(queue.getByRole("row", { name: /ADMSN-90302/ })).toHaveCount(0)

    // Opening an entry from the queue.
    await zuberi.getByRole("link", { name: "ADMSN-90301" }).click()
    await expect(page.getByRole("heading", { name: "Re-application", exact: true })).toBeVisible()
    await expect(page.getByText("Not reviewed yet.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeVisible()

    // Its own re-application, from its lead's screen.
    await page.goto(`/staff/leads/${mine.leadId}`)
    const section = page.getByRole("region", { name: "Re-applications" })
    await expect(section).toContainText("1 field differs")
    await expect(section).toContainText("Not reviewed")
    await section.getByRole("link").click()

    await expect(page.getByRole("heading", { name: "Re-application", exact: true })).toBeVisible()
    await expect(page.getByRole("main")).toContainText(mine.admissionNumber)
    await expect(page.getByRole("main")).toContainText("1 field differs from the lead.")
    await page.getByRole("button", { name: "Mark reviewed" }).click()

    await expect(page.getByText(`Reviewed by ${ADMISSIONS.name}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0)
    await expect.poll(async () => (await navCount(page)) === (await unreviewedInDatabase())).toBe(true)

    // Off the queue, which holds it no more on any page: the newest is last.
    await reApplicationsLink(page).click()
    const pages = /Page \d+ of (\d+)/.exec((await page.getByRole("main").textContent()) ?? "")
    if (pages) await page.goto(`/staff/re-applications?page=${pages[1]}`)
    await expect(page.getByRole("table", { name: "Re-applications" })).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(mine.admissionNumber) })).toHaveCount(0)

    // Show reviewed lists it first, the latest review, with who reviewed it.
    await page.getByRole("link", { name: "Show reviewed" }).click()
    const reviewed = page.getByRole("table", { name: "Re-applications" }).getByRole("row").nth(1)
    await expect(reviewed).toContainText(mine.admissionNumber)
    await expect(reviewed).toContainText(ADMISSIONS.name)
    await expect(page.getByRole("link", { name: "Show unreviewed" })).toBeVisible()

    // The lead screen keeps it, reviewed.
    await page.goto(`/staff/leads/${mine.leadId}`)
    await expect(page.getByRole("region", { name: "Re-applications" })).toContainText(`Reviewed by ${ADMISSIONS.name}`)
  })

  test("the Accountant reads re-applications, on a closed lead too, with no Mark reviewed", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect.poll(async () => (await navCount(page)) === (await unreviewedInDatabase())).toBe(true)
    await reApplicationsLink(page).click()

    const hamisi = page.getByRole("table", { name: "Re-applications" }).getByRole("row", { name: /ADMSN-90005/ })
    await hamisi.getByRole("link", { name: "ADMSN-90005" }).click()
    await expect(page.getByRole("heading", { name: "Re-application", exact: true })).toBeVisible()
    await expect(page.getByRole("main")).toContainText("Archived")
    await expect(page.getByText("Not reviewed yet.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0)

    // The Archived lead's screen lists it.
    await page.getByRole("main").getByRole("link", { name: "ADMSN-90005" }).click()
    await expect(page.getByRole("region", { name: "Re-applications" })).toContainText("Not reviewed")
  })
})
