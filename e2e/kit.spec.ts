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
  for (const title of ["Page header", "Filter pills and table", "Table", "List row", "Chips", "Note", "Empty state", "Loading state", "Skeleton", "Task card and finished state", "Guided form", "Sheet", "Side sheet", "Popover", "Toast", "Confetti"])
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
  await expect(filtered.getByRole("table", { name: "Applicants" })).toHaveCount(0)
  await more.getByRole("button", { name: "Clear" }).first().click()
  await expect(filtered.getByRole("table", { name: "Applicants" })).toBeVisible()

  const deposit = more.getByRole("group", { name: "What kind of payment is it?" }).getByRole("button", { name: "Initial deposit" })
  await deposit.click()
  await expect(deposit).toHaveAttribute("aria-pressed", "true")

  await more.getByRole("button", { name: "Find the family" }).click()
  const pending = more.getByRole("button", { name: "Finding the family…" })
  await expect(pending).toHaveAttribute("aria-busy", "true")
  await expect(more.getByRole("button", { name: "Find the family" })).toBeVisible()

  // #348: a link drawn as a button, a disabled button and the bad note are shown too.
  const states = more.getByRole("region", { name: "Button states" })
  await expect(states.getByRole("link", { name: "Open Applicants" })).toHaveAttribute("href", "/staff/applicants")
  await expect(states.getByRole("button", { name: "Continue" })).toBeDisabled()
  await expect(more.getByRole("region", { name: "Note" }).getByText("The payment form could not open. Check your connection and try again.")).toBeVisible()
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

/** Waits until an overlay has finished opening, so colours are not caught mid-fade. */
async function settled(overlay: Locator) {
  await expect.poll(() => overlay.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
}

/** Axe's findings, less the accepted white on orange; `include` narrows the scan to an open overlay. */
async function axeProblems(page: Page, include?: string) {
  if (include) await settled(page.locator(include))
  const builder = new AxeBuilder({ page })
  if (include) builder.include(include)
  const results = await builder.analyze()
  return results.violations.flatMap((violation) =>
    violation.nodes
      // White on #ee7300 is the owner's accepted risk (DESIGN.md, The ShuleFasta Button Rule).
      .filter((node) => !(violation.id === "color-contrast" && node.any.some((check) => check.data?.fgColor === "#ffffff" && check.data?.bgColor === "#ee7300")))
      .map((node) => `${violation.id}: ${node.target.join(" ")}`),
  )
}

for (const width of [1280, 390]) {
  test(`axe finds nothing but the accepted white-on-orange contrast at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openKit(page)
    // The guided form's first question fades in; mid-fade its colours are blended.
    await settled(page.locator(".kit-guided"))
    expect(await axeProblems(page)).toEqual([])
  })

  test(`axe finds nothing in the open sheets and popover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openKit(page)
    const more = page.locator('[data-part="more"]')

    await more.getByRole("region", { name: "Sheet", exact: true }).getByRole("button", { name: "Review" }).first().click()
    await expect(page.getByRole("dialog", { name: "Sibling · 10%" })).toBeVisible()
    expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await more.getByRole("row", { name: "Zuhura Ali Mussa Khamis" }).click()
    const sheet = page.getByRole("dialog", { name: "Zuhura Ali Mussa Khamis" })
    await sheet.getByRole("button", { name: "Edit fee" }).click()
    await sheet.locator("label", { hasText: "Full fee" }).click()
    await expect(sheet.getByText("Before you save")).toBeVisible()
    expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await more.getByRole("region", { name: "Popover" }).getByRole("button", { name: "New requests" }).click()
    await expect(page.getByRole("dialog", { name: "New requests" })).toBeVisible()
    expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
  })
}

/** Presses Tab, then Shift+Tab, and checks focus never leaves the overlay. */
async function tabStaysInside(page: Page, overlay: Locator, presses: number) {
  for (const key of ["Tab", "Shift+Tab"])
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key)
      // base-ui sends focus back in from a guard just past either end.
      await expect.poll(() => overlay.evaluate((el) => el.contains(document.activeElement)), `${key} ${i + 1}`).toBe(true)
    }
}

test("a centre sheet: focus on the title, Tab stays inside, Escape and Close return focus, a decision shows the toast", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openKit(page)
  const card = page.locator('[data-part="more"]').getByRole("region", { name: "Sheet", exact: true })
  const review = card.getByRole("button", { name: "Review" }).first()

  await review.click()
  const sheet = page.getByRole("dialog", { name: "Sibling · 10%" })
  await expect(sheet).toHaveAccessibleDescription("Latifa Omari Juma Hassan")
  await expect(sheet.getByRole("heading", { name: "Sibling · 10%" })).toBeFocused()
  // Centred on a wide screen, once it has settled.
  await expect(sheet).toHaveCSS("opacity", "1")
  await expect
    .poll(async () => {
      const box = (await sheet.boundingBox())!
      return [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)]
    })
    .toEqual([640, 400])
  // Close, the scrolling body, Grant and Refuse: Tab cycles through them and no further.
  await tabStaysInside(page, sheet, 6)
  await page.keyboard.press("Escape")
  await expect(sheet).toHaveCount(0)
  await expect(review).toBeFocused()

  await review.press("Enter")
  await expect(sheet).toBeVisible()
  await sheet.getByRole("button", { name: "Close" }).click()
  await expect(sheet).toHaveCount(0)
  await expect(review).toBeFocused()

  await review.click()
  await sheet.getByRole("button", { name: "Grant the discount" }).click()
  await expect(sheet).toHaveCount(0)
  const toast = page.getByRole("status").filter({ hasText: "Granted for Latifa Omari Juma Hassan. The desk can see it now." })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCSS("background-color", "rgb(3, 0, 77)")
  // Bottom centre, 24px up.
  await expect
    .poll(async () => {
      const box = (await toast.boundingBox())!
      return [box.x + box.width / 2, box.y + box.height].map(Math.round)
    })
    .toEqual([640, 800 - 24])
  await expect(card.getByText("Granted", { exact: true })).toBeVisible()
  // It leaves on its own after 2.6s.
  await expect(toast).toHaveCount(0, { timeout: 5_000 })
})

test("a side sheet keeps its head and foot while only the details scroll; the inline editors", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 })
  await openKit(page)
  const row = page.locator('[data-part="more"]').getByRole("row", { name: "Zuhura Ali Mussa Khamis" })
  await row.click()
  const sheet = page.getByRole("dialog", { name: "Zuhura Ali Mussa Khamis" })
  await expect(sheet.getByRole("heading", { name: "Zuhura Ali Mussa Khamis" })).toBeFocused()
  // 440px wide, 12px from the right, top and bottom, once it has slid in.
  await expect
    .poll(async () => {
      const box = (await sheet.boundingBox())!
      return [box.width, box.x + box.width, box.y, box.y + box.height].map(Math.round)
    })
    .toEqual([440, 1280 - 12, 12, 640 - 12])

  // The fee editor: a preview of what changes, then the reason.
  await sheet.getByRole("button", { name: "Edit fee" }).click()
  await sheet.getByRole("button", { name: "Save the fee" }).click()
  await expect(sheet.getByRole("alert")).toHaveText("Choose the fee.")
  await sheet.locator("label", { hasText: "Full fee" }).click()
  await expect(sheet.getByText("Zuhura: TZS 1,620,000 becomes TZS 1,800,000.")).toBeVisible()
  await expect(sheet.getByText("Khalid: no change.")).toBeVisible()

  const head = sheet.locator(".kit-sheet-head")
  const foot = sheet.locator(".kit-sheet-foot")
  const body = sheet.locator(".kit-sheet-body")
  const headBefore = await head.boundingBox()
  const footBefore = await foot.boundingBox()
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await head.boundingBox()).toEqual(headBefore)
  expect(await foot.boundingBox()).toEqual(footBefore)
  await expect(sheet.getByRole("heading", { name: "Zuhura Ali Mussa Khamis" })).toBeInViewport()
  await expect(sheet.getByRole("button", { name: "Open full record" })).toBeInViewport()

  await sheet.getByRole("button", { name: "Save the fee" }).click()
  await expect(sheet.getByRole("alert")).toHaveText("Choose the reason.")
  await sheet.getByRole("button", { name: "Full-fee sibling did not enrol" }).click()
  await sheet.getByRole("button", { name: "Save the fee" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Fee saved. The change and its reason are in the audit log." })).toBeVisible()
  await expect(sheet.getByText("TZS 1,800,000")).toBeVisible()
  await expect(sheet.getByText("Full fee · edited by the Accountant on 11 Nov · Full-fee sibling did not enrol")).toBeVisible()

  // The father's name: the field takes focus, Cancel gives it back to Edit.
  const edit = sheet.getByRole("button", { name: "Edit", exact: true })
  await edit.click()
  const father = sheet.getByRole("textbox", { name: "Father’s full name" })
  await expect(father).toBeFocused()
  await expect(father).toHaveValue("Ali Mussa Khamis")
  await father.fill("Ali")
  await father.press("Enter")
  await expect(father).toHaveAccessibleDescription("Type the full name, at least two names.")
  await sheet.getByRole("button", { name: "Cancel" }).click()
  await expect(father).toHaveCount(0)
  await expect(edit).toBeFocused()
  // Saving gives focus back to Edit too.
  await edit.click()
  await father.fill("Ali Mussa Khamis Juma")
  await father.press("Enter")
  await expect(page.getByRole("status").filter({ hasText: "Father’s name saved. The sibling check runs again." })).toBeVisible()
  await expect(sheet.getByText("Ali Mussa Khamis Juma")).toBeVisible()
  await expect(edit).toBeFocused()

  await tabStaysInside(page, sheet, 12)
  await page.keyboard.press("Escape")
  await expect(sheet).toHaveCount(0)
  await expect(row).toBeFocused()
})

test("on a 360×640 phone the sheet rises from the bottom and its foot stays above the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openKit(page)
  const row = page.locator('[data-part="more"]').getByRole("row", { name: "Rehema Said Abdallah" })
  await row.click()
  const record = page.getByRole("dialog", { name: "Rehema Said Abdallah" })
  await expect
    .poll(async () => {
      const box = (await record.boundingBox())!
      return [box.width, box.y + box.height].map(Math.round)
    })
    .toEqual([360, 640])
  // The keyboard works the same on a bottom sheet: title first, Tab stays inside, Escape returns focus.
  await expect(record.getByRole("heading", { name: "Rehema Said Abdallah" })).toBeFocused()
  await tabStaysInside(page, record, 10)
  await page.keyboard.press("Escape")
  await expect(record).toHaveCount(0)
  await expect(row).toBeFocused()
  await row.press("Enter")
  await expect(record).toBeVisible()

  // Previous school: Not known yet, added inline.
  await record.getByRole("button", { name: "Add", exact: true }).click()
  await record.getByRole("button", { name: "Save", exact: true }).click()
  await expect(record.getByRole("alert")).toHaveText("Type the school’s name.")
  await record.getByRole("textbox", { name: "School name" }).fill("Example Secondary School")
  await record.locator("label", { hasText: "Private" }).click()
  await record.getByRole("textbox", { name: "Find a region" }).fill("pw")
  await record.getByRole("button", { name: "Pwani" }).click()
  await record.getByRole("button", { name: "Save", exact: true }).click()
  await expect(record.getByText("Example Secondary School · Private · Pwani")).toBeVisible()

  // Record payment closes the record and opens the payment sheet.
  await record.getByRole("button", { name: "Record payment" }).click()
  const payment = page.getByRole("dialog", { name: "Record a payment" })
  await expect(payment).toBeVisible()
  await expect(record).toHaveCount(0)
  const amount = payment.getByRole("textbox", { name: "Amount in shillings" })
  await amount.focus()
  const review = payment.getByRole("button", { name: "Review payment" })
  await expect(review).toBeInViewport({ ratio: 1 })

  // An on-screen keyboard leaves 340px of the window: the foot moves up above it.
  await page.evaluate(() => {
    const view = window.visualViewport!
    Object.defineProperty(view, "height", { configurable: true, get: () => 340 })
    view.dispatchEvent(new Event("resize"))
  })
  await expect
    .poll(async () => {
      const box = (await review.boundingBox())!
      return box.y + box.height
    })
    .toBeLessThanOrEqual(340)
  await expect(amount).toBeFocused()

  await review.click()
  await expect(payment.getByRole("alert")).toHaveText("Choose the kind of payment.")
  await payment.getByRole("button", { name: "Initial deposit" }).click()
  await amount.fill("600,000")
  await review.click()
  await expect(payment.getByText("TZS 2,000,000")).toBeVisible()
  await payment.getByRole("button", { name: "Confirm payment" }).click()
  await expect(payment).toHaveCount(0)
  await expect(page.getByRole("status").filter({ hasText: "Initial deposit recorded. Rehema is now Enrolled." })).toBeVisible()
})

test("the popovers: the bell's new requests and the account menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openKit(page)
  const card = page.locator('[data-part="more"]').getByRole("region", { name: "Popover" })
  const bell = card.getByRole("button", { name: "New requests" })
  await expect(card.locator(".kp-pip")).toHaveText("2")

  await bell.press("Enter")
  const requests = page.getByRole("dialog", { name: "New requests" })
  await expect(requests).toBeVisible()
  await expect(bell).toHaveAttribute("aria-expanded", "true")
  // Opening it clears the pip.
  await expect(card.locator(".kp-pip")).toHaveCount(0)
  await expect(requests).toHaveCSS("border-radius", "22px")
  await expect(requests.getByRole("button", { name: /New discount request/ })).toBeVisible()
  // Tab never lands on something unseen: the screen-reader Close is out of the tab order.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab")
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? "")).not.toContain("sr-only")
  }
  await tabStaysInside(page, requests, 4)
  await page.keyboard.press("Escape")
  await expect(requests).toHaveCount(0)
  await expect(bell).toBeFocused()

  const me = card.getByRole("button", { name: "Rehema M. Admissions Manager" })
  await me.click()
  const account = page.getByRole("dialog", { name: "Rehema M." })
  await expect(account).toHaveAccessibleDescription("Admissions Manager")
  await expect(account.getByText("Admissions Manager")).toHaveCSS("color", "rgb(71, 85, 105)")
  await account.getByRole("button", { name: "Sign out" }).click()
  await expect(account).toHaveCount(0)
  await expect(me).toBeFocused()
})

test("confetti rains 46 pieces and removes itself", async ({ page }) => {
  await openKit(page)
  await page.locator('[data-part="more"]').getByRole("region", { name: "Confetti" }).getByRole("button", { name: "Play it" }).click()
  await expect(page.locator(".kit-cf i")).toHaveCount(46)
  await expect(page.locator(".kit-cf")).toHaveCount(0, { timeout: 5_000 })
})

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("sheets fade in place and confetti is skipped", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openKit(page)
    const more = page.locator('[data-part="more"]')
    await more.getByRole("region", { name: "Confetti" }).getByRole("button", { name: "Play it" }).click()
    await expect(page.locator(".kit-cf")).toHaveCount(0)

    await more.getByRole("row", { name: "Zuhura Ali Mussa Khamis" }).click()
    const sheet = page.getByRole("dialog", { name: "Zuhura Ali Mussa Khamis" })
    await expect(sheet).toHaveCSS("transition-property", "opacity")
    await expect(sheet).toHaveCSS("transform", "none")
  })
})

// #321: the guided form on a staff page, played with the prototype's registration questions.
async function answerNames(open: Locator, names: string[]) {
  const parts = ["First name", "Father’s name", "Last name"]
  for (const [i, name] of names.entries()) await open.getByRole("textbox", { name: parts[i], exact: true }).fill(name)
  await open.getByRole("button", { name: "Continue" }).click()
}
// A tile is a label around its hidden radio; clicking the label picks it.
const pick = (open: Locator, name: string) =>
  open
    .locator("label")
    .filter({ has: open.page().getByRole("radio", { name, exact: true }) })
    .click()

test("the guided form folds each answer, finishes its groups and ends on the finished screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openKit(page)
  const card = page.locator('[data-part="more"]').getByRole("region", { name: "Guided form" })
  const open = card.locator(".gf-step.gf-open")
  const bar = card.locator(".gf-bar-row")
  const question = (name: string) => open.getByRole("heading", { level: 2, name })

  // Start over hosts the Peach Glow on hover; Back is a plain chevron. Pressed, it empties the form.
  const reset = bar.getByRole("button", { name: "Start over" })
  await reset.hover()
  await expect.poll(() => glow(reset.locator("svg"))).toEqual({ fill: PEACH_GLOW, scale: 1 })
  await expect(bar.locator(".gf-secname")).toHaveText("Students")
  await open.getByRole("textbox", { name: "First name", exact: true }).fill("Neema")
  await reset.click()
  await expect(open.getByRole("textbox", { name: "First name", exact: true })).toHaveValue("")

  await open.getByRole("button", { name: "Continue" }).click()
  await expect(open.getByRole("alert")).toHaveText("Type at least three names: the student’s own name, the father’s name and the last name.")

  // Keyboard only: Enter sends the names, and each new question takes focus as it opens.
  const parts = ["First name", "Father’s name", "Last name"]
  for (const [i, name] of ["Neema", "Juma", "Salim"].entries()) await open.getByRole("textbox", { name: parts[i], exact: true }).fill(name)
  await page.keyboard.press("Enter")
  await expect(question("Which class is Neema joining?")).toBeFocused()
  await expect(card.getByRole("heading", { level: 3, name: "Neema Juma Salim" })).toBeVisible()
  await expect(card.locator(".kp-fa")).toHaveText("Father: Juma Salim")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Space")
  await expect(question("Will Neema be a day or a boarding student?")).toBeFocused()
  await pick(open, "Day")
  await expect(question("Is there another student?")).toBeFocused()
  await expect(card.getByText("DAY CARE", { exact: true }).first()).toBeVisible()

  // Change reopens an answer; answering it again folds it and returns to the open question.
  await card.getByRole("button", { name: "Change Class, Neema Juma Salim" }).click()
  await expect(question("Which class is Neema joining?")).toBeFocused()
  await pick(open, "STD 5")
  await expect(question("Is there another student?")).toBeFocused()
  await expect(card.locator(".gf-folded").filter({ hasText: "Class" })).toContainText("STD 5")

  // Back reopens the answer before.
  await bar.getByRole("button", { name: "Back" }).click()
  await expect(question("Will Neema be a day or a boarding student?")).toBeVisible()
  await pick(open, "Day")
  await expect(question("Is there another student?")).toBeVisible()

  // A second student gets its own heading and Remove; removing an answered one reads the toast.
  await open.getByRole("button", { name: "Yes, add a student" }).click()
  await expect(open.getByRole("textbox", { name: "First name", exact: true })).toBeFocused()
  await answerNames(open, ["Hamisi", "Juma", "Salim"])
  await pick(open, "FORM 1")
  await pick(open, "Boarding")
  await expect(card.getByRole("button", { name: /^Remove/ })).toHaveCount(2)
  await card.getByRole("button", { name: "Remove Hamisi Juma Salim" }).click()
  await expect(page.getByText("Student removed. Check the custodians again.")).toBeVisible()
  await expect(card.getByRole("button", { name: /^Remove/ })).toHaveCount(0)
  await expect(card.getByText("Hamisi Juma Salim")).toHaveCount(0)

  await open.getByRole("button", { name: "No, go to custodians" }).click()
  await expect(question("Is the father the main custodian of Neema?")).toBeFocused()
  // The first group closes into one bar with the tick, and its number cheers.
  await expect(bar.locator('[data-group="0"]')).toHaveClass(/gf-full/)
  await expect(bar.locator('[data-group="0"] .gf-gn')).toHaveAttribute("data-won", "true")
  await expect(bar.locator(".gf-secname")).toHaveText("Custodians")

  // Continue unfolds only once the question is complete; until then it is folded away and inert.
  const goReveal = open.locator(".kit-rv").filter({ has: page.getByRole("button", { name: "Continue" }) })
  await expect(goReveal).toHaveAttribute("inert")
  await pick(open, "Yes, the father")
  await open.getByRole("textbox", { name: "Custodian’s mobile number" }).fill("0712 345 678")
  await expect(goReveal).toHaveAttribute("data-open")
  await open.getByRole("button", { name: "Continue" }).click()
  await expect(card.getByText("Juma Salim · Father · 0712 345 678")).toBeVisible()

  await expect(question("Does the family have a Discount code?")).toBeFocused()
  await open.getByRole("button", { name: /NO CODE/ }).click()
  await expect(question("Register 1 student?")).toBeFocused()
  await open.getByRole("button", { name: "Register 1 student" }).click()

  // The last group cheers before the Finished screen takes its place (950ms).
  await expect(bar.locator('[data-group="2"] .gf-gn.gf-cheer')).toHaveCount(1, { timeout: 800 })
  const done = card.getByRole("heading", { level: 2, name: "1 student registered" })
  await expect(done).toBeFocused()
  await expect(card.getByText("DMSN-90013")).toBeVisible()
  await expect(card.locator(".gf-bar-row")).toHaveCount(0)
  await expect(page.locator(".kit-cf")).toHaveCount(1)
  await expect(card.getByRole("link", { name: "Open Applicants" })).toHaveAttribute("href", "/staff/applicants")

  await card.getByRole("button", { name: "Register another family" }).click()
  await expect(open.getByRole("textbox", { name: "First name", exact: true })).toBeFocused()
})

test("the guided form's progress bar sticks to the top while the questions scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await openKit(page)
  const card = page.locator('[data-part="more"]').getByRole("region", { name: "Guided form" })
  const bar = card.locator(".gf-bar-row")
  await card.locator(".kit-task").scrollIntoViewIfNeeded()
  await card.locator(".kit-task").evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top + 200))
  await expect.poll(async () => Math.round((await bar.boundingBox())!.y)).toBe(0)
})

test("under reduced motion the staff guided form opens each question at once, with no confetti", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 390, height: 844 })
  await openKit(page)
  const card = page.locator('[data-part="more"]').getByRole("region", { name: "Guided form" })
  const open = card.locator(".gf-step.gf-open")
  expect((await open.boundingBox())!.height).toBeGreaterThan(200)
  await expect(card.locator(".gf-item").first()).toHaveCSS("transition-duration", "0s, 0.12s")
  await answerNames(open, ["Neema", "Juma", "Salim"])
  await expect(open.getByRole("heading", { name: "Which class is Neema joining?" })).toBeVisible()
  expect((await open.boundingBox())!.height).toBeGreaterThan(200)
  await pick(open, "STD 5")
  await pick(open, "Day")
  await open.getByRole("button", { name: "No, go to custodians" }).click()
  await pick(open, "Yes, the father")
  await open.getByRole("textbox", { name: "Custodian’s mobile number" }).fill("0712 345 678")
  await open.getByRole("button", { name: "Continue" }).click()
  await open.getByRole("button", { name: /NO CODE/ }).click()
  await open.getByRole("button", { name: "Register 1 student" }).click()
  await expect(card.getByRole("heading", { level: 2, name: "1 student registered" })).toBeFocused()
  await expect(page.locator(".kit-cf")).toHaveCount(0)
})
