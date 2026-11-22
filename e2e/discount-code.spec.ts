import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { secretClient } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import {
  chooseLanguage,
  continueFrom,
  FORBIDDEN,
  fillRegistration,
  nameBox,
  newcomer,
  openQuestion,
  pickTile,
  sendButton,
  typeName,
  WORDS,
  type Lang,
} from "./discount-code"
import { E2E_PORT } from "./server"
import { signInOnce } from "./log-in"

// The Discount code page on a phone, against local Supabase with Turnstile's
// always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

test.beforeEach(async ({ context }) => {
  await chooseLanguage(context, "sw")
})

const ORIGIN = `http://localhost:${E2E_PORT}`
// The newcomer's own initials, a hyphen and the number (#404).
const CODE = /^RMX-\d{3,}$/

async function register(page: Page, lang: Lang, who: ReturnType<typeof newcomer>, whatsapp = "") {
  const t = WORDS[lang]
  await page.goto("/discount-code")
  await expect(page.getByRole("main")).toHaveAttribute("lang", lang)
  await fillRegistration(page, lang, who, { whatsapp })
  await waitForSecurityCheck(page)
  await sendButton(page, lang).click()
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

    // The way on is the students page, which asks a person with no session to sign in, saying why (#497).
    await page.getByRole("link", { name: lang === "sw" ? "Ona Wanafunzi Niliowaleta" : "See my Referred Students" }).click()
    await expect(page).toHaveURL(/\/auth\?from=students$/)
    await expect(page.getByText(lang === "sw" ? "Ingia uone wanafunzi uliowaleta." : "Sign in to see the students you referred.")).toBeVisible()
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
  await fillRegistration(page, "sw", { ...who, name: `${who.name} TENA` })
  await waitForSecurityCheck(page)
  await sendButton(page, "sw").click()
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
  await typeName(page, "sw", who.name)
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
  await expect(nameBox(page, "en")).toHaveValue("")
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

test("No skips the code box and goes straight to the review, which names only the person's own initials", async ({ page }) => {
  const who = newcomer()
  await page.goto("/discount-code")
  await typeName(page, "sw", who.name)
  await expect(nameBox(page, "sw", "middle")).toHaveValue("MAJARIBIO")
  await continueFrom(page, "sw")
  await page.getByLabel(WORDS.sw.phone).fill(who.phone)
  await continueFrom(page, "sw")
  await page.getByLabel(WORDS.sw.email).fill(who.email)
  await continueFrom(page, "sw")
  await pickTile(page, WORDS.sw.no)

  await expect(sendButton(page, "sw")).toBeVisible()
  await expect(page.getByLabel(WORDS.sw.code, { exact: true })).toHaveCount(0)
  await expect(openQuestion(page).getByText(/Code yako ya Punguzo itaanza na RMX,/)).toBeVisible()
})

test("Yes opens the code box, which adds the hyphen by itself", async ({ page }) => {
  const who = newcomer()
  await chooseLanguage(page.context(), "en")
  await page.goto("/discount-code")
  await typeName(page, "en", who.name)
  await continueFrom(page, "en")
  await page.getByLabel(WORDS.en.phone).fill(who.phone)
  await continueFrom(page, "en")
  await page.getByLabel(WORDS.en.email).fill(who.email)
  await continueFrom(page, "en")
  await pickTile(page, WORDS.en.yes)

  const box = page.getByLabel(WORDS.en.code, { exact: true })
  await box.pressSequentially("aan132")
  await expect(box).toHaveValue("AAN-132")
  await continueFrom(page, "en")
  await expect(sendButton(page, "en", true)).toBeVisible()
  await expect(page.getByText("We match this code to your phone number or your names. The Marketing Office then confirms it.")).toBeVisible()
})

test("no page or response before the finish carries an agent's code, and the finish carries only the person's own", async ({ page }) => {
  const { data, error } = await secretClient().from("marketing_agents").select("code")
  if (error) throw new Error(error.message)
  const codes = data.map((row) => row.code as string)
  expect(codes.length).toBeGreaterThan(0)

  // Everything the server sends this page: documents, RSC payloads and the
  // Server Action's answer. Static scripts are build output and hold no data.
  // Each response is filed under the phase it arrived in, before its body is read.
  let finishing = false
  const before: Promise<string>[] = []
  const after: Promise<string>[] = []
  page.on("response", (response) => {
    if (!["document", "fetch", "xhr"].includes(response.request().resourceType())) return
    ;(finishing ? after : before).push(response.text().catch(() => ""))
  })

  const who = newcomer()
  await page.goto("/discount-code")
  await fillRegistration(page, "sw", who)
  // The language switch re-renders the page on the server, too.
  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(sendButton(page, "en")).toBeVisible()
  await waitForSecurityCheck(page)
  const bodiesBefore = await Promise.all(before)
  // The page itself and the language switch's re-render, at least.
  expect(bodiesBefore.length).toBeGreaterThanOrEqual(2)
  expect(bodiesBefore.join("")).toContain(WORDS.sw.name)
  for (const body of bodiesBefore) for (const code of codes) expect(body.includes(code), `a response before the finish carries ${code}`).toBe(false)

  finishing = true
  // The Server Action's own answer. The test fetches it itself and hands it
  // on to the page, so its body is read here rather than from the browser,
  // which may already have let it go once the finish shows (#425).
  let resolveSent: (body: string) => void = () => {}
  const answer = new Promise<string>((resolve) => (resolveSent = resolve))
  await page.route("**/discount-code", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const response = await route.fetch()
    resolveSent(await response.text())
    await route.fulfill({ response })
  })
  await sendButton(page, "en").click()
  const sent = await answer
  await expect(page.getByRole("heading", { level: 1, name: WORDS.en.done })).toBeVisible()
  const own = (await page.locator("[data-own-code]").textContent())!.trim()
  expect(own).toMatch(CODE)
  expect(sent, `the send's answer (${sent.length} characters) names the new code`).toContain(own)
  const bodiesAfter = [sent, ...(await Promise.all(after))]
  for (const body of bodiesAfter) for (const code of codes) expect(body.includes(code), `the finish carries ${code}`).toBe(false)
})

test("Start over swaps as the Admission form's does: left on the first question, then on the right; the finish has no bar", async ({ page }) => {
  const who = newcomer()
  await page.goto("/discount-code")
  const startOver = page.getByRole("button", { name: WORDS.sw.startOver })
  await startOver.click()
  await expect(page.getByText("Hakuna cha kufuta bado. Fomu iko tupu.")).toBeVisible()

  await typeName(page, "sw", who.name)
  await continueFrom(page, "sw")
  // From the second question on: Back on the left, Start over after the section name, which sits above the bar.
  await expect(page.getByRole("button", { name: WORDS.sw.back })).toBeVisible()
  await expect(startOver).toHaveClass(/gf-reset-end/)
  await expect(page.locator(".gf-bar-row")).toHaveClass(/gf-chip-up/)
  await startOver.click()
  const sheet = page.getByRole("dialog", { name: "Uanze upya?" })
  await sheet.getByRole("button", { name: "Ndiyo, futa fomu" }).click()
  await expect(nameBox(page, "sw")).toHaveValue("")
  await expect(page.getByText("Fomu imeanza upya.")).toBeVisible()

  await fillRegistration(page, "sw", who)
  await waitForSecurityCheck(page)
  await sendButton(page, "sw").click()
  await expect(page.getByRole("heading", { level: 1, name: WORDS.sw.done })).toBeVisible()
  await expect(page.locator(".gf-bar-row")).toHaveCount(0)
  await expect(startOver).toHaveCount(0)
  // Sent: a reload opens an empty form.
  await page.reload()
  await expect(nameBox(page, "sw")).toHaveValue("")
})

test("a reload keeps the answers, and Hapana picked again after Back or a reload moves on, by tap, Space or Enter", async ({ page }) => {
  const who = newcomer()
  await page.goto("/discount-code")
  await typeName(page, "sw", who.name)
  await continueFrom(page, "sw")
  await page.getByLabel(WORDS.sw.phone).fill(who.phone)
  await continueFrom(page, "sw")
  await page.reload()
  // Back on the email question, with the name and phone folded above it.
  await expect(page.getByRole("button", { name: "Badilisha Jina" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Badilisha Namba" })).toBeVisible()
  await page.getByLabel(WORDS.sw.email).fill(who.email)
  await continueFrom(page, "sw")
  const no = page.getByRole("radio", { name: WORDS.sw.no })
  await pickTile(page, WORDS.sw.no)
  await expect(sendButton(page, "sw")).toBeVisible()

  await page.reload()
  await expect(sendButton(page, "sw")).toBeVisible()
  for (const pick of ["tap", "Space", "Enter"] as const) {
    await page.getByRole("button", { name: WORDS.sw.back }).click()
    await expect(no).toBeChecked()
    if (pick === "tap") await pickTile(page, WORDS.sw.no)
    else {
      await no.focus()
      await page.keyboard.press(pick)
    }
    await expect(sendButton(page, "sw"), `${pick} on the checked answer moves on`).toBeVisible()
  }
})
