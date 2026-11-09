import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"

import { secretClient } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"

// Importing applicants from a CSV on the Applicants list: upload the fixture
// file, review its counts, create, see Done, find the new applicants in the
// list filtered to the import, and the Enrolled-by-import mark on the
// application. Every name and number is invented; each run fills the
// fixture's placeholders with its own tag and phones.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

function phone() {
  return `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// The fixture with this run's values, and a family already on file for the
// "already present" and "joins a family" rows.
async function fixtureFile() {
  const tag = randomUUID().slice(0, 6)
  const existingPhone = phone()
  const existing = await createLead(secretClient(), {
    guardian: { contact: { fullName: `Zawadi ${tag} Mama`, relationship: "Mother", phone: existingPhone } },
    student: { fullName: `Faraja ${tag} Mfano`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!existing.ok) throw new Error(`setup failed: ${JSON.stringify(existing.error)}`)
  const template = await readFile(path.resolve("e2e/fixtures/student-import.csv"), "utf8")
  const values: Record<string, string> = {
    tag,
    year: String(thisYear + 1),
    phone1: phone(),
    phone2: phone(),
    phone3: phone(),
    existingPhone,
  }
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => values[key])
  return { tag, name: `applicants-${tag}.csv`, buffer: Buffer.from(text), existing: existing.data }
}

test("the Manager imports applicants, reviews every row, creates them and finds them in the list", async ({ page }) => {
  const file = await fixtureFile()
  await signIn(page, MANAGER)
  await page.goto("/staff/leads")
  await expect(page.getByRole("heading", { name: "Applicants", level: 1 })).toBeVisible()

  await page.getByRole("button", { name: "Import" }).click()
  const sheet = page.getByRole("dialog", { name: "Import applicants" })
  await expect(sheet.getByText("Drop the CSV here or choose a file")).toBeVisible()

  // The template's header row, as the import reads it.
  const template = page.waitForEvent("download")
  await sheet.getByRole("button", { name: "Download template" }).click()
  const templateDownload = await template
  expect(templateDownload.suggestedFilename()).toBe("students-import-template.csv")
  expect((await readFile((await templateDownload.path())!, "utf8")).replace(/^﻿/, "")).toBe(
    "Student name,Class,Enrollment year,Day or boarding,Parent/guardian name,Relationship,Parent phone,WhatsApp,Visit date,Discount code,Status\r\n",
  )

  await sheet.getByRole("button", { name: "Columns in the template" }).click()
  await expect(sheet.getByText("Not imported: interview payment, result, score, comments and follow-ups.")).toBeVisible()

  await sheet.getByLabel("CSV file").setInputFiles({ name: file.name, mimeType: "text/csv", buffer: file.buffer })

  // Review.
  await expect(sheet.getByText("7 rows checked")).toBeVisible()
  await expect(sheet.getByLabel("Summary")).toHaveText(
    ["3 to create", "1 joins a family", "1 already present", "1 flagged", "1 refused"].join(""),
  )
  const row = (name: string) => sheet.getByRole("table", { name: "Rows checked" }).getByRole("row").filter({ hasText: name })
  await expect(row(`Amani ${file.tag} Mfano`)).toContainText("To create")
  await expect(row(`Baraka ${file.tag} Mfano`)).toContainText("Same parent as row 2")
  await expect(row(`Chausiku ${file.tag} Mfano`)).toContainText("FORM 1 · Pre-Form One")
  await expect(row(`Dotto ${file.tag} Mfano`)).toContainText("Unknown class")
  await expect(row(`Eliya ${file.tag} Mfano`)).toContainText("Looks like an Excel number")
  await expect(row(`Faraja ${file.tag} Mfano`)).toContainText(`Already on file as ${file.existing.admissionNumber}`)
  await expect(row(`Gift ${file.tag} Mfano`)).toContainText("Joins a family")

  // The skipped rows: refused and flagged, ready to fix.
  const skipped = page.waitForEvent("download")
  await sheet.getByRole("button", { name: "Download the 2 skipped rows" }).click()
  const skippedDownload = await skipped
  expect(skippedDownload.suggestedFilename()).toBe(`applicants-${file.tag}-skipped.csv`)
  const skippedText = await readFile((await skippedDownload.path())!, "utf8")
  expect(skippedText).toContain(`Dotto ${file.tag} Mfano`)
  expect(skippedText).toContain(`Eliya ${file.tag} Mfano`)
  expect(skippedText).not.toContain(`Faraja ${file.tag} Mfano`)

  // Create, then Done.
  await sheet.getByRole("button", { name: "Create 4 applicants" }).click()
  await expect(sheet.getByRole("status").filter({ hasText: "4 applicants created, 1 joined a family, 3 skipped." })).toBeVisible()
  await expect(sheet.getByText(`Created by the workbook import (${file.name})`)).toBeVisible()
  await expect(sheet.getByText("Test Manager")).toBeVisible()

  await sheet.getByRole("button", { name: "Show them in the list" }).click()
  await expect(page).toHaveURL(/\/staff\/leads\?import=[0-9a-f-]{36}$/)
  await expect(page.getByText(`Applicants created by the import of ${file.name}`)).toBeVisible()
  const listed = page.getByRole("table", { name: "Applicants" }).locator("tbody tr")
  await expect(listed).toHaveCount(4)
  for (const name of ["Amani", "Baraka", "Chausiku", "Gift"]) {
    await expect(listed.filter({ hasText: `${name} ${file.tag} Mfano` }).getByText("Imported", { exact: true })).toBeVisible()
  }

  // The workbook's Contracted student is Enrolled by the import, with no payment.
  await listed.getByRole("link", { name: `Chausiku ${file.tag} Mfano` }).click()
  await expect(page.getByRole("heading", { name: `Chausiku ${file.tag} Mfano`, level: 1 })).toBeVisible()
  await expect(page.getByText("Enrolled · imported, payments not recorded")).toBeVisible()

  // The Super Admin's history names the file.
  await openLeadHistoryAsSuperAdmin(page)
  await expect(page.getByText(`Created by the workbook import (${file.name})`)).toBeVisible()
})

test("Admissions Staff, without leads.import, see Export but no Import", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await page.goto("/staff/leads")
  await expect(page.getByRole("heading", { name: "Applicants", level: 1 })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0)
})
