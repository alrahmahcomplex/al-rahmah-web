import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { approveReopeningRequest, declineLead } from "@/lib/services/lead-closure"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// A reopened lead that needs a follow-up date (#95): the seeded one shows in
// Overdue as Needs a follow-up date and its lead screen says so, until staff
// schedule a follow-up.

test.describe.configure({ mode: "serial" })

// Slice 7's seeded reopened lead, ADMSN-90070, approved 3 days before the
// seed ran.
const REOPENED = { id: "1ead0000-0000-4000-8000-000000000070", name: "Amani Rejea" }

const today = tanzaniaToday()

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// Scheduling clears the need for good, so a later run would find nothing to
// clear. Afterwards the lead is declined and reopened again, which closes the
// follow-up this test planned and leaves it needing a date once more.
test.afterAll(async () => {
  const followUps = await getLeadFollowUps(await signedIn(ADMISSIONS), REOPENED.id)
  if (!followUps.ok || (followUps.data.needsDate && !followUps.data.open)) return
  const declined = await declineLead(await signedIn(MANAGER), REOPENED.id, { reason: "Family changed plans" })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), REOPENED.id, {
    reason: "The family moved back to Dar and wants a place again.",
    source: "lead",
  })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data)
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const overdueList = (page: Page) => page.getByRole("list", { name: "Overdue follow-ups" })
const reopenedRow = (page: Page) => overdueList(page).getByRole("listitem").filter({ hasText: REOPENED.name })
const banner = (page: Page) => page.getByRole("note").filter({ hasText: "Reopened: set the next follow-up date" })

// Overdue may run to several pages; finds the page holding the reopened lead.
async function openOverdueWithReopened(page: Page) {
  for (let overdue = 1; ; overdue++) {
    await page.goto(`/staff/follow-ups?overdue=${overdue}`)
    if ((await reopenedRow(page).count()) > 0) return
    const next = page.getByRole("navigation", { name: "Overdue pages" }).getByRole("link", { name: "Next" })
    if ((await next.count()) === 0) throw new Error(`${REOPENED.name} is not in Overdue`)
  }
}

test("the seeded reopened lead shows as Needs a follow-up date until a follow-up is scheduled", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await openOverdueWithReopened(page)

  // The nav badge shows Overdue's count. Browser tests running alongside
  // plant overdue follow-ups too, so the exact count is the integration
  // tests' to check (tests/integration/follow-up-needs-date.test.ts).
  const nav = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Follow-ups/ })
  await expect(nav).toHaveAccessibleName(/^Follow-ups ?, [1-9]\d* overdue$/)

  const row = reopenedRow(page)
  await expect(row).toHaveCount(1)
  await expect(row).toContainText("Needs a follow-up date")
  await expect(row).toContainText("Reopened")
  await expect(row).toContainText("Zainabu Rejea")

  await row.getByRole("link", { name: REOPENED.name }).click()
  await expect(page).toHaveURL(new RegExp(`/staff/leads/${REOPENED.id}#lead-follow-ups$`))
  const panel = page.getByRole("region", { name: "Follow-ups" })
  await expect(banner(page)).toBeVisible()
  await expect(panel).toContainText("No follow-up scheduled.")

  await panel.getByRole("button", { name: "Schedule follow-up" }).click()
  const schedule = page.getByRole("dialog", { name: "Schedule follow-up" })
  await schedule.getByLabel("Follow-up date").fill(addDays(today, 2))
  await schedule.getByRole("button", { name: "Schedule follow-up" }).click()

  await expect(panel.getByRole("status")).toHaveText(`Follow-up scheduled for ${formatDate(addDays(today, 2))}.`)
  await expect(banner(page)).toHaveCount(0)

  // Gone from every page of Overdue.
  for (let overdue = 1; ; overdue++) {
    await page.goto(`/staff/follow-ups?overdue=${overdue}`)
    await expect(reopenedRow(page)).toHaveCount(0)
    const next = page.getByRole("navigation", { name: "Overdue pages" }).getByRole("link", { name: "Next" })
    if ((await next.count()) === 0) break
  }
})
