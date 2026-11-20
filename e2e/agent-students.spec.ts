import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { agentWithLogin, studentInterview, studentLead, type StudentsAgent } from "../tests/support/agent-students"
import { asSystem, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { chooseLanguage } from "./discount-code"
import { logIn } from "./log-in"

// The students using an agent's Discount code (#195) on a phone. Each test
// makes its own agent and leads, with invented names.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function signInAgent(page: Page, agent: StudentsAgent) {
  await chooseLanguage(page.context(), "sw")
  await logIn(page, agent.email, agent.password)
  await expect(page).toHaveURL(/\/discount-code\/students$/)
}

// The student cards, apart from the reminders above them (#497), which are list items too.
const cards = (page: Page) => page.getByRole("listitem").filter({ hasNot: page.getByRole("button", { name: /^(Andaa ujumbe|Prepare a message)$/ }) })
const card = (page: Page, name: string) => cards(page).filter({ hasText: name })

test("the agent sees a card per student, with the result only once it is out", async ({ page }) => {
  const agent = await agentWithLogin()
  const declined = await studentLead({ name: "Neema Kadi", code: agent.code, status: "Declined", createdAt: "2026-09-01 09:00+03" })
  await studentInterview(declined, { result: "Failed", score: 31.5, paid: true, registeredAt: "2026-09-04 09:00+03" })
  const waiting = await studentLead({ name: "Juma Kadi", code: agent.code, status: "Interviewed", createdAt: "2026-09-02 09:00+03" })
  await studentInterview(waiting, { result: "Passed", score: 88, paid: false, registeredAt: "2026-09-05 09:00+03" })
  const passed = await studentLead({ name: "Asha Kadi", code: agent.code, status: "Interviewed", createdAt: "2026-09-03 09:00+03" })
  await studentInterview(passed, { result: "Passed", score: 72.5, paid: true, registeredAt: "2026-09-06 09:00+03" })
  await studentLead({ name: "Tatu Kadi", code: agent.code, status: "Visited", closure: "Inactive", createdAt: "2026-09-04 09:00+03" })

  await signInAgent(page, agent)
  await expect(page.getByRole("heading", { name: "Habari, Rehema!" })).toBeVisible()
  await expect(page.getByText(`Code yako ${agent.code}`)).toBeVisible()
  // Newest first.
  await expect(cards(page)).toHaveText([/Tatu Kadi/, /Asha Kadi/, /Juma Kadi/, /Neema Kadi/])

  await expect(card(page, "Asha Kadi")).toContainText("Amefanya usaili")
  await expect(card(page, "Asha Kadi")).toContainText("Usaili: Amefaulu, alama 72.5%")
  await expect(card(page, "Juma Kadi")).toContainText("Matokeo bado hayajatoka")
  await expect(card(page, "Juma Kadi")).not.toContainText("88")
  await expect(card(page, "Neema Kadi")).toContainText("Hakuendelea")
  await expect(card(page, "Neema Kadi")).toContainText("Hakufaulu usaili")
  await expect(card(page, "Tatu Kadi")).toContainText("Ametembelea shule · haendelei kwa sasa")
  await expect(card(page, "Tatu Kadi")).toContainText("STD 3")
  await expect(page.getByRole("main")).not.toContainText(/Staff-only explanation|Mzazi|\+2556|50,000|50000/)
  await expect(page.getByText("Huoni familia? Waombe wahakikishe walitumia code yako, au piga simu ofisini.")).toBeVisible()
  // One page: no search, no Onyesha zaidi.
  await expect(page.getByRole("search")).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Onyesha zaidi" })).toHaveCount(0)

  // The language lives in the top bar's menu, under the COMPLEX badge.
  await expect(page.getByText("AL-RAHMAH COMPLEX", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("heading", { name: "Hello, Rehema!" })).toBeVisible()
  await expect(card(page, "Juma Kadi")).toContainText("Results aren't out yet")
  await expect(card(page, "Tatu Kadi")).toContainText("Visited · not active")
})

test("past one page, Onyesha zaidi shows more and the name search finds one student", async ({ page }) => {
  const agent = await agentWithLogin()
  for (let n = 1; n <= 21; n++) {
    await studentLead({ name: `Mtoto ${String(n).padStart(2, "0")} Orodha`, code: agent.code, createdAt: `2026-08-01 ${String(n).padStart(2, "0")}:00+03` })
  }
  await signInAgent(page, agent)
  await expect(cards(page)).toHaveCount(20)
  await page.getByRole("link", { name: "Onyesha zaidi" }).click()
  await expect(cards(page)).toHaveCount(21)
  await expect(page.getByRole("link", { name: "Onyesha zaidi" })).toHaveCount(0)

  await page.getByLabel("Tafuta kwa jina la mwanafunzi").fill("mtoto 07")
  await page.getByRole("button", { name: "Tafuta" }).click()
  await expect(cards(page)).toHaveText([/Mtoto 07 Orodha/])
  await expect(page.getByRole("link", { name: "Wote (21)" })).toBeVisible()
})

// The text a WhatsApp link carries, from its address.
async function whatsAppText(link: ReturnType<Page["getByRole"]>) {
  const href = await link.getAttribute("href")
  expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
  return decodeURIComponent(href!.slice("https://wa.me/?text=".length))
}

test("with no students yet, the page says what will show and offers the three ready-made messages, with the code's amount", async ({ page }) => {
  const agent = await agentWithLogin()
  await signInAgent(page, agent)
  await expect(page.getByRole("heading", { name: "Habari, Rehema!" })).toBeVisible()
  await expect(page.getByText(`Code yako ${agent.code}`)).toBeVisible()
  await expect(page.getByText("Familia ikitumia code yako, utaona hapa kila hatua yake")).toBeVisible()
  // The picker is on the page, so there is no Share button to open it.
  await expect(page.getByRole("button", { name: "Shiriki code yako" })).toHaveCount(0)

  const share = page.getByRole("link", { name: "Shiriki kwenye WhatsApp" })
  const link = `/apply?ref=${agent.code}`
  expect(await whatsAppText(share)).toMatch(
    new RegExp(`^Jaza fomu ya udahili ya Al-Rahmah Complex kupitia kiungo hiki\\. Code yangu ya Punguzo, ${agent.code}, itakuwa imeshajazwa na inakupa punguzo la TZS 10,000 kwenye ada ya usaili: http\\S+${link.replace("?", "\\?")}$`),
  )
  await page.getByRole("button", { name: "Kwa kikundi" }).click()
  expect(await whatsAppText(share)).toMatch(/^Wazazi, udahili wa Al-Rahmah Complex uko wazi\. .* inatoa punguzo la TZS 10,000 kwenye ada ya usaili: /)
  await page.getByRole("button", { name: "Fupi" }).click()
  expect(await whatsAppText(share)).toMatch(new RegExp(`^Al-Rahmah Complex: jaza fomu hapa, code ${agent.code} \\(punguzo TZS 10,000\\): `))
  await expect(page.getByRole("button", { name: "Nakili ujumbe" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Nakili kiungo" })).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
})

test("the dashboard counts each step, lists who could use a reminder, and sends it from the agent's own WhatsApp", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const agent = await agentWithLogin()
  const ago = (days: number) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date())
    const [y, m, d] = today.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
  }
  await studentLead({ name: "FARAJI OMARI SALUM", code: agent.code, createdAt: `${ago(23)} 09:00+03` })
  await studentLead({ name: "Daudi Mpya", code: agent.code, createdAt: `${ago(1)} 09:00+03` })
  await studentLead({ name: "Rehema Visited", code: agent.code, status: "Visited", createdAt: `${ago(30)} 09:00+03`, visitDate: ago(3) })
  await signInAgent(page, agent)

  await expect(page.getByRole("heading", { name: "Familia zako ziko wapi" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Amejisajili (2)" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Ametembelea shule (1)" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Wanaweza kukumbushwa (1)" })).toBeVisible()
  const waiting = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Andaa ujumbe" }) })
  await expect(waiting).toHaveCount(1)
  await expect(waiting).toContainText("FARAJI OMARI SALUM")
  await expect(waiting).toContainText("Alijisajili siku 23 zilizopita, bado hajatembelea shule.")

  await waiting.getByRole("button", { name: "Andaa ujumbe" }).click()
  const sheet = page.getByRole("dialog", { name: "Ujumbe wa kukumbusha" })
  await expect(sheet).toBeVisible()
  const message =
    "Habari! Hongera kwa kumsajili Faraji Al-Rahmah Complex. Karibuni mtembelee shule muone mazingira. Kwa maswali, piga ofisi ya udahili: +255 673 526 644."
  await expect(sheet.getByText(message)).toBeVisible()
  // The text and no number: the agent picks the chat.
  expect(await whatsAppText(sheet.getByRole("link", { name: "Fungua WhatsApp" }))).toBe(message)
  await sheet.getByRole("button", { name: "Nakili ujumbe" }).click()
  await expect(page.getByText("Ujumbe umenakiliwa")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message)
  await page.keyboard.press("Escape")
  await expect(sheet).toHaveCount(0)

  // One step at a time; the counts stay whole.
  await page.getByRole("link", { name: "Ametembelea shule (1)" }).click()
  await expect(page).toHaveURL(/\?step=Visited$/)
  await expect(cards(page)).toHaveText([/Rehema Visited/])
  await expect(page.getByRole("link", { name: "Amejisajili (2)" })).toBeVisible()
  await page.getByRole("link", { name: "Wote (3)" }).click()
  await expect(cards(page)).toHaveCount(3)

  // Share opens the same three messages in a sheet.
  await page.getByRole("button", { name: "Shiriki code yako" }).click()
  const shareSheet = page.getByRole("dialog", { name: "Shiriki code yako" })
  await expect(shareSheet.getByRole("button", { name: "Kwa mzazi" })).toHaveAttribute("aria-pressed", "true")
  expect(await whatsAppText(shareSheet.getByRole("link", { name: "Shiriki kwenye WhatsApp" }))).toContain("TZS 10,000")
})

test("a switched-off agent still signed in sees only the paused card, with no reason code, and can sign out", async ({ page }) => {
  const agent = await agentWithLogin()
  await studentLead({ name: "Siri Kadi", code: agent.code })
  await signInAgent(page, agent)
  await expect(card(page, "Siri Kadi")).toBeVisible()

  const { error } = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", {
    agent_id: agent.id,
    kind: "switched_off",
    reason: "Left the school",
  })
  expect(error).toBeNull()

  await page.reload()
  const alert = page.getByRole("main").getByRole("alert")
  await expect(alert.getByRole("heading", { name: "Code yako imesimamishwa" })).toBeVisible()
  await expect(alert).toContainText("Ofisi ya Masoko imesimamisha Code yako ya Punguzo kwa sasa.")
  await expect(alert).not.toContainText("switched_off")
  await expect(page.getByRole("main")).not.toContainText("Siri Kadi")
  await expect(page.getByRole("main")).not.toContainText(agent.code)
  await expect(page.getByRole("link", { name: "Shiriki kwenye WhatsApp" })).toHaveCount(0)

  await alert.getByRole("button", { name: "Toka" }).click()
  await expect(page).toHaveURL(/\/auth$/)
  // Signed out for real: the students page now asks to sign in.
  await page.goto("/discount-code/students")
  await expect(page).toHaveURL(/\/auth\?from=students$/)
})

// The one-time greeting after set-password follows the login it was left
// for, never a code or a cookie alone (#497 review).
test("the welcome greets only the login whose password was just set", async ({ page, context }) => {
  const agent = await agentWithLogin()
  await signInAgent(page, agent)
  const userId = await asSystem(async (sql) => (await sql.query<{ id: string }>("select id from auth.users where email = $1", [agent.email])).rows[0]?.id)
  if (!userId) throw new Error("no login for the fixture agent")
  // As set-password sets it: this host, this path.
  const welcome = (value: string) => ({ name: "agent-welcome", value, domain: new URL(page.url()).hostname, path: "/discount-code/students", httpOnly: true })

  // A greeting left for another login doesn't greet this one.
  await context.addCookies([welcome(randomUUID())])
  await page.reload()
  await expect(page.getByText(`Code yako ${agent.code}`)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toHaveCount(0)

  // Its own greets once; the button spends it.
  await context.addCookies([welcome(userId)])
  await page.reload()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toBeVisible()
  await page.getByRole("button", { name: "Ona Wanafunzi Niliowaleta" }).click()
  await expect(page.getByText(`Code yako ${agent.code}`)).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toHaveCount(0)
})

test("without a session, the students page sends the agent to sign in under a note saying why", async ({ page }) => {
  await chooseLanguage(page.context(), "sw")
  await page.goto("/discount-code/students")
  await expect(page).toHaveURL(/\/auth\?from=students$/)
  await expect(page.getByText("Ingia uone wanafunzi uliowaleta.")).toBeVisible()
})
