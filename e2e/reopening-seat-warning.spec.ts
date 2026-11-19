import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { declineLead } from "@/lib/services/lead-closure"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"
import { open, payDeposit, pupil, streamYear, yesterday, type StreamYear } from "./streams"

// Approving a Reopening request when no stream has a free seat (#103, #449):
// the approval goes through, and the child waits for a stream. The test
// claims a year of its own (e2e/streams.ts), so the seeded streams are left
// alone.

let years: StreamYear[] = []

test.afterEach(async () => {
  await Promise.all(years.map((each) => each.done()))
  years = []
})

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("approving a reopening when no stream has room still approves, and the child waits for a stream", async ({ page }) => {
  const fixture = await streamYear()
  years.push(fixture)
  const { year, className } = fixture

  // Two boys paid the deposit; one was declined since and asks to come
  // back. The class's one stream has one seat, which the other boy holds.
  const seated = await pupil(year, className, "Boy")
  await payDeposit(seated.id, yesterday)
  const lead = await pupil(year, className, "Boy")
  await payDeposit(lead.id)
  const declined = await declineLead(await signedIn(MANAGER), lead.id, { reason: "Fees or cost" })
  if (!declined.ok) throw new Error(declined.error)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead.id, { reason: "A sponsor will pay the fee.", source: "lead" })
  if (!raised.ok) throw new Error(JSON.stringify(raised.error))
  await open(year, className, "A", "Mixed", 1)

  await signIn(page, MANAGER)
  await page.goto(`/staff/applicants/${lead.id}`)
  const panel = page.getByRole("region", { name: "Reopening requests" })
  await panel.getByRole("group", { name: "Pending reopening request" }).getByRole("button", { name: "Approve" }).click()

  // The old count's warning is gone: nothing holds the approval back.
  const dialog = page.getByRole("dialog", { name: `Approve reopening ${lead.name}?` })
  await expect(dialog.getByRole("button", { name: "Approve and reopen" })).toBeVisible()
  await expect(dialog.getByRole("alert", { name: "Class full" })).toHaveCount(0)
  await dialog.locator("label").filter({ hasText: "Enrol without a retaken interview" }).click()
  await dialog.getByRole("button", { name: "Approve and reopen" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("region", { name: /^This application is/ })).toHaveCount(0)
  await expect(panel).toContainText(`Approved by ${MANAGER.name}`)

  // He has his Seat priority back and no seat: the School fee says he waits.
  await page.goto(leadUrl(lead.id, "School fee"))
  await expect(page.getByRole("region", { name: "School fee" })).toContainText(
    `No stream can take him yet. He will wait until a ${className} stream for boys opens or a seat frees. He keeps his Seat priority and can keep paying.`,
  )

  // Seats lists him as waiting, behind the full stream.
  await page.goto(`/staff/seats?year=${year}`)
  await expect(page.getByRole("main")).toContainText("Waiting for a stream")
  await expect(page.getByRole("listitem").filter({ hasText: lead.name })).toContainText(`${className} · Deposit since`)
  await expect(page.getByRole("list", { name: `${className} streams` }).getByRole("listitem")).toContainText("1 of 1")
})
