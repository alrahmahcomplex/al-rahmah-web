import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { chooseMore, moreActions } from "./lead-page"
import { logIn } from "./log-in"

// Marking a lead Inactive or Archived from the lead screen (#98). Each test
// marks a lead of its own; the seeded ones are only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's Archived lead, and slice 8's Inactive lead and lead both Declined
// and Archived.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const INACTIVE = "1ead0000-0000-4000-8000-000000000083"
const DECLINED_AND_ARCHIVED = "1ead0000-0000-4000-8000-000000000084"

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// A walk-in lead of the test's own: Visited.
async function newLead() {
  const name = `Mark ${randomUUID().slice(0, 6)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Mark Parent", relationship: "Mother", phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: name, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return { id: created.data.leadId, name, admissionNumber: created.data.admissionNumber }
}


test.describe("marking a lead", () => {
  test("Admissions Staff mark an open lead inactive, and then only Archive is left", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/applicants/${lead.id}`)

    expect(await moreActions(page)).toEqual(["Mark inactive", "Archive", "Decline"])
    await chooseMore(page, "Mark inactive")
    const dialog = page.getByRole("dialog", { name: `Mark ${lead.name} inactive`, exact: true })
    await expect(dialog).toContainText("keeps its status, Visited")
    await dialog.getByRole("button", { name: "Mark inactive" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Choose a reason.")

    await dialog.getByLabel("Reason").selectOption("No longer pursuing admission")
    await dialog.getByLabel("Note").fill("Waiting to hear about a job transfer.")
    await dialog.getByRole("button", { name: "Mark inactive" }).click()

    const banner = page.getByRole("region", { name: "This lead is Inactive" })
    await expect(banner).toContainText("No longer pursuing admission")
    await expect(banner).toContainText("Waiting to hear about a job transfer.")
    await expect(banner).toContainText(ADMISSIONS.name)
    await expect(page.getByText("Visited", { exact: true }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Edit student" })).toHaveCount(0)
    expect(await moreActions(page)).toEqual(["Request reopening", "Archive"])

    await openLeadHistoryAsSuperAdmin(page)
    await expect(page.getByText("marked the lead Inactive").first()).toBeVisible()
  })

  test("the Manager archives a Declined lead, and the banner shows the decline and the mark", async ({ page }) => {
    const lead = await newLead()
    await declineLead(await signedIn(ADMISSIONS), lead.id, { reason: "Enrolled elsewhere" })
    await signIn(page, MANAGER)
    await page.goto(`/staff/applicants/${lead.id}`)

    await expect(page.getByRole("region", { name: "This lead is Declined" })).toBeVisible()
    expect(await moreActions(page)).toEqual(expect.arrayContaining(["Mark inactive", "Archive"]))
    await chooseMore(page, "Archive")
    const dialog = page.getByRole("dialog", { name: `Archive ${lead.name}`, exact: true })
    await dialog.getByLabel("Reason").selectOption("Admission cycle ended")
    await dialog.getByRole("button", { name: "Archive" }).click()

    const banner = page.getByRole("region", { name: "This lead is Declined and Archived" })
    await expect(banner).toContainText("Enrolled elsewhere")
    await expect(banner).toContainText("Admission cycle ended")
    await expect(banner).toContainText(MANAGER.name)
    expect(await moreActions(page)).not.toContain("Archive")
  })

  test("Cancel leaves the lead as it was", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/applicants/${lead.id}`)

    await chooseMore(page, "Archive")
    const dialog = page.getByRole("dialog", { name: `Archive ${lead.name}`, exact: true })
    await dialog.getByLabel("Reason").selectOption("Duplicate record")
    await dialog.getByRole("button", { name: "Cancel" }).click()

    await page.reload()
    expect(await moreActions(page)).toContain("Archive")
    await expect(page.getByRole("region", { name: /^This lead is/ })).toHaveCount(0)
  })

  test("the Accountant gets neither action, and an Archived lead offers none", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/applicants/${lead.id}`)
    await expect(page.getByRole("heading", { name: lead.name })).toBeVisible()
    expect(await moreActions(page)).toEqual([])

    await page.context().clearCookies()
    await signIn(page, ADMISSIONS)
    for (const id of [ARCHIVED, DECLINED_AND_ARCHIVED]) {
      await page.goto(`/staff/applicants/${id}`)
      await expect(page.getByRole("region", { name: /^This lead is .*Archived$/ })).toBeVisible()
      const offered = await moreActions(page)
      expect(offered).not.toContain("Mark inactive")
      expect(offered).not.toContain("Archive")
    }
  })

  test("the seeded Inactive lead shows its reason, note, who and when, and offers Archive alone", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/applicants/${INACTIVE}`)
    const banner = page.getByRole("region", { name: "This lead is Inactive" })
    await expect(banner).toContainText("No longer pursuing admission")
    await expect(banner).toContainText("waiting to hear about a job transfer")
    await expect(banner).toContainText(ADMISSIONS.name)
    await expect(banner).toContainText(/18 Sept? 2026/)
    const offered = await moreActions(page)
    expect(offered).toContain("Archive")
    expect(offered).not.toContain("Mark inactive")
  })
})
