import { createHmac, randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { asSystem, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import { chooseLanguage, fillRegistration, sendButton } from "./discount-code"
import { signInOnce } from "./log-in"
import { E2E_OTP_HMAC_SECRET } from "./self-confirm-secret"

// Self-confirm end to end (#503, live since 20270128120100): an agent on
// record with an Approved code joins from the Discount code page by mobile or
// email, with no Manager wait, in the four cases of prototype v58; then the
// office removes a sign-in and the real agent joins. Every agent is the
// test's own, with invented names, numbers and example.test emails. The fake
// sender only logs the SMS, so the test puts a number it knows on the attempt.

const MAILPIT = "http://127.0.0.1:55424"

test.use({ viewport: PHONE_WIDTH })

function mobile() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}
const e164 = (local: string) => `+255${local.slice(1)}`

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`
}

// Three strong names, the third the test's own.
const names = () => `Neema Simu ${String.fromCharCode(65 + randomInt(0, 26))}${randomUUID().replace(/[^a-z]/g, "").slice(0, 6)}`

/** An Approved agent the Manager created, with a mobile on record. */
async function agentWithMobile() {
  const fullName = names()
  const phone = mobile()
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", { full_name: fullName, phone, whatsapp: "", email: "", code: "" })
  const row = data as { outcome: string; agent: { id: string; code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  return { id: row.agent.id, code: row.agent.code, fullName, phone }
}

/** An agent imported with three names and a code, and no mobile (#463). */
async function agentWithoutMobile() {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  const code = `S${letter()}${letter()}-${randomInt(100, 1000)}`
  const fullName = names()
  const manager = await signedIn(MANAGER)
  const row = { sheet_row: 2, code, full_name: fullName, phone: null, whatsapp: null, email: null }
  const checked = await manager.rpc("check_agent_import", { rows: [row] })
  if (checked.error) throw new Error(checked.error.message)
  const expected = (checked.data as { verdict: unknown }[])[0].verdict
  const done = await manager.rpc("confirm_agent_import", { file_name: `self-confirm-${randomUUID().slice(0, 8)}.csv`, row_count: 1, rows: [{ ...row, expected }] })
  if (done.error || (done.data as { outcome: string }).outcome !== "imported") throw new Error(JSON.stringify(done.error ?? done.data))
  const id = await asSystem(async (sql) => (await sql.query<{ id: string }>("select id from public.marketing_agents where code = $1", [code])).rows[0].id)
  return { id, code, fullName }
}

/** The Discount code page, "Tayari una code?" answered with the code, up to the choice. */
async function start(page: Page, who: { name: string; phone: string; email: string; code: string }) {
  await chooseLanguage(page.context(), "sw")
  await page.goto("/discount-code")
  await fillRegistration(page, "sw", who, { code: who.code })
  await waitForSecurityCheck(page)
  await sendButton(page, "sw", true).click()
  await expect(page.getByRole("heading", { name: "Chagua jinsi ya kuingia", level: 2 })).toBeVisible({ timeout: 15_000 })
}

/** Puts a number the test knows on the agent's latest attempt's open number, as the SMS would bring it. */
async function knownNumber(agentId: string): Promise<string> {
  const digits = String(randomInt(0, 1_000_000)).padStart(6, "0")
  await asSystem(async (sql) => {
    const { rows } = await sql.query<{ id: string }>("select id from public.agent_confirm_attempts where agent_id = $1 order by created_at desc limit 1", [agentId])
    const attempt = rows[0].id
    const digest = createHmac("sha256", E2E_OTP_HMAC_SECRET).update(`${attempt}|${digits}`).digest("hex")
    const updated = await sql.query("update public.agent_confirm_numbers set digest = $2 where attempt_id = $1 and used_at is null and voided_at is null", [attempt, digest])
    if (updated.rowCount !== 1) throw new Error(`expected one open number, found ${updated.rowCount}`)
  })
  return digits
}

/** By mobile: the number into the boxes, then a password, then the students page's welcome. */
async function byMobile(page: Page, agentId: string, password: string) {
  await page.getByRole("radio", { name: /Kwa namba ya simu/ }).check({ force: true })
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByRole("heading", { name: "Angalia SMS yako" })).toBeVisible()
  const digits = await knownNumber(agentId)
  await page.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }).click()
  await page.keyboard.type(digits)
  await expect(page.getByRole("heading", { name: "Weka nenosiri lako" })).toBeVisible({ timeout: 15_000 })
  await setPassword(page, password)
}

// The mobile finish signs in with Turnstile; the invite link's page has none.
async function setPassword(page: Page, password: string, { securityCheck = true } = {}) {
  await page.getByLabel("Nenosiri jipya", { exact: true }).fill(password)
  await page.getByLabel("Rudia nenosiri jipya").fill(password)
  if (securityCheck) await waitForSecurityCheck(page)
  await page.getByRole("button", { name: "Weka nenosiri" }).click()
  await expect(page).toHaveURL(/\/home/, { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Akaunti yako iko tayari!" })).toBeVisible()
}

/** By email: today's invite to the address, its link, a password, then the welcome. */
async function byEmail(page: Page, address: string, password: string) {
  await page.getByRole("radio", { name: /Kwa barua pepe/ }).check({ force: true })
  await page.getByRole("button", { name: "Endelea" }).click()
  // The email is asked on its path (#503 slice 4d-b): the form asked none.
  await page.getByLabel("Barua pepe yako?").fill(address)
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByRole("heading", { name: "Angalia barua pepe yako" })).toBeVisible()
  await expect(page.getByText(address)).toBeVisible()
  const link = await inviteLink(address)
  await page.goto(link)
  await setPassword(page, password, { securityCheck: false })
}

async function inviteLink(address: string): Promise<string> {
  let href = ""
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
        const { messages } = (await search.json()) as { messages: { ID: string }[] }
        if (messages.length === 0) return ""
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string }
        href = (message.HTML.match(/href="([^"]*token_hash[^"]*)"/)?.[1] ?? "").replaceAll("&amp;", "&")
        return href
      },
      { timeout: 15_000 },
    )
    .not.toBe("")
  return href
}

async function joinedLogin(agentId: string) {
  return asSystem(async (sql) => {
    const { rows } = await sql.query<{ user_id: string | null; joined: boolean }>(
      "select user_id, user_id is not null and public.agent_joined(user_id) as joined from public.marketing_agents where id = $1",
      [agentId],
    )
    return rows[0]
  })
}

test.describe("self-confirm: the four cases", () => {
  test("1. a mobile on record, by mobile: the number to that mobile, a password, and in", async ({ page }) => {
    const agent = await agentWithMobile()
    await start(page, { name: agent.fullName, phone: agent.phone, email: email("case1"), code: agent.code })
    await byMobile(page, agent.id, "case-one-password")
    expect(await joinedLogin(agent.id)).toMatchObject({ joined: true })
  })

  test("2. a mobile on record, by email: today's invite, a password, in, and a courtesy SMS to the mobile", async ({ page }) => {
    const agent = await agentWithMobile()
    const address = email("case2")
    await start(page, { name: agent.fullName, phone: agent.phone, email: address, code: agent.code })
    await byEmail(page, address, "case-two-password")
    expect(await joinedLogin(agent.id)).toMatchObject({ joined: true })
    await expect
      .poll(
        () => asSystem(async (sql) => (await sql.query("select kind, result from public.sms_sends where to_phone = $1 and kind = 'courtesy'", [e164(agent.phone)])).rows),
        { timeout: 15_000 },
      )
      .toEqual([{ kind: "courtesy", result: "sent" }])
  })

  test("3. no mobile on record, by the mobile typed: the number to it, a password, and in", async ({ page }) => {
    const agent = await agentWithoutMobile()
    const typed = mobile()
    await start(page, { name: agent.fullName, phone: typed, email: email("case3"), code: agent.code })
    await byMobile(page, agent.id, "case-three-password")
    expect(await joinedLogin(agent.id)).toMatchObject({ joined: true })
  })

  test("other names don't match: the page says so and nothing starts", async ({ page }) => {
    const agent = await agentWithoutMobile()
    await chooseLanguage(page.context(), "sw")
    await page.goto("/discount-code")
    await fillRegistration(page, "sw", { name: "Mtu Mwingine Kabisa", phone: mobile(), email: email("other") }, { code: agent.code })
    await waitForSecurityCheck(page)
    await sendButton(page, "sw", true).click()
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Hatukuweza kulinganisha code na majina yako. Yahakiki, au piga simu ofisini.")
    expect(await joinedLogin(agent.id)).toMatchObject({ user_id: null })
  })

  test("4. no mobile on record, by email: today's invite to the email typed, a password, and in", async ({ page }) => {
    const agent = await agentWithoutMobile()
    const address = email("case4")
    await start(page, { name: agent.fullName, phone: mobile(), email: address, code: agent.code })
    await byEmail(page, address, "case-four-password")
    expect(await joinedLogin(agent.id)).toMatchObject({ joined: true })
  })
})

// New agents choose too (#503 slice 4d-b): by mobile, the number to the mobile
// typed, a password, then the waiting code, with no students until the office
// approves the code; approving only flips the status.
test.describe("a new agent", () => {
  test("by mobile: the number, a password, the waiting code, and the students once the office approves", async ({ page }) => {
    test.slow()
    const who = { name: names(), phone: mobile(), email: email("new-mobile") }
    await chooseLanguage(page.context(), "sw")
    await page.goto("/discount-code")
    await fillRegistration(page, "sw", who)
    await waitForSecurityCheck(page)
    await sendButton(page, "sw").click()
    await expect(page.getByRole("heading", { name: "Chagua jinsi ya kuingia", level: 2 })).toBeVisible({ timeout: 15_000 })
    const id = await asSystem(async (sql) => (await sql.query<{ id: string }>("select id from public.marketing_agents where phone = $1", [e164(who.phone)])).rows[0].id)

    await page.getByRole("radio", { name: /Kwa namba ya simu/ }).check({ force: true })
    await page.getByRole("button", { name: "Endelea" }).click()
    await expect(page.getByRole("heading", { name: "Angalia SMS yako" })).toBeVisible()
    const digits = await knownNumber(id)
    await page.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }).click()
    await page.keyboard.type(digits)
    await expect(page.getByRole("heading", { name: "Weka nenosiri lako" })).toBeVisible({ timeout: 15_000 })
    await page.getByLabel("Nenosiri jipya", { exact: true }).fill("new-agent-password")
    await page.getByLabel("Rudia nenosiri jipya").fill("new-agent-password")
    await waitForSecurityCheck(page)
    await page.getByRole("button", { name: "Weka nenosiri" }).click()

    // The waiting code: its code and link, when the password works (O-N62), and no students.
    await expect(page).toHaveURL(/\/home/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Code yako ya Punguzo" })).toBeVisible()
    await expect(page.getByText("Ofisi ya Masoko ikithibitisha code yako, ingia kwa namba yako ya simu na nenosiri hili kuona wanafunzi uliowaleta.")).toBeVisible()
    await expect(page.getByText("Familia zako ziko wapi")).toHaveCount(0)
    expect(await joinedLogin(id)).toMatchObject({ joined: true })

    // The office approves the code: the same login now sees the dashboard.
    const approved = await (await signedIn(MANAGER)).rpc("approve_marketing_agent", { agent_id: id })
    if (approved.error) throw new Error(approved.error.message)
    await page.reload()
    await expect(page.getByRole("heading", { name: /^Habari, / })).toBeVisible()
  })
})

test.describe("Remove this sign-in", () => {
  test("the office removes a sign-in, the removed browser is out on its next page, and the real agent joins by mobile", async ({ page, browser }) => {
    // Two joins and a Manager's removal in one story.
    test.slow()
    const agent = await agentWithMobile()
    // Someone joins on the code by email first.
    const intruder = await browser.newPage({ viewport: PHONE_WIDTH })
    const address = email("intruder")
    await start(intruder, { name: agent.fullName, phone: agent.phone, email: address, code: agent.code })
    await byEmail(intruder, address, "intruder-password")

    await signInOnce(page, MANAGER.email, MANAGER.password)
    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)
    await page.getByRole("button", { name: `More actions for ${agent.fullName}` }).click()
    await page.getByRole("button", { name: "Remove this sign-in" }).click()
    const sheet = page.getByRole("dialog", { name: "Remove this sign-in?" })
    await expect(sheet.getByText(address)).toBeVisible()
    await expect(sheet.getByRole("checkbox", { name: /Close email self-confirm on this code/ })).toBeChecked()
    await sheet.getByRole("button", { name: "Remove this sign-in" }).click()
    await expect(page.getByText("Sign-in removed.")).toBeVisible()
    await expect(page.getByText(/Not joined · sign-in removed/)).toBeVisible()

    // The removed browser's next page sends it to sign in.
    await intruder.reload()
    await expect(intruder).not.toHaveURL(/\/discount-code\/students/)
    await intruder.close()

    // The real agent: email is closed on the code, so only the mobile on record.
    const real = await browser.newPage({ viewport: PHONE_WIDTH })
    await start(real, { name: agent.fullName, phone: agent.phone, email: email("real"), code: agent.code })
    await expect(real.getByRole("radio", { name: /Kwa barua pepe/ })).toHaveCount(0)
    await byMobile(real, agent.id, "real-agent-password")
    expect(await joinedLogin(agent.id)).toMatchObject({ joined: true })
    await real.close()
  })
})
