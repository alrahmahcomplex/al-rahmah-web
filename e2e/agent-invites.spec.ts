import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Browser, type Page } from "@playwright/test"

import { createThrowawayStaff, secretClient, signedIn } from "../tests/support/db"
import { MANAGER, SEEDED_AGENT, type FixtureStaff } from "../tests/support/fixtures"

// Agent invites and the Discount code sign-in (#191) end to end: the Manager
// sends the invite from the Agents screen, the email lands in local Mailpit,
// and the agent sets a password and lands on their students. Each test makes
// its own agent with an example.test email, so parallel tests never read
// each other's email; the seeded agent only signs in.

const MAILPIT = "http://127.0.0.1:55424"
const PASSWORD = "agent-e2e-password"

// The page's own message, not the route announcer.
const notice = (page: Page) => page.getByRole("main").getByRole("alert")

const STAFF_SESSION = "Kivinjari hiki kimeingia kama mfanyakazi. Toka kwanza."

async function signInStaff(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function signInAgent(page: Page, email: string, password: string) {
  await page.goto("/discount-code/sign-in")
  await page.getByLabel("Barua pepe").fill(email)
  await page.getByLabel("Nenosiri", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Ingia", exact: true }).click()
}

// An Approved agent of the test's own, created by the Manager with an email.
async function newAgent() {
  const suffix = randomUUID().slice(0, 8)
  const fullName = `Rehema Invite ${suffix}`
  const email = `rehema-${suffix}@example.test`
  // The Manager's create, as the Agents screen calls it.
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", {
    full_name: fullName,
    // A leading 7 keeps it clear of the seeded 700 000 numbers.
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email,
    code: "",
  })
  const row = data as { outcome: string; agent: { id: string; code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  return { id: row.agent.id, code: row.agent.code, fullName, email }
}

type Email = { subject: string; html: string; link: string }

async function invitesTo(email: string): Promise<Email[]> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
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

async function waitForInvite(email: string): Promise<Email> {
  await expect.poll(async () => (await invitesTo(email)).length, { timeout: 15_000 }).toBe(1)
  return (await invitesTo(email))[0]
}

function agentRow(page: Page, fullName: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: fullName, exact: true }) })
}

async function openAgentsScreen(page: Page, fullName: string) {
  await page.goto(`/staff/agents?status=approved&q=${encodeURIComponent(fullName)}`)
  await expect(agentRow(page, fullName)).toBeVisible()
}

async function sendInvite(page: Page, agent: { fullName: string; email: string }) {
  await openAgentsScreen(page, agent.fullName)
  const row = agentRow(page, agent.fullName)
  await expect(row).toContainText("Invite not sent")
  await row.getByRole("button", { name: `Send invite to ${agent.fullName}` }).click()
  await expect(page.getByText(`Invite sent to ${agent.email}.`)).toBeVisible()
  return waitForInvite(agent.email)
}

async function setPassword(page: Page) {
  await page.getByLabel("Nenosiri jipya", { exact: true }).fill(PASSWORD)
  await page.getByLabel("Rudia nenosiri jipya").fill(PASSWORD)
  await page.getByRole("button", { name: "Weka nenosiri" }).click()
}

async function newContextPage(browser: Browser) {
  const context = await browser.newContext()
  return context.newPage()
}

test("the Manager sends the invite; the agent sets a password from the email and lands on their students", async ({
  page,
  browser,
}) => {
  const agent = await newAgent()
  await signInStaff(page, MANAGER)

  const email = await sendInvite(page, agent)
  await expect(agentRow(page, agent.fullName)).toContainText("Invite sent")
  await expect(agentRow(page, agent.fullName)).not.toContainText(/deliver/i)

  expect(email.subject).toBe("Welcome to Al-Rahmah Admissions Portal - Setup your Account Today!")
  expect(email.link).toMatch(/^http:\/\/localhost:3100\/discount-code\/set-password\?token_hash=[^&]+&type=invite$/)
  // The Discount code wording: Swahili first, the sign-in address and the expiry.
  expect(email.html).toContain("Weka nenosiri")
  expect(email.html).toContain("/discount-code/sign-in")
  expect(email.html).toContain("saa 24")
  expect(email.html).not.toMatch(/Admissions Manager to send a new invite/)

  const agentPage = await newContextPage(browser)
  await agentPage.goto(email.link)
  await expect(agentPage.getByRole("heading", { name: "Weka nenosiri lako" })).toBeVisible()
  await expect(agentPage.getByText("Angalau herufi")).toBeVisible()
  // The show/hide toggle shows both boxes.
  await agentPage.getByRole("button", { name: "Onyesha nenosiri" }).click()
  await expect(agentPage.getByLabel("Nenosiri jipya", { exact: true })).toHaveAttribute("type", "text")
  await setPassword(agentPage)

  await expect(agentPage).toHaveURL(/\/discount-code\/students$/)
  await expect(agentPage.getByRole("heading", { name: `Wanafunzi wanaotumia Code ya Punguzo ${agent.code}` })).toBeVisible()

  await openAgentsScreen(page, agent.fullName)
  await expect(agentRow(page, agent.fullName)).toContainText("Joined")
})

test("an agent signs in on the Discount code pages; wrong credentials point to the forgotten password", async ({ page }) => {
  await signInAgent(page, SEEDED_AGENT.email, "not-the-password")
  await expect(notice(page)).toContainText("Barua pepe au nenosiri si sahihi.")
  await expect(notice(page).getByRole("link", { name: "Umesahau nenosiri?" })).toBeVisible()

  await signInAgent(page, SEEDED_AGENT.email, SEEDED_AGENT.password)
  await expect(page).toHaveURL(/\/discount-code\/students$/)
  await expect(page.getByRole("heading", { name: `Wanafunzi wanaotumia Code ya Punguzo ${SEEDED_AGENT.code}` })).toBeVisible()
})

test("staff and agent sign-in pages link to each other", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("link", { name: "Discount code holders sign in here" }).click()
  await expect(page).toHaveURL(/\/discount-code\/sign-in$/)
  await page.getByRole("link", { name: "Mfanyakazi? Ingia hapa" }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test("a browser signed in as staff refuses the agent's link until staff sign out, and the link still works", async ({ page }) => {
  const agent = await newAgent()
  // A staff member of the test's own: signing out ends every session of that
  // login, which would sign the Manager out of the tests running alongside.
  await signInStaff(page, await createThrowawayStaff(["leads.view", "agents.approve"]))
  const email = await sendInvite(page, agent)

  // The staff member opens the agent's link in their own browser.
  await page.goto(email.link)
  await expect(notice(page)).toHaveText(STAFF_SESSION)
  await expect(page.getByLabel("Nenosiri jipya", { exact: true })).toHaveCount(0)

  await page.getByRole("button", { name: "Toka" }).click()
  await expect(page.getByRole("heading", { name: "Weka nenosiri lako" })).toBeVisible()
  await setPassword(page)
  await expect(page).toHaveURL(/\/discount-code\/students$/)
})

test("a browser signed in as staff refuses agent sign-in, and one signed in as an agent refuses staff sign-in", async ({
  page,
  browser,
}) => {
  await signInStaff(page, MANAGER)
  await page.goto("/discount-code/sign-in")
  await expect(notice(page)).toHaveText(STAFF_SESSION)
  await expect(page.getByRole("button", { name: "Toka" })).toBeVisible()

  const agentPage = await newContextPage(browser)
  await signInAgent(agentPage, SEEDED_AGENT.email, SEEDED_AGENT.password)
  await expect(agentPage).toHaveURL(/\/discount-code\/students$/)
  await agentPage.goto("/login")
  await expect(notice(agentPage)).toHaveText(
    "This browser is signed in to the Discount code pages. Sign out first, then sign in here.",
  )
  await agentPage.getByRole("button", { name: "Sign out" }).click()
  await expect(agentPage.getByLabel("Email")).toBeVisible()
})

test("a switched-off agent is told to call the office, with the reason code", async ({ page }) => {
  const agent = await newAgent()
  // A login with a password, as if they had joined.
  const admin = secretClient().auth.admin
  const { data, error } = await admin.inviteUserByEmail(agent.email, { data: { kind: "agent" } })
  if (error || !data.user) throw new Error(`could not create the login: ${error?.message}`)
  const updated = await admin.updateUserById(data.user.id, { password: PASSWORD, email_confirm: true })
  if (updated.error) throw new Error(`could not set the password: ${updated.error.message}`)
  const switched = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", {
    agent_id: agent.id,
    kind: "switched_off",
    reason: "E2E setup",
  })
  if (switched.error) throw new Error(`could not switch off: ${switched.error.message}`)

  await signInAgent(page, agent.email, PASSWORD)

  await expect(notice(page)).toContainText("Huwezi kuingia kwa sasa. Piga simu ofisini.")
  await expect(notice(page)).toContainText("Msimbo: switched_off")
  await expect(page).toHaveURL(/\/discount-code\/sign-in$/)
})
