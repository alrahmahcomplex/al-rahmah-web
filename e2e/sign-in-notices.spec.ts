import { expect, test, type Page } from "@playwright/test"

import { createThrowawayStaff, inRolledBackTransaction, signedIn } from "./db"
import type { FixtureStaff } from "./fixtures"

// The notice a staff member sees on the staff home at sign-in when someone
// else changed their role or account, and dismissing it. Each test changes a
// throwaway staff member of its own.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
}

async function roleId(name: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

// Today in East Africa Time, the way the notice writes it.
const today = () =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date())

const noticesBox = (page: Page) => page.getByRole("region", { name: "Changes to your account" })

test("a role change by another Manager shows at next sign-in, and Dismiss clears it for good", async ({ page }) => {
  const manager = await createThrowawayStaff(["staff.administer"])
  const person = await createThrowawayStaff(["leads.view"])
  const managerClient = await signedIn(manager)
  const { error } = await managerClient.rpc("assign_staff_role", { staff_id: person.id, role_id: await roleId("Accountant") })
  expect(error).toBeNull()

  await signIn(page, person)

  await expect(noticesBox(page).getByRole("listitem")).toHaveText([
    `${manager.name} changed your role from ${person.roleName} to Accountant on ${today()}.`,
  ])

  await noticesBox(page).getByRole("button", { name: "Dismiss" }).click()
  await expect(noticesBox(page)).toHaveCount(0)

  await signOut(page)
  await signIn(page, person)
  await expect(page.getByText("Welcome,")).toBeVisible()
  await expect(noticesBox(page)).toHaveCount(0)
})

test("a deactivation and reactivation by someone else show as two notices", async ({ page }) => {
  const manager = await createThrowawayStaff(["staff.administer"])
  const person = await createThrowawayStaff(["leads.view"])
  const managerClient = await signedIn(manager)
  expect((await managerClient.rpc("deactivate_staff_member", { staff_id: person.id })).error).toBeNull()
  expect((await managerClient.rpc("reactivate_staff_member", { staff_id: person.id })).error).toBeNull()

  await signIn(page, person)

  await expect(noticesBox(page).getByRole("listitem")).toHaveText([
    `${manager.name} deactivated your account on ${today()}.`,
    `${manager.name} reactivated your account on ${today()}.`,
  ])
})

test("a staff member nobody else has changed sees no notices", async ({ page }) => {
  const person = await createThrowawayStaff(["leads.view"])

  await signIn(page, person)

  await expect(page.getByText(`Welcome, ${person.name}.`)).toBeVisible()
  await expect(noticesBox(page)).toHaveCount(0)
})
