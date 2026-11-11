import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { secretClient } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import { chooseLanguage, FORBIDDEN, fillRegistration, newcomer, WORDS, type Lang } from "./discount-code"
import { E2E_PORT } from "./server"
import { signInOnce } from "./log-in"

// The Discount code page on a phone, against local Supabase with Turnstile's
// always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

test.beforeEach(async ({ context }) => {
  await chooseLanguage(context, "sw")
})

const ORIGIN = `http://localhost:${E2E_PORT}`
const CODE = /^[A-Z]{1,3}-\d{3,4}$/

async function register(page: Page, lang: Lang, who: ReturnType<typeof newcomer>, whatsapp = "") {
  const t = WORDS[lang]
  await page.goto("/discount-code")
  await expect(page.getByRole("main")).toHaveAttribute("lang", lang)
  await fillRegistration(page, lang, who, { whatsapp })
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
  await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()
  const code = (await page.getByText(CODE).textContent())!.trim()
  return code
}

async function agentByPhone(phone: string) {
  const { data, error } = await secretClient()
    .from("marketing_agents")
    .select("full_name, code, status, whatsapp, email")
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
    if (lang === "en") await chooseLanguage(context, "en")

    await page.goto("/discount-code")
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeAttached()
    await expect(page.getByText("AL-RAHMAH COMPLEX", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: t.name })).toBeVisible()
    await expect(page.getByText(/TZS 10,000/)).toBeVisible()
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

    await expect(page.getByText(who.email)).toBeVisible()
    expect(await agentByPhone(who.phone)).toEqual({
      full_name: who.name,
      code,
      status: "Pending",
      whatsapp: "+255754000111",
      email: who.email,
    })
  })
}

test("registering again with the same details shows the same code; another name on the phone is told to say it has a code", async ({
  page,
}) => {
  const who = newcomer()
  const first = await register(page, "sw", who)

  const second = await register(page, "sw", who)
  expect(second).toBe(first)
  await expect(page.getByText(`${ORIGIN}/apply?ref=${first}`, { exact: true })).toBeVisible()

  await page.goto("/discount-code")
  await fillRegistration(page, "sw", { ...who, name: `${who.name} Tena` })
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: WORDS.sw.send }).click()
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Namba hii tayari ina Code ya Punguzo. Weka alama kwenye 'Tayari una code?' na uiandike, au piga simu ofisini.",
  )
})

test("the new agent arrives Pending on the Marketing Agents screen", async ({ page }) => {
  const who = newcomer()
  const code = await register(page, "sw", who)

  await signInOnce(page, MANAGER.email, MANAGER.password)
  await expect(page).toHaveURL(/\/staff$/)

  await page.goto("/staff/agents")
  await page.getByLabel("Search agents").fill(code)
  await page.getByRole("button", { name: "Search" }).click()
  const row = page.getByRole("row", { name: new RegExp(who.name) })
  await expect(row).toContainText(code)
  await expect(row).toContainText("Pending")
})

test("the menu changes the language in place, keeping every answer, and 'Futa fomu yote' asks before clearing", async ({ page }) => {
  const who = newcomer()
  await page.goto("/discount-code")
  await page.getByLabel(WORDS.sw.name).fill(who.name)
  await page.locator("li.gf-open").getByRole("button", { name: WORDS.sw.next }).click()
  await page.getByLabel(WORDS.sw.phone).fill(who.phone)

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByLabel(WORDS.en.phone)).toHaveValue(who.phone)
  await expect(page.getByText(who.name)).toBeVisible()
  await expect(page.getByRole("button", { name: "Change Name" })).toBeVisible()

  // The menu stays open across the switch; its words follow the language.
  const clear = page.getByRole("button", { name: "Clear the whole form" })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page.getByText("Clear every answer?")).toBeVisible()
  await page.getByRole("button", { name: "Yes, clear" }).click()
  await expect(page.getByLabel(WORDS.en.name)).toHaveValue("")
  await expect(page.getByLabel(WORDS.en.phone)).toHaveCount(0)
})

test("a first visit asks for the language once", async ({ page, context }) => {
  await context.clearCookies()
  await page.goto("/discount-code")
  await expect(page.getByText("Karibu!")).toBeVisible()
  await page.getByRole("button", { name: "Endelea kwa Kiswahili" }).click()
  await expect(page.getByText("Karibu!")).toBeHidden({ timeout: 10_000 })
  expect((await context.cookies()).find((c) => c.name === "lang")?.value).toBe("sw")
  await page.reload()
  await expect(page.getByRole("heading", { name: WORDS.sw.name })).toBeVisible()
  await expect(page.getByText("Karibu!")).toHaveCount(0)
})

test("the page is noindex and the landing page doesn't link to it", async ({ page }) => {
  await page.goto("/discount-code")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow")

  await page.goto("/")
  await expect(page.locator('a[href*="discount-code"]')).toHaveCount(0)
})
