import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

import { signInOnce } from "./log-in"
import { open, payDeposit, pupil, streamYear, type StreamYear } from "./streams"

// The Boy or girl answer on the applicant's record (#449): staff give it for
// a child who has none, and a change that takes a placed child out of their
// stream says where they go before it is saved. Each test claims a year of
// its own (e2e/streams.ts), so the seeded streams are left alone.

let years: StreamYear[] = []

test.afterEach(async () => {
  await Promise.all(years.map((each) => each.done()))
  years = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// A row of Student details.
function detail(page: Page, term: string) {
  return page.getByRole("region", { name: "Student" }).locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]")
}

test("staff give the answer for a child who has none", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const child = await pupil(fixture.year, fixture.className)
  const first = child.name.split(" ")[0]

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/applicants/${child.id}`)
  await expect(detail(page, "Boy or girl")).toContainText("Not given")
  await expect(page.getByRole("region", { name: "Student" })).toContainText(`Without an answer ${first} fits Mixed streams only.`)

  await detail(page, "Boy or girl").getByRole("button", { name: "Give the answer" }).click()
  const sheet = page.getByRole("dialog", { name: `Is ${first} a boy or a girl?` })
  await sheet.locator("label").filter({ has: page.getByRole("radio", { name: "Girl", exact: true }) }).click()
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saved: Girl." })).toBeVisible()

  await expect(detail(page, "Boy or girl")).toContainText("Girl")
  await expect(detail(page, "Boy or girl").getByRole("button", { name: "Change" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Student" })).not.toContainText("Without an answer")
})

test("changing the answer of a placed child warns where they move, then moves them", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const { year, className } = fixture

  // A boy placed in the boys' stream; the girls' stream has room.
  await open(year, className, "A", "Boys", 1)
  await open(year, className, "A", "Girls", 1)
  const child = await pupil(year, className, "Boy")
  await payDeposit(child.id)

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/applicants/${child.id}`)
  await expect(detail(page, "Boy or girl")).toContainText("Boy")
  await expect(detail(page, "Seat")).toHaveText(`${className} A (Boys)`)

  await detail(page, "Boy or girl").getByRole("button", { name: "Change" }).click()
  const sheet = page.getByRole("dialog", { name: `Is ${child.name.split(" ")[0]} a boy or a girl?` })
  await sheet.locator("label").filter({ has: page.getByRole("radio", { name: "Girl", exact: true }) }).click()
  await expect(sheet.getByRole("status")).toHaveText(
    `This moves her out of ${className} A (Boys). She takes a seat in ${className} A (Girls), the first stream for girls with a free seat.`,
  )
  await sheet.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Saved: Girl." })).toBeVisible()

  await expect(detail(page, "Boy or girl")).toContainText("Girl")
  await expect(detail(page, "Seat")).toHaveText(`${className} A (Girls)`)
})
