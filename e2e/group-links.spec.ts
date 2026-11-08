import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { ADMISSIONS, ACCOUNTANT, type FixtureStaff } from "../tests/support/fixtures"
import { logIn } from "./log-in"

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("Admissions Staff save and replace a group link with attribution and a test action", async ({ page }) => {
  await signIn(page, ADMISSIONS)
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "WhatsApp groups" }).click()
  await page.getByLabel("Enrollment year").fill("2099")
  await page.getByRole("button", { name: "Open year" }).click()
  const link = `https://chat.whatsapp.com/${randomUUID().replaceAll("-", "")}`
  await page.getByLabel("WhatsApp group link", { exact: true }).fill("https://example.com/wrong")
  await page.getByRole("button", { name: "Save link" }).click()
  await expect(page.getByRole("form", { name: "Group link 2099" }).getByRole("alert")).toContainText("https://chat.whatsapp.com/")
  await page.getByLabel("WhatsApp group link", { exact: true }).fill(link)
  await page.getByRole("button", { name: "Save link" }).click()
  await expect(page.getByRole("status")).toHaveText("The group link is saved.")
  await expect(page.getByRole("link", { name: "Open to test" })).toHaveAttribute("href", link)
  await expect(page.getByText(`Set by ${ADMISSIONS.name}`, { exact: false })).toBeVisible()
  await expect(page.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/)
  await expect(page.getByText("Replacing the link only affects new invitations. Families already invited still hold the earlier link.")).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("WhatsApp group link", { exact: true })).toHaveValue(link)
  const replacement = `${link}?mode=ems_copy_t`
  await page.getByLabel("WhatsApp group link", { exact: true }).fill(replacement)
  await page.getByRole("button", { name: "Save link" }).click()
  await expect(page.getByRole("status")).toHaveText("The group link is saved.")
  await expect(page.getByRole("link", { name: "Open to test" })).toHaveAttribute("href", replacement)
  await page.screenshot({ path: "test-results/183-group-links-desktop.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: "test-results/183-group-links-mobile.png", fullPage: true })
})

test("the Accountant reads saved links without a save control", async ({ page }) => {
  await signIn(page, ACCOUNTANT)
  await page.goto("/staff/group-links?year=2099")
  await expect(page.getByRole("heading", { name: "WhatsApp groups" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save link" })).toHaveCount(0)
})
