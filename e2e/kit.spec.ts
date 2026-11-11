import AxeBuilder from "@axe-core/playwright"
import { type Locator, type Page } from "@playwright/test"

import { ADMISSIONS } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The kit page (#319): the prototype's Design system page rebuilt with
// components/kit, then the kit's other pieces. Any signed-in staff member may
// open it; it sits outside the old shell until F6.

const INDIGO = "rgb(9, 0, 187)"
const PEACH_GLOW = "rgb(255, 207, 166)"

async function openKit(page: Page) {
  await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
  await page.goto("/staff/kit")
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible()
}

const glow = (icon: Locator) =>
  icon.locator("circle.gf-ic-glow").evaluate((el) => {
    const style = getComputedStyle(el)
    return { fill: style.fill, scale: new DOMMatrixReadOnly(style.transform).a }
  })
const line = (icon: Locator) => icon.locator("g.gf-ic-line").first().evaluate((el) => getComputedStyle(el).stroke)

test("a signed-out visitor is sent to sign in", async ({ page }) => {
  await page.goto("/staff/kit")
  await expect(page).toHaveURL(/\/login/)
})

test("shows both parts on the lavender wash, outside the old shell, and is not indexed", async ({ page }) => {
  await openKit(page)
  await expect(page).toHaveTitle("Design system · Al-Rahmah Complex")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)
  await expect(page.getByRole("navigation", { name: "Staff" })).toHaveCount(0)
  await expect(page.locator("[data-kit]")).toHaveCSS("background-image", /linear-gradient/)

  const top = page.locator('[data-part="design-system"]')
  for (const title of ["Icons: one colour at rest, two in use", "Illustrations", "Colour", "Type", "Buttons", "Fields", "Selectors", "Progress bar", "Cards and chips"])
    await expect(top.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible()
  // The swatches read their values from app/tokens.css.
  await expect(top.getByText("#0900bb")).toBeVisible()

  const more = page.locator('[data-part="more"]')
  for (const title of ["Page header", "Filter pills and table", "Table", "List row", "Chips", "Note", "Empty state", "Loading state", "Skeleton", "Task card and finished state"])
    await expect(more.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible()
})

test("the active icon state shows on hover and in a featured icon", async ({ page }) => {
  await openKit(page)
  const host = page.locator('[data-icons="hover"] > span').first()
  const icon = host.locator("svg")

  await expect.poll(() => glow(icon)).toEqual({ fill: "rgba(0, 0, 0, 0)", scale: 0.5 })
  await host.hover()
  await expect.poll(() => glow(icon)).toEqual({ fill: PEACH_GLOW, scale: 1 })
  expect(await line(icon)).toBe(INDIGO)

  const featured = page.locator('[data-icons="featured"] svg').first()
  await expect.poll(() => glow(featured)).toEqual({ fill: PEACH_GLOW, scale: 1 })

  // A round button hosts its icon's active state too.
  const menu = page.locator('[data-part="design-system"]').getByRole("region", { name: "Buttons" }).getByRole("button", { name: "Menu" })
  await expect.poll(() => glow(menu.locator("svg"))).toEqual({ fill: "rgba(0, 0, 0, 0)", scale: 0.5 })
  await menu.hover()
  await expect.poll(() => glow(menu.locator("svg"))).toEqual({ fill: PEACH_GLOW, scale: 1 })
})

test("the controls answer: selectors, filter pills, rows, chip buttons and the pending button", async ({ page }) => {
  await openKit(page)
  const top = page.locator('[data-part="design-system"]')
  const tile = top.getByRole("button", { name: /FORM 1/ })
  await expect(tile).toHaveAttribute("aria-pressed", "true")
  await tile.click()
  await expect(tile).toHaveAttribute("aria-pressed", "false")
  await top.getByRole("radio", { name: "STD 6" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect(top.getByRole("radio", { name: "STD 7" })).toBeChecked()
  await expect(top.getByRole("textbox", { name: "Example field with an error" })).toHaveAccessibleDescription("Type the full name, at least two names.")

  const more = page.locator('[data-part="more"]')
  const detail = more.getByRole("region", { name: "Sections and key-value list" })
  await expect(detail).toContainText("DMSN-90001")
  const row = more.getByRole("row", { name: "Baraka Mfano" })
  await row.focus()
  await page.keyboard.press("Enter")
  await expect(detail).toContainText("DMSN-90002")

  await more.getByRole("button", { name: "Applied", exact: true }).click()
  await expect(more.getByRole("button", { name: "Applied", exact: true })).toHaveAttribute("aria-pressed", "true")
  const filtered = more.getByRole("region", { name: "Filter pills and table" })
  await expect(filtered.getByText("No applicant matches")).toBeVisible()
  await expect(more.getByRole("table", { name: "Applicants" })).toHaveCount(0)
  await more.getByRole("button", { name: "Clear" }).first().click()
  await expect(more.getByRole("table", { name: "Applicants" })).toBeVisible()

  const deposit = more.getByRole("group", { name: "What kind of payment is it?" }).getByRole("button", { name: "Initial deposit" })
  await deposit.click()
  await expect(deposit).toHaveAttribute("aria-pressed", "true")

  await more.getByRole("button", { name: "Find the family" }).click()
  const pending = more.getByRole("button", { name: "Finding the family…" })
  await expect(pending).toHaveAttribute("aria-busy", "true")
  await expect(more.getByRole("button", { name: "Find the family" })).toBeVisible()
})

test("Exo is never upright on the page", async ({ page }) => {
  await openKit(page)
  const upright = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const style = getComputedStyle(el)
        return /exo/i.test(style.fontFamily.split(",")[0]) && style.fontStyle === "normal" && el.textContent?.trim()
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  )
  expect(upright).toEqual([])
})

for (const width of [1280, 390]) {
  test(`axe finds nothing but the accepted white-on-orange contrast at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openKit(page)
    const results = await new AxeBuilder({ page }).analyze()
    const problems = results.violations.flatMap((violation) =>
      violation.nodes
        // White on #ee7300 is the owner's accepted risk (DESIGN.md, The ShuleFasta Button Rule).
        .filter((node) => !(violation.id === "color-contrast" && node.any.some((check) => check.data?.fgColor === "#ffffff" && check.data?.bgColor === "#ee7300")))
        .map((node) => `${violation.id}: ${node.target.join(" ")}`),
    )
    expect(problems).toEqual([])
  })
}
