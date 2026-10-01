import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { asSystem, createThrowawayStaff, inRolledBackTransaction } from "../tests/support/db"
import { ACCOUNTANT, MANAGER, RETIRED_ROLE, type FixtureStaff } from "../tests/support/fixtures"

// The Staff and roles screen, as a Manager uses it. Tests that change
// someone change a throwaway staff member of their own, so parallel tests and
// the seeded fixtures never collide.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
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
  test("administrators find it in the navigation", async ({ page }) => {
    await signIn(page, MANAGER)

    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Staff and roles" }).click()

    await expect(page).toHaveURL(/\/staff\/roles$/)
    await expect(page.getByRole("heading", { name: "Staff and roles", level: 1 })).toBeVisible()
  })

  test("anyone else sees no link and gets the forbidden page at its URL", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(page.getByRole("link", { name: "Staff and roles" })).toHaveCount(0)

    await page.goto("/staff/roles")

    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Roles" })).toHaveCount(0)
  })
})

test.describe("the rail and pane", () => {
  test("show each role's active holders, the viewer's role, retired roles and each person's status", async ({
    page,
  }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    const rail = page.getByRole("navigation", { name: "Roles" })
    const yours = rail.getByRole("link", { name: /Admissions Manager/ })
    await expect(yours).toHaveAttribute("aria-current", "page")
    await expect(yours).toContainText("Your role")
    await expect(rail.getByRole("link", { name: /Receptionist/ })).toContainText("Retired")

    await expect(page.getByRole("heading", { name: "Admissions Manager", level: 2 })).toBeVisible()
    await expect(page.getByText("This is your role. Another Manager has to change it.")).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "Administer staff and roles" })).toBeChecked()
    await expect(personRow(page, "Second Manager")).toContainText("Active")

    await rail.getByRole("link", { name: /Receptionist/ }).click()
    await expect(page.getByText("Retired. Kept for history.")).toBeVisible()
    await expect(personRow(page, RETIRED_ROLE.name)).toContainText("Deactivated")
  })
})

test.describe("changing staff members", () => {
  test("controls the screen can see are blocked are disabled, with the reason beside them", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    const me = personRow(page, MANAGER.name)
    await expect(me.getByRole("button", { name: "Move to…" })).toBeDisabled()
    await expect(me.getByRole("button", { name: "Deactivate" })).toBeDisabled()
    await expect(me).toContainText("You can't change your own role. Another Manager has to do it.")
    await expect(me).toContainText("You can't deactivate yourself.")

    await page.goto(`/staff/roles?role=${await roleId("Receptionist")}`)
    const retired = personRow(page, RETIRED_ROLE.name)
    await expect(retired.getByRole("button", { name: "Reactivate" })).toBeDisabled()
    await expect(retired).toContainText(
      `${RETIRED_ROLE.name}'s role "Receptionist" was retired. Give them a current role first, then reactivate.`,
    )
  })

  test("a refusal only the database can see shows in the callout at the top of the pane", async ({ page }) => {
    const target = await createThrowawayStaff(["leads.view"])
    await signIn(page, MANAGER)
    await page.goto(`/staff/roles?role=${target.roleId}`)

    // Someone else deactivates them after this page loaded.
    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [target.id]))
    await personRow(page, target.name).getByRole("button", { name: "Deactivate" }).click()

    await expect(callout(page)).toHaveText(`${target.name} is already deactivated.`)
    await expect(callout(page)).toHaveAttribute("role", "alert")
    // The screen catches up with what the database knew.
    await expect(personRow(page, target.name)).toContainText("Deactivated")
  })

  test("deactivating a fellow administrator asks first, naming the consequence", async ({ page }) => {
    const target = await createThrowawayStaff(["staff.administer"])
    await signIn(page, MANAGER)
    await page.goto(`/staff/roles?role=${target.roleId}`)
    const row = personRow(page, target.name)

    await row.getByRole("button", { name: "Deactivate" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByRole("heading")).toHaveText(`Deactivate ${target.name}?`)
    await expect(dialog).toContainText('including "Administer staff and roles"')
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(row).toContainText("Active")

    await row.getByRole("button", { name: "Deactivate" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click()

    await expect(callout(page)).toHaveText(`Deactivated ${target.name}.`)
    await expect(row).toContainText("Deactivated")

    await page.getByRole("button", { name: "History" }).click()
    // Other tests write history at the same time, so find this change by name.
    const change = page
      .getByRole("list", { name: "History" })
      .getByRole("listitem")
      .filter({ hasText: `${MANAGER.name} changed ${target.name}` })
    await expect(change).toContainText("status: Active → Deactivated")
  })

  test("moving a fellow administrator off administering asks first", async ({ page }) => {
    const target = await createThrowawayStaff(["staff.administer"])
    await signIn(page, MANAGER)
    await page.goto(`/staff/roles?role=${target.roleId}`)

    await personRow(page, target.name).getByRole("button", { name: "Move to…" }).click()
    await page.getByRole("menuitem", { name: "Accountant", exact: true }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByRole("heading")).toHaveText(`Move ${target.name} to Accountant?`)
    await expect(dialog).toContainText('will lose "Administer staff and roles"')
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
    await signIn(page, MANAGER)
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
    const target = await createThrowawayStaff(["leads.view"])
    const corrected = `${target.name} Corrected`
    await signIn(page, MANAGER)
    await page.goto(`/staff/roles?role=${target.roleId}`)

    await personRow(page, target.name).getByRole("button", { name: "Correct name" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(corrected)
    await dialog.getByRole("button", { name: "Save name" }).click()

    await expect(callout(page)).toHaveText(`Name corrected to ${corrected}.`)
    await expect(personRow(page, corrected)).toBeVisible()
  })
})

test.describe("shaping roles", () => {
  const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`

  // A role nobody holds, made by the system, so any Manager may edit it.
  async function systemRole(name = uniqueName("Role")) {
    const { rows } = await asSystem((sql) =>
      sql.query<{ id: string }>("insert into public.roles (name) values ($1) returning id", [name]),
    )
    return { id: rows[0].id, name }
  }

  test("a new role starts with nothing ticked, and ticking a permission saves it", async ({ page }) => {
    const name = uniqueName("Front desk")
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    const rail = page.getByRole("navigation", { name: "Roles" })
    await rail.getByLabel("New role").fill(name)
    await rail.getByRole("button", { name: "Add" }).click()

    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
    await expect(rail.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText("Changes apply to everyone in this role immediately.")).toBeVisible()
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0)

    await page.getByRole("checkbox", { name: "View leads and their history" }).click()

    await expect(callout(page)).toHaveText(`${name} can now: View leads and their history.`)
    await expect(page.getByRole("checkbox", { name: "View leads and their history" })).toBeChecked()

    await page.getByRole("button", { name: "History" }).click()
    const change = page
      .getByRole("list", { name: "History" })
      .getByRole("listitem")
      .filter({ hasText: `changed the role ${name}` })
    await expect(change).toContainText("permissions: None → View leads and their history")
  })

  test("a name another role has is refused under the field", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/roles")

    const rail = page.getByRole("navigation", { name: "Roles" })
    await rail.getByLabel("New role").fill("accountant")
    await rail.getByRole("button", { name: "Add" }).click()

    await expect(rail.getByRole("alert")).toHaveText('A role called "accountant" already exists.')
  })

  test("a role that administers staff is closed, and Administer staff and roles is never tickable", async ({
    page,
  }) => {
    const administering = await createThrowawayStaff(["staff.administer", "leads.view"])
    const open = await systemRole()
    await signIn(page, MANAGER)

    await page.goto("/staff/roles")
    await expect(page.getByText("This is your role. Another Manager has to change it.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Rename" })).toBeDisabled()

    await page.goto(`/staff/roles?role=${administering.roleId}`)
    await expect(page.getByText("Only a reviewed update to the system can change this role.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Rename" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Retire role" })).toBeDisabled()
    for (const checkbox of await page.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled()
    await expect(page.getByRole("checkbox", { name: "Administer staff and roles" })).toBeChecked()

    await page.goto(`/staff/roles?role=${open.id}`)
    await expect(page.getByRole("checkbox", { name: "View leads and their history" })).toBeEnabled()
    const administer = page.getByRole("checkbox", { name: "Administer staff and roles" })
    await expect(administer).toBeDisabled()
    await expect(administer).not.toBeChecked()
    await expect(page.getByText("Only a reviewed update to the system can give or take this.")).toBeVisible()
  })

  test("retiring a role active staff hold is refused, naming them", async ({ page }) => {
    const holder = await createThrowawayStaff(["leads.view"])
    await signIn(page, MANAGER)
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
    await signIn(page, MANAGER)
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
    await signIn(page, MANAGER)
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

  test("a role is renamed, then retired", async ({ page }) => {
    const role = await systemRole()
    const renamed = uniqueName("Renamed")
    await signIn(page, MANAGER)
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
    await expect(page.getByText("Retired. Kept for history.")).toBeVisible()
    await expect(
      page.getByRole("navigation", { name: "Roles" }).getByRole("link", { name: new RegExp(renamed) }),
    ).toContainText("Retired")
  })
})
