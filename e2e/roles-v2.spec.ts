import { randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { roleTemplate } from "../lib/role-templates"
import { createThrowawayStaff, inRolledBackTransaction, signedIn } from "../tests/support/db"
import { MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInAsSuperAdmin } from "./super-admin"
import { signInOnce } from "./log-in"

// Roles v2 (#241) end to end: the Super Admin makes a role from a template
// and invites into it; the seeded Manager manages Admissions Staff only and
// changes no role; an Administrator manages a Manager and has no audit.

async function signIn(page: Page, person: FixtureStaff) {
  await page.context().clearCookies()
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function roleId(name: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`
const callout = (page: Page) => page.getByTestId("role-outcome")

function personRow(page: Page, name: string) {
  return page.getByRole("list", { name: /^People in / }).getByRole("listitem", { name, exact: true })
}

test("the Super Admin creates an Admissions Manager role from its template and invites a Manager into it", async ({ page }) => {
  // The seed already holds a role named Admissions Manager, so this one
  // takes a name of its own; the template is what matters.
  const name = unique("Admissions Manager")
  const invitee = { name: unique("Invited Manager"), email: `${randomUUID().slice(0, 8)}@example.test` }
  await signInAsSuperAdmin(page)
  await page.goto("/staff/roles")

  const rail = page.getByRole("navigation", { name: "Roles" })
  await rail.getByLabel("Start from").selectOption("Admissions Manager")
  await expect(rail.getByLabel("Role name")).toHaveValue("Admissions Manager")
  await expect(rail).toContainText(roleTemplate("Admissions Manager")!.summary)
  await rail.getByLabel("Role name").fill(name)
  await rail.getByRole("button", { name: "Create" }).click()

  // The new role opens in the pane.
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
  // The template's permissions and managed set, as ordinary role data.
  await expect(page.getByRole("checkbox", { name: "Approve discounts" })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Record payments and maintain fees" })).not.toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Admissions Staff", exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "Accountant", exact: true })).not.toBeChecked()

  await page.getByLabel("Full name").fill(invitee.name)
  await page.getByLabel("Email").fill(invitee.email)
  await page.getByRole("button", { name: "Send invite", exact: true }).click()

  await expect(callout(page)).toHaveText(`Invited ${invitee.name} to ${name}. The email is on its way to ${invitee.email}.`)
  await expect(personRow(page, invitee.name)).toContainText("Invited")
})

test("the Manager sees the Admissions Staff only, and no control on any role", async ({ page }) => {
  await signIn(page, MANAGER)
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Staff and roles" }).click()

  // The rail counts holders only where the Manager manages them.
  const rail = page.getByRole("navigation", { name: "Roles" })
  await expect(rail.getByRole("link", { name: /Admissions Staff/ }).getByLabel(/active$/)).toBeVisible()
  await expect(rail.getByRole("link", { name: /^Accountant/ }).getByLabel(/active$/)).toHaveCount(0)
  await expect(rail.getByRole("form", { name: "New role" })).toHaveCount(0)
  await expect(rail.getByText("Super Admin", { exact: true })).toHaveCount(0)

  await expect(page.getByRole("heading", { name: "Admissions Staff", level: 2 })).toBeVisible()
  await expect(page.getByRole("list", { name: "People in Admissions Staff" })).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Retire role" })).toHaveCount(0)

  // Every other role reads without its people.
  for (const name of ["Admissions Manager", "Accountant"]) {
    await page.goto(`/staff/roles?role=${await roleId(name)}`)
    await expect(page.getByRole("list", { name: `What ${name} can do` })).toBeVisible()
    await expect(page.getByRole("list", { name: /^People in / })).toHaveCount(0)
    await expect(page.getByRole("checkbox")).toHaveCount(0)
  }
})

test("an Administrator manages a Manager, changes no role and has no audit screen", async ({ page }) => {
  const superAdmin = await signedIn(SUPER_ADMIN)
  const managerRole = await roleId("Admissions Manager")
  const created = await superAdmin.rpc("create_role", {
    name: unique("Administrator"),
    permissions: roleTemplate("Administrator")!.permissions,
    manages: [managerRole],
    managed_by: [],
  })
  expect(created.error).toBeNull()
  const administrator = await createThrowawayStaff([], { onRole: created.data.id })
  const manager = await createThrowawayStaff([], { onRole: managerRole })

  await signIn(page, administrator)
  const nav = page.getByRole("navigation", { name: "Staff" })
  await expect(nav.getByRole("link", { name: "Audit" })).toHaveCount(0)
  await nav.getByRole("link", { name: "Staff and roles" }).click()

  await expect(page.getByRole("heading", { name: "Admissions Manager", level: 2 })).toBeVisible()
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "History" })).toHaveCount(0)

  const row = personRow(page, manager.name)
  await row.getByRole("button", { name: "Deactivate" }).click()
  await expect(page.getByRole("dialog", { name: /\?$/ })).toContainText("including managing staff")
  // The confirmation is a kit sheet (#331).
  expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
  await page.getByRole("dialog", { name: /\?$/ }).getByRole("button", { name: "Deactivate" }).click()
  await expect(callout(page)).toHaveText(`Deactivated ${manager.name}.`)
  await row.getByRole("button", { name: "Reactivate" }).click()
  await expect(callout(page)).toHaveText(`Reactivated ${manager.name}.`)

  await page.goto("/staff/audit")
  await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
})
