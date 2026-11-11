import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { tanzaniaToday } from "@/lib/school-calendar"

import { unusedAdmissionNumber } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// The front desk, as Admissions Staff use it. Every run invents its own
// child and phone number, so runs never collide with each other or with the
// seeded leads (+255 700 000 xxx).

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
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
  await page.getByRole("radio", { name: "STD 3" }).click()
  await page.getByRole("radio", { name: String(new Date().getFullYear() + 1) }).click()
  await page.getByRole("radio", { name: "Boarding" }).click()
  await page.getByRole("button", { name: "Continue to review" }).click()
}

async function startNewStudent(page: Page) {
  await page.goto("/staff/check-in")
  await page.getByRole("link", { name: "New family, never registered" }).click()
  await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
}

test.describe("registering a new family", () => {
  test("Admissions Staff register a walk-in and the confirmation shows the Admission Number", async ({ page }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Check-in" }).click()
    await page.getByRole("link", { name: "New family, never registered" }).click()

    await fillParent(page, family)
    await fillStudent(page, family.child)

    // The review shows what will be saved, with the visit today.
    await expect(page.getByRole("heading", { name: "Check and register", level: 1 })).toBeVisible()
    await expect(page.getByRole("region", { name: "Student" })).toContainText(family.child)
    await expect(page.getByRole("region", { name: "Student" })).toContainText("Boarding")

    await page.getByRole("button", { name: "Register student" }).click()

    const number = page.getByLabel("Admission Number")
    await expect(number).toHaveText(/^ADMSN-\d{5}$/)
    await expect(page.getByRole("heading", { name: `${family.child} is registered` })).toBeVisible()

    const admissionNumber = (await number.textContent()) ?? ""
    await page.getByRole("link", { name: `Open ${family.child}` }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { name: family.child, level: 1 })).toBeVisible()
    await expect(page.getByLabel("Admission Number")).toHaveText(admissionNumber)
    await expect(page.getByText("Visited", { exact: true }).first()).toBeVisible()
    await expect(page.getByText(tanzaniaToday().slice(0, 4)).first()).toBeVisible()
    await expect(page.getByText(family.parent)).toBeVisible()
    await expect(page.getByText(/^\+2557\d{8}$/)).toBeVisible()
    // The lead opens to read, with corrections offered but no form open.
    await expect(page.getByRole("button", { name: "Edit student" })).toBeVisible()
    await expect(page.getByRole("textbox")).toHaveCount(0)
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

  test("a phone number that cannot be read keeps staff on the parent step, and nothing is written", async ({
    page,
  }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family, "12345")

    // The Family check reads the number before any child is typed.
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
    await expect(page.locator("[data-slot=alert]")).toContainText("That phone number can't be read")
    await expect(page.getByLabel("Full name")).toHaveValue(family.parent)

    // Correcting it lets the registration through, and only then is a lead made.
    await page.getByLabel("Phone", { exact: true }).fill(family.phone)
    await page.getByRole("button", { name: "Continue" }).click()
    await fillStudent(page, family.child)
    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByLabel("Admission Number")).toHaveText(/^ADMSN-\d{5}$/)
  })

  test("a request that never comes back says so, and registering again is safe", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: Failed to load resource: net::ERR_CONNECTION_FAILED \(http:\/\/[^)]+\/staff\/check-in\/new\)$/, "this test drops the first submit")
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

  test("the Visit date reads as today until it is changed, and cannot be later than today", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, newFamily())
    await expect(page.getByText(/^Visit date: today, /)).toBeVisible()
    await expect(page.getByLabel("Visit date", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Change visit date" }).click()
    await expect(page.getByLabel("Visit date", { exact: true })).toBeFocused()
    await expect(page.getByLabel("Visit date", { exact: true })).toHaveValue(tanzaniaToday())
    await expect(page.getByLabel("Visit date", { exact: true })).toHaveAttribute("max", tanzaniaToday())
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
    // in capitals, and staff skipping the Family match.
    await startNewStudent(page)
    await fillParent(page, family, family.phone.replace(/^0 /, "+255 "))
    await page.getByRole("button", { name: "Not the same person" }).click()
    await fillStudent(page, family.child.toUpperCase())
    await page.getByRole("button", { name: "Register student" }).click()

    const refusal = page.locator("[data-slot=alert]")
    await expect(refusal).toContainText("Already registered")
    await expect(refusal).toContainText(number)
    await refusal.getByRole("link", { name: `Open ${number}` }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\/[0-9a-f-]{36}$/)
    await expect(page.getByLabel("Admission Number")).toHaveText(number)
  })

  test("that is closed leads to the Reopening request form for the existing lead", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, { parent: "Omari Fixture", phone: "0700 000 104" })
    await page.getByRole("button", { name: "Not the same person" }).click()
    await fillStudent(page, "Hamisi Fixture")
    await page.getByRole("button", { name: "Register student" }).click()

    const refusal = page.locator("[data-slot=alert]")
    await expect(refusal).toContainText("ADMSN-90005")
    await refusal.getByRole("link", { name: "Open ADMSN-90005" }).click()

    await expect(page).toHaveURL(/\/staff\/applicants\/[0-9a-f-]{36}\/reopen\?source=duplicate_match$/)
    await expect(page.getByText("This student is already on file, so no new record was made.")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel("Why is the family back?")).toBeVisible()
  })
})

test.describe("a family who gives their Admission Number", () => {
  async function lookUp(page: Page, typed: string) {
    await page.goto("/staff/check-in")
    await page.getByLabel("Admission Number").fill(typed)
    await page.getByRole("button", { name: "Find" }).click()
  }

  test("goes straight to their lead, however the number is typed", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    for (const typed of ["ADMSN-90002", "  admsn-90002 ", "90002"]) {
      await lookUp(page, typed)
      await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000002$/)
      await expect(page.getByRole("heading", { name: "Baraka Fixture", level: 1 })).toBeVisible()
    }
  })

  test("goes to an Archived or Declined lead itself, not the reopening hand-off", async ({ page }) => {
    await signIn(page, ADMISSIONS)

    await lookUp(page, "ADMSN-90005")
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000005$/)
    await expect(page.getByRole("heading", { name: "Hamisi Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible()

    await lookUp(page, "90006")
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000006$/)
    await expect(page.getByRole("heading", { name: "Rehema Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("Declined", { exact: true }).first()).toBeVisible()
  })

  test("a number that matches nothing says so, and Try again clears the field and keeps focus on it", async ({
    page,
  }) => {
    await signIn(page, ADMISSIONS)
    await lookUp(page, await unusedAdmissionNumber())

    const notFound = page.locator("[data-slot=alert]")
    await expect(notFound).toContainText("No applicant with this Admission Number")
    await expect(page).toHaveURL(/\/staff\/check-in$/)

    await notFound.getByRole("button", { name: "Try again" }).click()
    await expect(page.locator("[data-slot=alert]")).toHaveCount(0)
    await expect(page.getByLabel("Admission Number")).toHaveValue("")
    await expect(page.getByLabel("Admission Number")).toBeFocused()

    // Staff can type the right number straight away.
    await page.keyboard.type("90001")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Zawadi Fixture", level: 1 })).toBeVisible()
  })

  test("a number that matches nothing offers a new family, which starts the registration", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await lookUp(page, (await unusedAdmissionNumber()).slice("ADMSN-".length))

    await page.locator("[data-slot=alert]").getByRole("link", { name: "New family, never registered" }).click()
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
    await expect(page.getByText("Step 1 of 3")).toBeVisible()
  })

  test("a lookup that never comes back says so, not that there is no lead, and the field stays locked meanwhile", async ({
    page,
    allowConsoleError,
  }) => {
    allowConsoleError(/^console\.error: Failed to load resource: net::ERR_CONNECTION_FAILED \(http:\/\/[^)]+\/staff\/check-in\)$/, "this test drops the first lookup")
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/check-in")

    // The first lookup is held, then dropped in flight; the second goes through.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let dropped = false
    await page.route("**/staff/check-in", async (route) => {
      if (route.request().method() === "POST" && !dropped) {
        dropped = true
        await held
        await route.abort("connectionfailed")
        return
      }
      await route.continue()
    })

    const field = page.getByLabel("Admission Number")
    await field.fill("ADMSN-90002")
    await page.getByRole("button", { name: "Find" }).click()
    await expect(field).toHaveAttribute("readonly")
    await expect(page.getByRole("button", { name: "Find" })).toBeDisabled()
    release()

    const refusal = page.locator("[data-slot=alert]")
    await expect(refusal).toContainText("The lookup could not be completed")
    await expect(refusal).not.toContainText("No applicant")
    await expect(field).not.toHaveAttribute("readonly")
    await expect(field).toHaveValue("ADMSN-90002")

    await page.getByRole("button", { name: "Find" }).click()
    await expect(page.getByRole("heading", { name: "Baraka Fixture", level: 1 })).toBeVisible()
  })

  test("an Accountant can look a lead up and read it, and is offered only Try again when nothing matches", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTANT)

    await lookUp(page, "ADMSN-90004")
    await expect(page.getByRole("heading", { name: "Salma Fixture", level: 1 })).toBeVisible()

    await lookUp(page, await unusedAdmissionNumber())
    const notFound = page.locator("[data-slot=alert]")
    await expect(notFound).toContainText("No applicant with this Admission Number")
    await expect(notFound.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(notFound.getByRole("link", { name: "New family, never registered" })).toHaveCount(0)
  })
})

test.describe("who sees what", () => {
  test("an Accountant sees Check-in, but no new-family button, and cannot open the form", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Check-in" }).click()

    await expect(page.getByRole("heading", { name: "Who has arrived?", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "New family, never registered" })).toHaveCount(0)

    await page.goto("/staff/check-in/new")
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
  })

  test("an Accountant can read a lead", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await page.goto("/staff/applicants/1ead0000-0000-4000-8000-000000000004")
    await expect(page.getByRole("heading", { name: "Salma Fixture", level: 1 })).toBeVisible()
    await expect(page.getByText("+255700000104")).toHaveCount(0)
    await expect(page.getByText("+255700000103")).toBeVisible()
    await expect(page.getByText("+255700000113")).toBeVisible()
  })

  test("a lead that does not exist is not found", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    // The application page streams behind its loading skeleton, so the
    // status is already sent when the lookup finds nothing. Next marks the
    // page noindex; what staff see is the staff 404 inside the shell.
    await page.goto(`/staff/applicants/${randomUUID()}`)
    await expect(page.getByRole("heading", { name: "This page does not exist", level: 1 })).toBeVisible()
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
  })

  test("someone signed out is sent to sign in", async ({ page }) => {
    await page.goto("/staff/check-in")
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe("a family who gives the student's name", () => {
  async function search(page: Page, typed: string) {
    await page.goto("/staff/check-in")
    await page.getByLabel("Admission Number").fill(typed)
    await page.getByRole("button", { name: "Find" }).click()
  }

  test("sees the matching students, Declined and Archived ones marked, the Archived one last, and picks one", async ({
    page,
  }) => {
    await signIn(page, ADMISSIONS)
    await search(page, "fixture")

    const matches = page.getByRole("region", { name: /students match “fixture”/ })
    await expect(matches).toBeVisible()
    const rows = matches.getByRole("link")
    await expect(rows).toHaveCount(6)
    // Leads without a closure mark come first, by name, Declined among them;
    // Inactive and Archived ones follow.
    await expect(rows.first()).toContainText("Baraka Fixture")
    await expect(rows.filter({ hasText: "Rehema Fixture" })).toContainText("Declined")
    await expect(rows.last()).toContainText("Hamisi Fixture")
    await expect(rows.last()).toContainText("Archived")

    await matches.getByRole("link", { name: /Baraka Fixture/ }).click()
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000002$/)
    await expect(page.getByRole("heading", { name: "Baraka Fixture", level: 1 })).toBeVisible()
  })

  test("a name that matches nothing says so, and offers a new family", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await search(page, "nobody of this name")

    const nothing = page.locator("[data-slot=alert]")
    await expect(nothing).toContainText("No student matches “nobody of this name”")
    await expect(nothing.getByRole("button", { name: "Try again" })).toBeVisible()
    await expect(nothing.getByRole("link", { name: "New family, never registered" })).toBeVisible()
    await expect(page.getByRole("link", { name: "New family, never registered" })).toHaveCount(1)
  })
})

test.describe("registering without a mouse", () => {
  test("Tab reaches each chip group and the cards, Space selects, and the arrow keys move along", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    // The Cancel for the whole registration sits in the top bar.
    await expect(page.getByRole("banner").getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/staff/check-in")
    await fillParent(page, newFamily())
    await expect(page.getByRole("heading", { name: "Who is the student?", level: 1 })).toBeFocused()

    await page.getByLabel("Student's full name").fill(`Child ${randomUUID().slice(0, 6)}`)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("radio", { name: "DAY CARE" })).toBeFocused()
    await page.keyboard.press("Space")
    await expect(page.getByRole("radio", { name: "DAY CARE" })).toBeChecked()
    await page.keyboard.press("ArrowRight")
    await expect(page.getByRole("radio", { name: "KG 1" })).toBeFocused()
    await expect(page.getByRole("radio", { name: "KG 1" })).toBeChecked()

    await page.keyboard.press("Tab")
    const year = page.getByRole("radiogroup", { name: "Enrollment year" }).getByRole("radio").first()
    await expect(year).toBeFocused()
    await page.keyboard.press("Space")
    await expect(year).toBeChecked()

    await page.keyboard.press("Tab")
    await expect(page.getByRole("radio", { name: "Day", exact: true })).toBeFocused()
    await page.keyboard.press("Space")
    await expect(page.getByRole("radio", { name: "Day", exact: true })).toBeChecked()
    await expect(page.getByRole("radio", { name: "Day", exact: true })).toHaveAccessibleDescription("Goes home after school each day.")

    await page.getByRole("button", { name: "Continue to review" }).focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("heading", { name: "Check and register", level: 1 })).toBeFocused()
    await expect(page.getByRole("region", { name: "Student" })).toContainText("KG 1")
  })

  test("the rail shows what was entered, and Change goes back to that step with it kept", async ({ page }) => {
    const family = newFamily()
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family)

    const rail = page.getByRole("list", { name: "Steps" })
    await expect(rail).toContainText(`${family.parent} · Mother`)
    await expect(rail).toContainText(family.phone)
    await expect(page.getByRole("progressbar", { name: "Step 2 of 3" })).toHaveAttribute("aria-valuenow", "2")

    await rail.getByRole("button", { name: "Change parent or guardian" }).click()
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeFocused()
    await expect(page.getByLabel("Full name")).toHaveValue(family.parent)
    await expect(page.getByText("Step 1 of 3")).toBeVisible()

    // Review's own Change links lead back too.
    await page.getByRole("button", { name: "Continue" }).click()
    await fillStudent(page, family.child)
    await page.getByRole("region", { name: "Student" }).getByRole("button", { name: "Change student" }).click()
    await expect(page.getByRole("heading", { name: "Who is the student?", level: 1 })).toBeFocused()
    await expect(page.getByLabel("Student's full name")).toHaveValue(family.child)
    await expect(page.getByRole("radio", { name: "STD 3" })).toBeChecked()
  })

  test("Register another child keeps the parent, and the Family check then lists the child just registered", async ({
    page,
  }) => {
    const family = newFamily()
    const sibling = `Sibling ${randomUUID().slice(0, 6)}`
    await signIn(page, ADMISSIONS)
    await startNewStudent(page)
    await fillParent(page, family)
    await fillStudent(page, family.child)
    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByRole("heading", { name: `${family.child} is registered`, level: 1 })).toBeFocused()
    await expect(page.getByText(`Tell the parent: “${family.child}'s Admission Number is`)).toBeVisible()

    await page.getByRole("button", { name: "Register another child" }).click()
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
    await expect(page.getByLabel("Full name")).toHaveValue(family.parent)
    await page.getByRole("button", { name: "Continue" }).click()

    await page.getByRole("group", { name: family.parent }).getByRole("button", { name: "Same person" }).click()
    await expect(page.getByRole("row", { name: new RegExp(family.child) })).toBeVisible()
    await page.getByRole("button", { name: "Register a new sibling" }).click()
    await expect(page.getByLabel("Student's full name")).toHaveValue("")
    await fillStudent(page, sibling)
    await expect(page.getByRole("region", { name: "Parent or guardian" })).toContainText("Returning family")
    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByRole("heading", { name: `${sibling} is registered`, level: 1 })).toBeVisible()
  })
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("check-in and every registration screen fit the width", async ({ page }) => {
    const family = newFamily()
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/check-in")
    await expect(page.getByRole("heading", { name: "Who has arrived?", level: 1 })).toBeVisible()
    expect(await fits()).toBe(true)

    await page.getByRole("link", { name: "New family, never registered" }).click()
    await expect(page.getByRole("heading", { name: "Who is the parent or guardian?", level: 1 })).toBeVisible()
    expect(await fits()).toBe(true)
    await fillParent(page, family)
    await expect(page.getByRole("heading", { name: "Who is the student?", level: 1 })).toBeVisible()
    expect(await fits()).toBe(true)
    await fillStudent(page, family.child)
    await expect(page.getByRole("heading", { name: "Check and register", level: 1 })).toBeVisible()
    expect(await fits()).toBe(true)
  })
})
