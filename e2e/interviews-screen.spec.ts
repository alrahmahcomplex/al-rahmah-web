import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { listInterviews } from "@/lib/services/interview-list"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { asSystem, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../tests/support/interview-years"
import { logIn } from "./log-in"

// The Interviews screen. Slice 5's seeded registrations hold S/N 1 to 3 for
// 2027, so they head the 2027 list whatever the other tests register after
// them: ADMSN-90501 with no result yet and Not Paid, ADMSN-90503 Passed and
// Paid (the seed marks it Paid as the Accountant), and ADMSN-90504 Failed and
// Not Paid. Tests only read these three.

// 2001 is before any intake the tests or seeds register interviews for.
const EMPTY_YEAR = 2001

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

const list = (page: Page) => page.getByRole("table", { name: "Interviews for 2027" })
// The data rows, without the header.
const rows = (page: Page) => list(page).getByRole("row").filter({ has: page.getByRole("cell") })
const filter = (page: Page, group: string, option: string) =>
  page.getByRole("navigation", { name: group }).getByRole("link", { name: option, exact: true })

// A lead of the test's own, registered in the year, Passed and Paid: ready
// to send.
async function readyLead(year: number) {
  const today = tanzaniaToday()
  const studentName = `Ready ${randomUUID().slice(0, 6)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Ready Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: {
      fullName: studentName,
      className: "STD 4",
      enrollmentYear: Number(today.slice(0, 4)) + 1,
      dayOrBoarding: "Day",
    },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result: "Passed", score: 70 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  const paid = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
  if (!paid.ok) throw new Error(`fee failed: ${paid.error}`)
  return { studentName, admissionNumber: created.data.admissionNumber }
}

// The Interview fee and Result sent columns' cells, by the column they're in
// rather than their position.
const FEE_CELL = 'td[data-column="fee"]'
const SENT_CELL = 'td[data-column="sent"]'

test.describe("the Interviews screen", () => {
  test("Admissions Staff open it from the navigation, walk the result filters and open a lead", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Interviews" }).click()
    await expect(page.getByRole("heading", { name: "Interviews", exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/staff\/interviews$/)

    await filter(page, "Enrollment year", "2027").click()
    await expect(page).toHaveURL(/\/staff\/interviews\?year=2027$/)
    await expect(filter(page, "Enrollment year", "2027")).toHaveAttribute("aria-current", "page")
    // In S/N order, each with its details.
    await expect(rows(page).nth(0)).toContainText("1ADMSN-90501Amani InterviewSTD 5DayNo result yet–Not Paid")
    await expect(rows(page).nth(1)).toContainText("2ADMSN-90503Neema InterviewSTD 1DayPassed78.5%Paid")
    await expect(rows(page).nth(2)).toContainText("3ADMSN-90504Baraka InterviewFORM 1BoardingFailed41%Not Paid")

    await filter(page, "Result", "No result yet").click()
    await expect(page).toHaveURL(/year=2027&result=none$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90501")
    await expect(list(page)).not.toContainText("ADMSN-90503")
    await expect(list(page)).not.toContainText("ADMSN-90504")

    await filter(page, "Result", "Passed").click()
    await expect(page).toHaveURL(/year=2027&result=passed$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90503")
    await expect(list(page)).not.toContainText("ADMSN-90501")
    await expect(list(page)).not.toContainText("ADMSN-90504")

    await filter(page, "Result", "Failed").click()
    await expect(page).toHaveURL(/year=2027&result=failed$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90504")
    await expect(list(page)).not.toContainText("ADMSN-90503")

    await filter(page, "Result", "Any result").click()
    await expect(page).toHaveURL(/\/staff\/interviews\?year=2027$/)
    await list(page).getByRole("link", { name: "Amani Interview" }).click()
    // The lead opens on its Interview tab.
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000501\?tab=interview#lead-interview$/)
    await expect(page.getByRole("region", { name: "Interview", exact: true })).toBeVisible()
  })

  test("the Accountant filters to Not Paid to see who still owes, at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/interviews?year=2027")

    await filter(page, "Interview fee", "Not Paid").click()
    await expect(page).toHaveURL(/year=2027&fee=not-paid$/)
    await expect(rows(page).nth(0)).toContainText("ADMSN-90501")
    await expect(list(page)).toContainText("ADMSN-90504")
    await expect(list(page).getByText("ADMSN-90503")).toHaveCount(0)
    for (const fee of await rows(page).locator(FEE_CELL).allTextContents()) expect(fee).toBe("Not Paid")
    // The table scrolls inside its frame; the page itself doesn't.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)

    // Paid lists the seeded Paid lead first, by S/N, and only Paid rows.
    await filter(page, "Interview fee", "Paid").click()
    await expect(page).toHaveURL(/year=2027&fee=paid$/)
    await expect(rows(page).nth(0)).toContainText("2ADMSN-90503Neema Interview")
    await expect(rows(page).nth(0).locator(FEE_CELL)).toHaveText("Paid")
    for (const fee of await rows(page).locator(FEE_CELL).allTextContents()) expect(fee).toBe("Paid")
    await expect(list(page).getByText("ADMSN-90501")).toHaveCount(0)
    await expect(list(page).getByText("ADMSN-90504")).toHaveCount(0)
  })

  test("says plainly when a year has no registrations, and when nothing matches the filters", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${EMPTY_YEAR}`)
    await expect(page.getByText(`No one is registered for interview for ${EMPTY_YEAR} yet.`)).toBeVisible()
    await expect(page.getByRole("table")).toHaveCount(0)

    await filter(page, "Result", "Passed").click()
    await expect(page.getByText("No interviews match these filters.")).toBeVisible()
    await page.getByRole("link", { name: `Show every interview for ${EMPTY_YEAR}` }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/interviews\\?year=${EMPTY_YEAR}$`))
  })
})

test.describe("the Result sent column and the Ready to send filter", () => {
  let claim: InterviewYearClaim
  test.beforeAll(async () => {
    claim = await claimInterviewYear()
  })
  test.afterAll(async () => {
    await claim?.release()
  })

  test("Ready to send lists a paid result; once it is sent it leaves the list and shows when it went", async ({ page }) => {
    const year = claim.year
    const lead = await readyLead(year)
    // The new lead has the year's newest S/N, so it is on the last page.
    const lastPage = async (search: { readyToSend?: true }) => {
      const listed = await listInterviews(await signedIn(ADMISSIONS), { enrollmentYear: year, ...search, page: 1 })
      if (!listed.ok) throw new Error(listed.error)
      return listed.data.pageCount
    }
    const yearList = (page: Page) => page.getByRole("table", { name: `Interviews for ${year}` })
    const row = (page: Page) => yearList(page).getByRole("row").filter({ hasText: lead.admissionNumber })

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${year}`)
    await filter(page, "Result release", "Ready to send").click()
    await expect(page).toHaveURL(new RegExp(`year=${year}&release=ready$`))
    await expect(filter(page, "Result release", "Ready to send")).toHaveAttribute("aria-current", "page")
    const pages = await lastPage({ readyToSend: true })
    if (pages > 1) await page.goto(`/staff/interviews?year=${year}&release=ready&page=${pages}`)
    await expect(row(page)).toContainText("Paid")
    await expect(row(page).locator(SENT_CELL)).toHaveText("")

    // Released from the lead's screen, by SMS.
    await row(page).getByRole("link", { name: lead.studentName }).click()
    const release = page.getByRole("region", { name: "Result release" })
    await release.getByRole("button", { name: "Send SMS instead" }).click()
    await expect(release.getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", {
      timeout: 15_000,
    })

    for (let n = 1; n <= (await lastPage({ readyToSend: true })); n++) {
      await page.goto(`/staff/interviews?year=${year}&release=ready&page=${n}`)
      await expect(yearList(page).or(page.getByText(`No results for ${year} are waiting to be sent.`))).toBeVisible()
      await expect(row(page)).toHaveCount(0)
    }

    // The Accountant, at phone width, sees that the family has heard.
    await page.context().clearCookies()
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/interviews?year=${year}&page=${await lastPage({})}`)
    await expect(row(page).locator(SENT_CELL)).toHaveText(formatDate(tanzaniaToday()))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})
