import { type Page } from "@playwright/test"

import { createThrowawayStaff } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { axeProblems } from "./axe"
import { logIn, signInOnce, signOut } from "./log-in"
import { expect, test } from "./staff-test"

// The new staff shell (#322), on the first routes it holds: the kit page and
// Reopening requests. Every other route keeps the old shell
// (e2e/staff-shell.spec.ts). Both shells keep the same contract: a
// navigation landmark named "Staff" and the page's main.

const MANAGER_ENTRIES = [
  "Today",
  "Check-in",
  "Register a student",
  "Applicants",
  "Interviews",
  "Follow-ups",
  "Re-applications",
  "Marketing Agents",
  "WhatsApp groups",
  "Fee schedule",
  "Seats",
  "Discount requests",
  "Reopening requests",
  "Reports",
  "Staff and roles",
]

async function open(page: Page, person: FixtureStaff, path: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(path)
  await expect(page.locator('[data-shell="new"]')).toBeVisible()
}

const shell = (page: Page) => page.locator('[data-shell="new"]')
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff" })
const entry = (page: Page, label: string) => staffNav(page).getByRole("link", { name: label, exact: true })
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sidebar" })
const toggle = (page: Page) => page.getByRole("button", { name: "Fold or open the sidebar" })
const handle = (page: Page) => page.getByRole("separator", { name: /^Resize the sidebar/ })
const width = (page: Page) => sidebar(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("draws the grouped sidebar with no counts, the top bar and the stage around Reopening requests", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    for (const group of ["Front desk", "Admissions", "Referrals", "Money", "Admin"]) await expect(staffNav(page).getByText(group, { exact: true })).toBeVisible()
    for (const label of MANAGER_ENTRIES) await expect(entry(page, label)).toBeVisible()
    await expect(entry(page, "Reopening requests")).toHaveAttribute("aria-current", "page")
    // The One Pip Rule: no entry carries a count.
    await expect(entry(page, "Follow-ups")).toHaveAccessibleName("Follow-ups")
    await expect(page.getByRole("main")).toContainText("Reopening requests")
    await expect(page.locator(".ns-stage")).toHaveCSS("border-radius", "28px")
    await expect(sidebar(page).getByText("Al-Rahmah Complex")).toBeVisible()
    await expect(sidebar(page).getByText("Admissions Portal")).toBeVisible()
    await expect(page.getByRole("searchbox", { name: "Search applicants" }).or(page.getByRole("textbox", { name: "Search applicants" }))).toBeVisible()
    expect(await scrollsSideways(page)).toBe(false)
  })

  test("moves between the new and the old shell", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    await entry(page, "Interviews").click()
    await expect(page).toHaveURL(/\/staff\/interviews$/)
    await expect(shell(page)).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1, name: "Interviews" })).toBeVisible()
    await expect(page.getByRole("banner")).toContainText("Interviews")

    await staffNav(page).getByRole("link", { name: /^Reopening requests/ }).click()
    await expect(page).toHaveURL(/\/staff\/reopenings$/)
    await expect(shell(page)).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: "Reopening requests" })).toBeVisible()
  })

  test("searching opens Applicants with the term", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    const search = page.getByRole("search").getByRole("textbox", { name: "Search applicants" })
    await search.fill("Asha")
    await search.press("Enter")
    await expect(page).toHaveURL(/\/staff\/applicants\?q=Asha$/)
  })

  test("the toggle folds the sidebar to its icons, for both shells, across a reload", async ({ page }) => {
    await open(page, ADMISSIONS, "/staff/kit")
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true")
    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false")
    await expect.poll(() => width(page)).toBe(60)
    // Every icon keeps its name, and a tooltip with its label.
    await expect(entry(page, "Applicants")).toHaveAttribute("title", "Applicants")
    await expect(handle(page)).toHaveCount(0)

    await page.reload()
    await expect.poll(() => width(page)).toBe(60)
    await page.goto("/staff/applicants")
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
    await page.getByRole("button", { name: "Expand sidebar" }).click()

    await page.goto("/staff/kit")
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true")
    await expect.poll(() => width(page)).toBeGreaterThan(150)
  })

  test("the edge resizes the sidebar by keyboard and remembers it; Home and a double-click return to the narrowest", async ({ page }) => {
    await open(page, ADMISSIONS, "/staff/kit")
    const edge = handle(page)
    await expect(edge).toHaveAttribute("aria-valuemin", /\d+/)
    const min = Number(await edge.getAttribute("aria-valuemin"))
    const max = Number(await edge.getAttribute("aria-valuemax"))
    expect(max).toBeGreaterThanOrEqual(min)
    await expect(edge).toHaveAttribute("aria-valuenow", String(min))
    await expect.poll(() => width(page)).toBe(min)

    await edge.focus()
    await page.keyboard.press("End")
    await expect(edge).toHaveAttribute("aria-valuenow", String(max))
    await page.keyboard.press("ArrowLeft")
    await expect(edge).toHaveAttribute("aria-valuenow", String(Math.max(min, max - 8)))
    await expect(edge).toHaveAttribute("aria-valuetext", `${Math.max(min, max - 8)} pixels wide`)
    await page.reload()
    await expect.poll(() => width(page)).toBe(Math.max(min, max - 8))

    await handle(page).dblclick()
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(min))
    await page.reload()
    await expect.poll(() => width(page)).toBe(min)

    // Dragging moves the edge within the limits.
    const box = (await handle(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 400, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(max))
    await handle(page).focus()
    await page.keyboard.press("Home")
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(min))
  })

  test("the bell counts the requests the Manager may decide, lists them and hides its pip once opened", async ({ page }) => {
    await open(page, MANAGER, "/staff/kit")
    const bell = page.getByRole("banner").getByRole("button", { name: /^New requests, [1-9]\d* waiting$/ })
    await expect(bell).toBeVisible()
    await expect(page.locator(".ns-pip")).toHaveText(/^[1-9]\d*$/)

    await bell.click()
    const list = page.getByRole("dialog", { name: "New requests" })
    await expect(list.getByRole("link", { name: /New reopening request.*Asha Kibwana/ })).toBeVisible()
    await expect(page.locator(".ns-pip")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(list).toHaveCount(0)
    await expect(page.getByRole("banner").getByRole("button", { name: "New requests" })).toBeFocused()

    await page.getByRole("banner").getByRole("button", { name: "New requests" }).click()
    await list.getByRole("link", { name: /New reopening request.*Asha Kibwana/ }).click()
    await expect(page).toHaveURL(/\/staff\/reopenings$/)
    await expect(list).toHaveCount(0)
  })

  test("staff who decide no requests see no bell; the person pill opens the account menu", async ({ page }) => {
    await open(page, ADMISSIONS, "/staff/kit")
    await expect(page.getByRole("banner").getByRole("button", { name: /^New requests/ })).toHaveCount(0)
    const me = page.getByRole("banner").getByRole("button", { name: `${ADMISSIONS.name} ${ADMISSIONS.roleName}` })
    await me.click()
    const account = page.getByRole("dialog", { name: ADMISSIONS.name })
    await expect(account).toHaveAccessibleDescription(ADMISSIONS.roleName)
    await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(me).toBeFocused()
  })

  test("Sign out from the person pill ends the session", async ({ page }) => {
    const person = await createThrowawayStaff(["leads.view", "reopenings.approve"])
    await logIn(page, person.email, person.password)
    await page.waitForURL(/\/staff$/)
    await page.goto("/staff/reopenings")
    await signOut(page)
    await page.goto("/staff/reopenings")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("the stage scrolls under its border, with its bar drawn outside it", async ({ page }) => {
    await open(page, ADMISSIONS, "/staff/kit")
    const scroll = page.locator(".ns-scroll")
    // The stage's own bar is hidden; the drawn one sits in the white gutter.
    expect(await scroll.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth)).toBe(0)
    await expect(page.locator(".ns-vbar[data-on]")).toBeVisible()
    const stage = (await page.locator(".ns-stage").boundingBox())!
    const bar = (await page.locator(".ns-vbar").boundingBox())!
    expect(bar.x).toBeGreaterThan(stage.x + stage.width)

    const thumbAt = () => page.locator(".ns-vbar i").evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).f)
    await scroll.evaluate((el) => el.scrollTo(0, 1400))
    await expect.poll(thumbAt).toBeGreaterThan(0)
    // Pressing the bottom of the track jumps there.
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height - 2)
    await expect.poll(() => scroll.evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(1)
  })

  test("a short window keeps every row at least 24px and never shows the sidebar's scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await open(page, MANAGER, "/staff/reopenings")
    const nav = staffNav(page)
    const heights = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(24)
    expect(await nav.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth)).toBe(0)
    await nav.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expect(entry(page, "Staff and roles")).toBeInViewport()
  })
})

test.describe("Back on the stage", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("returns to where the kit page was scrolled, and a new page starts at the top with the stage focused", async ({ page }) => {
    await open(page, MANAGER, "/staff/kit")
    const scroll = page.locator(".ns-scroll")
    await scroll.evaluate((el) => el.scrollTo(0, 1500))
    await expect.poll(() => scroll.evaluate((el) => Math.round(el.scrollTop))).toBe(1500)
    await page.waitForTimeout(150)

    await entry(page, "Reopening requests").click()
    await expect(page).toHaveURL(/\/staff\/reopenings$/)
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(scroll).toBeFocused()

    await page.goBack()
    await expect(page).toHaveURL(/\/staff\/kit$/)
    await expect.poll(() => scroll.evaluate((el) => Math.round(el.scrollTop))).toBe(1500)
  })
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("has no tab bar; the Menu button opens the drawer with every entry, and choosing one closes it", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    await expect(sidebar(page)).toBeHidden()
    await expect(staffNav(page)).toHaveCount(0)
    await expect(page.locator(".ns-vbar")).toBeHidden()
    expect(await scrollsSideways(page)).toBe(false)
    // The pill shows only the initials; the name stays for screen readers.
    const me = page.getByRole("banner").getByRole("button", { name: `${MANAGER.name} ${MANAGER.roleName}` })
    await expect(me).toBeVisible()
    await expect(me.getByText(MANAGER.name)).not.toBeInViewport()

    const menu = page.getByRole("button", { name: "Open the menu" })
    await menu.click()
    const drawer = page.getByRole("dialog", { name: "Menu" })
    await expect(drawer).toBeVisible()
    for (const label of MANAGER_ENTRIES) await expect(drawer.getByRole("link", { name: label, exact: true })).toBeAttached()
    await expect(drawer.getByRole("link", { name: "Reopening requests", exact: true })).toHaveAttribute("aria-current", "page")
    // A touch screen gets 44px rows.
    expect((await drawer.getByRole("link", { name: "Today", exact: true }).boundingBox())!.height).toBe(44)

    await page.keyboard.press("Escape")
    await expect(drawer).toHaveCount(0)
    await expect(menu).toBeFocused()

    await menu.click()
    await drawer.getByRole("link", { name: "Interviews", exact: true }).click()
    await expect(page).toHaveURL(/\/staff\/interviews$/)
    await expect(drawer).toHaveCount(0)
    // Interviews keeps the old shell, with its tab bar.
    await expect(staffNav(page).getByRole("link", { name: "Today" })).toBeVisible()
  })

  test("Sign out from the person pill ends the session", async ({ page }) => {
    const person = await createThrowawayStaff(["leads.view", "reopenings.approve"])
    await logIn(page, person.email, person.password)
    await page.waitForURL(/\/staff$/)
    await page.goto("/staff/reopenings")
    await signOut(page)
    await page.goto("/staff/reopenings")
    await expect(page).toHaveURL(/\/login$/)
  })
})

for (const [label, size] of [
  ["1280px", { width: 1280, height: 900 }],
  ["390px", { width: 390, height: 844 }],
] as const) {
  test(`axe finds nothing but the accepted findings on Reopening requests, the bell and the account menu at ${label}`, async ({ page }) => {
    await page.setViewportSize(size)
    await open(page, MANAGER, "/staff/reopenings")
    expect(await axeProblems(page)).toEqual([])

    await page.getByRole("banner").getByRole("button", { name: /^New requests/ }).click()
    await expect(page.getByRole("dialog", { name: "New requests" }).getByRole("link").first()).toBeVisible()
    expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
    await page.keyboard.press("Escape")

    await page.getByRole("banner").getByRole("button", { name: `${MANAGER.name} ${MANAGER.roleName}` }).click()
    await expect(page.getByRole("dialog", { name: MANAGER.name })).toBeVisible()
    expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
    await page.keyboard.press("Escape")

    if (size.width === 390) {
      await page.getByRole("button", { name: "Open the menu" }).click()
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible()
      expect(await axeProblems(page, '[role="dialog"]')).toEqual([])
    }
  })
}

// The page-change motion (DESIGN.md, Motion), drawn by the stage for every
// page in it: each top-level block rises 10px and fades in over 460ms,
// starting 0, 50, 100 and 140ms in; nothing moves under reduced motion.
const riseOf = (page: Page) =>
  page.locator(".ns-page > *").evaluateAll((blocks) =>
    blocks.slice(0, 4).map((block) => {
      const style = getComputedStyle(block)
      return `${style.animationName} ${style.animationDuration} ${style.animationDelay}`
    }),
  )

for (const path of ["/staff/kit", "/staff/reopenings"]) {
  test(`the blocks of ${path} rise in, staggered`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page, MANAGER, path)
    const rise = await riseOf(page)
    expect(rise.length).toBeGreaterThanOrEqual(2)
    expect(rise).toEqual(["ns-rise 0.46s 0s", "ns-rise 0.46s 0.05s", "ns-rise 0.46s 0.1s", "ns-rise 0.46s 0.14s"].slice(0, rise.length))
  })
}

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } })

  test("no block of the page moves", async ({ page }) => {
    await open(page, MANAGER, "/staff/kit")
    for (const value of await riseOf(page)) expect(value.startsWith("none ")).toBe(true)
  })
})

test.describe("crossing between the shells by links", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("keeps the fold and the width both ways", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    const min = Number(await handle(page).getAttribute("aria-valuemin"))
    await handle(page).focus()
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(min + 16))

    await toggle(page).click()
    await expect.poll(() => width(page)).toBe(60)
    await entry(page, "Interviews").click()
    await expect(page).toHaveURL(/\/staff\/interviews$/)
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible()

    await page.getByRole("button", { name: "Expand sidebar" }).click()
    await staffNav(page).getByRole("link", { name: /^Reopening requests/ }).click()
    await expect(page).toHaveURL(/\/staff\/reopenings$/)
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true")
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(min + 16))
    await handle(page).focus()
    await page.keyboard.press("Home")
  })

  test("a link from the old shell gives the new page's stage the focus; a fresh load does not", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    await expect(page.locator(".ns-scroll")).not.toBeFocused()
    await page.goto("/staff/interviews")
    await staffNav(page).getByRole("link", { name: /^Reopening requests/ }).click()
    await expect(page).toHaveURL(/\/staff\/reopenings$/)
    await expect(page.locator(".ns-scroll")).toBeFocused()
  })
})

test.describe("on a touch screen wider than a phone", () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true })

  test("folded rows stay 44px targets", async ({ page }) => {
    await open(page, MANAGER, "/staff/reopenings")
    await toggle(page).click()
    await expect.poll(() => width(page)).toBe(60)
    const box = (await entry(page, "Applicants").boundingBox())!
    expect(box.height).toBe(44)
    expect(box.width).toBe(44)
    await toggle(page).click()
  })
})

test("a role that may approve discounts but not view applicants gets a bell whose number matches its list", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const person = await createThrowawayStaff(["discounts.approve"])
  await open(page, person, "/staff/kit")
  const bell = page.getByRole("banner").getByRole("button", { name: /^New requests/ })
  const waiting = Number((await bell.getAttribute("aria-label"))!.match(/(\d+) waiting/)?.[1] ?? 0)
  await bell.click()
  const list = page.getByRole("dialog", { name: "New requests" })
  if (waiting === 0) await expect(list.getByText("Nothing is waiting.")).toBeVisible()
  else await expect(list.getByRole("link", { name: /^New discount request/ })).toHaveCount(waiting)
  await expect(list.getByRole("link", { name: /^New reopening request/ })).toHaveCount(0)
})
