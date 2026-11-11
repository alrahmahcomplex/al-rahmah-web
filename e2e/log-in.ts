import { expect, type Cookie, type Page } from "@playwright/test"

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

// The session cookies of each account that signed in on the page in this
// worker, by email. Each worker keeps its own, so two tests never use one
// session at the same moment.
const sessions = new Map<string, Cookie[]>()

// Signs in for a test whose subject is something other than signing in.
//
// The first test in a worker to ask for an account signs in on the page with
// logIn, and the session's cookies are kept. A later test puts them into its
// own fresh browser and opens /login, which sends a signed-in browser to its
// home. That skips the form, the security check and the password check that
// every one of those tests would otherwise repeat. If the kept session has
// ended, /login shows the form and the test signs in on the page again.
//
// A test about signing in itself (the form, the security check, a sign-in
// notice, a password, an account that is refused) must call logIn.
export async function signInOnce(page: Page, email: string, password: string): Promise<void> {
  const kept = sessions.get(email)
  if (kept) {
    await page.context().addCookies(kept)
    await page.goto("/login")
    if (new URL(page.url()).pathname !== "/login") return
    sessions.delete(email)
  }
  await logIn(page, email, password)
  await page.waitForURL((url) => url.pathname !== "/login")
  sessions.set(
    email,
    (await page.context().cookies()).filter((cookie) => /^sb-.+-auth-token/.test(cookie.name)),
  )
}

// Signs out from whichever shell the page is in (#322): the old shell's
// account menu at the foot of the sidebar, or the new shell's person pill in
// the top bar. On a phone the old shell has Sign out in its More sheet.
export async function signOut(page: Page): Promise<void> {
  if (await page.locator('[data-shell="new"]').count()) {
    // A click that lands before the page has hydrated opens nothing; press again until the menu shows.
    const signOutButton = page.getByRole("dialog").getByRole("button", { name: "Sign out" })
    await expect(async () => {
      if (!(await signOutButton.isVisible())) await page.getByRole("banner").locator(".ns-me").click()
      await expect(signOutButton).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
    await signOutButton.click()
  } else if (await page.getByRole("complementary", { name: "Sidebar" }).isVisible()) {
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("button", { name: /^Account menu/ }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
  } else {
    await page.getByRole("navigation", { name: "Staff" }).getByRole("button", { name: "More" }).click()
    await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Sign out" }).click()
  }
  await page.waitForURL((url) => url.pathname === "/login")
}
