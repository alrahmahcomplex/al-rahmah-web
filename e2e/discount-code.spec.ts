import { expect, test, type Page } from "@playwright/test"

import { secretClient } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import { FORBIDDEN, fillRegistration, newcomer, WORDS, type Lang } from "./discount-code"
import { E2E_PORT } from "./server"

// The Discount code page on a phone, against local Supabase with Turnstile's
// always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

const ORIGIN = `http://localhost:${E2E_PORT}`
const CODE = /^[A-Z]{1,3}-\d{3,4}$/

async function register(page: Page, lang: Lang, who: ReturnType<typeof newcomer>, whatsapp = "") {
  const t = WORDS[lang]
  await page.goto("/discount-code")
  await expect(page.getByRole("main")).toHaveAttribute("lang", lang)
  await fillRegistration(page, lang, who, whatsapp)
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
  await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()
  const code = (await page.getByText(CODE).textContent())!.trim()
  return code
}

async function agentByPhone(phone: string) {
  const { data, error } = await secretClient()
    .from("marketing_agents")
    .select("full_name, code, status, whatsapp")
    .eq("phone", `+255${phone.slice(1)}`)
    .single()
  if (error) throw new Error(error.message)
  return data
}

for (const lang of ["sw", "en"] as const satisfies Lang[]) {
  test(`registers for a Discount code in ${lang === "sw" ? "Swahili" : "English"}, with its link, Copy and WhatsApp share`, async ({
    page,
    context,
  }) => {
    const t = WORDS[lang]
    const who = newcomer()
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN })
    if (lang === "en") await context.addCookies([{ name: "lang", value: "en", url: ORIGIN }])

    await page.goto("/discount-code")
    await expect(page.getByRole("heading", { level: 1, name: t.heading })).toBeVisible()
    await expect(page.getByText(/TZS 20,000/)).toBeVisible()
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN)

    const code = await register(page, lang, who, "0754 000 111")
    const link = `${ORIGIN}/apply?ref=${code}`
    await expect(page.getByText(code, { exact: true })).toBeVisible()
    await expect(page.getByText(link, { exact: true })).toBeVisible()

    await page.getByRole("button", { name: t.copy }).click()
    await expect(page.getByRole("button", { name: t.copied })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)

    const share = await page.getByRole("link", { name: t.share }).getAttribute("href")
    expect(share).toMatch(/^https:\/\/wa\.me\/\?text=/)
    const text = decodeURIComponent(share!.slice("https://wa.me/?text=".length))
    expect(text).toContain(code)
    expect(text.endsWith(link)).toBe(true)
    expect(text).toContain(lang === "sw" ? "Code yangu ya Punguzo" : "My Discount code")
    expect(text).not.toMatch(FORBIDDEN)

    await expect(page.getByRole("link", { name: "+255 673 526 644" })).toHaveAttribute("href", "tel:+255673526644")
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN)

    expect(await agentByPhone(who.phone)).toEqual({ full_name: who.name, code, status: "Pending", whatsapp: "+255754000111" })
  })
}

test("registering again with the same phone shows the same code", async ({ page }) => {
  const who = newcomer()
  const first = await register(page, "sw", who)

  const second = await register(page, "sw", { ...who, name: `${who.name} Tena` })
  expect(second).toBe(first)
  await expect(page.getByText(`${ORIGIN}/apply?ref=${first}`, { exact: true })).toBeVisible()
})

test("the new agent arrives Pending on the Marketing Agents screen", async ({ page }) => {
  const who = newcomer()
  const code = await register(page, "sw", who)

  await page.goto("/login")
  await page.getByLabel("Email").fill(MANAGER.email)
  await page.getByLabel("Password", { exact: true }).fill(MANAGER.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)

  await page.goto("/staff/agents")
  await page.getByLabel("Search agents").fill(code)
  await page.getByRole("button", { name: "Search" }).click()
  const row = page.getByRole("row", { name: new RegExp(who.name) })
  await expect(row).toContainText(code)
  await expect(row).toContainText("Pending")
})

test("the page is noindex and the landing page doesn't link to it", async ({ page }) => {
  await page.goto("/discount-code")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")

  await page.goto("/")
  await expect(page.locator('a[href*="discount-code"]')).toHaveCount(0)
})
