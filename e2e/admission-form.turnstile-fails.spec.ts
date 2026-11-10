import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { expectQuestion, family, fillForm, openQuestion, PHONE_WIDTH, setLanguageCookie, waitForSecurityCheck, WORDS } from "./admission-form"

// The Admission form's fail-closed path, on the server whose Turnstile secret
// always fails (playwright.config.ts).

test.use({ viewport: PHONE_WIDTH })

declare global {
  interface Window {
    turnstileResets?: number
  }
}

test("a failed security check is refused, keeps the entries and resets the widget", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await fillForm(page, "sw", who, String(admissionYears()[1]))
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

  await openQuestion(page).getByRole("button", { name: WORDS.sw.send }).click()

  await expect(page.getByText(/Ukaguzi wa usalama haukukamilika/)).toBeVisible()
  // The Cloudflare box carries no "quick security check" line under it (#264).
  await expect(page.getByText(/Ukaguzi mfupi wa usalama/)).toHaveCount(0)
  await expectQuestion(page, WORDS.sw.review)
  await expect(page.getByText(who.parent, { exact: true })).toBeVisible()
  await expect(page.getByText(`${who.child} · STD 3`)).toBeVisible()
  expect(await page.evaluate(() => window.turnstileResets)).toBe(1)
  await expect(openQuestion(page).getByRole("button", { name: WORDS.sw.send })).toBeEnabled()

  await page.getByRole("button", { name: WORDS.sw.back }).click()
  await page.getByRole("button", { name: WORDS.sw.back }).click()
  await page.getByRole("button", { name: WORDS.sw.back }).click()
  await page.getByRole("button", { name: WORDS.sw.back }).click()
  await expectQuestion(page, /Wewe ni nani kwa/)
  await page.getByRole("button", { name: "Badilisha Jina" }).last().click()
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue(who.parent)
})
