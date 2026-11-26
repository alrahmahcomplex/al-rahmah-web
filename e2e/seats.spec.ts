import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"
import { chooseOption } from "./kit-parts"

import { ACCOUNTANT, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"
import { open, payDeposit, pupil, streamYear, yesterday, type StreamYear } from "./streams"

// Seats in streams (#449): a child no stream can take can't pay the school
// fee; the Accountant asks for a stream, the Manager opens one on Seats, and
// the payment then places the child. The test claims a year of its own
// (e2e/streams.ts), so the seeded streams are left alone.

let years: StreamYear[] = []

test.afterEach(async () => {
  await Promise.all(years.map((each) => each.done()))
  years = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.context().clearCookies()
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("a child no stream can take can't pay until the Manager opens a stream, and the payment then places him", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const { year, className } = fixture

  // One stream for boys with one seat, taken by a boy who paid yesterday.
  await open(year, className, "A", "Boys", 1)
  const seated = await pupil(year, className, "Boy")
  await payDeposit(seated.id, yesterday)
  const boy = await pupil(year, className, "Boy")

  // The Accountant can't record his school fee, and asks for a stream.
  await signIn(page, ACCOUNTANT)
  await page.goto(leadUrl(boy.id, "School fee"))
  const section = page.getByRole("region", { name: "School fee" })
  await expect(section).toContainText(
    `No stream can take him yet. ${className} A (Boys) is full. A new ${className} stream for boys must be opened before his school fee can be recorded.`,
  )
  await expect(section).toContainText("The interview fee can still be recorded while the streams are full.")
  await expect(section.getByRole("button", { name: "Record payment" })).toHaveCount(0)
  await section.getByRole("button", { name: "Send a request to open a new stream" }).click()
  await expect(section.getByRole("button", { name: "Request sent" })).toBeDisabled()

  // The Manager sees the full stream and who asked, and opens a second one.
  await signIn(page, MANAGER)
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Seats", exact: true })).toHaveAttribute("href", "/staff/seats")
  await page.goto(`/staff/seats?year=${year}`)
  await expect(page.getByRole("heading", { level: 1, name: "Seats" })).toBeVisible()
  const streams = page.getByRole("list", { name: `${className} streams` }).getByRole("listitem")
  await expect(streams).toHaveCount(1)
  await expect(streams.first()).toContainText(`${className} A`)
  await expect(streams.first()).toContainText("Full")
  await expect(streams.first()).toContainText("1 of 1")
  const main = page.getByRole("main")
  await expect(main).toContainText(`Open a new ${className} stream for boys. ${className} A (Boys) is full.`)
  await expect(main).toContainText(`${boy.name} can’t pay his school fee until a stream takes him.`)

  await main.getByRole("button", { name: `Open a new ${className} stream` }).click()
  const sheet = page.getByRole("dialog", { name: `Open a new ${className} stream` })
  // Filled in for boys: the next free label after A.
  await expect(sheet.getByLabel("Label", { exact: true })).toHaveValue("B")
  await sheet.getByLabel("Seats for new students").fill("2")
  await sheet.getByRole("button", { name: "Open the stream" }).click()
  await expect(page.getByRole("status").filter({ hasText: `${className} B (Boys) is open with 2 seats.` })).toBeVisible()
  await expect(streams).toHaveCount(2)
  await expect(streams.nth(1)).toContainText(`${className} B`)
  await expect(streams.nth(1)).toContainText("2 free")
  await expect(main.getByText(`Open a new ${className} stream for boys.`)).toHaveCount(0)

  // The payment now goes through, and places him in the new stream.
  await signIn(page, ACCOUNTANT)
  await page.goto(leadUrl(boy.id, "School fee"))
  await expect(section).toContainText(
    `His seat will be in ${className} B (Boys), the first stream for boys with a free seat. A seat is booked once the deposit is paid.`,
  )
  await section.getByRole("button", { name: "Record payment" }).click()
  const form = page.getByRole("form", { name: "Record payment" })
  await chooseOption(form.getByLabel("Payment type"), "Initial deposit")
  await form.getByLabel("Amount (TZS)").fill("300,000")
  await form.getByRole("button", { name: "Review payment" }).click()
  const review = page.getByRole("region", { name: "Review payment" })
  await expect(review.getByRole("alert", { name: "Class full" })).toHaveCount(0)
  await review.getByRole("button", { name: "Confirm payment" }).click()
  await expect(section.getByRole("status")).toHaveText(`Deposit recorded. Placed automatically in ${className} B (Boys).`)
})

// Who a stream takes (owner 2026-11-26, prototype v4): the Manager turns a
// Mixed stream into a boys' stream and opens a girls' stream in the same save.
test("the Manager changes a Mixed stream to Boys and opens a girls' stream for the girl in it", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const { year, className } = fixture

  await open(year, className, "A", "Mixed", 2)
  const boy = await pupil(year, className, "Boy")
  await payDeposit(boy.id, yesterday)
  const girl = await pupil(year, className, "Girl")
  await payDeposit(girl.id, yesterday)

  await signIn(page, MANAGER)
  await page.goto(`/staff/seats?year=${year}`)
  const streams = page.getByRole("list", { name: `${className} streams` }).getByRole("listitem")
  await expect(streams.first()).toContainText("1 boy · 1 girl")

  await page.getByRole("button", { name: `Change ${className} A` }).click()
  const sheet = page.getByRole("dialog", { name: `Change ${className} A` })
  const choose = (name: string | RegExp) => sheet.locator("label").filter({ has: page.getByRole("radio", { name, exact: typeof name === "string" }) }).click()
  await choose("Boys")
  await expect(sheet.getByRole("heading", { name: "1 girl has to move" })).toBeVisible()
  await choose(/Open a new stream for girl/)
  // The girls may have an A of their own: it doesn't clash with the boys' A.
  await expect(sheet.getByLabel("Label", { exact: true }).nth(1)).toHaveValue("A")
  await sheet.getByLabel("Seats", { exact: true }).nth(1).fill("1")
  await sheet.getByRole("button", { name: "Save and move 1 girl" }).click()

  await expect(
    page.getByRole("status").filter({ hasText: `${className} A (Boys) now takes boys. 1 girl moved to ${className} A (Girls). ${className} A (Girls) is open.` }),
  ).toBeVisible()
  await expect(streams).toHaveCount(2)
  await expect(streams.first()).toContainText("1 boy")
  await expect(streams.first()).not.toContainText("girl")
  await expect(streams.nth(1)).toContainText("Girls")
  await expect(streams.nth(1)).toContainText("1 girl")
})
