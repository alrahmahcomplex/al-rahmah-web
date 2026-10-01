import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { createLead, getLead } from "@/lib/services/leads"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Correcting a lead on the lead screen, as staff do. Each test registers its
// own family, so the seeded leads other tests read stay as they are.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

function nineDigits() {
  return `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A family registered at the front desk: one child, or siblings on one contact.
async function family(children = 1) {
  const staff = await signedIn(ADMISSIONS)
  const suffix = randomUUID().slice(0, 6)
  const leads: { id: string; admissionNumber: string; name: string }[] = []
  let contactId: string | undefined
  for (let i = 0; i < children; i++) {
    const name = `${["Asha", "Bakari", "Chausiku"][i]} Edit ${suffix}`
    const created = await createLead(staff, {
      guardian: contactId
        ? { contactId }
        : { contact: { fullName: `Parent ${suffix}`, relationship: "Father", phone: `0${nineDigits()}` } },
      student: { fullName: name, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    if (!contactId) {
      const lead = await getLead(staff, created.data.leadId)
      if (!lead.ok) throw new Error("setup failed")
      contactId = lead.data.contact.id
    }
    leads.push({ id: created.data.leadId, admissionNumber: created.data.admissionNumber, name })
  }
  return leads
}

function detail(page: Page, section: "Student" | "Parent or guardian", term: string) {
  return page.getByRole("region", { name: section }).locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]")
}

test.describe("correcting a lead", () => {
  test("Admissions Staff correct the class, and the lead screen shows it", async ({ page }) => {
    const [lead] = await family()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)

    await page.getByRole("button", { name: "Edit student" }).click()
    const form = page.getByRole("form", { name: "Edit student" })
    await expect(form.getByLabel("Class")).toHaveValue("STD 3")
    await form.getByLabel("Class").selectOption("STD 4")
    await form.getByRole("button", { name: "Save" }).click()

    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Student details saved.")
    await expect(detail(page, "Student", "Class")).toHaveText("STD 4")
    // The Admission Number is never offered for editing, and stays.
    await expect(page.getByLabel("Admission Number")).toHaveText(lead.admissionNumber)

    await page.reload()
    await expect(detail(page, "Student", "Class")).toHaveText("STD 4")
  })

  test("a shared contact names the children it reaches before saving, and the change shows on each", async ({ page }) => {
    const [first, second, third] = await family(3)
    const digits = nineDigits()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${first.id}`)

    await page.getByRole("button", { name: "Edit parent or guardian" }).click()
    const form = page.getByRole("form", { name: "Edit parent or guardian" })
    const warning = form.getByText("This parent or guardian is shared with 2 other children.")
    await expect(warning).toBeVisible()
    for (const sibling of [second, third]) {
      await expect(form.getByRole("listitem").filter({ hasText: sibling.name })).toContainText(sibling.admissionNumber)
    }
    await expect(form.getByRole("listitem").filter({ hasText: first.name })).toHaveCount(0)

    await form.getByLabel("Phone").fill(`0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`)
    await form.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("region", { name: "Parent or guardian" }).getByRole("status")).toHaveText("Parent or guardian saved for every child on this contact.")
    await expect(detail(page, "Parent or guardian", "Phone")).toHaveText(`+255${digits}`)

    for (const sibling of [second, third]) {
      await page.goto(`/staff/leads/${sibling.id}`)
      await expect(detail(page, "Parent or guardian", "Phone")).toHaveText(`+255${digits}`)
    }
  })

  test("a correction that would make a duplicate is refused, and links to that lead", async ({ page }) => {
    const [existing] = await family()
    const [other] = await family()
    const staff = await signedIn(ADMISSIONS)
    const existingLead = await getLead(staff, existing.id)
    if (!existingLead.ok) throw new Error("setup failed")

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${other.id}`)
    await page.getByRole("button", { name: "Edit student" }).click()
    await page.getByLabel("Student's full name").fill(existing.name)
    await page.getByRole("button", { name: "Save" }).click()
    // Same name, different parent: not a duplicate.
    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Student details saved.")

    await page.getByRole("button", { name: "Edit parent or guardian" }).click()
    await page.getByLabel("Phone").fill(existingLead.data.contact.phone)
    await page.getByRole("button", { name: "Save" }).click()
    const refusal = page.getByRole("form", { name: "Edit parent or guardian" }).getByRole("alert")
    await expect(refusal).toContainText("would make the student a duplicate of")
    await refusal.getByRole("link", { name: existing.admissionNumber }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${existing.id}$`))
  })

  test("the Visit date can be moved earlier, never later than today", async ({ page }) => {
    const [lead] = await family()
    const earlier = new Date(`${today}T00:00:00Z`)
    earlier.setUTCDate(earlier.getUTCDate() - 4)
    const earlierDate = earlier.toISOString().slice(0, 10)

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await page.getByRole("button", { name: "Correct Visit date" }).click()
    const input = page.getByLabel("Visit date", { exact: true })
    await expect(input).toHaveAttribute("max", today)
    await input.fill(earlierDate)
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("region", { name: "Student" }).getByRole("status")).toHaveText("Visit date saved.")
    await expect(detail(page, "Student", "Visit date")).toHaveText(formatDate(earlierDate))
  })

  test("an Accountant sees the lead with no edit actions", async ({ page }) => {
    const [lead] = await family()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)

    await expect(page.getByRole("heading", { name: lead.name, level: 1 })).toBeVisible()
    for (const name of ["Edit student", "Correct Visit date", "Edit parent or guardian"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }
  })

  test("closed leads offer no corrections", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    // The seeded Archived lead, Hamisi Fixture.
    await page.goto("/staff/leads/1ead0000-0000-4000-8000-000000000005")
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
    for (const name of ["Edit student", "Correct Visit date", "Edit parent or guardian"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }
  })
})
