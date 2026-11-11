import { type Browser, type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { createThrowawayStaff, inRolledBackTransaction } from "../tests/support/db"
import { INVITED, MANAGER } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// Staff reset their password (#265) end to end, against local Supabase with
// Turnstile's always-pass test keys: from "Umesahau nenosiri?" on their own,
// and from a Manager's "Send reset link". The email lands in local Mailpit,
// the shared reset page in the /login card sets the new password, and the
// person lands on the staff side and signs in with it. Each test makes its
// own staff member with an example.test email.

const MAILPIT = "http://127.0.0.1:55424"
const NEW_PASSWORD = "staff-reset-password"
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

// A joined staff member on Admissions Staff, which the seeded Manager manages.
async function joinedStaff() {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select role_id as id from public.staff_members where id = $1", [INVITED.id]),
  )
  return createThrowawayStaff([], { onRole: rows[0].id })
}

async function setNewPassword(page: Page) {
  await expect(page.getByRole("heading", { name: "Weka nenosiri jipya" })).toBeVisible()
  await page.getByLabel("Nenosiri jipya", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Rudia nenosiri jipya").fill(NEW_PASSWORD)
  await page.getByRole("button", { name: "Weka nenosiri" }).click()
}

// The link in a browser of its own, as the staff member opens it.
async function openLink(browser: Browser, link: string) {
  const page = await (await browser.newContext()).newPage()
  await page.goto(link)
  return page
}

async function signsInWithNewPassword(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage()
  await logIn(page, email, NEW_PASSWORD)
  await expect(page).toHaveURL(/\/staff$/)
}

test("a staff member resets their own password from Umesahau nenosiri? and lands on the staff side", async ({ page, browser }) => {
  const member = await joinedStaff()

  await page.goto("/login")
  await page.getByRole("link", { name: "Umesahau nenosiri?" }).click()
  await expect(page).toHaveURL(/\/login\/forgot-password$/)
  // #264's "ask whoever manages your account" note is gone.
  await expect(page.getByText(/Mfanyakazi\?/)).toHaveCount(0)
  await page.getByLabel("Barua pepe").fill(member.email)
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
  await page.getByRole("button", { name: "Tuma kiungo kipya" }).click()
  await expect(page.getByRole("status")).toHaveText(SENT)

  const [email] = await waitForEmails(member.email, 1)
  expect(email.subject).toBe("Reset your Al-Rahmah Admissions Portal password")
  expect(email.link).toMatch(/^http:\/\/localhost:3100\/login\/reset-password\?token_hash=[^&]+&type=recovery$/)
  expect(email.html).toContain("Reset your password")
  expect(email.html).not.toContain("Punguzo")

  const reset = await openLink(browser, email.link)
  await expect(reset.getByText("AL-RAHMAH COMPLEX", { exact: true })).toBeVisible()
  await setNewPassword(reset)
  await expect(reset).toHaveURL(/\/staff$/)

  await signsInWithNewPassword(browser, member.email)
})

test("a Manager's Send reset link emails a joined staff member a link that works", async ({
  page,
  browser,
}) => {
  const member = await joinedStaff()
  await logIn(page, MANAGER.email, MANAGER.password)
  await expect(page).toHaveURL(/\/staff$/)
  await page.goto(`/staff/roles?role=${member.roleId}`)

  const row = page.getByRole("list", { name: /^People in / }).getByRole("listitem", { name: member.name, exact: true })
  await row.getByRole("button", { name: "Send reset link" }).click()
  await expect(page.locator("[data-slot=alert]")).toHaveText(`Sent ${member.name} a reset link at ${member.email}. It works once, for 24 hours.`)

  const [email] = await waitForEmails(member.email, 1)
  expect(email.link).toMatch(/^http:\/\/localhost:3100\/login\/reset-password\?token_hash=[^&]+&type=recovery$/)
  const reset = await openLink(browser, email.link)
  await setNewPassword(reset)
  await expect(reset).toHaveURL(/\/staff$/)

  await signsInWithNewPassword(browser, member.email)
})

test("an Invited staff member gets Resend invite, not Send reset link", async ({ page }) => {
  await logIn(page, MANAGER.email, MANAGER.password)
  await expect(page).toHaveURL(/\/staff$/)
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select role_id as id from public.staff_members where id = $1", [INVITED.id]),
  )
  await page.goto(`/staff/roles?role=${rows[0].id}`)
  const row = page.getByRole("list", { name: /^People in / }).getByRole("listitem", { name: INVITED.name, exact: true })
  await expect(row.getByRole("button", { name: "Resend invite" })).toBeVisible()
  await expect(row.getByRole("button", { name: "Send reset link" })).toHaveCount(0)
})
