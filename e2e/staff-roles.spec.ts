import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { asSystem, createThrowawayStaff, inRolledBackTransaction } from "../tests/support/db"
import { ACCOUNTANT, MANAGER, RETIRED_ROLE, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { openStaffHistoryAsSuperAdmin, signInAsSuperAdmin } from "./super-admin"
import { logIn } from "./log-in"

// The Staff and roles screen (#241): the Super Admin shapes every role and
// manages everyone; the seeded Manager manages the Admissions Staff and reads
// the roles. Tests that change someone change a throwaway staff member of
// their own, so parallel tests and the seeded fixtures never collide.

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function roleId(name: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

function personRow(page: Page, name: string) {
  return page.getByRole("list", { name: /^People in / }).getByRole("listitem", { name, exact: true })
}

const callout = (page: Page) => page.locator("[data-slot=alert]")

test.describe("who can open Staff and roles", () => {
  test("a Manager, whose role manages Admissions Staff, finds it in the navigation", async ({ page }) => {
    await signIn(page, MANAGER)

    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Staff and roles" }).click()

    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(page.getByRole("heading", { name: "Staff and roles", level: 1 })).toBeVisible()
  })

  test("a role that manages nobody sees no link and gets the forbidden page at its URL", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(page.getByRole("link", { name: "Staff and roles" })).toHaveCount(0)

    await page.goto("/staff/roles")

    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Roles" })).toHaveCount(0)
  })
})

test.describe("the rail and pane", () => {
  test("the Super Admin sees each role's holders, its managed set, retired roles and each person's status", async ({
    page,
  }) => {
    const managerRole = await roleId("Admissions Manager")
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${managerRole}`)

    const rail = page.getByRole("navigation", { name: "Roles" })
    // Other tests make roles named after the templates, so find this one by its link.
    await expect(rail.locator(`a[href="/staff/roles?role=${managerRole}"]`)).toHaveAttribute("aria-current", "page")
    await expect(rail.getByRole("link", { name: /Receptionist/ })).toContainText("Retired")

    await expect(page.getByRole("heading", { name: "Admissions Manager", level: 2 })).toBeVisible()
    await expect(page.getByText("Changes apply to everyone in this role immediately.")).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Admissions Staff", exact: true })).toBeChecked()
    await expect(page.getByRole("checkbox", { name: "Accountant", exact: true })).not.toBeChecked()
    await expect(personRow(page, "Second Manager")).toContainText("Active")

    await rail.getByRole("link", { name: /Receptionist/ }).click()
    await expect(page.getByText("Retired. Kept for history. Reactivate it to give it to anyone again.")).toBeVisible()
    await expect(personRow(page, RETIRED_ROLE.name)).toContainText("Deactivated")
  })

  test("the Manager opens on the Admissions Staff, and reads every role without a control to change it", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    await expect(page.getByRole("heading", { name: "Admissions Staff", level: 2 })).toBeVisible()
    await expect(page.getByText("You manage the staff in this role. Only the Super Admin changes what it can do.")).toBeVisible()
    await expect(page.getByRole("list", { name: "People in Admissions Staff" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Send invite", exact: true })).toBeEnabled()

    for (const name of ["Admissions Staff", "Admissions Manager", "Accountant"]) {
      await page.goto(`/staff/roles?role=${await roleId(name)}`)
      await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
      await expect(page.getByRole("list", { name: `What ${name} can do` })).toBeVisible()
      await expect(page.getByRole("checkbox")).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Retire role|Reactivate role/ })).toHaveCount(0)
    }
    await expect(page.getByRole("navigation", { name: "Roles" }).getByRole("form", { name: "New role" })).toHaveCount(0)

    await page.goto(`/staff/roles?role=${await roleId("Admissions Manager")}`)
    await expect(page.getByText("This is your role. Only the Super Admin changes it.")).toBeVisible()
    await expect(page.getByRole("list", { name: /^People in / })).toHaveCount(0)

    await page.goto(`/staff/roles?role=${await roleId("Accountant")}`)
    await expect(page.getByText("Your role doesn't manage the staff in this role. Only the Super Admin changes roles.")).toBeVisible()
    await expect(page.getByText(ACCOUNTANT.email)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Send invite", exact: true })).toHaveCount(0)
  })
})

test.describe("changing staff members", () => {
  test("controls the screen can see are blocked are disabled, with the reason beside them", async ({ page }) => {
    const target = await createThrowawayStaff([], { onRole: await roleId("Admissions Staff") })
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    // Admissions Staff is the only role the Manager manages.
    const row = personRow(page, target.name)
    await expect(row.getByRole("button", { name: "Move to…" })).toBeDisabled()
    await expect(row).toContainText("There is no other current role you manage to move them to.")

    await signInAsSuperAdmin(page)
    await page.goto(`/staff/roles?role=${await roleId("Receptionist")}`)
    const retired = personRow(page, RETIRED_ROLE.name)
    await expect(retired.getByRole("button", { name: "Reactivate" })).toBeDisabled()
    await expect(retired).toContainText(
      `${RETIRED_ROLE.name}'s role "Receptionist" was retired. Give them a current role first, then reactivate.`,
    )
  })

  test("a refusal only the database can see shows in the callout at the top of the pane", async ({ page }) => {
    const target = await createThrowawayStaff([], { onRole: await roleId("Admissions Staff") })
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    // Someone else deactivates them after this page loaded.
    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [target.id]))
    await personRow(page, target.name).getByRole("button", { name: "Deactivate" }).click()

    await expect(callout(page)).toHaveText(`${target.name} is already deactivated.`)
    await expect(callout(page)).toHaveAttribute("role", "alert")
    // The screen catches up with what the database knew.
    await expect(personRow(page, target.name)).toContainText("Deactivated")
  })

  test("deactivating someone who manages staff asks first, naming the consequence", async ({ page }) => {
    const target = await createThrowawayStaff([], { onRole: await roleId("Admissions Manager") })
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${target.roleId}`)
    const row = personRow(page, target.name)

    await row.getByRole("button", { name: "Deactivate" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByRole("heading")).toHaveText(`Deactivate ${target.name}?`)
    await expect(dialog).toContainText("including managing staff")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(row).toContainText("Active")

    await row.getByRole("button", { name: "Deactivate" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click()

    await expect(callout(page)).toHaveText(`Deactivated ${target.name}.`)
    await expect(row).toContainText("Deactivated")

    await openStaffHistoryAsSuperAdmin(page)
    // Other tests write history at the same time, so find this change by name.
    const change = page
      .getByRole("list", { name: "History" })
      .getByRole("listitem")
      .filter({ hasText: `${SUPER_ADMIN.name} changed ${target.name}` })
      .filter({ hasText: "Deactivated" })
    await expect(change).toContainText("status: Active → Deactivated")
  })

  test("moving someone who manages staff to a role that manages nobody asks first", async ({ page }) => {
    const target = await createThrowawayStaff([], { onRole: await roleId("Admissions Manager") })
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${target.roleId}`)

    await personRow(page, target.name).getByRole("button", { name: "Move to…" }).click()
    await page.getByRole("menuitem", { name: "Accountant", exact: true }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByRole("heading")).toHaveText(`Move ${target.name} to Accountant?`)
    await expect(dialog).toContainText("will no longer manage")
    await dialog.getByRole("button", { name: "Move" }).click()

    await expect(callout(page)).toHaveText(`Moved ${target.name} to Accountant.`)
    await expect(personRow(page, target.name)).toHaveCount(0)
  })

  test("someone deactivated on a retired role is given a current role, then reactivated", async ({ page }) => {
    const target = await createThrowawayStaff(["leads.view"])
    await asSystem(async (sql) => {
      await sql.query("update public.staff_members set active = false where id = $1", [target.id])
      await sql.query("update public.roles set retired = true where id = $1", [target.roleId])
    })
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${target.roleId}`)

    await personRow(page, target.name).getByRole("button", { name: "Move to…" }).click()
    await page.getByRole("menuitem", { name: "Admissions Staff", exact: true }).click()
    await expect(callout(page)).toHaveText(`Moved ${target.name} to Admissions Staff.`)

    await page.goto(`/staff/roles?role=${await roleId("Admissions Staff")}`)
    const row = personRow(page, target.name)
    await row.getByRole("button", { name: "Reactivate" }).click()

    await expect(callout(page)).toHaveText(`Reactivated ${target.name}.`)
    await expect(row).toContainText("Active")
  })

  test("a name is corrected in a dialog", async ({ page }) => {
    const target = await createThrowawayStaff([], { onRole: await roleId("Admissions Staff") })
    const corrected = `${target.name} Corrected`
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    await personRow(page, target.name).getByRole("button", { name: "Correct name" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(corrected)
    await dialog.getByRole("button", { name: "Save name" }).click()

    await expect(callout(page)).toHaveText(`Name corrected to ${corrected}.`)
    await expect(personRow(page, corrected)).toBeVisible()
  })
})

test.describe("shaping roles, the Super Admin's alone", () => {
  const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`

  // A role nobody holds, made by the system.
  async function systemRole(name = uniqueName("Role")) {
    const { rows } = await asSystem((sql) =>
      sql.query<{ id: string }>("insert into public.roles (name) values ($1) returning id", [name]),
    )
    return { id: rows[0].id, name }
  }

  test("a blank role starts with nothing ticked, and ticking a permission saves it", async ({ page }) => {
    const name = uniqueName("Front desk")
    await signIn(page, SUPER_ADMIN)
    await page.goto("/staff/roles")

    const rail = page.getByRole("navigation", { name: "Roles" })
    await rail.getByLabel("Role name").fill(name)
    await rail.getByRole("button", { name: "Add" }).click()

    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
    await expect(rail.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText("Changes apply to everyone in this role immediately.")).toBeVisible()
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0)

    await page.getByRole("checkbox", { name: "View applicants and their history" }).click()

    await expect(callout(page)).toHaveText(`${name} can now: View applicants and their history.`)
    await expect(page.getByRole("checkbox", { name: "View applicants and their history" })).toBeChecked()

    await openStaffHistoryAsSuperAdmin(page)
    const change = page
      .getByRole("list", { name: "History" })
      .getByRole("listitem")
      .filter({ hasText: `changed the role ${name}` })
    await expect(change).toContainText("permissions: None → View applicants and their history")
  })

  test("a name another role has is refused under the field", async ({ page }) => {
    await signIn(page, SUPER_ADMIN)
    await page.goto("/staff/roles")

    const rail = page.getByRole("navigation", { name: "Roles" })
    await rail.getByLabel("Role name").fill("accountant")
    await rail.getByRole("button", { name: "Add" }).click()

    await expect(rail.getByRole("alert")).toHaveText('A role called "accountant" already exists.')
  })

  test("a role's managed set is ticked and unticked like its permissions", async ({ page }) => {
    const role = await systemRole()
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${role.id}`)

    const accountants = page.getByRole("checkbox", { name: "Accountant", exact: true })
    await accountants.click()
    await expect(callout(page)).toHaveText(`${role.name} now manages the staff in another role.`)
    await expect(accountants).toBeChecked()

    await accountants.click()
    await expect(callout(page)).toHaveText(`${role.name} no longer manages the staff in that role.`)
    await expect(accountants).not.toBeChecked()
  })

  test("retiring a role active staff hold is refused, naming them", async ({ page }) => {
    const holder = await createThrowawayStaff(["leads.view"])
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${holder.roleId}`)

    await expect(page.getByRole("button", { name: "Retire role" })).toBeDisabled()
    await expect(
      page.getByText(`${holder.roleName} is still held by ${holder.name}. Move them to another role first.`),
    ).toBeVisible()
  })

  test("someone given the role after the page loaded still blocks retirement, and the callout names them", async ({
    page,
  }) => {
    const role = await systemRole()
    const holder = await createThrowawayStaff(["leads.view"])
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${role.id}`)

    await asSystem((sql) =>
      sql.query("update public.staff_members set role_id = $1 where id = $2", [role.id, holder.id]),
    )
    await page.getByRole("button", { name: "Retire role" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Retire role" }).click()

    await expect(callout(page)).toHaveText(
      `${role.name} is still held by ${holder.name}. Move them to another role first.`,
    )
    await expect(callout(page)).toHaveAttribute("role", "alert")
  })

  test("a refused rename keeps the dialog open with the typed name, to fix in place", async ({ page }) => {
    const role = await systemRole()
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${role.id}`)

    await page.getByRole("button", { name: "Rename" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Role name").fill("accountant")
    await dialog.getByRole("button", { name: "Save name" }).click()

    await expect(dialog.getByRole("alert")).toHaveText('A role called "accountant" already exists.')
    await expect(dialog.getByLabel("Role name")).toHaveValue("accountant")

    const fixed = uniqueName("Accounts desk")
    await dialog.getByLabel("Role name").fill(fixed)
    await dialog.getByRole("button", { name: "Save name" }).click()
    await expect(dialog).toBeHidden()
    await expect(callout(page)).toHaveText(`Renamed the role to ${fixed}.`)
  })

  test("a role is renamed, retired, then reactivated", async ({ page }) => {
    const role = await systemRole()
    const renamed = uniqueName("Renamed")
    await signIn(page, SUPER_ADMIN)
    await page.goto(`/staff/roles?role=${role.id}`)

    await page.getByRole("button", { name: "Rename" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Role name").fill(renamed)
    await dialog.getByRole("button", { name: "Save name" }).click()
    await expect(callout(page)).toHaveText(`Renamed the role to ${renamed}.`)
    await expect(page.getByRole("heading", { name: renamed, level: 2 })).toBeVisible()

    await page.getByRole("button", { name: "Retire role" }).click()
    await expect(page.getByRole("alertdialog").getByRole("heading")).toHaveText(`Retire ${renamed}?`)
    await page.getByRole("alertdialog").getByRole("button", { name: "Retire role" }).click()

    await expect(callout(page)).toHaveText(`Retired ${renamed}. It stays in history.`)
    await expect(page.getByText("Retired. Kept for history. Reactivate it to give it to anyone again.")).toBeVisible()
    await expect(
      page.getByRole("navigation", { name: "Roles" }).getByRole("link", { name: new RegExp(renamed) }),
    ).toContainText("Retired")

    await page.getByRole("button", { name: "Reactivate role" }).click()
    await expect(callout(page)).toHaveText(`${renamed} is a current role again.`)
    await expect(page.getByText("Changes apply to everyone in this role immediately.")).toBeVisible()
  })
})
