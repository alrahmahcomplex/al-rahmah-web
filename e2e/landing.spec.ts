import { expect, test } from "@playwright/test"

import { E2E_PORT } from "./server"

test.describe("the landing page", () => {
  test("greets a first-time visitor in Swahili, with Apply, the office phone and Staff sign-in", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByRole("main")).toHaveAttribute("lang", "sw")
    await expect(page.getByRole("img", { name: "Al-Rahmah Logo" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: "Al-Rahmah Complex" })).toBeVisible()
    await expect(page.getByText(/maadili ya Kiislamu/)).toBeVisible()
    await expect(page.getByRole("link", { name: "Omba sasa" })).toHaveAttribute("href", "/apply")
    await expect(page.getByRole("link", { name: "+255 673 526 644" })).toHaveAttribute("href", "tel:+255673526644")
    await expect(page.getByRole("link", { name: "Staff sign-in" })).toHaveAttribute("href", "/login")
  })

  test("switches to English, and the choice survives a reload", async ({ page, context }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "English" }).click()

    await expect(page.getByRole("main")).toHaveAttribute("lang", "en")
    await expect(page.getByRole("link", { name: "Apply now" })).toBeVisible()
    await expect(page.getByText(/Islamic values/)).toBeVisible()
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true")

    // The cookie covers the whole site, so every public page reads it.
    const [cookie] = (await context.cookies()).filter((c) => c.name === "lang")
    expect(cookie).toMatchObject({ value: "en", path: "/" })

    await page.reload()
    await expect(page.getByRole("link", { name: "Apply now" })).toBeVisible()

    await page.getByRole("button", { name: "Kiswahili" }).click()
    await expect(page.getByRole("link", { name: "Omba sasa" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("link", { name: "Omba sasa" })).toBeVisible()
  })

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false })

    test("the switch still changes the language", async ({ page }) => {
      await page.goto("/")
      await page.getByRole("button", { name: "English" }).click()

      await expect(page.getByRole("main")).toHaveAttribute("lang", "en")
      await expect(page.getByRole("link", { name: "Apply now" })).toBeVisible()

      await page.reload()
      await expect(page.getByRole("link", { name: "Apply now" })).toBeVisible()
    })
  })

  test("renders the chosen language on the server, so it never flashes the other one", async ({ request }) => {
    const english = await (await request.get("/", { headers: { cookie: "lang=en" } })).text()
    expect(english).toContain("Apply now")
    expect(english).not.toContain("Omba sasa")

    const swahili = await (await request.get("/")).text()
    expect(swahili).toContain("Omba sasa")
    expect(swahili).not.toContain("Apply now")
  })

  test("Apply now opens the Admission form", async ({ page, context }) => {
    await context.addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
    await page.goto("/")
    await page.getByRole("link", { name: "Apply now" }).click()

    await expect(page).toHaveURL(/\/apply$/)
  })
})
