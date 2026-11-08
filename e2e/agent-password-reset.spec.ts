import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { secretClient, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// Agents reset their own password (#194) end to end, against local Supabase
// with Turnstile's always-pass test keys: "Umesahau nenosiri?" sends a reset
// email to local Mailpit, the shared reset page (#265) sets the new password,
// and an expired link's "Tuma kiungo kipya" sends an invited agent a new
// invite.
// Each test makes its own agent with an example.test email.

const MAILPIT = "http://127.0.0.1:55424"
const PASSWORD = "agent-reset-password"
const SENT =
  "Kama barua pepe hii ina akaunti, tumeitumia kiungo. Angalia barua pepe zako, pamoja na spam. Kiungo kinatumika mara moja tu, ndani ya saa 24."

type Email = { subject: string; html: string; link: string }

async function emailsTo(address: string): Promise<Email[]> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
  const { messages } = (await search.json()) as { messages: { ID: string; Created: string }[] }
  const ordered = [...messages].sort((a, b) => a.Created.localeCompare(b.Created))
  return Promise.all(
    ordered.map(async ({ ID }) => {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as { Subject: string; HTML: string }
      const href = message.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1] ?? ""
      return { subject: message.Subject, html: message.HTML, link: href.replaceAll("&amp;", "&") }
    }),
  )
}

async function waitForEmails(address: string, count: number): Promise<Email[]> {
  await expect.poll(async () => (await emailsTo(address)).length, { timeout: 15_000 }).toBe(count)
  return emailsTo(address)
}

// An Approved agent of the test's own, created by the Manager with an email.
async function newAgent() {
  const suffix = randomUUID().slice(0, 8)
  const address = `amani-${suffix}@example.test`
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", {
    full_name: `Amani Reset ${suffix}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email: address,
    code: "",
  })
  const row = data as { outcome: string; agent: { id: string; code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  return { id: row.agent.id, code: row.agent.code, address }
}

// An agent who has joined: a confirmed login with a password, marked as an
// agent's so the recovery email uses the Discount code wording.
async function joinedAgent() {
  const agent = await newAgent()
  const { error } = await secretClient().auth.admin.createUser({
    email: agent.address,
    password: "old-password-123",
    email_confirm: true,
    user_metadata: { kind: "agent" },
  })
  if (error) throw new Error(`could not create the login: ${error.message}`)
  return agent
}

// An agent the Manager invited, through the same database calls as the
// Agents screen, who hasn't joined.
async function invitedAgent() {
  const agent = await newAgent()
  const manager = await signedIn(MANAGER)
  const prepared = await manager.rpc("prepare_agent_invite", { agent_id: agent.id })
  const attempt = (prepared.data as { attempt_id: string }[] | null)?.[0]?.attempt_id
  if (prepared.error || !attempt) throw new Error(`could not prepare: ${JSON.stringify(prepared.error)}`)
  const invited = await secretClient().auth.admin.inviteUserByEmail(agent.address, {
    redirectTo: "http://localhost:3100/discount-code/set-password",
    data: { kind: "agent" },
  })
  if (invited.error) throw new Error(`could not invite: ${invited.error.message}`)
  const recorded = await manager.rpc("record_agent_invite", { attempt_id: attempt, result: "sent", error_code: null })
  if (recorded.error) throw new Error(`could not record: ${recorded.error.message}`)
  await waitForEmails(agent.address, 1)
  return agent
}

async function requestLink(page: Page, address: string) {
  await page.getByLabel("Barua pepe").fill(address)
  // Turnstile's test site key passes on its own; wait for its token.
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
  await page.getByRole("button", { name: "Tuma kiungo kipya" }).click()
  await expect(page.getByRole("status")).toHaveText(SENT)
}

async function setPassword(page: Page) {
  await page.getByLabel("Nenosiri jipya", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Rudia nenosiri jipya").fill(PASSWORD)
  await page.getByRole("button", { name: "Weka nenosiri" }).click()
}

test("Umesahau nenosiri? emails a reset link; the reset page sets the new password and signs the agent in", async ({ page }) => {
  const agent = await joinedAgent()

  await page.goto("/login")
  await page.getByRole("link", { name: "Umesahau nenosiri?" }).click()
  await expect(page).toHaveURL(/\/login\/forgot-password$/)
  await expect(page.getByRole("heading", { name: "Umesahau nenosiri?" })).toBeVisible()
  // The same card as sign-in, without the old security-check line (#264).
  await expect(page.getByText("AL-RAHMAH COMPLEX", { exact: true })).toBeVisible()
  await expect(page.getByText(/Ukaguzi mfupi wa usalama/)).toHaveCount(0)
  // Staff reset here too now (#265), so #264's note for them is gone.
  await expect(page.getByText(/Mfanyakazi\?/)).toHaveCount(0)
  await requestLink(page, agent.address)

  const [email] = await waitForEmails(agent.address, 1)
  expect(email.subject).toBe("Reset your Al-Rahmah Admissions Portal password")
  expect(email.link).toMatch(/^http:\/\/localhost:3100\/login\/reset-password\?token_hash=[^&]+&type=recovery$/)
  expect(email.html).toContain("Nenosiri jipya")

  await page.goto(email.link)
  await expect(page.getByRole("heading", { name: "Weka nenosiri jipya" })).toBeVisible()
  await setPassword(page)
  await expect(page).toHaveURL(/\/discount-code\/students$/)

  // The new password signs in on /login.
  await page.context().clearCookies()
  await logIn(page, agent.address, PASSWORD)
  await expect(page).toHaveURL(/\/discount-code\/students$/)

  // The link is spent: opening it again leads with "Tuma kiungo kipya".
  await page.context().clearCookies()
  await page.goto(email.link)
  await setPassword(page)
  await expect(page.getByRole("heading", { name: "Kiungo kimeisha muda" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Tuma kiungo kipya" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Piga simu ofisini/ })).toBeVisible()
})

test("an email with no account gets the same reply, and nothing is sent", async ({ page }) => {
  const stranger = `nobody-${randomUUID().slice(0, 8)}@example.test`
  // The old address still works (#264).
  await page.goto("/discount-code/forgot-password")
  await expect(page).toHaveURL(/\/login\/forgot-password$/)
  await requestLink(page, stranger)
  // The send happens after the reply; give it time to show up if it did.
  await page.waitForTimeout(2_000)
  expect(await emailsTo(stranger)).toEqual([])
})

test("an expired invite link's Tuma kiungo kipya sends an invited agent a new invite that works", async ({ page }) => {
  const agent = await invitedAgent()

  await page.goto("/discount-code/set-password?token_hash=not-a-real-token&type=invite")
  await setPassword(page)
  await expect(page.getByRole("heading", { name: "Kiungo kimeisha muda" })).toBeVisible()
  await requestLink(page, agent.address)

  const emails = await waitForEmails(agent.address, 2)
  const latest = emails[1]
  expect(latest.link).toMatch(/^http:\/\/localhost:3100\/discount-code\/set-password\?token_hash=[^&]+&type=invite$/)
  await page.goto(latest.link)
  await expect(page.getByRole("heading", { name: "Weka nenosiri lako" })).toBeVisible()
  await setPassword(page)
  await expect(page).toHaveURL(/\/discount-code\/students$/)
})

test("a reset link sent before #265, to the old reset page, still works", async ({ page }) => {
  const agent = await joinedAgent()
  await page.goto("/login/forgot-password")
  await requestLink(page, agent.address)
  const [email] = await waitForEmails(agent.address, 1)
  const old = email.link.replace("/login/reset-password", "/discount-code/reset-password")

  await page.goto(old)
  await expect(page).toHaveURL(email.link)
  await setPassword(page)
  await expect(page).toHaveURL(/\/discount-code\/students$/)
})

test("the reset page without a link offers a new one", async ({ page }) => {
  await page.goto("/login/reset-password")
  await expect(page.getByRole("heading", { name: "Kiungo kimeisha muda" })).toBeVisible()
  await expect(page.getByLabel("Barua pepe")).toBeVisible()
})
