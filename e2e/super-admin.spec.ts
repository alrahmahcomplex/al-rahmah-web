import { expect, test, type Page } from "@playwright/test"

import { MANAGER, SUPER_ADMIN, type FixtureStaff } from "../tests/support/fixtures"
import { signInAsSuperAdmin } from "./super-admin"
import { logIn } from "./log-in"

// The Super Admin (#237): signs in, reads the system audit, and administers
// staff on a Roles tab that never lists their own role. The seeded Manager
// sees no history page and no trace of the Super Admin.

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

test("the Super Admin signs in, reads the audit and filters it", async ({ page }) => {
  await signInAsSuperAdmin(page)

  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Audit" }).click()
  await expect(page).toHaveURL(/\/staff\/audit$/)
  await expect(page.getByRole("heading", { name: "Audit", level: 1 })).toBeVisible()
  await expect(page.getByRole("list", { name: "Audit entries" }).locator(":scope > li").first()).toBeVisible()

  // The migration created the role as the system, in staff administration.
  await page.getByLabel("Who").selectOption("system")
  await page.getByLabel("Area").selectOption("staff_admin")
  await page.getByLabel("Record").fill(SUPER_ADMIN.roleId)
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/area=staff_admin/)
  const entries = page.getByRole("list", { name: "Audit entries" }).locator(":scope > li")
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText("System")
  await expect(entries.first()).toContainText("insert on roles")
  await expect(entries.first()).toContainText("name: Super Admin")

  await page.getByLabel("Record").fill("not a record")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page.getByText("Enter a record as an Admission Number")).toBeVisible()
})

test("the Super Admin's Roles tab lists every other role and person, never their own", async ({ page }) => {
  await signInAsSuperAdmin(page)
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Staff and roles" }).click()

  const rail = page.getByRole("navigation", { name: "Roles" })
  // Other tests make roles named after the templates, so the seeded one is found by its id (#241).
  await expect(rail.locator('a[href="/staff/roles?role=7e000000-0000-4000-8000-000000000002"]')).toBeVisible()
  await expect(rail.getByText("Super Admin", { exact: true })).toHaveCount(0)
  await expect(rail).not.toContainText("Your role")
  await expect(page.getByText(SUPER_ADMIN.email)).toHaveCount(0)
  await expect(page.getByRole("checkbox", { name: "See the full audit history" })).toHaveCount(0)

  // The history is theirs.
  await page.getByRole("button", { name: "History" }).click()
  await expect(page.getByRole("list", { name: "History" }).locator(":scope > li").first()).toBeVisible()
})

test("the seeded Manager sees no history, no Audit and no Super Admin anywhere", async ({ page }) => {
  await signIn(page, MANAGER)

  const nav = page.getByRole("navigation", { name: "Staff" })
  await expect(nav.getByRole("link", { name: "Staff and roles" })).toBeVisible()
  await expect(nav.getByRole("link", { name: "Audit" })).toHaveCount(0)

  await page.goto("/staff/audit")
  await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()

  await page.goto("/staff/roles")
  await expect(page.getByRole("heading", { name: "Staff and roles", level: 1 })).toBeVisible()
  await expect(page.getByRole("button", { name: "History" })).toHaveCount(0)
  await expect(page.getByText("Super Admin", { exact: true })).toHaveCount(0)
  // The holder carries the school's own name, which the sidebar shows as the brand.
  await expect(page.getByRole("main").getByText(SUPER_ADMIN.name)).toHaveCount(0)
  await expect(page.getByText(SUPER_ADMIN.email)).toHaveCount(0)
  await expect(page.getByRole("checkbox", { name: "See the full audit history" })).toHaveCount(0)

  // The invite's role choices leave it out too.
  const roleChoices = await page.locator("select option, [role=option]").allTextContents()
  expect(roleChoices.map((choice) => choice.trim())).not.toContain("Super Admin")
})
