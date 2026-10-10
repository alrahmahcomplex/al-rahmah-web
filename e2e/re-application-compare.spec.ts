import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { secretClient } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Comparing a Re-application with its lead and acting on it (#78): the side by
// side view with its highlights, Apply on a differing class and phone, and
// Request reopening on the seeded Archived lead. The Apply tests record a
// lead and a re-application of their own, so reruns never meet a field an
// earlier run applied.

const nextYear = admissionYears()[1]

// The seeded Archived lead (00_base.sql), re-applied for in 30_admission_form.sql.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A leading 7 keeps it clear of the seeded 700 000 numbers.
const localPhone = () => `07${String(randomInt(10_000_000, 100_000_000))}`
const spaced = (local: string) => `+255 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`

// A lead from the Admission form, then the same child sent again asking for
// STD 4 from a new phone: the class and the phone differ.
async function reApplied() {
  const studentName = `Mtoto Linganisha ${randomUUID().slice(0, 6)}`
  const phone = localPhone()
  const newPhone = localPhone()
  const contact = { full_name: "Mama Linganisha", relationship: "Mother", phone }
  const student = { full_name: studentName, class_name: "STD 3", enrollment_year: nextYear, day_or_boarding: "Day" }
  const supabase = secretClient()

  const created = await supabase.rpc("create_lead", {
    start_kind: "admission_form",
    existing_contact_id: null,
    new_contact: contact,
    student_details: student,
  })
  if (created.error || created.data?.result !== "created") throw new Error(`could not create a lead: ${created.error?.message}`)
  const recorded = await supabase.rpc("record_re_application", {
    lead_id: created.data.lead_id,
    submission_key: randomUUID(),
    submitted: { contact: { ...contact, phone: newPhone }, student: { ...student, class_name: "STD 4" } },
  })
  if (recorded.error) throw new Error(`could not record a re-application: ${recorded.error.message}`)
  return {
    id: recorded.data as string,
    leadId: created.data.lead_id as string,
    studentName,
    phone: spaced(phone),
    newPhone: spaced(newPhone),
  }
}

const comparison = (page: Page) => page.getByRole("table", { name: "Compared with the lead" })
const row = (page: Page, field: string) => comparison(page).getByRole("row", { name: new RegExp(`^${field}`) })

test.describe("comparing a re-application with its lead", () => {
  test("Admissions Staff see the differences side by side and Apply the class and the phone", async ({ page }) => {
    const mine = await reApplied()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/re-applications/${mine.id}`)

    // Side by side, the differing fields highlighted: as many as the queue counts.
    await expect(page.getByRole("main")).toContainText("2 fields differ from the lead.")
    await expect(comparison(page).getByText("Differs")).toHaveCount(2)
    await expect(row(page, "Class")).toContainText("STD 3")
    await expect(row(page, "Class")).toContainText("STD 4")
    await expect(row(page, "Class")).toContainText("Differs")
    await expect(row(page, "Phone")).toContainText(mine.phone)
    await expect(row(page, "Phone")).toContainText(mine.newPhone)
    await expect(row(page, "Student name")).not.toContainText("Differs")
    await expect(comparison(page).getByRole("button", { name: /^Apply/ })).toHaveCount(2)
    // An open lead offers no reopening.
    await expect(page.getByRole("link", { name: "Request reopening" })).toHaveCount(0)

    await row(page, "Class").getByRole("button", { name: "Apply Class" }).click()
    await expect(row(page, "Class")).toContainText("Matches now")
    await expect(row(page, "Class").getByRole("button")).toHaveCount(0)
    // Still highlighted, so the count still matches the queue's.
    await expect(row(page, "Class")).toContainText("Differs")

    await row(page, "Phone").getByRole("button", { name: "Apply Phone" }).click()
    await expect(row(page, "Phone")).toContainText("Matches now")
    await expect(comparison(page).getByRole("button", { name: /^Apply/ })).toHaveCount(0)

    // The lead holds what the family sent, and its history shows the staff
    // member's edits.
    await page.goto(`/staff/leads/${mine.leadId}`)
    await expect(page.getByRole("region", { name: "Student" })).toContainText("STD 4")
    await page.getByRole("link", { name: "History" }).click()
    const entries = page.getByRole("list", { name: "History" }).locator(":scope > li")
    await expect(entries.nth(0)).toContainText(ADMISSIONS.name)
    await expect(entries.nth(0)).toContainText(mine.newPhone.replaceAll(" ", ""))
    await expect(entries.nth(1)).toContainText(`${ADMISSIONS.name} changed the lead`)
    await expect(entries.nth(1)).toContainText("Class: STD 3 → STD 4")
  })

  test("the Accountant reads the comparison, with no Apply", async ({ page }) => {
    const mine = await reApplied()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/re-applications/${mine.id}`)

    await expect(row(page, "Class")).toContainText("Differs")
    await expect(comparison(page).getByRole("button")).toHaveCount(0)
  })

  test("the seeded Archived lead offers Request reopening, with only the lead and re-application ids", async ({ page }) => {
    const { data, error } = await secretClient().from("re_applications").select("id").eq("lead_id", ARCHIVED).limit(1).single()
    if (error) throw new Error(error.message)
    const reApplicationId = data.id as string

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/re-applications/${reApplicationId}`)

    await expect(page.getByRole("region", { name: "This lead is Archived" })).toBeVisible()
    await expect(comparison(page)).toBeVisible()
    await expect(comparison(page).getByRole("button")).toHaveCount(0)

    const link = page.getByRole("link", { name: "Request reopening" })
    await expect(link).toHaveAttribute(
      "href",
      `/staff/leads/${ARCHIVED}/reopen?source=re_application&re_application=${reApplicationId}`,
    )
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/staff/leads/${ARCHIVED}/reopen\\?source=re_application&re_application=${reApplicationId}$`))
    await expect(page.getByRole("main")).toContainText("ADMSN-90005")
  })
})
