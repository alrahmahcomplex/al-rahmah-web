import { randomInt } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { inRolledBackTransaction } from "../tests/support/db"
import { ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { signInOnce } from "./log-in"

// A Discount code entered on Register students (#81, #308). Every run invents
// its own names and phone number; the codes are slice 4's seeded agents.

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
const open = (page: Page) => page.locator(".gf-step.gf-open")
const go = (page: Page, name: string | RegExp) => open(page).getByRole("button", { name, exact: typeof name === "string" })
// A tile's radio sits under its label, so the label is what takes the click.
const pick = (page: Page, name: string | RegExp, within = open(page)) =>
  within.locator("label").filter({ has: page.getByRole("radio", { name, exact: typeof name === "string" }) }).click()

/** One FORM 1 student, the father as custodian, brought by him: on to the Discount code. Returns the student's full name. */
async function toCodeStep(page: Page) {
  const [first, f, m, l] = [`AMANI${letters(4)}`, `JUMA${letters(4)}`, `SALIM${letters(4)}`, `MRISHO${letters(4)}`]
  await page.goto("/staff/check-in/new")
  const step = open(page)
  await step.getByRole("textbox", { name: "Student’s name" }).fill(first)
  await step.getByRole("textbox", { name: "First name" }).fill(f)
  await step.getByRole("textbox", { name: "Middle name" }).fill(m)
  await step.getByRole("textbox", { name: "Last name" }).fill(l)
  await go(page, "Continue").click()
  await pick(page, "Boy")
  await go(page, /FORM 1/).click()
  await pick(page, "Day")
  await go(page, "Not known yet").click()
  await go(page, "No, go to custodians").click()
  await open(page).getByRole("switch", { name: "The father is the custodian" }).click()
  await open(page).getByRole("textbox", { name: "Custodian’s mobile number" }).fill(`07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`)
  await go(page, "Continue").click()
  await pick(page, new RegExp(`^${f} ${m} ${l}`))
  await expect(page.getByRole("heading", { name: "Does the family have a Discount code?" })).toBeVisible()
  return `${first} ${f} ${l}`
}

test.describe("a Discount code on Register students", () => {
  // Each test answers a whole form first.
  test.describe.configure({ timeout: 90_000 })

  test("a seeded agent's code goes on the new student, with the staff reminder", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    const child = await toCodeStep(page)

    await go(page, "They have a code").click()
    // The first letters complete to the listed code, and Tab takes it.
    const box = open(page).getByRole("combobox", { name: "Discount code" })
    await box.pressSequentially("bjn4")
    await expect(box).toHaveValue("BJN-4")
    await box.press("Tab")
    await expect(box).toHaveValue("BJN-402")
    await expect(open(page).getByText("Tell the family: the person who gave them this code will see this student's admission progress.")).toBeVisible()
    await go(page, "Continue").click()
    await expect(page.getByText("BJN-402 · family told who sees the progress")).toBeVisible()
    await go(page, "Looks right").click()
    await go(page, "Register 1 student").click()
    await expect(page.getByRole("heading", { name: "1 student registered" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("The Discount code wasn’t saved")).toHaveCount(0)
    // The reminder was shown, so the lead records that the family was told (#182).
    const [lead] = await inRolledBackTransaction(
      async (sql) => (await sql.query("select id, referral_notice_version as v from public.leads where student_name = $1", [child])).rows as { id: string; v: string }[],
    )
    expect(lead.v).toBe("staff_reminder")

    await page.goto(`/staff/applicants/${lead.id}`)
    const panel = page.getByRole("region", { name: "Referral code" })
    await expect(panel.getByLabel("Code", { exact: true })).toHaveText("BJN-402")

    await openLeadHistoryAsSuperAdmin(page)
    const entries = page.getByRole("list", { name: "History" }).locator(":scope > li")
    await expect(entries.filter({ hasText: "added a Referral code" })).toContainText(ADMISSIONS.name)
  })

  test("the arrow lists the codes to pick from; a typed code nobody holds is refused until it is corrected or No code is chosen", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await toCodeStep(page)
    await go(page, "They have a code").click()
    const box = open(page).getByRole("combobox", { name: "Discount code" })

    await open(page).getByRole("button", { name: "Show all Discount codes" }).click()
    const list = open(page).getByRole("listbox", { name: "Discount codes" })
    await expect(list.getByText("Agent codes")).toBeVisible()
    await open(page).getByRole("combobox", { name: "Search Discount codes" }).fill("bjn402")
    await list.getByRole("option", { name: /BJN-402/ }).click()
    await expect(box).toHaveValue("BJN-402")
    await expect(list).toHaveCount(0)

    await box.fill("NOP-404")
    // Continue checks the code, however soon it is pressed.
    await go(page, "Continue").click()
    await expect(open(page).getByText("No Marketing Agent or Promo code has this code. Correct it, or choose No code.")).toBeVisible()
    await go(page, /NO CODE/).click()
    await expect(page.getByText("No code", { exact: true })).toBeVisible()
  })
})
