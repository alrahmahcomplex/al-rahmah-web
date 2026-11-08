import { expect, type Page } from "@playwright/test"

import { SUPER_ADMIN } from "../tests/support/fixtures"
import { logIn } from "./log-in"

// The audit history is the Super Admin's alone (#237). A spec that checks a
// history after acting as another staff member signs out and back in as the
// Super Admin, in the same page, then opens the history.

export async function signInAsSuperAdmin(page: Page): Promise<void> {
  await page.context().clearCookies()
  await logIn(page, SUPER_ADMIN.email, SUPER_ADMIN.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead's History page, as the Super Admin. Without `leadId`, the lead whose
// screen the page is on.
export async function openLeadHistoryAsSuperAdmin(page: Page, leadId?: string): Promise<void> {
  const id = leadId ?? /^\/staff\/leads\/([^/]+)/.exec(new URL(page.url()).pathname)?.[1]
  if (!id) throw new Error(`not on a lead screen: ${page.url()}`)
  await signInAsSuperAdmin(page)
  await page.goto(`/staff/leads/${id}/history`)
}

// The Staff and roles history, as the Super Admin.
export async function openStaffHistoryAsSuperAdmin(page: Page): Promise<void> {
  await signInAsSuperAdmin(page)
  await page.goto("/staff/roles")
  await page.getByRole("button", { name: "History" }).click()
}
