import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { MANAGER } from "../tests/support/fixtures"
import { chooseLanguage } from "./discount-code"
import { logIn } from "./log-in"

// The reset by SMS (#503 slice 2b, prototype F1 to F3) end to end. Local
// Auth texts nothing to the test number and takes the test code for it
// (auth.sms.test_otp in supabase/config.toml); the hook's own sending is
// covered by tests/integration/sms-reset.test.ts.

const TEST_NUMBER = "255799000503"
const TEST_CODE = "246810"
const NEW_PASSWORD = "sms-reset-password"

// The page's own message, not the route announcer.
const notice = (page: Page) => page.getByRole("main").getByRole("alert")

test.beforeEach(async ({ context }) => {
  await chooseLanguage(context, "sw")
})

// An Approved agent whose login carries the test number, as self-confirm
// (slice 3) will make them. Frees the number from an earlier run first.
async function agentOnTestNumber() {
  await asSystem((sql) => sql.query("update auth.users set phone = null, phone_confirmed_at = null where phone = $1", [TEST_NUMBER]))
  const suffix = randomUUID().slice(0, 8)
  const email = `sms-reset-${suffix}@example.test`
  const { data, error } = await (await signedIn(MANAGER)).rpc("create_marketing_agent", {
    full_name: `Neema Simu ${suffix}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    whatsapp: "",
    email,
    code: "",
  })
  const row = data as { outcome: string; agent: { code: string } } | null
  if (error || row?.outcome !== "created") throw new Error(`could not create: ${JSON.stringify(error ?? row)}`)
  const login = await secretClient().auth.admin.createUser({ email, phone: TEST_NUMBER, password: "fixture-password", email_confirm: true, phone_confirm: true })
  if (login.error) throw new Error(`could not create the login: ${login.error.message}`)
  return { code: row.agent.code }
}

async function askForSms(page: Page, mobile: string) {
  await page.goto("/auth/forgot-password")
  await page.getByLabel("Barua pepe au namba ya simu").fill(mobile)
  await expect(page.locator('input[name="cf-turnstile-response"]').first()).toHaveValue(/.+/, { timeout: 20_000 })
  await page.getByRole("button", { name: "Tuma", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Angalia SMS yako" })).toBeVisible()
  await expect(page.getByText("Kama namba hii ina akaunti, tumeitumia SMS yenye namba ya kuthibitisha.")).toBeVisible()
}

async function typeNumber(page: Page, number: string) {
  await page.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }).click()
  await page.keyboard.type(number)
}

test("an agent resets their password by SMS and signs in with their mobile", async ({ page, browser }) => {
  const agent = await agentOnTestNumber()
  await askForSms(page, "0799 000 503")

  // A wrong number: red, then the note and Jaribu tena.
  await typeNumber(page, "000000")
  await expect(notice(page)).toContainText("Namba hii si sahihi. Ihakiki, kisha ujaribu tena.")
  await page.getByRole("button", { name: "Jaribu tena" }).click()
  await expect(page.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" })).toBeFocused()

  await typeNumber(page, TEST_CODE)
  await expect(page.getByRole("heading", { name: "Weka nenosiri jipya" })).toBeVisible()
  await expect(page.getByText("Utalitumia pamoja na namba yako ya simu kuingia kwenye kurasa za Code ya Punguzo.")).toBeVisible()
  await page.getByLabel("Nenosiri jipya", { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel("Rudia nenosiri jipya").fill(NEW_PASSWORD)
  await page.getByRole("button", { name: "Weka nenosiri" }).click()
  await expect(page).toHaveURL(/\/discount-code\/students$/)
  await expect(page.getByText(`Code yako ${agent.code}`)).toBeVisible()

  const later = await browser.newContext()
  await chooseLanguage(later, "sw")
  const again = await later.newPage()
  await logIn(again, "+255 799 000 503", NEW_PASSWORD)
  await expect(again).toHaveURL(/\/discount-code\/students$/)
  await later.close()
})

test("a mobile with no account gets the same screen, and the boxes never let it in", async ({ page }) => {
  await askForSms(page, `07${String(randomInt(10_000_000, 100_000_000))}`)
  await typeNumber(page, "123456")
  await expect(notice(page)).toContainText("Namba hii si sahihi.")
  await expect(page.getByRole("button", { name: /^Tuma tena baada ya/ })).toBeDisabled()
})

test("something that is neither an email nor a mobile is refused before anything is sent", async ({ page }) => {
  await page.goto("/auth/forgot-password")
  await page.getByLabel("Barua pepe au namba ya simu").fill("0222 123 456")
  await page.getByRole("button", { name: "Tuma", exact: true }).click()
  await expect(notice(page)).toHaveText("Andika barua pepe, au namba ya simu kama 0712 345 678.")
})
