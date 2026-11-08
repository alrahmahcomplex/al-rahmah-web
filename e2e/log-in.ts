import { expect, type Page } from "@playwright/test"

// Signs in on the one sign-in page (#264), staff or Discount code holder, in
// whichever language the page is in: Swahili unless the browser chose
// English. It waits for the Turnstile token first, since Supabase checks it
// on every sign-in (#268).
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel(/^(Email|Barua pepe)$/).fill(email)
  await page.getByLabel(/^(Password|Nenosiri)$/).fill(password)
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
  await page.getByRole("button", { name: /^(Log In|Ingia)$/ }).click()
}
