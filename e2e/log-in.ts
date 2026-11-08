import type { Page } from "@playwright/test"

// Signs in on the one sign-in page (#264), staff or Discount code holder, in
// whichever language the page is in: Swahili unless the browser chose
// English.
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login")
  await page.getByLabel(/^(Email|Barua pepe)$/).fill(email)
  await page.getByLabel(/^(Password|Nenosiri)$/).fill(password)
  await page.getByRole("button", { name: /^(Log In|Ingia)$/ }).click()
}
