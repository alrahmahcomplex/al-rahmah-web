import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { agentWithLogin, studentInterview, studentLead, type StudentsAgent } from "../tests/support/agent-students"
import { asSystem, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { chooseLanguage } from "./discount-code"
import { logIn } from "./log-in"

// The agents app (#195, #497, #539) on a phone: /home, /students,
// /students/[id] and /reminders. Each test makes its own agent and leads with
// invented names.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function signInAgent(page: Page, agent: StudentsAgent) {
  await chooseLanguage(page.context(), "sw")
  await logIn(page, agent.email, agent.password)
  await expect(page).toHaveURL(/\/home$/)
}

// The text a WhatsApp link carries, from its address.
async function whatsAppText(link: ReturnType<Page["getByRole"]>) {
  const href = await link.getAttribute("href")
  expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/)
  return decodeURIComponent(href!.slice("https://wa.me/?text=".length))
}

test("the agent lands on /home, sees stats, opens /students and /students/[id] with results only once paid", async ({ page }) => {
  const agent = await agentWithLogin()
  const other = await agentWithLogin()
  const declined = await studentLead({ name: "Neema Kadi", code: agent.code, status: "Declined", createdAt: "2026-09-01 09:00+03" })
  await studentInterview(declined, { result: "Failed", score: 31.5, paid: true, registeredAt: "2026-09-04 09:00+03" })
  const waiting = await studentLead({ name: "Juma Kadi", code: agent.code, status: "Interviewed", createdAt: "2026-09-02 09:00+03" })
  await studentInterview(waiting, { result: "Passed", score: 88, paid: false, registeredAt: "2026-09-05 09:00+03" })
  const passed = await studentLead({ name: "Asha Kadi", code: agent.code, status: "Interviewed", createdAt: "2026-09-03 09:00+03" })
  await studentInterview(passed, { result: "Passed", score: 72.5, paid: true, registeredAt: "2026-09-06 09:00+03" })
  const closed = await studentLead({ name: "Tatu Kadi", code: agent.code, status: "Visited", closure: "Inactive", createdAt: "2026-09-04 09:00+03" })
  const foreignId = await studentLead({ name: "Siri Nje", code: other.code, status: "Applied" })

  await signInAgent(page, agent)
  await expect(page.getByRole("heading", { name: "Habari, Rehema!" })).toBeVisible()
  await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Shiriki code kwenye WhatsApp" })).toBeVisible()

  // Stat tiles link to /students.
  await page.getByRole("link", { name: /Waliojisajili wote/ }).click()
  await expect(page).toHaveURL(/\/students$/)
  const studentRows = page.locator("main a.kit-row")
  await expect(studentRows).toHaveText([/Tatu Kadi.*haendelei kwa sasa/, /Asha Kadi/, /Juma Kadi/, /Neema Kadi/])
  await expect(page.getByRole("main")).not.toContainText(/Staff-only explanation|Mzazi|\+2556|50,000|50000|Inactive|Family requested closure/)

  // Open Tatu Kadi -> shows "haendelei kwa sasa" without exposing closure reason.
  await page.goto(`/students/${closed}`)
  await expect(page.getByText("haendelei kwa sasa")).toBeVisible()
  await expect(page.getByRole("main")).not.toContainText(/Inactive|Family requested closure/)

  // Open Asha Kadi -> paid result shows.
  await page.goto(`/students/${passed}`)
  await expect(page).toHaveURL(new RegExp(`/students/${passed}$`))
  await expect(page.getByRole("heading", { name: "Asha Kadi" })).toBeVisible()
  await expect(page.getByText("Amefaulu · alama 72.5%")).toBeVisible()

  // Open Juma Kadi -> unpaid result stays hidden.
  await page.goto(`/students/${waiting}`)
  await expect(page.getByText("Matokeo bado hayajatoka")).toBeVisible()
  await expect(page.getByRole("main")).not.toContainText("88")

  // Open Neema Kadi -> Declined with translated reason.
  await page.goto(`/students/${declined}`)
  await expect(page.getByText("Hakuendelea")).toBeVisible()
  await expect(page.getByText("Hakufaulu usaili")).toBeVisible()

  // Another agent's student and a missing id show the same not-found page.
  await page.goto(`/students/${foreignId}`)
  await expect(page.getByText("Mwanafunzi huyu hajapatikana")).toBeVisible()
  await page.goto("/students/00000000-0000-4000-8000-000000000999")
  await expect(page.getByText("Mwanafunzi huyu hajapatikana")).toBeVisible()

  // Switch language from the top bar menu.
  await page.goto("/home")
  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("heading", { name: "Hello, Rehema!" })).toBeVisible()
})

test("past one page on /students, Onyesha zaidi shows more, FilterMenu filters by step, and top bar search finds one student", async ({ page }) => {
  const agent = await agentWithLogin()
  for (let n = 1; n <= 21; n++) {
    await studentLead({ name: `Mtoto ${String(n).padStart(2, "0")} Orodha`, code: agent.code, createdAt: `2026-08-01 ${String(n).padStart(2, "0")}:00+03` })
  }
  await studentLead({ name: "Rehema Visited", code: agent.code, status: "Visited" })
  await signInAgent(page, agent)
  await page.goto("/students")

  await expect(page.locator("main a.kit-row")).toHaveCount(20)
  await page.getByRole("link", { name: "Onyesha zaidi" }).click()
  await expect(page.locator("main a.kit-row")).toHaveCount(22)
  await expect(page.getByRole("link", { name: "Onyesha zaidi" })).toHaveCount(0)

  // Filter via FilterMenu radio dropdown.
  await page.getByRole("button", { name: /^Chuja:/ }).click()
  await page.getByRole("menuitemradio", { name: /Ametembelea shule/ }).click()
  await expect(page).toHaveURL(/\/students\?step=Visited$/)
  await expect(page.locator("main a.kit-row")).toHaveText([/Rehema Visited/])

  // Search from top bar.
  const search = page.getByRole("searchbox", { name: "Tafuta mwanafunzi" }).or(page.getByPlaceholder("Tafuta mwanafunzi"))
  await search.fill("mtoto 07")
  await search.press("Enter")
  await expect(page).toHaveURL(/\/students\?q=mtoto\+07/)
  await expect(page.locator("main a.kit-row")).toHaveText([/Mtoto 07 Orodha/])
  await expect(page.getByRole("link", { name: "Onyesha wote" })).toBeVisible()
})

test("with no students yet, /home shows the empty note and the ready-made share messages with the code's amount", async ({ page }) => {
  const agent = await agentWithLogin()
  await signInAgent(page, agent)
  await expect(page.getByRole("heading", { name: "Habari, Rehema!" })).toBeVisible()
  await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
  await expect(page.getByText("Familia ikitumia code yako, utaona hapa kila hatua yake")).toBeVisible()

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
  await expect(page.getByRole("button", { name: "Nakili kiungo" }).first()).toBeVisible()
})

test("reminders open /students/[id] where the agent sends via WhatsApp or copies the SMS message", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const agent = await agentWithLogin()
  const ago = (days: number) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date())
    const [y, m, d] = today.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
  }
  const farajiId = await studentLead({ name: "FARAJI OMARI SALUM", code: agent.code, createdAt: `${ago(23)} 09:00+03` })
  await studentLead({ name: "Daudi Mpya", code: agent.code, createdAt: `${ago(1)} 09:00+03` })
  await studentLead({ name: "Rehema Visited", code: agent.code, status: "Visited", createdAt: `${ago(30)} 09:00+03`, visitDate: ago(3) })
  await signInAgent(page, agent)

  await expect(page.getByRole("heading", { name: "Familia zako ziko wapi" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Wanaweza kukumbushwa (1)" })).toBeVisible()
  const remRow = page.getByRole("link", { name: /FARAJI OMARI SALUM/ })
  await expect(remRow).toContainText("Mkumbushe mzazi kuhusu usaili.")
  await remRow.click()
  await expect(page).toHaveURL(new RegExp(`/students/${farajiId}$`))

  const message =
    "Habari! Hongera kwa kumsajili Faraji Al-Rahmah Complex. Karibuni mtembelee shule muone mazingira. Kwa maswali, piga ofisi ya udahili: +255 673 526 644."
  await expect(page.getByText(message)).toBeVisible()
  expect(await whatsAppText(page.getByRole("link", { name: "Fungua WhatsApp" }))).toBe(message)
  await page.getByRole("button", { name: "Nakili ujumbe wa SMS" }).click()
  await expect(page.getByText("Ujumbe umenakiliwa. Utume kwa SMS kutoka simu yako.")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message)
})

test("a switched-off agent sees only the paused card and signs out via the menu confirmation sheet", async ({ page }) => {
  const agent = await agentWithLogin()
  await studentLead({ name: "Siri Kadi", code: agent.code })
  await signInAgent(page, agent)
  await expect(page.getByText(agent.code, { exact: true })).toBeVisible()

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

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("menuitem", { name: "Toka" }).click()
  const sheet = page.getByRole("dialog", { name: "Utoke kwenye akaunti?" })
  await expect(sheet).toBeVisible()
  await sheet.getByRole("button", { name: "Toka" }).click()
  await expect(page).toHaveURL(/\/auth$/)

  // Signed out for real: /home now asks to sign in.
  await page.goto("/home")
  await expect(page).toHaveURL(/\/auth\?from=home$/)
})

test("the welcome greets only the login whose password was just set", async ({ page, context }) => {
  const agent = await agentWithLogin()
  await signInAgent(page, agent)
  const userId = await asSystem(async (sql) => (await sql.query<{ id: string }>("select id from auth.users where email = $1", [agent.email])).rows[0]?.id)
  if (!userId) throw new Error("no login for the fixture agent")
  const welcome = (value: string) => ({ name: "agent-welcome", value, domain: new URL(page.url()).hostname, path: "/home", httpOnly: true })

  // A greeting left for another login doesn't greet this one.
  await context.addCookies([welcome(randomUUID())])
  await page.reload()
  await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toHaveCount(0)

  // Its own greets once; the button spends it.
  await context.addCookies([welcome(userId)])
  await page.reload()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toBeVisible()
  await page.getByRole("button", { name: "Ona Wanafunzi Niliowaleta" }).click()
  await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Umeidhinishwa!" })).toHaveCount(0)
})

test("without a session, /home and /discount-code/students send the agent to sign in under a note saying why", async ({ page }) => {
  await chooseLanguage(page.context(), "sw")
  await page.goto("/discount-code/students")
  await expect(page).toHaveURL(/\/auth\?from=home$/)
  await expect(page.getByText("Ingia uone wanafunzi uliowaleta.")).toBeVisible()
})
