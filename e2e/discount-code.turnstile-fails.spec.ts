import { expect, test } from "@playwright/test"

import { secretClient } from "../tests/support/db"
import { PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"
import { fillRegistration, newcomer, WORDS } from "./discount-code"

// The Discount code page's fail-closed path, on the server whose Turnstile
// secret always fails (playwright.config.ts).

test.use({ viewport: PHONE_WIDTH })

declare global {
  interface Window {
    turnstileResets?: number
  }
}

test("a failed security check is refused, keeps the entries, resets the widget and registers nobody", async ({ page }) => {
  const who = newcomer()
  const t = WORDS.sw
  await page.goto("/discount-code")
  await fillRegistration(page, "sw", who, "0754 000 111")
  await waitForSecurityCheck(page)

  // Count the widget's resets.
  await page.evaluate(() => {
    const turnstile = window.turnstile!
    const reset = turnstile.reset.bind(turnstile)
    window.turnstileResets = 0
    turnstile.reset = (id: string) => {
      window.turnstileResets! += 1
      reset(id)
    }
  })

  await page.getByRole("button", { name: t.send }).click()

  await expect(page.getByText(/Ukaguzi wa usalama haukukamilika/)).toBeVisible()
  await expect(page.getByLabel(t.name)).toHaveValue(who.name)
  await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue(who.phone)
  await expect(page.getByLabel(t.whatsapp)).toHaveValue("0754 000 111")
  expect(await page.evaluate(() => window.turnstileResets)).toBe(1)
  await expect(page.getByRole("button", { name: t.send })).toBeEnabled()

  const { count } = await secretClient()
    .from("marketing_agents")
    .select("id", { count: "exact", head: true })
    .eq("phone", `+255${who.phone.slice(1)}`)
  expect(count).toBe(0)
})
