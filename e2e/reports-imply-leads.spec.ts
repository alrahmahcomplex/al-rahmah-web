import { randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { signInAsSuperAdmin } from "./super-admin"

// reports.view implies leads.view (#244): on the Super Admin's role pane,
// selecting View reports selects View leads, clearing View leads clears View
// reports, and the needed permission shows beside View reports.

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`
const callout = (page: Page) => page.getByTestId("role-outcome")
const LEADS = "View applicants and their history"
const REPORTS = "View reports"

async function save(page: Page) {
  await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0)
}

test("selecting View reports selects View leads, and clearing View leads clears both", async ({ page }) => {
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
  await expect(reports).toHaveAccessibleDescription(`Needs “${LEADS}”. Selecting this selects it too; clearing that clears this.`)

  await reports.click()
  await expect(reports).toBeChecked()
  await expect(leads).toBeChecked()
  await save(page)
  await expect(callout(page)).toHaveText(`Saved 2 changes to ${name}.Can now: ${LEADS}, ${REPORTS}.`)

  // Survives a reload: the database holds both.
  await page.reload()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()

  await page.getByRole("checkbox", { name: LEADS, exact: true }).click()
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).not.toBeChecked()
  await save(page)
  await expect(callout(page)).toHaveText(`Saved 2 changes to ${name}.Can no longer: ${LEADS}, ${REPORTS}.`)

  // Clearing View reports alone leaves View leads.
  await page.getByRole("checkbox", { name: REPORTS, exact: true }).click()
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()
  await save(page)
  await page.getByRole("checkbox", { name: REPORTS, exact: true }).click()
  await save(page)
  await expect(callout(page)).toHaveText(`Saved 1 change to ${name}.Can no longer: ${REPORTS}.`)
  await expect(page.getByRole("checkbox", { name: LEADS, exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: REPORTS, exact: true })).not.toBeChecked()
})
