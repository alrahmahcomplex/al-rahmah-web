import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

import { moreActions } from "./lead-page"
import { signInOnce } from "./log-in"
import { open, payDeposit, pupil, streamYear, yesterday, type StreamYear } from "./streams"

// Declining a child who waits for a stream from Seats, with No seat
// available (#115, #449). Each test claims a year of its own
// (e2e/streams.ts), so the seeded streams are left alone.

let years: StreamYear[] = []

test.afterEach(async () => {
  await Promise.all(years.map((each) => each.done()))
  years = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("the Manager declines a child waiting for a stream from Seats with No seat available", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const { year, className } = fixture

  // Two children hold a Deposit priority; the stream opened then has one
  // seat, so the one who paid later waits.
  const seated = await pupil(year, className, "Girl")
  await payDeposit(seated.id, yesterday)
  const lead = await pupil(year, className, "Girl")
  await payDeposit(lead.id)
  await open(year, className, "A", "Mixed", 1)

  await signIn(page, MANAGER)
  await page.goto(`/staff/seats?year=${year}`)
  const waiting = page.getByRole("listitem").filter({ hasText: lead.name })
  await expect(waiting).toContainText(`${className} · Deposit since`)
  await expect(page.getByRole("main")).toContainText("Waiting for a stream")
  const link = waiting.getByRole("link", { name: `Decline ${lead.name}: No seat available` })
  await expect(link).toHaveText("Decline: No seat available")
  await link.click()

  // The lead screen opens Decline with No seat available chosen.
  await expect(page).toHaveURL(new RegExp(`/staff/applicants/${lead.id}\\?decline=No\\+seat\\+available$`))
  const dialog = page.getByRole("dialog", { name: `Decline ${lead.name}`, exact: true })
  await expect(dialog.getByLabel("Reason")).toHaveText("No seat available")
  await dialog.getByRole("button", { name: "Continue" }).click()

  const confirm = page.getByRole("dialog", { name: `Decline ${lead.name}?`, exact: true })
  await expect(confirm).toContainText("No seat available")
  await confirm.getByRole("button", { name: "Decline application" }).click()

  const banner = page.getByRole("region", { name: "This application is Declined" })
  await expect(banner).toContainText("No seat available")
  await expect(banner).toContainText(MANAGER.name)
  // The link's reason leaves the address, so a reload after a later
  // reopening doesn't open Decline again.
  await expect(page).toHaveURL(new RegExp(`/staff/applicants/${lead.id}$`))

  // She waits no more: nobody waits for a stream, and the stream is as full
  // as it was.
  await page.goto(`/staff/seats?year=${year}`)
  const stream = page.getByRole("list", { name: `${className} streams` }).getByRole("listitem")
  await expect(stream).toContainText("1 of 1")
  await expect(page.getByText(lead.name)).toHaveCount(0)
  await expect(page.getByRole("main").getByText("Waiting for a stream")).toHaveCount(0)
})

test("a decline link opens nothing for staff who can't use its reason", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const lead = await pupil(fixture.year, fixture.className, "Girl")
  await payDeposit(lead.id)

  // Admissions Staff may decline, but not with No seat available.
  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/applicants/${lead.id}?decline=No+seat+available`)
  await expect(page.getByRole("heading", { name: lead.name })).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(await moreActions(page)).toContain("Decline")
})
