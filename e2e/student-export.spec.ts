import { readFile } from "node:fs/promises"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ADMISSIONS, MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// Exporting applicants from the Applicants list. Admissions Staff hold
// leads.view only: the applicant columns. The Manager holds leads.export:
// parent contacts too. Full data is the Super Admin's. The route answers a
// CSV attachment, never cached, and refuses a tier not held.

const DATED_NAME = (preset: string) => new RegExp(`^attachment; filename="students-${preset}-[0-9]{4}-[0-9]{2}-[0-9]{2}[.]csv"$`)

async function signIn(page: Page, person: FixtureStaff | typeof SUPER_ADMIN) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function openExport(page: Page) {
  await page.goto("/staff/applicants")
  await page.getByRole("button", { name: "Export" }).click()
  const sheet = page.getByRole("dialog", { name: "Export applicants" })
  await expect(sheet.getByLabel("Which applicants")).toBeVisible()
  return sheet
}

function presets(sheet: ReturnType<Page["getByRole"]>) {
  return sheet.getByRole("radio")
}

// The sheet fetches the file from the route, then hands it to the browser.
const exportAnswer = (page: Page) => page.waitForResponse((response) => response.url().includes("/staff/applicants/export?"))

// The first line of a CSV, without the byte-order mark.
function headerRow(text: string) {
  return text.replace(/^﻿/, "").split("\r\n")[0]
}

test("Admissions Staff export the applicant columns only", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  const sheet = await openExport(page)

  await expect(sheet.getByRole("radio", { name: /^Class list/ })).toBeChecked()
  await expect(presets(sheet)).toHaveCount(3)
  await expect(sheet.getByRole("radio", { name: /^Follow-up calls/ })).toHaveCount(0)
  await expect(sheet.getByRole("radio", { name: /^Full data/ })).toHaveCount(0)

  // Choose columns shows the locked groups as one line each.
  await sheet.getByRole("radio", { name: /^Choose columns/ }).check()
  await expect(sheet.getByText("Parent contact needs the Export applicants permission.")).toBeVisible()
  await expect(sheet.getByText(/Full data is the Super Admin.s export only/)).toBeVisible()
  await expect(sheet.getByRole("checkbox", { name: "Parent phone" })).toHaveCount(0)
  await expect(sheet.getByRole("checkbox", { name: "Admission Number" })).toBeChecked()

  await sheet.getByRole("radio", { name: /^Class list/ }).check()
  await expect(sheet.getByText(/^\d[\d,]* rows?, 6 columns$/)).toBeVisible()
  const download = page.waitForEvent("download")
  await sheet.getByRole("button", { name: "Download CSV" }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^students-class-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(headerRow(await readFile((await file.path())!, "utf8"))).toBe("Admission Number,Student name,Class,Enrollment year,Day or boarding,Status")
  await expect(page.getByText(/^Exported [\d,]+ applicants?\. Recorded in the audit history\.$/)).toBeVisible()

  // The route refuses what the sheet does not offer.
  for (const query of ["preset=calls&scope=all", "preset=custom&scope=all&col=adm&col=phone", "preset=full&scope=all"]) {
    const refused = await page.request.get(`/staff/applicants/export?${query}`)
    expect(refused.status()).toBe(403)
    expect(refused.headers()["content-disposition"]).toBeUndefined()
  }
})

test("the Manager, with leads.export, exports parent contacts but not Full data", async ({ page }) => {
  await signIn(page, MANAGER)
  const sheet = await openExport(page)

  await expect(sheet.getByRole("radio", { name: /^Full data/ })).toHaveCount(0)
  await expect(sheet.getByText(/Personal Data Protection Act/)).toHaveCount(0)
  await sheet.getByRole("radio", { name: /^Follow-up calls/ }).check()
  await expect(
    sheet.getByText(
      "Includes parent names and phone numbers, personal data under the Personal Data Protection Act. Share only with staff who need it.",
    ),
  ).toBeVisible()
  await sheet.getByLabel("Which applicants").selectOption({ label: "Every applicant" })
  await expect(sheet.getByText(/^\d[\d,]* rows?, 8 columns$/)).toBeVisible()

  const download = page.waitForEvent("download")
  const answered = exportAnswer(page)
  await sheet.getByRole("button", { name: "Download CSV" }).click()
  const answer = await answered
  expect(new URL(answer.url()).search).toBe("?preset=calls&scope=all")
  expect(answer.status()).toBe(200)
  expect(answer.headers()["content-type"]).toBe("text/csv; charset=utf-8")
  expect(answer.headers()["content-disposition"]).toMatch(DATED_NAME("calls"))
  expect(answer.headers()["cache-control"]).toBe("no-store")
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^students-calls-\d{4}-\d{2}-\d{2}\.csv$/)
  expect(headerRow(await readFile((await file.path())!, "utf8"))).toBe(
    "Admission Number,Student name,Class,Status,Status since,Parent name,Parent phone,WhatsApp",
  )

  const full = await page.request.get("/staff/applicants/export?preset=full&scope=all")
  expect(full.status()).toBe(403)
})

test("the Super Admin exports Full data", async ({ page }) => {
  await signIn(page, SUPER_ADMIN)
  const sheet = await openExport(page)
  await sheet.getByRole("radio", { name: /^Full data/ }).check()
  await expect(sheet.getByText("Includes payments and notes. Keep this file inside the school.")).toBeVisible()
  await sheet.getByLabel("Which applicants").selectOption({ label: `Enrollment year ${new Date().getFullYear() + 1}` })

  const download = page.waitForEvent("download")
  const answered = exportAnswer(page)
  await sheet.getByRole("button", { name: "Download CSV" }).click()
  const answer = await answered
  expect(answer.status()).toBe(200)
  expect(answer.headers()["content-disposition"]).toMatch(DATED_NAME("full"))
  const header = headerRow(await readFile((await (await download).path())!, "utf8")).split(",")
  expect(header).toHaveLength(28)
  expect(header).toEqual(expect.arrayContaining(["Parent phone", "Interview fee status", "Follow-up notes", "History entries"]))
})

test("an export the route refuses says why in the sheet, and never says Exported", async ({ page }) => {
  await signIn(page, MANAGER)
  const sheet = await openExport(page)
  // More applicants than one export holds: the route answers 413 and records nothing.
  const refusal = "More applicants match (5,001) than one export holds, 5,000. Export one Enrollment year at a time, or filter the list first."
  await page.route("**/staff/applicants/export?*", (route) =>
    route.fulfill({ status: 413, contentType: "text/plain; charset=utf-8", body: refusal }),
  )
  await sheet.getByRole("button", { name: "Download CSV" }).click()
  await expect(sheet.getByRole("alert")).toHaveText(refusal)
  await expect(sheet.getByRole("button", { name: "Download CSV" })).toBeEnabled()
  await expect(page.getByText(/^Exported /)).toHaveCount(0)

  // A dropped connection is no export either.
  await page.unroute("**/staff/applicants/export?*")
  await page.route("**/staff/applicants/export?*", (route) => route.abort())
  await sheet.getByRole("button", { name: "Download CSV" }).click()
  await expect(sheet.getByRole("alert")).toHaveText("The export could not be downloaded. Check your connection, reload the page and try again.")
  await expect(page.getByText(/^Exported /)).toHaveCount(0)
})
