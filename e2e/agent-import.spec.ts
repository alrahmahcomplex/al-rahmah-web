import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"
import { Client } from "pg"

import { toCsv } from "@/lib/import"

import { registerApprovedAgent } from "../tests/support/agents"
import { MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// Importing agents from a CSV (#190): upload, the check screen, confirm, the
// result screen and the refused-rows download. Every row is fixture data
// generated here.

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
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

// Gives a stored agent an email, as the database owner.
async function setAgentEmail(agentId: string, email: string) {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    await sql.query("select public.set_audit_actor('system')")
    await sql.query("update public.marketing_agents set email = $1 where id = $2", [email, agentId])
    await sql.query("commit")
  } finally {
    await sql.end()
  }
}

// Server Actions post to the page with a Next-Action header.
const isAction = (method: string, headers: Record<string, string>) => method === "POST" && "next-action" in headers

test("a check whose answer never arrives asks to try again", async ({ page }) => {
  const file = fixtureFile()
  await signIn(page, MANAGER)
  await page.goto("/staff/agents/import")
  await page.route("**/staff/agents/import", (route) =>
    isAction(route.request().method(), route.request().headers()) ? route.abort("connectionreset") : route.fallback(),
  )
  await upload(page, file.name, [[file.first.code, file.first.fullName, file.first.mobile, "", ""]])
  await expect(page.getByText("The file could not be checked. Check your connection, choose the file again and check it.")).toBeVisible()

  // The form clears once it is sent, so the file is chosen again.
  await page.unroute("**/staff/agents/import")
  await upload(page, file.name, [[file.first.code, file.first.fullName, file.first.mobile, "", ""]])
  await expect(page.getByRole("heading", { name: `Check ${file.name}` })).toBeVisible()
})

test("a confirm whose answer never arrives asks to check the same file again, which finds the saved rows already present", async ({ page }) => {
  const file = fixtureFile()
  const rows = [[file.first.code, file.first.fullName, file.first.mobile, "", ""]]
  await signIn(page, MANAGER)
  await page.goto("/staff/agents/import")
  await upload(page, file.name, rows)
  await expect(page.getByRole("heading", { name: `Check ${file.name}` })).toBeVisible()

  // The import saves, but its answer is lost on the way back.
  await page.route("**/staff/agents/import", async (route) => {
    if (!isAction(route.request().method(), route.request().headers())) return route.fallback()
    await route.fetch()
    await route.abort("connectionreset")
  })
  await page.getByRole("button", { name: "Create 1 agent" }).click()
  await expect(page.getByText("We couldn't tell whether the import was saved.", { exact: false })).toBeVisible()
  await expect(page.getByText("Reload this page, choose the same file and check it again.", { exact: false })).toBeVisible()

  // Checking the same file again shows the saved row as already present, so there is nothing to confirm.
  await page.unroute("**/staff/agents/import")
  await page.reload()
  await upload(page, file.name, rows)
  await expect(page.getByRole("heading", { name: `Check ${file.name}` })).toBeVisible()
  await expect(page.getByRole("listitem", { name: "Row 2" })).toContainText("Already present")
  await expect(page.getByRole("button", { name: "Nothing to import" })).toBeDisabled()

  // Earlier imports still lists the saved import.
  await page.goto("/staff/agents/import")
  await page.getByRole("link", { name: file.name, exact: true }).click()
  await expect(page.getByText(`Agents created by the import of ${file.name}`)).toBeVisible()
  await expect(page.getByRole("row", { name: new RegExp(file.first.fullName) })).toContainText("Approved")
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test("the check screen fits and the confirm button stays in reach, with a long file name and a long stored email", async ({ page }) => {
    const file = fixtureFile()
    const longName = `agents-${file.tag}-${"spreadsheetexportfromthemarketingteam".repeat(3)}.csv`
    const stored = { fullName: `Neema Stored ${file.tag}`, mobile: mobile() }
    const { id, code } = await registerApprovedAgent(MANAGER, { fullName: stored.fullName, phone: stored.mobile })
    await setAgentEmail(id, `neema.stored.${file.tag}.${"marketingagent".repeat(4)}@${"agents".repeat(6)}.example.test`)

    await signIn(page, MANAGER)
    await page.goto("/staff/agents/import")
    await upload(page, longName, [
      [file.first.code, file.first.fullName, file.first.mobile, "", ""],
      [file.second.code, file.second.fullName, file.second.mobile, "", ""],
      [code, stored.fullName, stored.mobile, "", `other.${file.tag}@example.test`],
      ...Array.from({ length: 12 }, (_, i) => ["", `Refused ${i}`, mobile(), "", ""]),
    ])
    await expect(page.getByRole("heading", { name: `Check ${longName}` })).toBeVisible()
    await expect(page.getByRole("listitem", { name: "Row 4", exact: true })).toContainText("Email differs")
    const confirm = page.getByRole("button", { name: "Create 2 agents, skip 13 rows" })
    await expect(confirm).toBeInViewport()
    // Nothing runs off the side of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await confirm.click()
    await expect(page.getByRole("heading", { name: `${longName} is imported` })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)

    // The earlier imports list, and the Agents screen filtered by the import.
    await page.reload()
    await expect(page.getByRole("link", { name: longName, exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await page.getByRole("link", { name: longName, exact: true }).click()
    await expect(page.getByText(`Agents created by the import of ${longName}`)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  })
})
