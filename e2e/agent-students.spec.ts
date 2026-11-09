import { expect, test, type Page } from "@playwright/test"

import { agentWithLogin, studentInterview, studentLead, type StudentsAgent } from "../tests/support/agent-students"
import { signedIn } from "../tests/support/db"
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

const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name })

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
  await expect(page.getByRole("heading", { name: `Wanafunzi wanaotumia Code ya Punguzo ${agent.code} (4)` })).toBeVisible()
  // Newest first.
  await expect(page.getByRole("listitem")).toHaveText([/Tatu Kadi/, /Asha Kadi/, /Juma Kadi/, /Neema Kadi/])

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
  await expect(page.getByText("AL-RAHMAH COMPLEX")).toBeVisible()
  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("heading", { name: `Students using Discount code ${agent.code} (4)` })).toBeVisible()
  await expect(card(page, "Juma Kadi")).toContainText("Results aren't out yet")
  await expect(card(page, "Tatu Kadi")).toContainText("Visited · not active")
})

test("past one page, Onyesha zaidi shows more and the name search finds one student", async ({ page }) => {
  const agent = await agentWithLogin()
  for (let n = 1; n <= 21; n++) {
    await studentLead({ name: `Mtoto ${String(n).padStart(2, "0")} Orodha`, code: agent.code, createdAt: `2026-08-01 ${String(n).padStart(2, "0")}:00+03` })
  }
  await signInAgent(page, agent)
  await expect(page.getByRole("listitem")).toHaveCount(20)
  await page.getByRole("link", { name: "Onyesha zaidi" }).click()
  await expect(page.getByRole("listitem")).toHaveCount(21)
  await expect(page.getByRole("link", { name: "Onyesha zaidi" })).toHaveCount(0)

  await page.getByLabel("Tafuta kwa jina la mwanafunzi").fill("mtoto 07")
  await page.getByRole("button", { name: "Tafuta" }).click()
  await expect(page.getByRole("listitem")).toHaveText([/Mtoto 07 Orodha/])
  await expect(page.getByRole("heading", { name: `Wanafunzi wanaotumia Code ya Punguzo ${agent.code} (21)` })).toBeVisible()
})

test("an empty list shows the code, the link, Copy and the number-free WhatsApp share", async ({ page }) => {
  const agent = await agentWithLogin()
  await signInAgent(page, agent)
  await expect(page.getByRole("heading", { name: `Wanafunzi wanaotumia Code ya Punguzo ${agent.code} (0)` })).toBeVisible()
  await expect(page.getByText(`/apply?ref=${agent.code}`)).toBeVisible()
  await expect(page.getByRole("button", { name: "Nakili kiungo" })).toBeVisible()
  const share = page.getByRole("link", { name: "Shiriki kwenye WhatsApp" })
  await expect(share).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*${agent.code}`))
  await expect(page.getByRole("listitem")).toHaveCount(0)
})

test("a switched-off agent still signed in sees only the message", async ({ page }) => {
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Huwezi kuingia kwa sasa. Piga simu ofisini.")
  await expect(page.getByRole("main")).not.toContainText("Siri Kadi")
  await expect(page.getByRole("main")).not.toContainText(agent.code)
  await expect(page.getByRole("link", { name: "Shiriki kwenye WhatsApp" })).toHaveCount(0)
})
