import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"

import { lookFor } from "@/app/staff/route-looks"
import { tanzaniaToday } from "@/lib/school-calendar"
import { requestDiscount } from "@/lib/services/discounts"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { leadUrl, type LeadTabName } from "./lead-page"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The lead record in the new look (#325): axe on each tab and on the sheets
// the seeded leads open, at desktop and phone widths. Every sheet is closed
// again unsaved; the discount sheets need a Pending request, made on a lead
// of the test's own. Set R3_SHOTS to a folder to keep a capture of each.

const APPLIED = "1ead0000-0000-4000-8000-000000000047" // Imani Arrival, Applied
const PAID = "1ead0000-0000-4000-8000-000000000902" // a lead with a recorded deposit
const PENDING_REOPENING = "1ead0000-0000-4000-8000-000000000080" // closed, a Pending reopening request

const TABS: LeadTabName[] = ["Overview", "Interview", "School fee", "Follow-ups", "Discounts"]

async function open(page: Page, person: FixtureStaff, url: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(url)
  await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Application sections" })).toBeVisible()
}

/** A Passed lead of its own, so a discount request may be made on it. */
async function passedLead(): Promise<{ id: string; studentName: string }> {
  const today = tanzaniaToday()
  const admissions = await signedIn(ADMISSIONS)
  const studentName = `Look ${randomUUID().slice(0, 6)}`
  const created = await createLead(admissions, {
    guardian: {
      contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: studentName, className: "STD 2", enrollmentYear: Number(today.slice(0, 4)) + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(admissions, created.data.leadId)
  if (!registered.ok) throw new Error(registered.error)
  const result = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!result.ok) throw new Error(result.error)
  return { id: created.data.leadId, studentName }
}

async function shot(page: Page, name: string) {
  const folder = process.env.R3_SHOTS
  if (folder) await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true })
}

/** Axe inside the open sheet, then Escape, which closes it unsaved. */
async function checkSheet(page: Page, name: string, file: string) {
  const sheet = page.getByRole("dialog", { name })
  await expect(sheet).toBeVisible()
  expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
  await shot(page, file)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

// The record turns new only with the kit's form parts swapped in (#358): a
// screen is never half-converted. Until then this spec has nothing to check.
test.skip(lookFor("/staff/applicants/1ead") !== "new", "The lead record is still legacy until #358's parts are in")

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("every tab passes axe", async ({ page }) => {
      for (const tab of TABS) {
        await open(page, SUPER_ADMIN, leadUrl(APPLIED, tab))
        expect(await axeProblems(page), tab).toEqual([])
        await shot(page, `${width}-tab-${tab.toLowerCase().replace(/ /g, "-")}`)
      }
    })

    test("the More popover and its sheets pass axe", async ({ page }) => {
      await open(page, SUPER_ADMIN, leadUrl(APPLIED))
      const more = page.getByRole("button", { name: "More actions", exact: true })

      await more.click()
      const popover = page.getByRole("dialog", { name: "More actions" })
      await expect(popover).toBeVisible()
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
      await shot(page, `${width}-more`)

      await popover.getByRole("button", { name: "Mark inactive", exact: true }).click()
      await checkSheet(page, "Mark Imani Arrival inactive", `${width}-sheet-mark-inactive`)

      await more.click()
      await page.getByRole("dialog", { name: "More actions" }).getByRole("button", { name: "Decline", exact: true }).click()
      await checkSheet(page, "Decline Imani Arrival", `${width}-sheet-decline`)
    })

    test("the follow-up sheets pass axe", async ({ page }) => {
      await open(page, SUPER_ADMIN, leadUrl(APPLIED, "Follow-ups"))
      const panel = page.getByRole("region", { name: "Follow-ups" })
      await panel.getByRole("button", { name: "Schedule follow-up" }).click()
      await checkSheet(page, "Schedule follow-up", `${width}-sheet-schedule-follow-up`)
      await panel.getByRole("button", { name: "Record follow-up" }).click()
      await checkSheet(page, "Record follow-up", `${width}-sheet-record-follow-up`)
    })

    test("Adjust payment passes axe", async ({ page }) => {
      await open(page, ACCOUNTANT, leadUrl(PAID, "School fee"))
      await page.getByRole("list", { name: "Payments" }).getByRole("button", { name: "Adjust" }).first().click()
      await checkSheet(page, "Adjust payment", `${width}-sheet-adjust-payment`)
    })

    test("Request discount, then Grant and Refuse on the request, pass axe", async ({ page }) => {
      const lead = await passedLead()

      await open(page, ADMISSIONS, leadUrl(lead.id, "Discounts"))
      const panel = page.getByRole("region", { name: "Discounts" })
      await panel.getByRole("button", { name: "Request discount" }).click()
      const form = panel.getByRole("form", { name: "Request discount" })
      await expect(form).toBeVisible()
      expect(await axeProblems(page, '[aria-label="Request discount"]')).toEqual([])
      await shot(page, `${width}-form-request-discount`)

      const made = await requestDiscount(await signedIn(ADMISSIONS), lead.id, "staff_child", "Mother teaches Year 3.", randomUUID())
      if (!made.ok) throw new Error(JSON.stringify(made.error))

      await page.context().clearCookies()
      await open(page, MANAGER, leadUrl(lead.id, "Discounts"))
      await panel.getByRole("button", { name: "Grant" }).click()
      await checkSheet(page, `Grant ${lead.studentName} the discount?`, `${width}-sheet-grant-discount`)
      await panel.getByRole("button", { name: "Refuse" }).click()
      await checkSheet(page, `Refuse ${lead.studentName} the discount?`, `${width}-sheet-refuse-discount`)
    })

    test("Approve and Reject on a reopening request pass axe", async ({ page }) => {
      await open(page, MANAGER, leadUrl(PENDING_REOPENING))
      const pending = page.getByRole("group", { name: "Pending reopening request" })
      await pending.getByRole("button", { name: "Approve" }).click()
      await checkSheet(page, (await page.getByRole("dialog").getByRole("heading").first().textContent()) ?? "", `${width}-sheet-approve-reopening`)
      await pending.getByRole("button", { name: "Reject" }).click()
      await checkSheet(page, (await page.getByRole("dialog").getByRole("heading").first().textContent()) ?? "", `${width}-sheet-reject-reopening`)
    })
  })
}
