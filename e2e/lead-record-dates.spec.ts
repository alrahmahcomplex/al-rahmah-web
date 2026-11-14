import { type Locator, type Page } from "@playwright/test"


import { ACCOUNTANT, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl, type LeadTabName } from "./lead-page"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// A date the kit's date field cannot read never reaches a save on the lead
// record (#325, #358): the field says how to type it, keeps the focus, and
// the form stays open with nothing saved. One test per form with a date.


const APPLIED = "1ead0000-0000-4000-8000-000000000047" // Imani Arrival, Applied: Record visit is the step
const PAID = "1ead0000-0000-4000-8000-000000000902" // a lead with a recorded deposit and fees still owing

const WRONG_DATE = "Type the date as day/month/year, for example 25/09/2026."
const WRONG_TIME = "Type the time as hours:minutes, for example 14:30."

async function open(page: Page, person: FixtureStaff, id: string, tab?: LeadTabName) {
  await signInOnce(page, person.email, person.password)
  await page.goto(leadUrl(id, tab))
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

test("Record visit does not save a date it cannot read", async ({ page }) => {
  await open(page, SUPER_ADMIN, APPLIED)
  await page.getByRole("button", { name: "Record visit" }).click()
  const form = page.getByRole("form", { name: "Record visit" })
  await refusesGarbage(form, "Visit date", "Record visit", "next tuesday")
  await expect(form).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "Record visit" })).toBeVisible()
})

test("Record payment does not reach its review with a date it cannot read", async ({ page }) => {
  await open(page, ACCOUNTANT, PAID, "School fee")
  await page.getByRole("region", { name: "School fee" }).getByRole("button", { name: "Record payment" }).click()
  const form = page.getByRole("form", { name: "Record payment" })
  await refusesGarbage(form, "Payment date", "Review payment")
  await expect(page.getByRole("region", { name: "Review payment" })).toHaveCount(0)
})

test.describe("follow-ups", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, SUPER_ADMIN, APPLIED, "Follow-ups")
  })

  test("Schedule follow-up does not save a date it cannot read", async ({ page }) => {
    await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Schedule follow-up" }).click()
    const sheet = page.getByRole("dialog", { name: "Schedule follow-up" })
    await refusesGarbage(sheet, "Follow-up date", "Schedule follow-up")
    await expect(sheet).toBeVisible()
  })

  // A required date left empty is the browser's own required check, as on a
  // kit Field: the field is invalid and focused, and nothing is saved. The
  // browser's words are its own, so they are not asserted.
  test("Schedule follow-up does not save with its required date left empty", async ({ page }) => {
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

  test("Record follow-up does not save a next date it cannot read", async ({ page }) => {
    await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Record follow-up" }).click()
    const sheet = page.getByRole("dialog", { name: "Record follow-up" })
    await sheet.getByLabel("Comment").fill("Asked about the bus route.")
    await refusesGarbage(sheet, "Next follow-up date", "Record follow-up", "2026-13-45")
    await expect(sheet).toBeVisible()
  })

  test("Contacted at does not save a time it cannot read, or a time with no day", async ({ page }) => {
    await page.getByRole("region", { name: "Follow-ups" }).getByRole("button", { name: "Record follow-up" }).click()
    const sheet = page.getByRole("dialog", { name: "Record follow-up" })
    const when = sheet.getByRole("group", { name: "When" })
    const time = when.getByLabel("Time, 24-hour clock")
    await sheet.getByLabel("Comment").fill("Asked about the bus route.")

    await time.fill("99:99")
    await sheet.getByRole("button", { name: "Record follow-up", exact: true }).click()
    await expect(sheet.getByText(WRONG_TIME)).toBeVisible()
    await expect(time).toBeFocused()

    // A time with the day emptied is half a value: unreadable, so not saved either.
    await time.fill("09:30")
    await when.getByLabel("When", { exact: true }).fill("")
    await sheet.getByRole("button", { name: "Record follow-up", exact: true }).click()
    await expect(sheet.getByText(WRONG_DATE)).toBeVisible()
    await expect(sheet).toBeVisible()
  })
})
