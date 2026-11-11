import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import { chooseLanguage, FORBIDDEN, fillRegistration, WORDS } from "./discount-code"
import { logIn } from "./log-in"

// Sign-up with an email and claiming an existing Discount code (#193) end to
// end: each outcome's message on the Discount code page, and the Manager's
// Confirm, Reject and Save and send invite on the "Awaiting email
// confirmation" queue, with the invite landing in local Mailpit. Every agent
// is the test's own, with invented names, numbers and example.test emails.

const MAILPIT = "http://127.0.0.1:55424"
const t = WORDS.sw

const notice = (page: Page) => page.getByRole("main").getByRole("alert")

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

// An agent the Manager created, as an imported one arrives: Approved, with
// no email unless one is given.
async function existingAgent(address = "") {
  const fullName = `Zawadi Dai ${randomUUID().slice(0, 8)}`
  const number = phone()
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", {
    full_name: fullName,
    phone: number,
    whatsapp: "",
    email: address,
    code: "",
  })
  const row = data as { outcome: string; agent: { id: string; code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  return { id: row.agent.id, code: row.agent.code, fullName, phone: number }
}

type Entry = { name: string; phone: string; email: string; code?: string; hasCode?: boolean }

async function send(page: Page, entry: Entry) {
  await chooseLanguage(page.context(), "sw")
  await page.goto("/discount-code")
  // hasCode answers "Tayari una code?" with Ndiyo; without it, Hapana.
  if (entry.hasCode) await fillRegistration(page, "sw", entry, { code: entry.code ?? "" })
  else await fillRegistration(page, "sw", entry)
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
}

async function claim(page: Page, agent: { fullName: string; phone: string; code: string }, address: string, name = agent.fullName) {
  await send(page, { name, phone: agent.phone, email: address, code: agent.code, hasCode: true })
}

async function invitesTo(address: string): Promise<number> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
  const { messages } = (await search.json()) as { messages: unknown[] }
  return messages.length
}

async function storedEmail(agentId: string) {
  const { data, error } = await secretClient().from("marketing_agents").select("email").eq("id", agentId).single()
  if (error) throw new Error(error.message)
  return data.email as string | null
}

async function signInManager(page: Page) {
  await logIn(page, MANAGER.email, MANAGER.password)
  // Signing in waits on local Auth, which runs slowly with the other specs.
  await expect(page).toHaveURL(/\/staff$/, { timeout: 15_000 })
}

function queueCard(page: Page, fullName: string) {
  return page.getByRole("region", { name: new RegExp(`^${fullName}`) })
}

test.describe("the Discount code page's answers", () => {
  test.use({ viewport: PHONE_WIDTH })

  test("1 and 8. a claim on an imported code shows the code, the link and share, and says to check spam; a retry shows it again", async ({
    page,
  }) => {
    const agent = await existingAgent()
    const address = email("claim")
    await claim(page, agent, address)

    await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()
    await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`/apply\\?ref=${agent.code}$`))).toBeVisible()
    await expect(page.getByRole("link", { name: t.share })).toBeVisible()
    await expect(page.getByText(/Shule itathibitisha barua pepe yako/)).toContainText("angalia spam")
    expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN)
    expect(await storedEmail(agent.id)).toBeNull()

    await claim(page, agent, address)
    await expect(page.getByText(agent.code, { exact: true })).toBeVisible()
  })

  test("2. a phone that has a code, answered Hapana: say it has a code", async ({ page }) => {
    const agent = await existingAgent()
    await send(page, { name: agent.fullName, phone: agent.phone, email: email("two") })
    await expect(notice(page)).toHaveText(
      "Namba hii tayari ina Code ya Punguzo. Weka alama kwenye 'Tayari una code?' na uiandike, au piga simu ofisini.",
    )
    await expect(page.getByLabel(t.name)).toHaveValue(agent.fullName)
  })

  test("3. the code matches but the mobile doesn't", async ({ page }) => {
    const agent = await existingAgent()
    await send(page, { name: agent.fullName, phone: phone(), email: email("three"), code: agent.code, hasCode: true })
    await expect(notice(page)).toHaveText("Hatukuweza kulinganisha code na namba hii. Zihakiki, au piga simu ofisini.")
  })

  test("4. nothing matches, a switched-off code included", async ({ page }) => {
    await send(page, { name: "Zawadi Hakuna", phone: phone(), email: email("four"), code: `NO-${randomInt(1000, 9999)}`, hasCode: true })
    await expect(notice(page)).toHaveText("Hatukupata code hii. Ihakiki, au piga simu ofisini.")

    const off = await existingAgent()
    const switched = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", {
      agent_id: off.id,
      kind: "switched_off",
      reason: "E2E setup",
    })
    if (switched.error) throw new Error(switched.error.message)
    await claim(page, off, email("four-off"))
    await expect(notice(page)).toHaveText("Hatukupata code hii. Ihakiki, au piga simu ofisini.")
  })

  test("5. a claim already waiting gets the calm reply, with the same or another email", async ({ page }) => {
    const agent = await existingAgent()
    const address = email("five")
    await claim(page, agent, address)
    await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()

    await claim(page, agent, address, "Jina Lingine")
    await expect(notice(page)).toHaveText("Tumepokea ombi lako; shule itathibitisha.")
    await claim(page, agent, email("five-other"))
    await expect(notice(page)).toHaveText("Tumepokea ombi lako; shule itathibitisha.")
  })

  test("6. invited but not joined: check spam or ask for a new link", async ({ page }) => {
    const address = email("six")
    const agent = await existingAgent(address)
    await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.agent_events (agent_id, kind, result, email) values ($1, 'invite', 'started', $2) returning id",
        [agent.id, address],
      )
      await sql.query("insert into public.agent_events (agent_id, kind, result, attempt_id, email) values ($1, 'invite', 'sent', $2, $3)", [
        agent.id,
        rows[0].id,
        address,
      ])
    })
    await claim(page, agent, email("six-typed"))
    await expect(notice(page)).toHaveText("Tumekutumia barua pepe. Angalia spam, au tumia 'Tuma kiungo kipya'.")
    expect(await storedEmail(agent.id)).toBe(address)
  })

  test("7. already joined: a sign-in link", async ({ page }) => {
    const address = email("seven")
    const agent = await existingAgent(address)
    const login = await secretClient().auth.admin.createUser({ email: address, password: "agent-e2e-password", email_confirm: true })
    if (login.error) throw new Error(login.error.message)

    await claim(page, agent, email("seven-typed"))
    await expect(notice(page)).toContainText("Tayari una akaunti. Ingia.")
    await notice(page).getByRole("link", { name: "Ingia" }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test("an email already in use gets the neutral reply", async ({ page }) => {
    await send(page, { name: "Zawadi Barua", phone: phone(), email: MANAGER.email })
    await expect(notice(page)).toHaveText("Barua pepe hii haiwezi kutumika. Tumia nyingine au piga simu ofisini.")
  })

  test("the sign-up prompt and the sign-in prompt stay apart", async ({ page }) => {
    await chooseLanguage(page.context(), "sw")
    await page.goto("/discount-code")
    await fillRegistration(page, "sw", { name: "Zawadi Barua", phone: phone(), email: email("apart") })
    await page.getByRole("button", { name: "Badilisha Code" }).click()
    await expect(page.getByRole("group", { name: t.hasCode })).toBeVisible()
    await expect(page.getByText("Una code lakini bado hujapokea barua pepe ya kuweka nenosiri? Chagua Ndiyo.")).toBeVisible()
    await expect(page.getByText("Umeshaweka nenosiri?")).toBeVisible()
    await page.getByRole("link", { name: "Ingia", exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe("the Manager's queue", () => {
  test("Confirm saves the email, rejects the competing claim, and sends the invite", async ({ page, browser }) => {
    const agent = await existingAgent()
    const address = email("confirm")
    const rival = email("rival")
    const visitor = await browser.newPage({ viewport: PHONE_WIDTH })
    await claim(visitor, agent, address, `${agent.fullName} Mwenyewe`)
    await expect(visitor.getByRole("heading", { level: 1, name: t.done })).toBeVisible()
    await claim(visitor, agent, rival, "Mtu Mwingine")
    await expect(notice(visitor)).toHaveText("Tumepokea ombi lako; shule itathibitisha.")
    await visitor.close()

    await signInManager(page)
    await page.goto("/staff/agents?status=all")
    await expect(page.getByRole("link", { name: /^Awaiting email confirmation \(\d+\)$/ })).toBeVisible()
    await expect(page.getByText(/^\s*\(\d+ awaiting email confirmation, /)).toBeVisible()
    await page.getByRole("link", { name: /^Awaiting email confirmation/ }).click()

    const card = queueCard(page, agent.fullName)
    await expect(card).toContainText(`Phone ${agent.fullName} on`)
    await expect(card).toContainText("1 other attempt")
    await expect(card).toContainText(`${agent.fullName} Mwenyewe`)
    await expect(card).toContainText("Mtu Mwingine")
    await card.getByRole("button", { name: `Confirm ${address} for ${agent.fullName}` }).click()
    await expect(page.getByText(`Email confirmed for ${agent.fullName}. Invite sent to ${address}.`)).toBeVisible()
    await expect(card).toHaveCount(0)

    expect(await storedEmail(agent.id)).toBe(address)
    await expect.poll(() => invitesTo(address), { timeout: 15_000 }).toBe(1)
    expect(await invitesTo(rival)).toBe(0)
  })

  test("Reject leaves the record without an email", async ({ page }) => {
    const agent = await existingAgent()
    const address = email("reject")
    await claim(page, agent, address)
    await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()

    await signInManager(page)
    await page.goto("/staff/agents?status=all&account=awaiting-confirmation")
    const card = queueCard(page, agent.fullName)
    await card.getByRole("button", { name: `Reject ${address} for ${agent.fullName}` }).click()
    await expect(page.getByText("Claim rejected. The record's email stays empty.")).toBeVisible()
    await expect(card).toHaveCount(0)
    expect(await storedEmail(agent.id)).toBeNull()
    expect(await invitesTo(address)).toBe(0)
  })

  test("Save and send invite saves the corrected email and sends the invite there", async ({ page }) => {
    const agent = await existingAgent()
    const typo = email("typo")
    const corrected = email("corrected")
    await claim(page, agent, typo)
    await expect(page.getByRole("heading", { level: 1, name: t.done })).toBeVisible()

    await signInManager(page)
    await page.goto("/staff/agents?status=all&account=awaiting-confirmation")
    await queueCard(page, agent.fullName).getByRole("button", { name: `Save and send invite for ${agent.fullName}` }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Email").fill(corrected)
    await dialog.getByRole("button", { name: "Save and send invite" }).click()
    await expect(page.getByText(`Email confirmed for ${agent.fullName}. Invite sent to ${corrected}.`)).toBeVisible()

    expect(await storedEmail(agent.id)).toBe(corrected)
    await expect.poll(() => invitesTo(corrected), { timeout: 15_000 }).toBe(1)
    expect(await invitesTo(typo)).toBe(0)
  })
})
