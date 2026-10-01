import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"

// The Admission form's fail-closed path, on the server whose Turnstile secret
// always fails (playwright.config.ts).

test.use({ viewport: PHONE_WIDTH })

declare global {
  interface Window {
    turnstileResets?: number
  }
}

test("a failed security check is refused, keeps the entries and resets the widget", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: "Endelea" }).click()
  await fillChild(page, "sw", who, String(admissionYears()[1]))
  await page.getByRole("button", { name: "Endelea" }).click()
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

  await page.getByRole("button", { name: "Tuma maombi" }).click()

  await expect(page.getByText(/Ukaguzi wa usalama haukukamilika/)).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Hakiki maombi yako" })).toBeVisible()
  await expect(page.getByText(who.parent)).toBeVisible()
  await expect(page.getByText(who.child)).toBeVisible()
  expect(await page.evaluate(() => window.turnstileResets)).toBe(1)
  await expect(page.getByRole("button", { name: "Tuma maombi" })).toBeEnabled()

  await page.getByRole("button", { name: "Rudi" }).click()
  await page.getByRole("button", { name: "Rudi" }).click()
  await expect(page.getByLabel("Jina kamili la mzazi au mlezi")).toHaveValue(who.parent)
})
