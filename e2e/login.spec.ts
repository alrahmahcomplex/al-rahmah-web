import { expect, test } from "./staff-test"

import { asSystem, createThrowawayStaff } from "../tests/support/db"
import { ACCOUNTANT, DEACTIVATED, MANAGER } from "../tests/support/fixtures"
import { logIn } from "./log-in"

test.describe("the one sign-in page", () => {
  test("is Swahili first, with the language switch above the card and no separate Discount code sign-in", async ({ page }) => {
    await page.goto("/login")

    await expect(page.getByRole("heading", { name: "Karibu!" })).toBeVisible()
    await expect(page.getByLabel("Barua pepe")).toHaveAttribute("placeholder", "Barua pepe")
    await expect(page.getByLabel("Nenosiri", { exact: true })).toHaveAttribute("placeholder", "Nenosiri")
    await expect(page.getByText(/Discount code holders/)).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Umesahau nenosiri?" })).toHaveAttribute("href", "/login/forgot-password")

    // The switch sits above the card, centred; the logo sits inside the card.
    const switchBox = (await page.getByRole("group", { name: "Lugha" }).boundingBox())!
    const logoBox = (await page.getByRole("img", { name: "Al-Rahmah Logo" }).boundingBox())!
    const viewport = page.viewportSize()!
    expect(switchBox.y + switchBox.height).toBeLessThan(logoBox.y)
    expect(Math.abs(switchBox.x + switchBox.width / 2 - viewport.width / 2)).toBeLessThan(2)

    await page.getByRole("button", { name: "English" }).click()
    await expect(page.getByRole("heading", { name: "Welcome!" })).toBeVisible()
    await expect(page.getByLabel("Email")).toHaveAttribute("placeholder", "Email")
  })

  test("the password toggle shows and hides the password", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "English" }).click()
    const password = page.getByLabel("Password", { exact: true })
    await password.fill("fixture-password")

    await expect(password).toHaveAttribute("type", "password")
    await page.getByRole("button", { name: "Show password" }).click()
    await expect(password).toHaveAttribute("type", "text")
    await page.getByRole("button", { name: "Hide password" }).click()
    await expect(password).toHaveAttribute("type", "password")
    // The typed password is never copied into the HTML, where injected CSS
    // could read it with an attribute selector (#278).
    await expect(password).toHaveValue("fixture-password")
    expect((await password.getAttribute("value")) ?? "").toBe("")
  })
})

test.describe("signing in", () => {
  async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
    await logIn(page, email, password)
  }

  test("tells a deactivated staff member their account is deactivated, even with the right password", async ({
    page,
  }) => {
    await signIn(page, DEACTIVATED.email, DEACTIVATED.password)

    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Akaunti yako ya mfanyakazi imezimwa. Mwombe anayesimamia akaunti yako aiwashe tena.",
    )
    await expect(page).toHaveURL(/\/login$/)

    // No session was left behind.
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("explains an account that is not on the staff list", async ({ page }) => {
    await page.goto("/login?error=not-staff")

    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Akaunti hii haipo kwenye orodha ya wafanyakazi. Mwombe anayesimamia wafanyakazi akualike.",
    )
  })

  test("refuses a wrong password, keeps the email, and offers the reset link under the warning", async ({ page }) => {
    await signIn(page, MANAGER.email, "not-the-password")

    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toContainText("Barua pepe au nenosiri si sahihi.")
    // The email stays; the wrong password is cleared, ready to type again (#273).
    await expect(page.getByLabel("Barua pepe")).toHaveValue(MANAGER.email)
    await expect(page.getByLabel("Nenosiri", { exact: true })).toHaveValue("")
    await expect(page.getByLabel("Nenosiri", { exact: true })).toBeFocused()
    await alert.getByRole("link", { name: "Umesahau nenosiri?" }).click()
    await expect(page).toHaveURL(/\/login\/forgot-password$/)
  })

  test("lets staff in, shows their name and role on the staff layout, and signs them out", async ({ page }) => {
    await signIn(page, ACCOUNTANT.email, ACCOUNTANT.password)

    await expect(page).toHaveURL(/\/staff$/)
    const sidebar = page.getByRole("complementary", { name: "Sidebar" })
    await expect(sidebar.getByText(ACCOUNTANT.name, { exact: true })).toBeVisible()
    await expect(sidebar.getByText(ACCOUNTANT.roleName, { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon), Test$/ })).toBeVisible()

    await sidebar.getByRole("button", { name: /^Account menu/ }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("sends a signed-in staff member to sign-in on their next request after they are deactivated", async ({
    page,
  }) => {
    const person = await createThrowawayStaff(["leads.view"])
    await signIn(page, person.email, person.password)
    await expect(page).toHaveURL(/\/staff$/)

    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [person.id]))

    await page.reload()
    await expect(page).toHaveURL(/\/login\?error=deactivated$/)
    await expect(page.locator("form").getByRole("alert")).toHaveText(/deactivated/)
  })

  test("sends visitors with no session from staff and Discount code pages to sign-in", async ({ page }) => {
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/discount-code/students")
    await expect(page).toHaveURL(/\/login$/)
  })
})
