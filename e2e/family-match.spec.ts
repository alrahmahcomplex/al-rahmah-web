import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { signedIn } from "./db"
import { ADMISSIONS, type FixtureStaff } from "./fixtures"

// The Family step of New Student, as Admissions Staff use it. Each test makes
// its own Family through the lead module, with a number nobody else holds, so
// runs never collide with each other or with the seeded leads.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A parent with one child already registered at the front desk.
async function knownFamily() {
  const digits = `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const family = {
    parent: `Parent ${randomUUID().slice(0, 6)}`,
    phone: `0${digits}`,
    stored: `+255${digits}`,
    child: `Child ${randomUUID().slice(0, 6)}`,
  }
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: family.parent, relationship: "Father", phone: family.phone } },
    student: { fullName: family.child, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: tanzaniaToday() },
  })
  if (!created.ok) throw new Error(`Could not create the Family: ${JSON.stringify(created.error)}`)
  return { ...family, admissionNumber: created.data.admissionNumber }
}

async function enterParent(page: Page, parent: { name: string; phone: string; relationship?: string }) {
  await page.goto("/staff/check-in/new")
  await page.getByLabel("Full name").fill(parent.name)
  await page.getByLabel("Relationship to the student").selectOption(parent.relationship ?? "Father")
  await page.getByLabel("Phone", { exact: true }).fill(parent.phone)
  await page.getByRole("button", { name: "Continue" }).click()
}

async function fillStudent(page: Page, child: string) {
  await page.getByLabel("Student's full name").fill(child)
  await page.getByLabel("Class").selectOption("KG 2")
  await page.getByLabel("Enrollment year").selectOption(String(thisYear + 1))
  await page.getByLabel("Day", { exact: true }).check()
  await page.getByRole("button", { name: "Review" }).click()
}

test.describe("a parent whose number is on file", () => {
  test("is shown by stored name and relationship, and confirming lists the Family's children; an active child opens its lead", async ({
    page,
  }) => {
    const family = await knownFamily()
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: "Someone typed", phone: family.phone.replace(/^0/, "+255 ") })

    await expect(page.getByRole("heading", { name: "Is this the same parent?", level: 2 })).toBeVisible()
    const match = page.getByRole("group", { name: family.parent })
    await expect(match).toContainText("Father")
    await expect(page.getByRole("button", { name: "Not the same person" })).toBeVisible()
    await match.getByRole("button", { name: "Same person" }).click()

    await expect(page.getByRole("heading", { name: `${family.parent}'s family`, level: 2 })).toBeVisible()
    const row = page.getByRole("row", { name: new RegExp(family.child) })
    for (const text of [family.admissionNumber, "STD 4", String(thisYear + 1), "Visited"]) {
      await expect(row).toContainText(text)
    }

    await row.getByRole("link", { name: `Open ${family.child}` }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { name: family.child, level: 1 })).toBeVisible()
  })

  test("Register a new sibling adds a child to the Family, flagged Returning family", async ({ page }) => {
    const family = await knownFamily()
    const sibling = `Sibling ${randomUUID().slice(0, 6)}`
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: family.parent, phone: family.phone })

    await page.getByRole("group", { name: family.parent }).getByRole("button", { name: "Same person" }).click()
    await page.getByRole("button", { name: "Register a new sibling" }).click()

    // The typed details match the stored contact, so nothing to compare.
    await expect(page.getByRole("heading", { name: "Student", level: 2 })).toBeVisible()
    await fillStudent(page, sibling)
    await expect(page.getByText("Returning family", { exact: false })).toBeVisible()
    await page.getByRole("button", { name: "Register student" }).click()

    await expect(page.getByLabel("Admission Number")).toHaveText(/^ADMSN-\d{5}$/)
    await page.getByRole("link", { name: "Open lead" }).click()
    await expect(page.getByRole("heading", { name: sibling, level: 1 })).toBeVisible()
    await expect(page.getByText("Returning family", { exact: true })).toBeVisible()
    await expect(page.getByText(family.stored)).toBeVisible()
  })

  test("typed details that differ show beside the stored ones, and Update the shared contact changes it", async ({
    page,
  }) => {
    const family = await knownFamily()
    const corrected = `${family.parent} Corrected`
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: corrected, phone: family.phone, relationship: "Guardian" })

    await page.getByRole("group", { name: family.parent }).getByRole("button", { name: "Same person" }).click()
    await page.getByRole("button", { name: "Register a new sibling" }).click()

    await expect(page.getByRole("heading", { name: "Update the shared contact?", level: 2 })).toBeVisible()
    const nameRow = page.getByRole("row", { name: /Full name/ })
    await expect(nameRow).toContainText(corrected)
    await expect(nameRow).toContainText(family.parent)
    await expect(page.getByRole("row", { name: /Relationship/ })).toContainText("Guardian")
    await expect(page.getByRole("button", { name: "Keep stored details" })).toBeVisible()
    await page.getByRole("button", { name: "Update the shared contact" }).click()

    await expect(page.getByRole("heading", { name: "Student", level: 2 })).toBeVisible()
    await fillStudent(page, `Sibling ${randomUUID().slice(0, 6)}`)
    await page.getByRole("button", { name: "Register student" }).click()
    await page.getByRole("link", { name: "Open lead" }).click()

    // The contact every sibling shares now carries the corrected details.
    await expect(page.getByText(corrected)).toBeVisible()
    await expect(page.getByText("Guardian", { exact: true })).toBeVisible()
  })

  test("Keep stored details registers the sibling with the contact unchanged", async ({ page }) => {
    const family = await knownFamily()
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: `${family.parent} Typo`, phone: family.phone })

    await page.getByRole("group", { name: family.parent }).getByRole("button", { name: "Same person" }).click()
    await page.getByRole("button", { name: "Register a new sibling" }).click()
    await page.getByRole("button", { name: "Keep stored details" }).click()

    await fillStudent(page, `Sibling ${randomUUID().slice(0, 6)}`)
    await expect(page.getByRole("region", { name: "Parent or guardian" })).toContainText(family.parent)
    await expect(page.getByRole("region", { name: "Parent or guardian" })).not.toContainText("Typo")
    await page.getByRole("button", { name: "Register student" }).click()
    await page.getByRole("link", { name: "Open lead" }).click()
    await expect(page.getByText(family.parent, { exact: true })).toBeVisible()
  })

  test("Not the same person continues with a new contact and no Returning family flag", async ({ page }) => {
    const family = await knownFamily()
    const stranger = `Stranger ${randomUUID().slice(0, 6)}`
    const child = `Child ${randomUUID().slice(0, 6)}`
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: stranger, phone: family.phone, relationship: "Mother" })

    await page.getByRole("button", { name: "Not the same person" }).click()
    await expect(page.getByRole("heading", { name: "Student", level: 2 })).toBeVisible()
    await fillStudent(page, child)
    await expect(page.getByRole("region", { name: "Parent or guardian" })).toContainText(stranger)
    await page.getByRole("button", { name: "Register student" }).click()
    await page.getByRole("link", { name: "Open lead" }).click()

    await expect(page.getByRole("heading", { name: child, level: 1 })).toBeVisible()
    await expect(page.getByText(stranger)).toBeVisible()
    await expect(page.getByText("Returning family", { exact: true })).toHaveCount(0)
  })

  test("a closed child in the Family leads to the Reopening request hand-off", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await enterParent(page, { name: "Omari Fixture", phone: "0700 000 104", relationship: "Guardian" })

    await page.getByRole("group", { name: "Omari Fixture" }).getByRole("button", { name: "Same person" }).click()
    const row = page.getByRole("row", { name: /Hamisi Fixture/ })
    await expect(row).toContainText("ADMSN-90005")
    await expect(row).toContainText("Archived")

    await row.getByRole("link", { name: "Reopening request for Hamisi Fixture" }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/1ead0000-0000-4000-8000-000000000005\/reopen\?source=duplicate_match$/)
    await expect(page.getByText("Reopening a closed lead isn't available yet")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
  })
})
