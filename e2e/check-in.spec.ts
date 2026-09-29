import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "./fixtures"

// The front desk, as Admissions Staff use it. Every run invents its own
// child and phone number, so runs never collide with each other or with the
// seeded leads (+255 700 000 xxx).

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

function newFamily() {
  return {
    parent: `Parent ${randomUUID().slice(0, 6)}`,
    phone: `0 7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    child: `Child ${randomUUID().slice(0, 6)}`,
  }
}

async function fillParent(page: Page, family: { parent: string; phone: string }, phone = family.phone) {
  await page.getByLabel("Full name").fill(family.parent)
  await page.getByLabel("Phone", { exact: true }).fill(phone)
  await page.getByRole("button", { name: "Continue" }).click()
}

async function fillStudent(page: Page, child: string) {
  await page.getByLabel("Student's full name").fill(child)
  await page.getByLabel("Class").selectOption("STD 3")
  await page.getByLabel("Enrollment year").selectOption(String(new Date().getFullYear() + 1))
  await page.getByLabel("Boarding").check()
  await page.getByRole("button", { name: "Review" }).click()
}

async function startNewStudent(page: Page) {
  await page.goto("/staff/check-in")
  await page.getByRole("link", { name: "New Student" }).click()
  await expect(page.getByRole("heading", { name: "New Student", level: 1 })).toBeVisible()
}

test.describe("registering a new family", () => {
  test("Admissions Staff register a walk-in and the confirmation shows the Admission Number", async ({ page }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Check-in" }).click()
    await page.getByRole("link", { name: "New Student" }).click()

    await fillParent(page, family)
    await fillStudent(page, family.child)

    // The review shows what will be saved, with the visit today.
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible()
    await expect(page.getByText(family.child)).toBeVisible()
    await expect(page.getByText("Boarding", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Register student" }).click()

    const number = page.getByLabel("Admission Number")
    await expect(number).toHaveText(/^ADMSN-\d{5}$/)
    await expect(page.getByRole("heading", { name: `${family.child} is registered` })).toBeVisible()

    const admissionNumber = (await number.textContent()) ?? ""
    await page.getByRole("link", { name: "Open lead" }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { name: family.child, level: 1 })).toBeVisible()
    await expect(page.getByLabel("Admission Number")).toHaveText(admissionNumber)
    await expect(page.getByText("Visited", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(tanzaniaToday().slice(0, 4)).first()).toBeVisible()
    await expect(page.getByText(family.parent)).toBeVisible()
    await expect(page.getByText(/^\+2557\d{8}$/)).toBeVisible()
    // The lead screen is read-only: nothing to edit.
    await expect(page.getByRole("button", { name: /edit|save/i })).toHaveCount(0)
  })

  test("the number can be copied from the confirmation", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family)
    await fillStudent(page, family.child)
    await page.getByRole("button", { name: "Register student" }).click()

    const number = (await page.getByLabel("Admission Number").textContent()) ?? ""
    await page.getByRole("button", { name: "Copy number" }).click()

    await expect(page.getByRole("status")).toHaveText("Copied.")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(number)
  })

  test("a phone number that cannot be read sends staff back to the parent step, and nothing is written", async ({
    page,
  }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family, "12345")
    await fillStudent(page, family.child)
    await page.getByRole("button", { name: "Register student" }).click()

    await expect(page.getByRole("heading", { name: "Parent or guardian", level: 2 })).toBeVisible()
    await expect(page.locator("[data-slot=alert]")).toContainText("That phone number can't be read")
    await expect(page.getByLabel("Full name")).toHaveValue(family.parent)

    // Correcting it lets the registration through, and only then is a lead made.
    await page.getByLabel("Phone", { exact: true }).fill(family.phone)
    await page.getByRole("button", { name: "Continue" }).click()
    await page.getByRole("button", { name: "Review" }).click()
    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByLabel("Admission Number")).toHaveText(/^ADMSN-\d{5}$/)
  })

  test("a request that never comes back says so, and registering again is safe", async ({ page }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family)
    await fillStudent(page, family.child)

    // The first submit is dropped in flight; the second goes through.
    let dropped = false
    await page.route("**/staff/check-in/new", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true
        await route.abort("connectionfailed")
        return
      }
      await route.continue()
    })

    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.locator("[data-slot=alert]")).toContainText("could not be confirmed")
    await expect(page.getByRole("button", { name: "Register student" })).toBeEnabled()

    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByLabel("Admission Number")).toHaveText(/^ADMSN-\d{5}$/)
  })

  test("the Visit date cannot be later than today", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, newFamily())
    await expect(page.getByLabel("Visit date")).toHaveValue(tanzaniaToday())
    await expect(page.getByLabel("Visit date")).toHaveAttribute("max", tanzaniaToday())
  })
})

test.describe("a child who is already registered", () => {
  test("is refused, showing the existing Admission Number and a link to the lead", async ({ page }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)

    await startNewStudent(page)
    await fillParent(page, family)
    await fillStudent(page, family.child)
    await page.getByRole("button", { name: "Register student" }).click()
    const number = (await page.getByLabel("Admission Number").textContent()) ?? ""

    // The same child again, with the number written another way and the name
    // in capitals.
    await startNewStudent(page)
    await fillParent(page, family, family.phone.replace(/^0 /, "+255 "))
    await fillStudent(page, family.child.toUpperCase())
    await page.getByRole("button", { name: "Register student" }).click()

    const refusal = page.locator("[data-slot=alert]")
    await expect(refusal).toContainText("Already registered")
    await expect(refusal).toContainText(number)
    await refusal.getByRole("link", { name: `Open ${number}` }).click()
    await expect(page).toHaveURL(/\/staff\/leads\/[0-9a-f-]{36}$/)
    await expect(page.getByLabel("Admission Number")).toHaveText(number)
  })

  test("that is closed leads to the reopening hand-off, which shows it read-only", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, { parent: "Omari Fixture", phone: "0700 000 104" })
    await fillStudent(page, "Hamisi Fixture")
    await page.getByRole("button", { name: "Register student" }).click()

    const refusal = page.locator("[data-slot=alert]")
    await expect(refusal).toContainText("ADMSN-90005")
    await refusal.getByRole("link", { name: "Open ADMSN-90005" }).click()

    await expect(page).toHaveURL(/\/staff\/leads\/[0-9a-f-]{36}\/reopen\?source=duplicate_match$/)
    await expect(page.getByText("Reopening a closed lead isn't available yet")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible()
  })
})

test.describe("who sees what", () => {
  test("an Accountant sees Check-in, but no New Student button, and cannot open the form", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Check-in" }).click()

    await expect(page.getByRole("heading", { name: "Check-in", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "New Student" })).toHaveCount(0)

    await page.goto("/staff/check-in/new")
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
  })

  test("an Accountant can read a lead", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/leads/1ead0000-0000-4000-8000-000000000004")
    await expect(page.getByRole("heading", { name: "Salma Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("+255700000104")).toHaveCount(0)
    await expect(page.getByText("+255700000103")).toBeVisible()
    await expect(page.getByText("+255700000113")).toBeVisible()
  })

  test("a lead that does not exist is not found", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    const response = await page.goto(`/staff/leads/${randomUUID()}`)
    expect(response?.status()).toBe(404)
  })

  test("someone signed out is sent to sign in", async ({ page }) => {
    await page.goto("/staff/check-in")
    await expect(page).toHaveURL(/\/login/)
  })
})
