import { randomUUID } from "node:crypto"

import { expect, test, type Browser, type Page } from "@playwright/test"

import { inRolledBackTransaction } from "../tests/support/db"
import { INVITED, MANAGER, RETIRED_ROLE, type FixtureStaff } from "../tests/support/fixtures"

// Inviting staff end to end: the Manager invites from Staff and roles, the
// email lands in local Mailpit, and the invited person sets a password on
// /auth/confirm. Each test invites a fresh address, so parallel tests never
// read each other's email.

const MAILPIT = "http://127.0.0.1:55424"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function roleId(name: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

function personRow(page: Page, name: string) {
  return page.getByRole("list", { name: /^People in / }).getByRole("listitem", { name, exact: true })
}

const callout = (page: Page) => page.locator("[data-slot=alert]")

function newInvitee() {
  const suffix = randomUUID().slice(0, 8)
  return { name: `Invitee ${suffix}`, email: `invitee-${suffix}@example.test` }
}

type Email = { subject: string; link: string }

// Every invite email sent to the address, oldest first, as its subject and
// the link it carries.
async function invitesTo(email: string): Promise<Email[]> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  const { messages } = (await search.json()) as { messages: { ID: string; Created: string }[] }
  const ordered = [...messages].sort((a, b) => a.Created.localeCompare(b.Created))
  return Promise.all(
    ordered.map(async ({ ID }) => {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as { Subject: string; HTML: string }
      const href = message.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1] ?? ""
      return { subject: message.Subject, link: href.replaceAll("&amp;", "&") }
    }),
  )
}

async function waitForInvites(email: string, count: number): Promise<Email[]> {
  await expect.poll(async () => (await invitesTo(email)).length, { timeout: 15_000 }).toBe(count)
  return invitesTo(email)
}

async function accountState(email: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ confirmed: boolean; has_password: boolean }>(
      `select email_confirmed_at is not null as confirmed, coalesce(encrypted_password, '') <> '' as has_password
       from auth.users where email = $1`,
      [email],
    ),
  )
  return rows[0]
}

async function invite(page: Page, roleName: string, invitee: { name: string; email: string }) {
  await page.goto(`/staff/roles?role=${await roleId(roleName)}`)
  await page.getByLabel("Full name").fill(invitee.name)
  await page.getByLabel("Email").fill(invitee.email)
  await page.getByRole("button", { name: "Send invite", exact: true }).click()
}

// The invited person opens the link in a browser of their own.
async function openInvite(browser: Browser, link: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)
  return page
}

async function setPassword(page: Page, password = "invitee-password") {
  await page.getByLabel("New password", { exact: true }).fill(password)
  await page.getByLabel("Confirm new password").fill(password)
  await page.getByRole("button", { name: "Set password" }).click()
}

const EXPIRED = "This invite link has expired or was already used. Ask an Admissions Manager to send a new one."

test("a Manager invites someone, who sets a password from the email and lands on the staff side with the role's powers", async ({
  page,
  browser,
}) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)

  await invite(page, "Admissions Manager", invitee)

  await expect(callout(page)).toHaveText(
    `Invited ${invitee.name} to Admissions Manager. The email is on its way to ${invitee.email}.`,
  )
  await expect(page.getByLabel("Full name")).toHaveValue("")
  const row = personRow(page, invitee.name)
  await expect(row).toContainText("Invited")
  await expect(row.getByRole("button", { name: "Resend invite" })).toBeVisible()

  const [email] = await waitForInvites(invitee.email, 1)
  expect(email.subject).toBe("Your Al-Rahmah Complex staff account")
  expect(email.link).toMatch(/^http:\/\/localhost:3100\/auth\/confirm\?token_hash=[^&]+&type=invite$/)

  const invitedPage = await openInvite(browser, email.link)
  await expect(invitedPage.getByRole("heading", { name: "Set your password" })).toBeVisible()
  // Opening the page, as an email link scanner would, leaves the token unused.
  expect(await accountState(invitee.email)).toEqual({ confirmed: false, has_password: false })

  await setPassword(invitedPage)

  await expect(invitedPage).toHaveURL(/\/staff$/)
  await expect(invitedPage.getByText(`Welcome, ${invitee.name}.`)).toBeVisible()
  await expect(invitedPage.getByRole("banner")).toContainText("Admissions Manager")
  await expect(
    invitedPage.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Staff and roles" }),
  ).toBeVisible()
  expect(await accountState(invitee.email)).toEqual({ confirmed: true, has_password: true })

  await page.reload()
  await expect(personRow(page, invitee.name)).toContainText("Active")
  await expect(personRow(page, invitee.name).getByRole("button", { name: "Resend invite" })).toHaveCount(0)
  await page.getByRole("button", { name: "History" }).click()
  await expect(
    page.getByRole("list", { name: "History" }).getByRole("listitem").filter({ hasText: `sent an invite to ${invitee.name}` }),
  ).toContainText(MANAGER.name)
})

test("an invite link that was already used says so and asks for a new one", async ({ page, browser }) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)
  await invite(page, "Admissions Staff", invitee)
  const [email] = await waitForInvites(invitee.email, 1)

  await setPassword(await openInvite(browser, email.link))
  const again = await openInvite(browser, email.link)
  await setPassword(again, "another-password")

  await expect(again.getByRole("main").getByRole("alert")).toHaveText(EXPIRED)
  await expect(again.getByRole("button", { name: "Set password" })).toHaveCount(0)
})

test("an expired or broken invite link says so", async ({ browser }) => {
  const broken = await openInvite(browser, "/auth/confirm?token_hash=not-a-real-token&type=invite")
  await setPassword(broken)
  await expect(broken.getByRole("main").getByRole("alert")).toHaveText(EXPIRED)

  const noToken = await openInvite(browser, "/auth/confirm")
  await expect(noToken.getByRole("main").getByRole("alert")).toHaveText(EXPIRED)
  await expect(noToken.getByRole("link", { name: "Go to sign-in" })).toBeVisible()
})

test("an invite sent with no redirect, as the Supabase dashboard sends one, lands on the site root and still works", async ({
  page,
  browser,
}) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)
  await invite(page, "Admissions Staff", invitee)
  const [email] = await waitForInvites(invitee.email, 1)
  const token = new URL(email.link).search

  const invitedPage = await openInvite(browser, `/${token}`)

  await expect(invitedPage).toHaveURL(`/auth/confirm${token}`)
  await setPassword(invitedPage)
  await expect(invitedPage).toHaveURL(/\/staff$/)
})

test("passwords that don't match are refused without using the link", async ({ page, browser }) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)
  await invite(page, "Admissions Staff", invitee)
  const [email] = await waitForInvites(invitee.email, 1)
  const invitedPage = await openInvite(browser, email.link)

  await invitedPage.getByLabel("New password", { exact: true }).fill("invitee-password")
  await invitedPage.getByLabel("Confirm new password").fill("invitee-passwerd")
  await invitedPage.getByRole("button", { name: "Set password" }).click()
  await expect(invitedPage.getByRole("main").getByRole("alert")).toHaveText("The two passwords don't match.")
  expect(await accountState(invitee.email)).toEqual({ confirmed: false, has_password: false })

  await setPassword(invitedPage)
  await expect(invitedPage).toHaveURL(/\/staff$/)
})

test("Resend invite sends a new link, and the earlier one stops working", async ({ page, browser }) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)
  await invite(page, "Admissions Staff", invitee)
  const [first] = await waitForInvites(invitee.email, 1)

  await personRow(page, invitee.name).getByRole("button", { name: "Resend invite" }).click()

  await expect(callout(page)).toHaveText(
    `Sent ${invitee.name} a new invite at ${invitee.email}. The earlier link no longer works.`,
  )
  const [, second] = await waitForInvites(invitee.email, 2)
  expect(second.link).not.toBe(first.link)

  const stale = await openInvite(browser, first.link)
  await setPassword(stale)
  await expect(stale.getByRole("main").getByRole("alert")).toHaveText(EXPIRED)

  const fresh = await openInvite(browser, second.link)
  await setPassword(fresh)
  await expect(fresh).toHaveURL(/\/staff$/)
})

test("someone deactivated before accepting is signed out with a message, and signs in with their password once reactivated", async ({
  page,
  browser,
}) => {
  const invitee = newInvitee()
  await signIn(page, MANAGER)
  await invite(page, "Admissions Staff", invitee)
  const [email] = await waitForInvites(invitee.email, 1)
  await personRow(page, invitee.name).getByRole("button", { name: "Deactivate" }).click()
  await expect(callout(page)).toHaveText(`Deactivated ${invitee.name}.`)

  const invitedPage = await openInvite(browser, email.link)
  await setPassword(invitedPage)

  await expect(invitedPage.getByRole("main").getByRole("alert")).toHaveText(
    "Your staff account was deactivated before you accepted the invite. Ask an Admissions Manager to reactivate it.",
  )
  await invitedPage.goto("/staff")
  await expect(invitedPage).toHaveURL(/\/login$/)

  await page.reload()
  await personRow(page, invitee.name).getByRole("button", { name: "Reactivate" }).click()
  await expect(callout(page)).toHaveText(`Reactivated ${invitee.name}.`)
  await signIn(invitedPage, { ...invitee, password: "invitee-password" } as FixtureStaff)
  await expect(invitedPage.getByText(`Welcome, ${invitee.name}.`)).toBeVisible()
})

test("inviting an email already on staff is refused in the callout, and nothing is sent", async ({ page }) => {
  await signIn(page, MANAGER)

  await invite(page, "Admissions Staff", { name: "Someone Else", email: INVITED.email })

  await expect(callout(page)).toHaveText(`${INVITED.email} already belongs to ${INVITED.name}.`)
  await expect(page.getByLabel("Full name")).toHaveValue("Someone Else")
})

test("the invite box is closed on a retired role, with the reason", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto(`/staff/roles?role=${await roleId(RETIRED_ROLE.roleName)}`)

  await expect(page.getByRole("button", { name: "Send invite", exact: true })).toBeDisabled()
  await expect(page.getByText(`"${RETIRED_ROLE.roleName}" is retired, so nobody can be given it.`)).toBeVisible()
})

test("the seeded Invited member shows as Invited with Resend invite", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.goto(`/staff/roles?role=${await roleId(INVITED.roleName)}`)

  await expect(personRow(page, INVITED.name)).toContainText("Invited")
  await expect(personRow(page, INVITED.name).getByRole("button", { name: "Resend invite" })).toBeVisible()
})
