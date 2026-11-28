import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { asSystem, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../tests/support/interview-years"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"

// The Interviews screen (prototype 1MpUKuX27V6pc1CS1z1URz v5): the whole year
// searched, sorted and filtered as staff type, and the interview in a side
// sheet. Each test registers leads of its own in a year the file claims.

// 2001 is before any intake the tests or seeds register interviews for.
const EMPTY_YEAR = 2001

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead of the test's own in `year`, registered for interview with no result
// and its fee Not Paid; `passed` records Passed and marks the fee Paid.
async function ownLead(year: number, { passed = false, className = "STD 4" }: { passed?: boolean; className?: "STD 4" | "KG 1" } = {}) {
  const today = tanzaniaToday()
  const studentName = `Listed ${randomUUID().slice(0, 6)} Pupil`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "List Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: studentName, className, enrollmentYear: Number(today.slice(0, 4)) + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  if (passed) {
    const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result: "Passed", score: 70 })
    if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
    const paid = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
    if (!paid.ok) throw new Error(`fee failed: ${paid.error}`)
  }
  return { leadId, studentName, admissionNumber: created.data.admissionNumber, serialNumber: registered.data.serialNumber }
}

const search = (page: Page) => page.getByRole("searchbox", { name: /Search the \d{4} interviews/ })
const yearList = (page: Page, year: number) => page.getByRole("table", { name: `Interviews for ${year}` })
const listRows = (page: Page, year: number) => yearList(page, year).getByRole("row").filter({ has: page.getByRole("cell") })
const sheet = (page: Page) => page.getByRole("dialog")
const FEE_CELL = '[data-column="fee"]'
const SENT_CELL = '[data-column="sent"]'

test.describe("the Interviews screen", () => {
  let claim: InterviewYearClaim
  test.beforeAll(async () => {
    claim = await claimInterviewYear()
  })
  test.afterAll(async () => {
    await claim?.release()
  })

  test("opens newest first, searches as staff type, and sorts and filters by column", async ({ page }) => {
    const year = claim.year
    const older = await ownLead(year, { className: "KG 1" })
    const newer = await ownLead(year, { passed: true })
    await signIn(page, ADMISSIONS)
    await page.getByRole("navigation").getByRole("link", { name: "Interviews" }).first().click()
    await expect(page.getByRole("heading", { level: 1, name: "Interviews" })).toBeVisible()
    await page.goto(`/staff/interviews?year=${year}`)

    // Newest registration first: the higher S/N heads the list.
    const sns = async () => (await listRows(page, year).locator("td:first-child").allTextContents()).map(Number)
    const first = await sns()
    expect(first).toEqual([...first].sort((a, b) => b - a))

    // The list narrows on every letter, with no Search button; the URL keeps the search.
    await search(page).pressSequentially(newer.studentName.split(" ")[1].slice(0, 4))
    await expect(listRows(page, year)).toHaveCount(1)
    await expect(listRows(page, year)).toContainText(newer.admissionNumber)
    await expect(page.getByText("Showing 1–1 of 1 matching interview")).toBeVisible()
    await expect(page).toHaveURL(/q=/)
    await page.getByRole("button", { name: "Clear the search" }).click()
    await search(page).fill(older.admissionNumber.replace("ADMSN-", ""))
    await expect(listRows(page, year)).toHaveCount(1)
    await expect(listRows(page, year)).toContainText(older.studentName)
    await search(page).press("Escape")
    await expect(search(page)).toHaveValue("")

    // S/N lowest first, then highest first, then back to newest first.
    await page.getByRole("button", { name: "Sort by S/N, lowest first" }).click()
    const ascending = await sns()
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b))
    await expect(yearList(page, year).getByRole("columnheader", { name: /S\/N/ })).toHaveAttribute("aria-sort", "ascending")

    // The Class heading filters, several classes at once; the Filter button agrees.
    await yearList(page, year).getByRole("button", { name: "Filter by Class" }).click()
    await page.getByRole("button", { name: "KG 1" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByText("Filtered by KG 1")).toBeVisible()
    for (const cell of await listRows(page, year).locator("td:nth-child(5)").allTextContents()) expect(cell).toBe("KG 1")
    await page.getByRole("button", { name: /^Filter: Class on/ }).click()
    await expect(page.getByRole("group", { name: "Class" }).getByRole("button", { name: "KG 1" })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("group", { name: "Interview fee" }).getByRole("button", { name: /Not Paid/ }).click()
    await page.getByRole("button", { name: "Done" }).click()
    await expect(page.getByText("Filtered by KG 1 · Not Paid")).toBeVisible()
    for (const fee of await listRows(page, year).locator(FEE_CELL).allTextContents()) expect(fee).toBe("Not Paid")
    await page.getByRole("button", { name: "Clear filters" }).first().click()
    await expect(page.getByText(/Filtered by/)).toHaveCount(0)
  })

  test("Admissions Staff record a result in the side sheet, then open the full record and come back", async ({ page }) => {
    const year = claim.year
    const lead = await ownLead(year)
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${year}`)
    await search(page).fill(lead.admissionNumber)
    await listRows(page, year).filter({ hasText: lead.admissionNumber }).click()

    // The interview opens beside the list, which stays where it was.
    await expect(sheet(page).getByRole("heading", { name: lead.studentName })).toBeVisible()
    await expect(sheet(page)).toContainText(`Number ${lead.serialNumber} on the ${year} interview list. Each year's list starts again at 1.`)
    await sheet(page).getByRole("button", { name: "Record result" }).click()
    const form = sheet(page).getByRole("form", { name: "Record result" })
    await form.locator("label").filter({ hasText: "Passed" }).click()
    await form.getByLabel("Score (%)").fill("77")
    await form.getByRole("button", { name: "Save result" }).click()
    await expect(sheet(page).getByRole("status")).toHaveText("Result recorded. The applicant is Interviewed.")
    // The list behind it follows. The sheet is modal, so it closes first.
    await sheet(page).getByRole("button", { name: "Close" }).click()
    await expect(sheet(page)).toHaveCount(0)
    await expect(listRows(page, year).filter({ hasText: lead.admissionNumber })).toContainText("Passed")
    await expect(listRows(page, year).filter({ hasText: lead.admissionNumber })).toContainText("77%")

    await listRows(page, year).filter({ hasText: lead.admissionNumber }).click()
    await sheet(page).getByRole("link", { name: "View full record" }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\/[^?]+\?tab=interview/)
    await expect(page.getByRole("heading", { level: 1, name: lead.studentName })).toBeVisible()
    await page.getByRole("link", { name: "Interviews", exact: true }).last().click()
    await expect(page).toHaveURL(new RegExp(`/staff/interviews\\?year=${year}&q=`))
    await expect(search(page)).toHaveValue(lead.admissionNumber)
    await expect(sheet(page)).toHaveCount(0)
  })

  test("the Accountant marks the fee paid in the side sheet, at phone width", async ({ page }) => {
    const year = claim.year
    const lead = await ownLead(year)
    await page.setViewportSize({ width: 375, height: 812 })
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/interviews?year=${year}&q=${lead.admissionNumber}`)
    await listRows(page, year).filter({ hasText: lead.admissionNumber }).click()
    await expect(sheet(page).getByRole("button", { name: "Record result" })).toHaveCount(0)
    await sheet(page).getByRole("button", { name: "Mark paid" }).click()
    await expect(sheet(page).getByRole("status")).toHaveText(/^Marked Paid\./)
    await page.keyboard.press("Escape")
    await expect(sheet(page)).toHaveCount(0)
    await expect(listRows(page, year).filter({ hasText: lead.admissionNumber }).locator(FEE_CELL)).toHaveText("Paid")
  })

  test("Result sent shows the day a result went, and filters sent and not sent", async ({ page }) => {
    const year = claim.year
    const lead = await ownLead(year, { passed: true })
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${year}&q=${lead.admissionNumber}&sent=not-sent`)
    await expect(listRows(page, year)).toHaveCount(1)
    await expect(listRows(page, year).locator(SENT_CELL)).toHaveText("")

    // Released from the record, by SMS.
    await page.goto(`/staff/applicants/${lead.leadId}?tab=interview`)
    const release = page.getByRole("region", { name: "Result release" })
    await release.getByRole("button", { name: "Send SMS instead" }).click()
    await expect(release.getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", { timeout: 15_000 })

    await page.goto(`/staff/interviews?year=${year}&q=${lead.admissionNumber}&sent=not-sent`)
    await expect(page.getByText(`No one matching “${lead.admissionNumber}” is on the ${year} list with these filters.`)).toBeVisible()
    await page.goto(`/staff/interviews?year=${year}&q=${lead.admissionNumber}&sent=sent`)
    await expect(listRows(page, year).locator(SENT_CELL)).toHaveText(formatDate(tanzaniaToday()))
  })

  test("says plainly when a year has no registrations", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/interviews?year=${EMPTY_YEAR}`)
    await expect(page.getByText(`No one is registered for interview for ${EMPTY_YEAR} yet.`)).toBeVisible()
  })
})

// Axe may report only the accepted white on orange, at the desktop and the
// phone width (docs/agents/workflow.md, Axe scans).
for (const width of [1280, 390]) {
  test(`axe finds nothing on Interviews at ${width}px`, { tag: "@nightly" }, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/interviews?year=2027")
    await expect(listRows(page, 2027).first()).toBeVisible()
    expect(await axeProblems(page)).toEqual([])
  })
}
