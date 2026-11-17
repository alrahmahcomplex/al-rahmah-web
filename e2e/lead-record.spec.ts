import { randomInt, randomUUID } from "node:crypto"

import { type Locator, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { requestDiscount } from "@/lib/services/discounts"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { chooseOption } from "./kit-parts"
import { leadUrl, listOptions, type LeadTabName } from "./lead-page"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The lead record in the kit (#325).
// - Dates: a date the kit's date field cannot read never reaches a save. The
//   field says how to type it, keeps the focus, and the form stays open with
//   nothing saved. One test per form with a date.
// - Axe (@nightly): every tab and the sheets the seeded leads open, at desktop
//   and phone widths. Each sheet is closed again unsaved. Set R3_SHOTS to a
//   folder to keep a capture of each, for a PR's evidence.

const APPLIED = "1ead0000-0000-4000-8000-000000000047" // Imani Arrival, Applied: Record visit is the step
const PAID = "1ead0000-0000-4000-8000-000000000902" // a lead with a recorded deposit and fees still owing
const PENDING_REOPENING = "1ead0000-0000-4000-8000-000000000080" // closed, a Pending reopening request
const TABS: LeadTabName[] = ["Overview", "Interview", "School fee", "Follow-ups", "Discounts"]

const WRONG_DATE = "Type the date as day/month/year, for example 25/09/2026."
const WRONG_TIME = "Type the time as hours:minutes, for example 14:30."

async function open(page: Page, person: FixtureStaff, url: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(url)
  await expect(page.getByRole("navigation", { name: "Application sections" })).toBeVisible()
}

/** Types text that is no date, presses the form's button, and expects the field's own sentence and no save. */
async function refusesGarbage(scope: Locator, field: string, submit: string, text = "31/02/2026") {
  const input = scope.getByLabel(field, { exact: true })
  await input.fill(text)
  await scope.getByRole("button", { name: submit, exact: true }).click()
  await expect(scope.getByText(WRONG_DATE)).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute("aria-invalid", "true")
}

/**
 * Waits out the date field's refocus after a refused submit. The kit moves
 * focus to the unreadable field at once, after a 0 ms timer and two frames
 * later (revealFirst in components/kit/date-field.tsx). Playwright's fill
 * selects a field and then presses its keys in a second step, so a late
 * refocus landing in between sends the keys to the refused field instead.
 * On a slow CI runner, fill("") on the date pressed Delete in the time box,
 * the date stayed filled, and the form was sent (#446). Frame callbacks run
 * in the order they were asked for, so two frames and a timer from now come
 * after the kit's.
 */
async function refocusDone(page: Page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))))
}

test.describe("a date the field cannot read is never saved", () => {
  test("Record visit", async ({ page }) => {
    await open(page, SUPER_ADMIN, leadUrl(APPLIED))
    await page.getByRole("button", { name: "Record visit" }).click()
    const form = page.getByRole("form", { name: "Record visit" })
    await refusesGarbage(form, "Visit date", "Record visit", "next tuesday")
    await expect(form).toBeVisible()
    await page.reload()
    await expect(page.getByRole("button", { name: "Record visit" })).toBeVisible()
  })

  test("Record payment never reaches its review", async ({ page }) => {
    await open(page, ACCOUNTANT, leadUrl(PAID, "School fee"))
    await page.getByRole("region", { name: "School fee" }).getByRole("button", { name: "Record payment" }).click()
    const form = page.getByRole("form", { name: "Record payment" })
    // The other fields are filled, so the date is the only thing that holds the form.
    const type = form.getByLabel("Payment type")
    await chooseOption(type, (await listOptions(type))[0])
    const amount = form.getByLabel("Amount (TZS)")
    if (await amount.count()) await amount.fill("100,000")
    await refusesGarbage(form, "Payment date", "Review payment")
    await expect(page.getByRole("region", { name: "Review payment" })).toHaveCount(0)
  })

  test.describe("follow-ups", () => {
    test.beforeEach(async ({ page }) => {
      await open(page, SUPER_ADMIN, leadUrl(APPLIED, "Follow-ups"))
    })

    test("Schedule follow-up", async ({ page }) => {
      await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Schedule follow-up" }).click()
      const sheet = page.getByRole("dialog", { name: "Schedule follow-up" })
      await refusesGarbage(sheet, "Follow-up date", "Schedule follow-up")
      await expect(sheet).toBeVisible()
    })

    // A required date left empty is the browser's own required check, as on a
    // kit Field: the field is invalid and focused, and nothing is saved. The
    // browser's words are its own, so they are not asserted.
    test("Schedule follow-up with its required date left empty", async ({ page }) => {
      await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Schedule follow-up" }).click()
      const sheet = page.getByRole("dialog", { name: "Schedule follow-up" })
      const input = sheet.getByLabel("Follow-up date", { exact: true })
      await input.fill("")
      await sheet.getByRole("button", { name: "Schedule follow-up", exact: true }).click()
      await expect(input).toBeFocused()
      expect(await input.evaluate((el) => el.matches(":invalid"))).toBe(true)
      await expect(sheet.getByText(WRONG_DATE)).toHaveCount(0)
      await expect(sheet).toBeVisible()
    })

    test("Record follow-up's next date", async ({ page }) => {
      await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Record follow-up" }).click()
      const sheet = page.getByRole("dialog", { name: "Record follow-up" })
      await sheet.getByLabel("Comment").fill("Asked about the bus route.")
      await refusesGarbage(sheet, "Next follow-up date", "Record follow-up", "2026-13-45")
      await expect(sheet).toBeVisible()
    })

    test("Contacted at, with a wrong time or a time with no day", async ({ page }) => {
      await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Record follow-up" }).click()
      const sheet = page.getByRole("dialog", { name: "Record follow-up" })
      const when = sheet.getByRole("group", { name: "When" })
      const time = when.getByLabel("Time, 24-hour clock")
      await sheet.getByLabel("Comment").fill("Asked about the bus route.")

      await time.fill("99:99")
      await sheet.getByRole("button", { name: "Record follow-up", exact: true }).click()
      await expect(sheet.getByText(WRONG_TIME)).toBeVisible()
      await expect(time).toBeFocused()
      await refocusDone(page)

      // A time with the day emptied is half a value: unreadable, so not saved either.
      await time.fill("09:30")
      const day = when.getByLabel("When", { exact: true })
      await day.fill("")
      await expect(day).toHaveValue("")
      await sheet.getByRole("button", { name: "Record follow-up", exact: true }).click()
      await expect(sheet.getByText(WRONG_DATE)).toBeVisible()
      await expect(sheet).toBeVisible()
    })
  })
})

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

for (const width of [1280, 390]) {
  test.describe(`axe at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test("every tab", { tag: "@nightly" }, async ({ page }) => {
      for (const tab of TABS) {
        await open(page, SUPER_ADMIN, leadUrl(APPLIED, tab))
        expect(await axeProblems(page), tab).toEqual([])
        await shot(page, `${width}-tab-${tab.toLowerCase().replace(/ /g, "-")}`)
      }
    })

    test("the More popover and its sheets", { tag: "@nightly" }, async ({ page }) => {
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

    test("the follow-up sheets", { tag: "@nightly" }, async ({ page }) => {
      await open(page, SUPER_ADMIN, leadUrl(APPLIED, "Follow-ups"))
      const panel = page.getByRole("region", { name: "Follow-ups" })
      await panel.getByRole("button", { name: "Schedule follow-up" }).click()
      await checkSheet(page, "Schedule follow-up", `${width}-sheet-schedule-follow-up`)
      await panel.getByRole("button", { name: "Record follow-up" }).click()
      await checkSheet(page, "Record follow-up", `${width}-sheet-record-follow-up`)
    })

    test("Adjust payment", { tag: "@nightly" }, async ({ page }) => {
      await open(page, ACCOUNTANT, leadUrl(PAID, "School fee"))
      await page.getByRole("list", { name: "Payments" }).getByRole("button", { name: "Adjust" }).first().click()
      await checkSheet(page, "Adjust payment", `${width}-sheet-adjust-payment`)
    })

    test("Request discount, then Grant and Refuse on the request", { tag: "@nightly" }, async ({ page }) => {
      const lead = await passedLead()

      await open(page, ADMISSIONS, leadUrl(lead.id, "Discounts"))
      const panel = page.getByRole("region", { name: "Discounts" })
      await panel.getByRole("button", { name: "Request discount" }).click()
      await expect(panel.getByRole("form", { name: "Request discount" })).toBeVisible()
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

    test("Approve and Reject on a reopening request", { tag: "@nightly" }, async ({ page }) => {
      await open(page, MANAGER, leadUrl(PENDING_REOPENING))
      const pending = page.getByRole("group", { name: "Pending reopening request" })
      await pending.getByRole("button", { name: "Approve" }).click()
      await checkSheet(page, (await page.getByRole("dialog").getByRole("heading").first().textContent()) ?? "", `${width}-sheet-approve-reopening`)
      await pending.getByRole("button", { name: "Reject" }).click()
      await checkSheet(page, (await page.getByRole("dialog").getByRole("heading").first().textContent()) ?? "", `${width}-sheet-reject-reopening`)
    })
  })
}
