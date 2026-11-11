import { expect, test } from "./staff-test"

import { createThrowawayStaff } from "../tests/support/db"
import { MANAGER, SEEDED_AGENT } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// Supabase's CAPTCHA protection (#268), against local Supabase with it on
// (supabase/config.toml) and Cloudflare's always-pass Turnstile test keys.
// Sign-in sends the widget's token to Supabase; the reset form sends with the
// secret key, which Supabase doesn't ask for a token. A direct call with the
// publishable key and no token is refused. Seeded fixtures and example.test
// emails only.

const MAILPIT = "http://127.0.0.1:55424"
const SENT =
  "Kama barua pepe hii ina akaunti, tumeitumia kiungo. Angalia barua pepe zako, pamoja na spam. Kiungo kinatumika mara moja tu, ndani ya saa 24."

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set in .env.local. See .env.example.`)
  return value
}

async function emailCount(address: string): Promise<number> {
  const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
  return ((await search.json()) as { messages: unknown[] }).messages.length
}

test.describe("with Supabase's CAPTCHA protection on", () => {
  test("the sign-in form carries the security check, and staff get in", async ({ page }) => {
    await page.goto("/login")
    await expect(page.locator("form").locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })

    await logIn(page, MANAGER.email, MANAGER.password)
    await expect(page).toHaveURL(/\/staff$/)
  })

  test("a Discount code holder gets in", async ({ page }) => {
    await logIn(page, SEEDED_AGENT.email, SEEDED_AGENT.password)
    await expect(page).toHaveURL(/\/discount-code\/students$/)
  })

  test("a wrong password still says wrong password, and a fresh check lets the right one in", async ({ page }) => {
    await logIn(page, MANAGER.email, "not-the-password")
    await expect(page.locator("form").getByRole("alert")).toContainText("Barua pepe au nenosiri si sahihi.")

    // The spent token was replaced, so a second try on the same page works.
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
    await page.getByLabel("Barua pepe").fill(MANAGER.email)
    await page.getByLabel("Nenosiri", { exact: true }).fill(MANAGER.password)
    await page.getByRole("button", { name: "Ingia" }).click()
    await expect(page).toHaveURL(/\/staff$/)
  })

  test("Umesahau nenosiri? still sends the reset email", async ({ page }) => {
    const member = await createThrowawayStaff([])

    await page.goto("/login/forgot-password")
    await page.getByLabel("Barua pepe").fill(member.email)
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
    await page.getByRole("button", { name: "Tuma kiungo kipya" }).click()
    await expect(page.getByRole("status")).toHaveText(SENT)

    await expect.poll(() => emailCount(member.email), { timeout: 15_000 }).toBe(1)
  })

  test("a direct call with the publishable key and no token is refused", async () => {
    const url = env("NEXT_PUBLIC_SUPABASE_URL")
    const headers = { apikey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "content-type": "application/json" }

    const recover = await fetch(`${url}/auth/v1/recover`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: SEEDED_AGENT.email }),
    })
    expect(recover.status).toBeGreaterThanOrEqual(400)
    expect(recover.status).toBeLessThan(500)
    expect(((await recover.json()) as { error_code?: string }).error_code).toBe("captcha_failed")

    const password = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: MANAGER.email, password: MANAGER.password }),
    })
    expect(password.status).toBeGreaterThanOrEqual(400)
    expect(password.status).toBeLessThan(500)
    expect(((await password.json()) as { error_code?: string }).error_code).toBe("captcha_failed")
  })
})
