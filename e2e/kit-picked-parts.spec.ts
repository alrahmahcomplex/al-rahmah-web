import { type Page } from "@playwright/test"

import { ADMISSIONS } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The parts the owner picked on prototype v38 (#402), on the kit page, with a
// real keyboard: the name boxes, the code box, the tabs and the pages.

async function openKit(page: Page, card: string) {
  await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
  await page.goto("/staff/kit")
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible()
  await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
  const region = page.getByRole("region", { name: card })
  await region.scrollIntoViewIfNeeded()
  return region
}

test("the name boxes take capitals, move on at a space, spread a paste and go back on Backspace", async ({ page }) => {
  const card = await openKit(page, "Names and codes")
  const person = card.getByRole("group", { name: "Agent or custodian" })
  const first = person.getByRole("textbox", { name: "First name" })
  const middle = person.getByRole("textbox", { name: "Middle name" })
  const last = person.getByRole("textbox", { name: "Last name" })

  await first.click()
  await page.keyboard.type("amina juma salim")
  await expect(first).toHaveValue("AMINA")
  await expect(middle).toHaveValue("JUMA")
  await expect(last).toHaveValue("SALIM")
  await expect(last).toBeFocused()

  await last.fill("")
  await page.keyboard.press("Backspace")
  await expect(middle).toBeFocused()

  const student = card.getByRole("group", { name: "Student" })
  await student.getByRole("textbox", { name: "Student’s name" }).click()
  await page.keyboard.insertText("Neema Omari Juma Hassan")
  const father = student.getByRole("group", { name: "Father’s name" })
  await expect(father.getByRole("textbox", { name: "First name" })).toHaveValue("OMARI")
  await expect(father.getByRole("textbox", { name: "Middle name" })).toHaveValue("JUMA")
  await expect(father.getByRole("textbox", { name: "Last name" })).toHaveValue("HASSAN")
})

test("the code box adds its hyphen, and the full-name box asks for two names", async ({ page }) => {
  const card = await openKit(page, "Names and codes")
  const code = card.getByRole("textbox", { name: "Discount code" })
  await code.click()
  await page.keyboard.type("aan1329")
  await expect(code).toHaveValue("AAN-132")

  const who = card.getByRole("textbox", { name: "Their full name" })
  await who.click()
  await page.keyboard.type("juma")
  await card.getByRole("button", { name: "Check the name" }).click()
  await expect(card.getByText("Type their full name, at least two names.")).toBeVisible()
  await expect(who).toHaveAttribute("aria-invalid", "true")
  await who.click()
  await page.keyboard.type(" khamis")
  await expect(who).toHaveValue("JUMA KHAMIS")
  await card.getByRole("button", { name: "Check the name" }).click()
  await expect(who).not.toHaveAttribute("aria-invalid")
})

test("the tabs and the pages work from the keyboard", async ({ page }) => {
  const tabsCard = await openKit(page, "Tabs: sliding track")
  await tabsCard.getByRole("tab", { name: "Overview" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(tabsCard.getByRole("tab", { name: "Interview" })).toBeFocused()
  await expect(tabsCard.getByRole("tabpanel", { name: "Interview" })).toHaveText("Showing: Interview")
  await page.keyboard.press("End")
  await expect(tabsCard.getByRole("tab", { name: "Follow-ups" })).toHaveAttribute("aria-selected", "true")

  const pages = page.getByRole("region", { name: "Pagination: numbered pills" })
  const nav = pages.getByRole("navigation", { name: "Applicant pages" })
  await expect(nav.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page")
  await nav.getByRole("button", { name: "Next page" }).focus()
  await page.keyboard.press("Enter")
  await expect(nav.getByRole("button", { name: "Page 4" })).toHaveAttribute("aria-current", "page")
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Enter")
  await expect(pages.getByText("Page 12 of 12")).toBeVisible()
  await expect(nav.getByRole("button", { name: "Next page" })).toBeDisabled()
})

// Axe scans run nightly (docs/agents/workflow.md, Axe scans).
test("axe finds nothing in the picked parts' cards", { tag: "@nightly" }, async ({ page }) => {
  await openKit(page, "Tabs: sliding track")
  const cards = ["Tabs: sliding track", "Pagination: numbered pills", "Avatars: soft tints", "Tooltips: light", "Slider: steps with labels", "Accordion: separate cards", "Names and codes"]
  for (const [i, card] of cards.entries()) {
    await page.getByRole("region", { name: card }).evaluate((el, n) => el.setAttribute("data-axe", String(n)), i)
    expect(await axeProblems(page, `[data-axe="${i}"]`), card).toEqual([])
  }
})
