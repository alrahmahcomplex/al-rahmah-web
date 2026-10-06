import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { asSystem, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Approving and rejecting a Reopening request from the lead (#101). Each test
// decides a request on a Declined lead of its own, raised by Test Admissions.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in lead of the test's own, Interviewed when asked, then declined,
// with a Pending request from Test Admissions.
async function requestedLead({ interviewed }: { interviewed: boolean }) {
  const child = `Decide ${randomUUID().slice(0, 6)}`
  const staff = await signedIn(ADMISSIONS)
  const created = await createLead(staff, {
    guardian: {
      // A leading 3 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Decide Parent", relationship: "Father", phone: `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: child, className: "STD 5", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  if (interviewed) {
    await asSystem((sql) => sql.query("update public.leads set status = 'Interviewed' where id = $1", [id]))
  }
  const declined = await declineLead(staff, id, { reason: "Fees or cost" })
  if (!declined.ok) throw new Error(`setup failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(staff, id, { reason: "The family found a sponsor for the fees.", source: "lead" })
  if (!raised.ok) throw new Error(`setup failed: ${JSON.stringify(raised.error)}`)
  return { id, child }
}

const panel = (page: Page) => page.getByRole("region", { name: "Reopening requests" })
const pending = (page: Page) => panel(page).getByRole("group", { name: "Pending reopening request" })

test("a Manager approves from the lead, choosing to enrol without a retaken interview", async ({ page }) => {
  const lead = await requestedLead({ interviewed: true })
  await signIn(page, MANAGER)
  await page.goto(`/staff/leads/${lead.id}`)

  await expect(pending(page)).toContainText("Requested by Test Admissions")
  await pending(page).getByRole("button", { name: "Approve" }).click()

  const dialog = page.getByRole("dialog", { name: `Approve reopening ${lead.child}?` })
  await expect(dialog).toContainText("The lead goes back to Interviewed.")
  await dialog.getByRole("button", { name: "Approve and reopen" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Choose whether the lead retakes the interview.")

  await dialog.getByLabel("Enrol without a retaken interview").check()
  await dialog.getByRole("button", { name: "Approve and reopen" }).click()
  await expect(dialog).toHaveCount(0)

  // Open again: no banner, the Interviewed status, the tag and the note.
  await expect(page.getByRole("region", { name: /^This lead is/ })).toHaveCount(0)
  await expect(page.getByText("Initially declined", { exact: true })).toBeVisible()
  const note = page.getByRole("region", { name: "Reopened after decline" })
  await expect(note).toContainText(`Approved by ${MANAGER.name} on`)
  await expect(note).toContainText("Enrol without a retaken interview.")
  await expect(pending(page)).toHaveCount(0)
  await expect(panel(page)).toContainText(`Approved by ${MANAGER.name}`)
  await expect(panel(page)).toContainText("Reopened from Declined as Interviewed. Enrol without a retaken interview.")

  // The lead list shows the tag beside the status.
  await page.goto(`/staff/leads?q=${encodeURIComponent(lead.child)}`)
  const row = page.getByRole("row", { name: new RegExp(lead.child) })
  await expect(row.getByText("Interviewed", { exact: true })).toBeVisible()
  await expect(row.getByText("Initially declined", { exact: true })).toBeVisible()

  await page.goto(`/staff/leads/${lead.id}/history`)
  await expect(page.getByText("reopened the lead from Declined").first()).toBeVisible()
  await expect(page.getByText("approved the reopening request").first()).toBeVisible()
})

test("a Manager rejects with a reason, and the requester reads it on the lead", async ({ page, browser }) => {
  const lead = await requestedLead({ interviewed: false })
  await signIn(page, MANAGER)
  await page.goto(`/staff/leads/${lead.id}`)

  await pending(page).getByRole("button", { name: "Reject" }).click()
  const dialog = page.getByRole("dialog", { name: `Reject reopening ${lead.child}?` })
  await dialog.getByRole("button", { name: "Reject request" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Write why the request is rejected.")
  await dialog.getByLabel("Why is it rejected?").fill("The sponsor letter is missing. Bring it to the office first.")
  await dialog.getByRole("button", { name: "Reject request" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(pending(page)).toHaveCount(0)

  const requester = await browser.newPage()
  try {
    await signIn(requester, ADMISSIONS)
    await requester.goto(`/staff/leads/${lead.id}`)
    // Still closed, with the outcome under the requests.
    await expect(requester.getByRole("region", { name: "This lead is Declined" })).toBeVisible()
    await expect(panel(requester)).toContainText(`Rejected by ${MANAGER.name}`)
    await expect(panel(requester)).toContainText("Reason for rejecting: The sponsor letter is missing. Bring it to the office first.")
    // No decision buttons for staff who may not approve.
    await expect(panel(requester).getByRole("button", { name: "Approve" })).toHaveCount(0)
  } finally {
    await requester.close()
  }
})
