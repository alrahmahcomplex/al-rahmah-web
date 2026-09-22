import { expect, test } from "@playwright/test"

import { FORMER_STAFF, STAFF } from "./fixtures"

// Al-Rahmah palette values from app/globals.css.
const AL_RAHMAH_BLUE = "rgb(9, 0, 187)" // --color-blue-600: #0900bb
const AL_RAHMAH_ORANGE = "rgb(245, 130, 32)" // --color-orange-500: #f58220

test.describe("staff sign-in page", () => {
  test("shows the Al-Rahmah logo and brand colours", async ({ page }) => {
    await page.goto("/login")

    const logo = page.getByRole("img", { name: "Al-Rahmah Logo" })
    await expect(logo).toBeVisible()
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

    await expect(page.getByText("AL-RAHMAH COMPLEX")).toBeVisible()
    const badge = page.getByText("AL-RAHMAH COMPLEX").locator("..")
    await expect(badge).toHaveCSS("background-color", AL_RAHMAH_BLUE)
    await expect(page.getByRole("heading", { name: "Welcome!" })).toHaveCSS("color", AL_RAHMAH_BLUE)
    await expect(page.getByRole("button", { name: "Log In" })).toHaveCSS(
      "background-color",
      AL_RAHMAH_ORANGE,
    )
  })

  test("the password toggle shows and hides the password", async ({ page }) => {
    await page.goto("/login")
    const password = page.getByLabel("Password", { exact: true })
    await password.fill("fixture-password")

    await expect(password).toHaveAttribute("type", "password")
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(password).toHaveAttribute("type", "text")
    await page.getByRole("button", { name: "Hide password" }).click()
    await expect(password).toHaveAttribute("type", "password")
  })
})

test.describe("signing in", () => {
  async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/login")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Log In" }).click()
  }

  test("refuses an email missing from the allowlist, even with the right password", async ({ page }) => {
    await signIn(page, FORMER_STAFF.email, FORMER_STAFF.password)

    await expect(page.locator("form").getByRole("alert")).toHaveText(/does not have staff access/)
    await expect(page).toHaveURL(/\/login$/)

    // No session was left behind.
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("refuses a wrong password", async ({ page }) => {
    await signIn(page, STAFF.email, "not-the-password")

    await expect(page.locator("form").getByRole("alert")).toHaveText("Wrong email or password.")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("lets allowlisted staff in and out", async ({ page }) => {
    await signIn(page, STAFF.email, STAFF.password)

    await expect(page).toHaveURL(/\/staff$/)
    await expect(page.getByText(`Signed in as ${STAFF.email}`)).toBeVisible()

    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("sends visitors with no session from staff pages to sign-in", async ({ page }) => {
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })
})
