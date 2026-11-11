import { randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { signInAsSuperAdmin } from "./super-admin"

// reports.view implies leads.view (#244): on the Super Admin's role pane,
// ticking View reports ticks View leads, unticking View leads unticks View
// reports, and the reason shows beside View reports.

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`
const callout = (page: Page) => page.locator("[data-slot=alert]")
const LEADS = "View applicants and their history"
const REPORTS = "View reports"

test("ticking View reports ticks View leads, and unticking View leads unticks both", async ({ page }) => {
  const name = unique("Reports reader")
  await signInAsSuperAdmin(page)
  await page.goto("/staff/roles")

  const rail = page.getByRole("navigation", { name: "Roles" })
  await rail.getByLabel("Role name").fill(name)
  await rail.getByRole("button", { name: "Add" }).click()
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()

  const leads = page.getByRole("checkbox", { name: LEADS, exact: true })
  const reports = page.getByRole("checkbox", { name: REPORTS, exact: true })
  await expect(leads).not.toBeChecked()
  await expect(reports).not.toBeChecked()
  await expect(reports).toHaveAccessibleDescription(`Reports need “${LEADS}”. Ticking this ticks it too, and unticking it unticks this.`)

  await reports.click()
  await expect(callout(page)).toHaveText(`${name} can now: ${REPORTS}. “${LEADS}” is ticked too, since Reports need it.`)
  await expect(reports).toBeChecked()
  await expect(leads).toBeChecked()

  // Survives a reload: the database holds both.
  await page.reload()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()

  await page.getByRole("checkbox", { name: LEADS, exact: true }).click()
  await expect(callout(page)).toHaveText(`${name} can no longer: ${LEADS}. “${REPORTS}” went with it.`)
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).not.toBeChecked()

  // Unticking View reports alone leaves View leads.
  await page.getByRole("checkbox", { name: REPORTS, exact: true }).click()
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()
  await page.getByRole("checkbox", { name: REPORTS, exact: true }).click()
  await expect(callout(page)).toHaveText(`${name} can no longer: ${REPORTS}.`)
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).not.toBeChecked()
})
