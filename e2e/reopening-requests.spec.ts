import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"

import { signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Raising and withdrawing a Reopening request (#99). Each test raises on a
// Declined lead of its own; the seeded Pending request on ADMSN-90080, raised
// by Test Admissions, is only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

const SEEDED_PENDING_LEAD = "1ead0000-0000-4000-8000-000000000080"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in lead of the test's own, declined.
async function declinedLead() {
  const family = {
    parent: `Reopen Parent ${randomUUID().slice(0, 6)}`,
    // A leading 4 keeps it clear of the seeded 700 000 numbers.
    phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    child: `Reopen ${randomUUID().slice(0, 6)}`,
  }
  const staff = await signedIn(ADMISSIONS)
  const created = await createLead(staff, {
    guardian: { contact: { fullName: family.parent, relationship: "Mother", phone: family.phone } },
    student: { fullName: family.child, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const declined = await declineLead(staff, created.data.leadId, { reason: "Family changed plans" })
  if (!declined.ok) throw new Error(`setup failed: ${declined.error}`)
  return { id: created.data.leadId, ...family }
}

const banner = (page: Page) => page.getByRole("region", { name: "This lead is Declined" })
const panel = (page: Page) => page.getByRole("region", { name: "Reopening requests" })

test.describe("raising a reopening request", () => {
  test("from the lead screen: the reason is required, and the lead then shows the Pending request", async ({ page }) => {
    const lead = await declinedLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(panel(page)).toHaveCount(0)

    await banner(page).getByRole("link", { name: "Request reopening" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}/reopen\\?source=lead$`))
    await expect(page.getByRole("heading", { name: lead.child, level: 1 })).toBeVisible()

    await page.getByRole("button", { name: "Send request" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Write why the family is back." })).toBeVisible()
    await expect(page.getByLabel("Why is the family back?")).toHaveAttribute("aria-invalid", "true")

    await page.getByLabel("Why is the family back?").fill("The family moved back to Dar and wants a place in January.")
    await page.getByRole("button", { name: "Send request" }).click()

    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}$`))
    const pending = panel(page).getByRole("group", { name: "Pending reopening request" })
    await expect(pending).toContainText("Requested by you")
    await expect(pending).toContainText("From the lead screen.")
    await expect(pending).toContainText("The family moved back to Dar and wants a place in January.")
    await expect(pending.getByRole("button", { name: "Withdraw" })).toBeVisible()
    // Asked once is enough: the banner stops offering it.
    await expect(banner(page).getByRole("link", { name: "Request reopening" })).toHaveCount(0)

    await page.getByRole("link", { name: "History" }).click()
    await expect(page.getByText("requested reopening").first()).toBeVisible()
  })

  test("from the front desk's Family hand-off", async ({ page }) => {
    const lead = await declinedLead()
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/check-in/new")
    await page.getByLabel("Full name").fill("Someone typed")
    await page.getByLabel("Relationship to the student").selectOption("Mother")
    await page.getByLabel("Phone", { exact: true }).fill(lead.phone)
    await page.getByRole("button", { name: "Continue" }).click()

    await page.getByRole("group", { name: lead.parent }).getByRole("button", { name: "Same person" }).click()
    await page.getByRole("row", { name: new RegExp(lead.child) }).getByRole("link", { name: `Reopening request for ${lead.child}` }).click()

    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}/reopen\\?source=duplicate_match$`))
    await expect(page.getByText("This student is already on file, so no new record was made.")).toBeVisible()
    await page.getByLabel("Why is the family back?").fill("The mother came to the front desk to re-register her son.")
    await page.getByRole("button", { name: "Send request" }).click()

    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}$`))
    const pending = panel(page).getByRole("group", { name: "Pending reopening request" })
    await expect(pending).toContainText("From the duplicate match at the front desk.")
    await expect(pending).toContainText("The mother came to the front desk to re-register her son.")
  })

  test("a second staff member sees who already asked, instead of the form", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto(`/staff/leads/${SEEDED_PENDING_LEAD}/reopen?source=lead`)

    await expect(page.getByRole("status")).toHaveText(
      "Reopening already requested by Test Admissions on 28 Sept 2026. A Manager will approve or reject it.",
    )
    await expect(page.getByLabel("Why is the family back?")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Send request" })).toHaveCount(0)

    // On the lead, the Pending request shows without Withdraw for anyone but
    // its requester.
    await page.goto(`/staff/leads/${SEEDED_PENDING_LEAD}`)
    const pending = panel(page).getByRole("group", { name: "Pending reopening request" })
    await expect(pending).toContainText("Requested by Test Admissions on 28 Sept 2026")
    await expect(pending.getByRole("button", { name: "Withdraw" })).toHaveCount(0)
  })
})

test.describe("withdrawing a reopening request", () => {
  test("the requester withdraws, the request stays listed, and a new one can be sent", async ({ page }) => {
    const lead = await declinedLead()
    const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead.id, {
      reason: "The family asked about a place.",
      source: "lead",
    })
    if (!raised.ok) throw new Error(`setup failed: ${JSON.stringify(raised.error)}`)

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await panel(page).getByRole("button", { name: "Withdraw" }).click()
    const confirm = page.getByRole("alertdialog", { name: "Withdraw your reopening request?" })
    await confirm.getByRole("button", { name: "Withdraw request" }).click()

    await expect(panel(page).getByRole("group", { name: "Pending reopening request" })).toHaveCount(0)
    await expect(panel(page)).toContainText(`Withdrawn by ${ADMISSIONS.name}`)
    await expect(panel(page)).toContainText("The family asked about a place.")

    await banner(page).getByRole("link", { name: "Request reopening" }).click()
    await page.getByLabel("Why is the family back?").fill("They asked again after the holidays.")
    await page.getByRole("button", { name: "Send request" }).click()

    await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}$`))
    await expect(panel(page).getByRole("group", { name: "Pending reopening request" })).toContainText(
      "They asked again after the holidays.",
    )
    await expect(panel(page)).toContainText(`Withdrawn by ${ADMISSIONS.name}`)

    await page.getByRole("link", { name: "History" }).click()
    await expect(page.getByText("withdrew the reopening request")).toBeVisible()
  })
})
