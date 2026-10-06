import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// A Referral code entered at New Student (#81). Every run invents its own
// child and phone number; the codes are slice 4's seeded agents.

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function toStudentStep(page: Page) {
  await page.goto("/staff/check-in/new")
  await page.getByLabel("Full name").fill(`Parent ${randomUUID().slice(0, 6)}`)
  await page.getByLabel("Phone", { exact: true }).fill(`0 7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Student", level: 2 })).toBeVisible()

  const child = `Child ${randomUUID().slice(0, 6)}`
  await page.getByLabel("Student's full name").fill(child)
  await page.getByLabel("Class").selectOption("STD 3")
  await page.getByLabel("Enrollment year").selectOption(String(new Date().getFullYear() + 1))
  await page.getByLabel("Day", { exact: true }).check()
  return child
}

test.describe("a Referral code at New Student", () => {
  test("Admissions Staff register a walk-in with a seeded agent's code and see it on the lead", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    const child = await toStudentStep(page)

    // The agent is named as the code is typed, however it is typed.
    const code = page.getByLabel("Referral code (optional)")
    await code.fill(" bjn -402")
    await expect(page.getByText("Baraka Juma Njoroge · Approved")).toBeVisible()
    await page.getByRole("button", { name: "Review" }).click()

    // The review shows the code and the agent's name.
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible()
    const student = page.getByRole("region", { name: "Student" })
    await expect(student).toContainText("Referral codeBJN-402")
    await expect(student).toContainText("Marketing AgentBaraka Juma Njoroge")

    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByRole("heading", { name: `${child} is registered` })).toBeVisible()
    await expect(page.getByText("the referral code wasn't saved")).toHaveCount(0)

    // The lead carries the code.
    await page.getByRole("link", { name: "Open lead" }).click()
    const panel = page.getByRole("region", { name: "Referral code" })
    await expect(panel.getByLabel("Code", { exact: true })).toHaveText("BJN-402")
    await expect(panel).toContainText("Marketing Agent: Baraka Juma Njoroge")
    await expect(panel.getByLabel("Expected interview fee")).toHaveText("TZS 30,000")

    // Its history shows the staff member who added it.
    await page.getByRole("link", { name: "History" }).click()
    const entries = page.getByRole("list", { name: "History" }).locator(":scope > li")
    await expect(entries.filter({ hasText: "added a Referral code" })).toContainText(ADMISSIONS.name)
    await expect(entries.filter({ hasText: "added a Referral code" })).toContainText("BJN-402")
  })

  test("a code no agent holds is refused on the student step", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await toStudentStep(page)

    const code = page.getByLabel("Referral code (optional)")
    await code.fill("nope-404")
    await expect(page.getByText("No Marketing Agent has this code.")).toBeVisible()
    await expect(code).toHaveAttribute("aria-invalid", "true")

    // Review stays on the student step until the code is corrected or cleared.
    await page.getByRole("button", { name: "Review" }).click()
    await expect(page.getByRole("heading", { name: "Student", level: 2 })).toBeVisible()
    await expect(page.getByText("Correct it, or clear the field to register without one.")).toBeVisible()
    await expect(code).toBeFocused()

    await code.fill("")
    await page.getByRole("button", { name: "Review" }).click()
    await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible()
    await expect(page.getByRole("region", { name: "Student" })).not.toContainText("Referral code")
  })
})
