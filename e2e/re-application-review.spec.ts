import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { admissionYears } from "../lib/admission-form"
import { secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"

// Reviewing Re-applications (#77): the queue and its count, opening one, and
// Mark reviewed. The Admissions Staff test records a re-application of its
// own, the way the Admission form does, and reviews that one, so reruns never
// meet a seeded re-application an earlier run reviewed.

const nextYear = admissionYears()[1]

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
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

// The queue says in words how many wait (The One Pip Rule: not on the nav).
async function queueCount(page: Page): Promise<number> {
  await page.goto("/staff/re-applications")
  const counted = page.getByRole("main").getByText(/^\d+ unreviewed re-applications?$/)
  const none = page.getByText("No re-applications wait for review.")
  await expect(counted.or(none)).toBeVisible()
  if (await none.isVisible()) return 0
  return Number(/^\d+/.exec((await counted.textContent()) ?? "")![0])
}

test.describe("Re-applications", () => {
  test("Admissions Staff open the queue, open an entry and mark one reviewed, which leaves the queue", async ({ page }) => {
    const mine = await reApplied()
    await signIn(page, ADMISSIONS)

    await reApplicationsLink(page).click()
    await expect(page).toHaveURL(/\/staff\/re-applications$/)
    // The count is the unreviewed re-applications, as the database holds them.
    await expect.poll(async () => (await queueCount(page)) === (await unreviewedInDatabase())).toBe(true)
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
    await page.goto(`/staff/applicants/${mine.leadId}`)
    const section = page.getByRole("region", { name: "Re-applications" })
    await expect(section).toContainText("1 field differs")
    await expect(section).toContainText("Not reviewed")
    await section.getByRole("link").click()

    await expect(page.getByRole("heading", { name: "Re-application", exact: true })).toBeVisible()
    await expect(page.getByRole("main")).toContainText(mine.admissionNumber)
    await expect(page.getByRole("main")).toContainText("1 field differs from the application.")
    await page.getByRole("button", { name: "Mark reviewed" }).click()

    await expect(page.getByText(`Reviewed by ${ADMISSIONS.name}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0)
    await expect.poll(async () => (await queueCount(page)) === (await unreviewedInDatabase())).toBe(true)

    // Off the queue, which holds it no more on any page: the newest is last.
    await reApplicationsLink(page).click()
    await expect(page.getByRole("table", { name: "Re-applications" })).toBeVisible()
    const pageLinks = page.getByRole("navigation", { name: "Re-application pages" }).getByRole("link", { name: /^Page \d+$/ })
    if ((await pageLinks.count()) > 0) {
      const last = /\d+/.exec((await pageLinks.last().getAttribute("aria-label")) ?? "")![0]
      await page.goto(`/staff/re-applications?page=${last}`)
    }
    await expect(page.getByRole("table", { name: "Re-applications" })).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(mine.admissionNumber) })).toHaveCount(0)

    // Show reviewed lists it first, the latest review, with who reviewed it.
    await page.getByRole("link", { name: "Show reviewed" }).click()
    const reviewed = page.getByRole("table", { name: "Re-applications" }).getByRole("row").nth(1)
    await expect(reviewed).toContainText(mine.admissionNumber)
    await expect(reviewed).toContainText(ADMISSIONS.name)
    await expect(page.getByRole("link", { name: "Show unreviewed" })).toBeVisible()

    // The lead screen keeps it, reviewed.
    await page.goto(`/staff/applicants/${mine.leadId}`)
    await expect(page.getByRole("region", { name: "Re-applications" })).toContainText(`Reviewed by ${ADMISSIONS.name}`)
  })

  test("the Accountant reads re-applications, on a closed lead too, with no Mark reviewed", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await reApplicationsLink(page).click()
    await expect.poll(async () => (await queueCount(page)) === (await unreviewedInDatabase())).toBe(true)

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

// Axe may report only the accepted white on orange, at the desktop and the
// phone width (docs/agents/workflow.md, Axe scans): the queue, an open
// lead's re-application with its Apply buttons, and a closed one's.
for (const width of [1280, 390]) {
  test(`axe finds nothing on Re-applications and a re-application at ${width}px`, { tag: "@nightly" }, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/re-applications")
    const queue = page.getByRole("table", { name: "Re-applications" })
    await expect(queue).toBeVisible()
    expect(await axeProblems(page)).toEqual([])

    await queue.getByRole("link", { name: "ADMSN-90301" }).click()
    await expect(page.getByRole("table", { name: "Compared with the application" }).getByRole("button", { name: /^Apply/ }).first()).toBeVisible()
    expect(await axeProblems(page)).toEqual([])

    await page.goto("/staff/re-applications")
    await queue.getByRole("link", { name: "ADMSN-90005" }).click()
    await expect(page.getByRole("region", { name: "This application is Archived" })).toBeVisible()
    expect(await axeProblems(page)).toEqual([])
  })
}
