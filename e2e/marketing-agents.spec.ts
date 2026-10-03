import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { secretClient } from "../tests/support/db"
import { ACCOUNTANT, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The Marketing Agents screen, as the Admissions Manager and the Accountant
// use it. The Manager's test registers a Pending agent of its own, the way
// the registration page will, so reruns never meet an agent an earlier run
// approved. The seeded agents stay as they are.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function registerPendingAgent() {
  const fullName = `Rehema Agent ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const { data, error } = await secretClient().rpc("register_marketing_agent", { full_name: fullName, phone, whatsapp: null })
  if (error) throw new Error(`could not register an agent: ${error.message}`)
  const digits = phone.slice(1)
  return {
    fullName,
    code: data as string,
    phone: `+255${digits}`,
    displayPhone: `+255 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
  }
}

async function pendingInDatabase(): Promise<number> {
  const { count, error } = await secretClient()
    .from("marketing_agents")
    .select("id", { count: "exact", head: true })
    .eq("status", "Pending")
  if (error) throw new Error(error.message)
  return count ?? 0
}

const agentsLink = (page: Page) => page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Marketing Agents/ })

async function pendingCount(page: Page): Promise<number> {
  const name = (await agentsLink(page).textContent()) ?? ""
  const match = /(\d+)\s*Pending/.exec(name)
  return match ? Number(match[1]) : 0
}

test.describe("Marketing Agents", () => {
  test("the Manager confirms a Pending agent's name and code, approves them, and the Pending count drops", async ({ page }) => {
    const agent = await registerPendingAgent()
    await signIn(page, MANAGER)

    const before = await pendingCount(page)
    expect(before).toBeGreaterThanOrEqual(1)
    expect(before).toBeLessThanOrEqual(await pendingInDatabase())
    await agentsLink(page).click()
    await expect(page.getByRole("heading", { name: "Marketing Agents", exact: true })).toBeVisible()
    // Pending first for an approver.
    await expect(page.getByRole("link", { name: "Pending", exact: true })).toHaveAttribute("aria-current", "page")

    await page.getByLabel("Search agents").fill(agent.code.toLowerCase())
    await page.getByRole("button", { name: "Search" }).click()
    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    await expect(row).toContainText(agent.code)
    await expect(row).toContainText("Pending")
    await expect(row).toContainText("Not yet")
    await expect(row.getByRole("link", { name: agent.displayPhone })).toHaveAttribute("href", `tel:${agent.phone}`)

    await row.getByRole("button", { name: `Approve ${agent.fullName}` }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText(`Approve ${agent.fullName}?`)
    await expect(dialog).toContainText(agent.code)
    await dialog.getByRole("button", { name: `Approve ${agent.code}` }).click()

    await expect(page.getByText(`${agent.fullName} (${agent.code}) is Approved.`)).toBeVisible()
    // Approved agents leave the Pending list, and the count drops: it shows
    // the Pending agents as they are now, without this one. (Other tests may
    // register agents meanwhile, so it is compared with the database.)
    await expect(page.getByText("No agent matches this search.")).toBeVisible()
    await expect.poll(async () => (await pendingCount(page)) === (await pendingInDatabase())).toBe(true)
    expect(await pendingCount(page)).toBeLessThan(before + 1)

    await page.getByRole("link", { name: "Approved", exact: true }).click()
    const approved = page.getByRole("row", { name: new RegExp(agent.fullName) })
    await expect(approved).toContainText("Approved")
    await expect(approved).toContainText(MANAGER.name)
    await expect(approved.locator("time")).toHaveCount(2)
    await expect(approved.getByRole("button", { name: /Approve/ })).toHaveCount(0)
  })

  test("the Accountant reads every agent, with no Approve and no Pending count", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(agentsLink(page)).toHaveText("Marketing Agents")
    await agentsLink(page).click()

    await expect(page.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("table", { name: "Marketing Agents" })).toBeVisible()
    await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0)

    // The seeded Approved agent, with who approved them.
    await page.getByLabel("Search agents").fill("Baraka Juma")
    await page.getByRole("button", { name: "Search" }).click()
    const approved = page.getByRole("row", { name: /Baraka Juma Njoroge/ })
    await expect(approved).toContainText("BJN-402")
    await expect(approved).toContainText("Approved")
    await expect(approved).toContainText(MANAGER.name)

    // Pending agents too, still with nothing to approve them by.
    await page.getByRole("link", { name: "Pending", exact: true }).click()
    await page.getByLabel("Search agents").fill("")
    await page.getByRole("button", { name: "Search" }).click()
    await expect(page.getByRole("table", { name: "Marketing Agents" }).getByRole("row").nth(1)).toContainText("Pending")
    await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0)
  })
})
