import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"

import { toCsv } from "@/lib/import"

import { registerApprovedAgent } from "../tests/support/agents"
import { MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Importing agents from a CSV (#190): upload, the check screen, confirm, the
// result screen and the refused-rows download. Every row is fixture data
// generated here.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A leading 7 keeps it clear of the seeded 700 000 numbers.
function mobile() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

function freshCode() {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  return `M${letter()}${letter()}-${randomInt(10_000, 100_000)}`
}

const HEADER = ["Code", "Full name", "Mobile", "WhatsApp", "Email"]

function fixtureFile() {
  const tag = randomUUID().slice(0, 6)
  const first = { code: freshCode(), fullName: `Amani Import ${tag}`, mobile: mobile() }
  const second = { code: freshCode(), fullName: `Bahati Import ${tag}`, mobile: mobile() }
  return { tag, first, second, name: `agents-${tag}.csv` }
}

async function upload(page: Page, name: string, rows: string[][]) {
  await page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(toCsv([HEADER, ...rows])) })
  await page.getByRole("button", { name: "Check file" }).click()
}

test("the Manager uploads, checks, confirms, downloads the refused rows and finds the imported agents", async ({ page }) => {
  const file = fixtureFile()
  const holder = { fullName: `Chiku Holder ${file.tag}`, mobile: mobile() }
  const { code: holderCode } = await registerApprovedAgent(MANAGER, { fullName: holder.fullName, phone: holder.mobile })

  await signIn(page, MANAGER)
  await page.goto("/staff/agents")
  await page.getByRole("link", { name: "Import from CSV" }).click()
  await expect(page.getByRole("heading", { name: "Import agents" })).toBeVisible()

  const template = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download the template" }).click()
  const templateText = await readFile((await (await template).path())!, "utf8")
  expect(templateText.replace(/^﻿/, "")).toBe("Code,Full name,Mobile,WhatsApp,Email\r\n")

  const badCodeMobile = mobile()
  await upload(page, file.name, [
    [file.first.code.toLowerCase(), file.first.fullName, file.first.mobile, "", ""],
    [file.second.code, file.second.fullName, file.second.mobile, "", ""],
    ["BAD_CODE", `Dotto Import ${file.tag}`, badCodeMobile, "", ""],
    [freshCode(), `Eliya Import ${file.tag}`, holder.mobile, "", ""],
    [freshCode(), `Faraja Import ${file.tag}`, "7.12E+08", "", ""],
  ])

  await expect(page.getByRole("heading", { name: `Check ${file.name}` })).toBeVisible()
  const row = (n: number) => page.getByRole("listitem", { name: `Row ${n}`, exact: true })
  await expect(row(2)).toContainText("To create")
  // The original beside the normalised value.
  await expect(row(2)).toContainText(file.first.code.toLowerCase())
  await expect(row(2)).toContainText(file.first.code)
  await expect(row(2)).toContainText(`+255${file.first.mobile.slice(1)}`)
  await expect(row(4)).toContainText("Bad code")
  await expect(row(5)).toContainText(`Mobile already belongs to ${holder.fullName}, ${holderCode}`)
  await expect(row(6)).toContainText("Looks like an Excel number")

  // The refused rows, made in the browser, before confirming.
  const refused = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download refused rows (3)" }).click()
  const refusedDownload = await refused
  expect(refusedDownload.suggestedFilename()).toBe(`agents-${file.tag}-refused-rows.csv`)
  const refusedText = (await readFile((await refusedDownload.path())!, "utf8")).replace(/^﻿/, "")
  expect(refusedText.split("\r\n")).toEqual([
    "Code,Full name,Mobile,WhatsApp,Email,Reason,Sheet row",
    `BAD_CODE,Dotto Import ${file.tag},${badCodeMobile},,,Bad code,4`,
    expect.stringMatching(new RegExp(`^M[A-Z]{2}-\\d+,Eliya Import ${file.tag},${holder.mobile},,,"Mobile already belongs to ${holder.fullName}, ${holderCode}",5$`)),
    expect.stringMatching(new RegExp(`^M[A-Z]{2}-\\d+,Faraja Import ${file.tag},7.12E\\+08,,,Looks like an Excel number,6$`)),
    "",
  ])

  await page.getByRole("button", { name: "Create 2 agents, skip 3 rows" }).click()
  await expect(page.getByRole("heading", { name: `${file.name} is imported` })).toBeVisible()
  await expect(page.getByText("2 agents created, Approved.")).toBeVisible()
  await expect(page.getByText("3 rows skipped.")).toBeVisible()
  await expect(page.getByText("No email was sent.", { exact: false })).toBeVisible()

  const again = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download refused rows (3)" }).click()
  expect((await again).suggestedFilename()).toBe(`agents-${file.tag}-refused-rows.csv`)

  await page.getByRole("link", { name: "See the agents this import created" }).click()
  await expect(page.getByText(`Agents created by the import of ${file.name}`)).toBeVisible()
  await expect(page.getByText("2 agents", { exact: true })).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(file.first.fullName) })).toContainText("Approved")
  await expect(page.getByRole("row", { name: new RegExp(file.second.fullName) })).toContainText(file.second.code)
})

test("a file over the row limit is refused in English and Swahili", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto("/staff/agents/import")
  await upload(
    page,
    "too-many.csv",
    Array.from({ length: 1001 }, (_, i) => [`X-${i}`, `Name ${i}`, "0712000000", "", ""]),
  )
  await expect(page.getByText("This file has 1,001 rows. Upload at most 1,000 rows at a time.")).toBeVisible()
  await expect(page.getByText("Faili hili lina safu 1,001. Pakia safu zisizozidi 1,000 kwa wakati mmoja.")).toBeVisible()
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test("the check screen fits and the confirm button stays in reach", async ({ page }) => {
    const file = fixtureFile()
    await signIn(page, MANAGER)
    await page.goto("/staff/agents/import")
    await upload(page, file.name, [
      [file.first.code, file.first.fullName, file.first.mobile, "", ""],
      [file.second.code, file.second.fullName, file.second.mobile, "", ""],
      ...Array.from({ length: 12 }, (_, i) => ["", `Refused ${i}`, mobile(), "", ""]),
    ])
    const confirm = page.getByRole("button", { name: "Create 2 agents, skip 12 rows" })
    await expect(confirm).toBeInViewport()
    // Nothing runs off the side of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await confirm.click()
    await expect(page.getByRole("heading", { name: `${file.name} is imported` })).toBeVisible()
  })
})
