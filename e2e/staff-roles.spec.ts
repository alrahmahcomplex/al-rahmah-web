import { expect, test, type Page } from "@playwright/test"

import { asSystem, createThrowawayStaff, inRolledBackTransaction } from "./db"
import { ACCOUNTANT, MANAGER, RETIRED_ROLE, type FixtureStaff } from "./fixtures"

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
    await expect(page.getByRole("listitem").filter({ hasText: "Administer staff and roles (included)" })).toBeVisible()
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
    const latest = page.getByRole("list", { name: "History" }).getByRole("listitem").first()
    await expect(latest).toContainText(`${MANAGER.name} changed ${target.name}`)
    await expect(latest).toContainText("status: Active → Deactivated")
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
