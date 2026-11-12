import { type Locator, type Page } from "@playwright/test"

import { ADMISSIONS } from "../tests/support/fixtures"
import { axeProblems, settled } from "./axe"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The kit's form parts on the kit page (#358): the prototype's card "Form
// parts on the student's record" (version 18), its "See them in a sheet",
// and the choice list inside a popover. The card is one plain form whose
// parts are all uncontrolled, so each test reads what it would post.

const CARD = "Form parts on the student’s record"
const WRONG_DATE = "Type the date as day/month/year, for example 25/09/2026."
const WRONG_TIME = "Type the time as hours:minutes, for example 14:30."

async function openKit(page: Page, path = "/staff/kit") {
  await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
  await page.goto(path)
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible()
  await expect(page.locator('[data-shell="new"][data-live]')).toBeVisible()
  const card = page.getByRole("region", { name: CARD })
  await card.scrollIntoViewIfNeeded()
  return card
}

/** What the card's form would post, as the browser builds it. */
const posted = (card: Locator) =>
  card.locator("form[data-kit-form]").evaluate((form: HTMLFormElement) => {
    const data: Record<string, string> = {}
    new FormData(form).forEach((value, key) => {
      data[key] = typeof value === "string" ? value : `file:${value.name}`
    })
    return data
  })

/** The device's own today, as "YYYY-MM-DD" and "DD/MM/YYYY". */
const deviceToday = (page: Page) =>
  page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    return { iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, shown: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` }
  })

test.describe("the choice list", () => {
  test("its empty text sits in the middle of the pill, and it posts the chosen value", async ({ page }) => {
    const card = await openKit(page)
    const list = card.getByRole("combobox", { name: "Payment type" })
    await expect(list).toHaveText("Choose a type")
    const field = (await list.boundingBox())!
    const text = (await list.locator(".kit-sel-v").boundingBox())!
    expect(field.height).toBe(44)
    expect(Math.abs(text.y + text.height / 2 - (field.y + field.height / 2))).toBeLessThanOrEqual(1)
    expect((await posted(card)).payment_type).toBe("")

    await list.click()
    const popup = page.getByRole("listbox")
    await expect(popup.getByRole("option")).toHaveText(["Full payment", "Initial deposit", "First instalment", "Second instalment", "Third instalment"])
    // The placeholder is the quiet heading, not an item; the list is as wide as the field.
    await expect(page.locator(".kit-sel-head")).toHaveText("Choose a type")
    expect(Math.round((await page.locator(".kit-sel-pop").boundingBox())!.width)).toBe(Math.round(field.width))
    await popup.getByRole("option", { name: "First instalment" }).click()
    await expect(list).toHaveText("First instalment")
    expect((await posted(card)).payment_type).toBe("First instalment")

    await list.click()
    const chosen = popup.getByRole("option", { name: "First instalment" })
    await expect(chosen).toHaveAttribute("aria-selected", "true")
    await expect(chosen).toHaveCSS("background-color", "rgb(9, 0, 187)")
    await expect(chosen).toHaveCSS("color", "rgb(255, 255, 255)")
    await page.keyboard.press("Escape")
  })

  test("answers the keyboard: arrows, Home, End, type-ahead, Enter and Space", async ({ page }) => {
    const card = await openKit(page)
    const list = card.getByRole("combobox", { name: "Payment type" })
    await list.focus()
    await page.keyboard.press("ArrowDown")
    const popup = page.getByRole("listbox")
    await expect(popup).toBeVisible()
    const active = popup.locator("[data-highlighted]")
    await expect(active).toHaveText("Full payment")
    await expect(active).toHaveCSS("background-color", "rgb(224, 220, 249)")
    await page.keyboard.press("ArrowDown")
    await expect(active).toHaveText("Initial deposit")
    await page.keyboard.press("End")
    await expect(active).toHaveText("Third instalment")
    await page.keyboard.press("Home")
    await expect(active).toHaveText("Full payment")
    await page.keyboard.type("s")
    await expect(active).toHaveText("Second instalment")
    await page.keyboard.press("Enter")
    await expect(popup).toBeHidden()
    await expect(list).toBeFocused()
    await expect(list).toHaveText("Second instalment")

    await page.keyboard.press(" ")
    await expect(popup).toBeVisible()
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press(" ")
    await expect(list).toHaveText("First instalment")
    expect((await posted(card)).payment_type).toBe("First instalment")
  })

  test("in a sheet, Escape closes the list and leaves the sheet open", async ({ page }) => {
    await openKit(page)
    await page.getByRole("button", { name: "See them in a sheet" }).click()
    const sheet = page.getByRole("dialog", { name: "Decline Yusuf Ali Hassan" })
    await settled(sheet)
    const reason = sheet.getByRole("combobox", { name: "Reason" })
    await reason.click()
    await expect(page.getByRole("listbox")).toBeVisible()
    expect(await axeProblems(page, ".kit-sel-pop")).toEqual([])
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toBeHidden()
    await expect(sheet).toBeVisible()
    await expect(reason).toBeFocused()

    // Continue with no reason marks the list; choosing one clears it.
    await sheet.getByRole("button", { name: "Continue" }).click()
    await expect(reason).toHaveAttribute("aria-invalid", "true")
    await expect(reason).toBeFocused()
    await reason.click()
    await page.getByRole("option", { name: "Other" }).click()
    await expect(reason).not.toHaveAttribute("aria-invalid", "true")
    await expect(sheet.getByText("Required for Other.")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
  })

  test("in a popover, Escape closes the list first, then the popover; the empty string is a real choice", async ({ page }) => {
    await openKit(page)
    const card = page.getByRole("region", { name: "Choice list in a popover" })
    await card.scrollIntoViewIfNeeded()
    const filter = card.getByRole("button", { name: "Filter Visited applicants" })
    await filter.click()
    const pop = page.getByRole("dialog", { name: "Filter Visited applicants" })
    await expect(pop).toBeVisible()
    const cls = pop.getByRole("combobox", { name: "Class" })
    // "" is the "Any class" choice, not an empty field.
    await expect(cls).toHaveText("Any class")
    await cls.click()
    await page.getByRole("option", { name: "STD 6" }).click()
    await expect(cls).toHaveText("STD 6")
    await expect(filter).toHaveAttribute("data-on", "")

    await cls.click()
    await expect(page.getByRole("listbox")).toBeVisible()
    expect(await axeProblems(page, ".kit-sel-pop")).toEqual([])
    await page.getByRole("option", { name: "Any class" }).click()
    await expect(cls).toHaveText("Any class")
    await expect(page.getByRole("option", { name: "Any class" })).toHaveCount(0)
    await expect(filter).not.toHaveAttribute("data-on")

    await cls.click()
    await expect(page.getByRole("option", { name: "Any class" })).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Escape")
    await expect(page.getByRole("listbox")).toBeHidden()
    await expect(pop).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(pop).toBeHidden()
    await expect(filter).toBeFocused()
  })
})

test.describe("the date field", () => {
  test("reads the day first, tidies it, refuses an impossible date and posts YYYY-MM-DD", async ({ page }) => {
    const card = await openKit(page)
    const date = card.getByLabel("Payment date")
    await expect(date).toHaveAttribute("placeholder", "DD/MM/YYYY")

    await date.fill("5/9/2026")
    await date.blur()
    await expect(date).toHaveValue("05/09/2026")
    expect((await posted(card)).paid_on).toBe("2026-09-05")

    await date.fill("31/02/2026")
    expect((await posted(card)).paid_on).toBe("")
    await date.blur()
    await expect(card.getByRole("alert").filter({ hasText: WRONG_DATE })).toBeVisible()
    await expect(date).toHaveAttribute("aria-invalid", "true")
    // Typing again clears the message.
    await date.fill("25/09/2026")
    await expect(card.getByText(WRONG_DATE)).toHaveCount(0)
    await expect(date).not.toHaveAttribute("aria-invalid", "true")
    // A typed date outside the bounds is submitted as typed; the server refuses it.
    await date.blur()
    expect((await posted(card)).paid_on).toBe("2026-09-25")
  })

  test("its calendar greys out the days after today, picks with the keyboard and offers Today", async ({ page }) => {
    const card = await openKit(page)
    const today = await deviceToday(page)
    const date = card.getByLabel("Payment date")
    const open = card.getByRole("button", { name: "Open the calendar" }).first()
    await open.click()
    const cal = page.getByRole("dialog", { name: "Choose a date" })
    await expect(cal).toBeVisible()
    await settled(cal)
    expect(await axeProblems(page, ".kit-cal-pop")).toEqual([])

    // Today has focus and the outline; the next month cannot be reached; tomorrow is greyed out.
    const todayButton = cal.locator(`[data-day="${today.iso}"]`)
    await expect(todayButton).toBeFocused()
    await expect(todayButton).toHaveAttribute("aria-current", "date")
    await expect(cal.getByRole("button", { name: "Next month" })).toBeDisabled()
    const later = cal.locator(".kit-cal-off .kit-cal-day").first()
    if (await later.count()) await expect(later).toHaveCSS("color", "rgb(182, 189, 201)")

    // Back a week with the keyboard, then Enter.
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("Enter")
    await expect(cal).toBeHidden()
    const weekAgo = await page.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() - 7)
      const p = (n: number) => String(n).padStart(2, "0")
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    })
    expect((await posted(card)).paid_on).toBe(weekAgo)

    await open.click()
    await expect(cal.locator(`[data-day="${weekAgo}"]`)).toBeFocused()
    // PageUp moves a month back.
    const shownMonth = (await cal.locator(".kit-cal-title").textContent())!
    await page.keyboard.press("PageUp")
    await expect(cal.locator(".kit-cal-title")).not.toHaveText(shownMonth)
    await cal.getByRole("button", { name: "Today" }).click()
    await expect(date).toHaveValue(today.shown)
    expect((await posted(card)).paid_on).toBe(today.iso)
  })

  test("the date with a time tidies the time and posts the datetime-local format", async ({ page }) => {
    const card = await openKit(page)
    const today = await deviceToday(page)
    const group = card.getByRole("group", { name: "Contacted at" })
    await expect(group.getByLabel("Date")).toHaveValue(today.shown)
    const time = group.getByLabel("Time, 24-hour clock")
    await expect(time).toHaveValue("14:30")
    expect((await posted(card)).contacted_at).toBe(`${today.iso}T14:30`)

    await time.fill("930")
    await time.blur()
    await expect(time).toHaveValue("09:30")
    expect((await posted(card)).contacted_at).toBe(`${today.iso}T09:30`)

    await time.fill("25:00")
    await time.blur()
    await expect(card.getByRole("alert").filter({ hasText: WRONG_TIME })).toBeVisible()
    await expect(time).toHaveAttribute("aria-invalid", "true")
    expect((await posted(card)).contacted_at).toBe("")
  })
})

// A device behind UTC: no date may move by a day, across a month end either.
test.describe("in a time zone behind UTC", () => {
  test.use({ timezoneId: "America/Los_Angeles" })

  test("typed and picked dates post the same day", async ({ page }) => {
    const card = await openKit(page)
    await card.getByRole("button", { name: "More options" }).click()
    const ends = card.getByLabel("Ends on")
    await ends.fill("31/10/2026")
    await ends.blur()
    expect((await posted(card)).ends_on).toBe("2026-10-31")

    await card.locator(".kit-dsc").getByRole("button", { name: "Open the calendar" }).click()
    const cal = page.getByRole("dialog", { name: "Choose a date" })
    await expect(cal.locator('[data-day="2026-10-31"]')).toBeFocused()
    // The next day is in the next month.
    await page.keyboard.press("ArrowRight")
    await expect(cal.locator(".kit-cal-title")).toHaveText("November 2026")
    await page.keyboard.press("Enter")
    await expect(ends).toHaveValue("01/11/2026")
    expect((await posted(card)).ends_on).toBe("2026-11-01")
  })
})

test("the week calendar chooses a whole week, Monday to Sunday, with the keyboard", async ({ page }) => {
  const card = await openKit(page)
  const week = card.getByRole("group", { name: "Week" })
  const said = card.locator("[data-week]")
  const before = await said.getAttribute("data-week")
  expect(await week.locator(".kit-cal-band").count()).toBeGreaterThan(0)

  // Down a week from the focusable day, then Enter: the band moves to that week.
  await week.locator(".kit-cal-day[tabindex='0']").focus()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(said).not.toHaveAttribute("data-week", before!)
  const monday = (await said.getAttribute("data-week"))!
  expect(new Date(`${monday}T12:00:00Z`).getUTCDay()).toBe(1)
  await expect(said).toHaveText(/^Chosen: \d+ \w{3} to \d+ \w{3} \d{4}$/)
  const band = week.locator(".kit-cal-band .kit-cal-day")
  await expect(band.first()).toHaveCSS("background-color", "rgb(9, 0, 187)")

  // The week under the pointer is a Lavender Mist band.
  const other = week.locator(".kit-cal-cell:not(.kit-cal-band):not(.kit-cal-hidden) .kit-cal-day").first()
  await other.hover()
  await expect(week.locator(".kit-cal-lit .kit-cal-day").first()).toHaveCSS("background-color", "rgb(224, 220, 249)")
})

test("tick boxes post with their form and the whole row toggles; a switch is role=switch", async ({ page }) => {
  const card = await openKit(page)
  const pre = card.getByRole("checkbox", { name: "Pre-Form One programme" })
  await expect(pre).toHaveAccessibleDescription(/Its fee is charged on its own/)
  expect(await posted(card)).toMatchObject({ has_sibling: "on" })
  expect((await posted(card)).pre_form_one).toBeUndefined()
  await card.getByText("Pre-Form One programme").click()
  await expect(pre).toBeChecked()
  expect((await posted(card)).pre_form_one).toBe("on")
  await expect(pre).toHaveCSS("background-color", "rgb(9, 0, 187)")
  await pre.press("Space")
  await expect(pre).not.toBeChecked()

  const off = card.getByRole("switch", { name: "Example switch, off" })
  await expect(off).not.toBeChecked()
  await off.click()
  await expect(off).toBeChecked()
  await expect(card.getByRole("switch", { name: "Example switch, on" })).toBeChecked()
})

test("the fold-open section opens and closes, and closed content is out of the tab order", async ({ page }) => {
  const card = await openKit(page)
  const history = card.getByRole("button", { name: "History" })
  await expect(history).toHaveAttribute("aria-expanded", "false")
  await expect(card.getByText("No changes yet.")).toBeHidden()
  await history.click()
  await expect(history).toHaveAttribute("aria-expanded", "true")
  await expect(card.getByText("No changes yet.")).toBeVisible()
  await history.click()
  await expect(card.getByText("No changes yet.")).toBeHidden()

  const more = card.getByRole("button", { name: "More options" })
  const panel = page.locator(`#${await more.getAttribute("aria-controls")}`)
  await expect(panel.getByLabel("Ends on")).toBeHidden()
  await more.focus()
  await page.keyboard.press("Tab")
  await expect(panel.getByLabel("Ends on")).not.toBeFocused()
  await more.click()
  await expect(more).toHaveAttribute("aria-expanded", "true")
  await more.focus()
  await page.keyboard.press("Tab")
  await expect(panel.getByLabel("Ends on")).toBeFocused()
})

test("the file area shows the chosen file's name and posts the file", async ({ page }) => {
  const card = await openKit(page)
  await expect(card.getByText("Drop the CSV here or choose a file")).toBeVisible()
  await card.getByLabel("CSV file").setInputFiles({ name: "agents-example.csv", mimeType: "text/csv", buffer: Buffer.from("name,phone\n") })
  await expect(card.locator(".kit-file-t")).toHaveText("agents-example.csv")
  await expect(card.locator(".kit-file-t")).toHaveCSS("color", "rgb(9, 0, 187)")
  expect((await posted(card)).file).toBe("file:agents-example.csv")
  await expect(card.getByRole("button", { name: "Choose file" })).toBeVisible()
})

test("tabs are links; the current one is marked and drawn as the indigo pill", async ({ page }) => {
  const card = await openKit(page)
  const nav = card.getByRole("navigation", { name: "Student record sections" })
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page")
  await nav.getByRole("link", { name: "Interview" }).click()
  await expect(page).toHaveURL(/\/staff\/kit\?tab=interview$/)
  const interview = nav.getByRole("link", { name: "Interview" })
  await expect(interview).toHaveAttribute("aria-current", "page")
  await expect(interview).toHaveCSS("background-color", "rgb(9, 0, 187)")
  await expect(interview).toHaveCSS("font-style", "italic")
  await expect(card.getByText("Showing: Interview")).toBeVisible()
  await expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "page")
})

test("the filter button keeps its name and shows its on state", async ({ page }) => {
  const card = await openKit(page)
  const [off, on] = await card.getByRole("button", { name: "Filter Visited applicants" }).all()
  await expect(on).toHaveAttribute("data-on", "")
  await expect(on).toHaveCSS("background-color", "rgb(242, 240, 252)")
  await expect(off).not.toHaveAttribute("data-on")
  await off.click()
  await expect(off).toHaveAttribute("data-on", "")
})

test("axe finds nothing in the form parts card", async ({ page }) => {
  const card = await openKit(page)
  await card.getByRole("button", { name: "More options" }).click()
  await card.getByRole("button", { name: "History" }).click()
  expect(await axeProblems(page, `[data-kit-form="form-parts"]`)).toEqual([])
})

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("the popups appear at once and the tick and chevrons do not move", async ({ page }) => {
    const card = await openKit(page)
    const list = card.getByRole("combobox", { name: "Payment type" })
    await expect(list.locator(".kit-sel-chev")).toHaveCSS("transition-duration", "0s")
    await list.click()
    await expect(page.locator(".kit-sel-pop")).toHaveCSS("transition-duration", "0s")
    await page.keyboard.press("Escape")

    await card.getByRole("button", { name: "Open the calendar" }).first().click()
    await expect(page.locator(".kit-cal-pop")).toHaveCSS("transition-duration", "0s")
    await page.keyboard.press("Escape")

    await expect(card.locator(".kit-ck .gf-ic").first()).toHaveCSS("transition-duration", "0s")
    await expect(card.locator(".kit-dsc-chev").first()).toHaveCSS("transition-duration", "0s")
    await expect(card.locator(".kit-dsc-panel").first()).toHaveCSS("transition-duration", "0s")
  })
})
