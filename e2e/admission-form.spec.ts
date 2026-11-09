import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import {
  expectQuestion,
  family,
  fillForm,
  fillParent,
  fillStudent,
  openQuestion,
  tile,
  PHONE_WIDTH,
  send,
  toCode,
  toSend,
  setLanguageCookie,
  WORDS,
  type Lang,
} from "./admission-form"

// The public Admission form on a phone, against local Supabase with
// Turnstile's always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])

for (const lang of ["sw", "en"] as const satisfies Lang[]) {
  test(`applies for one student end to end in ${lang === "sw" ? "Swahili" : "English"}`, async ({ page, context }) => {
    const t = WORDS[lang]
    const who = family()
    await setLanguageCookie(context, lang)
    await page.goto("/apply")
    await expect(page.getByRole("main")).toHaveAttribute("lang", lang)
    await expect(page.getByText("AL-RAHMAH SCHOOLS")).toBeVisible()
    await expectQuestion(page, t.studentName)

    await fillForm(page, lang, who, nextYear)
    // The folded answers are the review.
    await expect(page.getByText(who.parent, { exact: true })).toBeVisible()
    await expect(page.getByText(`STD 3 · ${nextYear} · ${t.boarding}`)).toBeVisible()

    await send(page, lang)
    await expect(page.getByRole("heading", { name: t.done })).toBeVisible()
    await expect(page.getByText(lang === "sw" ? "Namba ya Udahili" : "Admission Number", { exact: true })).toBeVisible()
    await expect(page.getByText(/^ADMSN-\d{5}$/)).toBeVisible()
    await expect(page.getByText(who.child, { exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "+255 673 526 644" })).toHaveAttribute("href", "tel:+255673526644")

    await page.getByRole("button", { name: t.again }).click()
    await expectQuestion(page, t.studentName)
    await expect(openQuestion(page).getByRole("textbox")).toHaveValue("")
  })
}

test("switching language mid-form keeps every entry", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await fillStudent(page, "sw", who.child, nextYear)
  await openQuestion(page).getByRole("button", { name: WORDS.sw.noMore }).click()
  await openQuestion(page).getByRole("textbox").fill(who.parent)

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("main")).toHaveAttribute("lang", "en")
  await expectQuestion(page, WORDS.en.parentName)
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue(who.parent)
  await expect(page.getByText(`STD 3 · ${nextYear} · Boarding`)).toBeVisible()

  await page.keyboard.press("Escape")
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await tile(openQuestion(page), "Mother").click()
  await expectQuestion(page, WORDS.en.phone)
  await openQuestion(page).getByLabel(WORDS.en.phone).fill(who.phone)

  await page.getByRole("button", { name: "Menu" }).click()
  await page.getByRole("button", { name: "Kiswahili" }).click()
  await expectQuestion(page, WORDS.sw.phone)
  await expect(openQuestion(page).getByLabel(WORDS.sw.phone)).toHaveValue(who.phone)
  await expect(page.getByText("Mama", { exact: true }).first()).toBeVisible()
})

test("Continue names what is missing, and Other asks for a description", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  const q = openQuestion(page)

  await q.getByRole("button", { name: "Endelea" }).click()
  await expect(q.getByText("Andika jina kamili la mwanafunzi.")).toBeVisible()
  await expect(q.getByRole("textbox")).toBeFocused()

  await fillStudent(page, "sw", who.child, nextYear)
  await q.getByRole("button", { name: WORDS.sw.noMore }).click()
  await expectQuestion(page, WORDS.sw.parentName)
  await q.getByRole("button", { name: "Endelea" }).click()
  await expect(q.getByText("Andika jina kamili la msimamizi.")).toBeVisible()
  await q.getByRole("textbox").fill(who.parent)
  await q.getByRole("button", { name: "Endelea" }).click()

  await tile(q, WORDS.sw.other).click()
  await q.getByRole("button", { name: "Endelea" }).click()
  await expect(q.getByText("Eleza uhusiano wako na mwanafunzi.")).toBeVisible()
  await expect(q.getByLabel(WORDS.sw.otherDescription)).toBeFocused()
  await q.getByLabel(WORDS.sw.otherDescription).fill("Shangazi")
  await q.getByRole("button", { name: "Endelea" }).click()
  await expectQuestion(page, WORDS.sw.phone)
  await expect(page.getByText("Mwingine: Shangazi")).toBeVisible()

  await q.getByRole("button", { name: "Endelea" }).click()
  await expect(q.getByText("Andika namba yako ya simu.")).toBeVisible()
})

test("a phone the school can't read sends the parent back to it", async ({ page, context }) => {
  const who = { ...family(), phone: "12345" }
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await fillForm(page, "sw", who, nextYear)
  await send(page, "sw")

  await expectQuestion(page, WORDS.sw.phone)
  await expect(openQuestion(page).getByText(/Hatukuweza kusoma namba hii ya simu/)).toBeVisible()
  await expect(openQuestion(page).getByLabel(WORDS.sw.phone)).toHaveValue("12345")
})

test("a folded answer reopens with its Badilisha link, and Continue returns to the first open question", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await toCode(page, "sw", who, nextYear)

  await page.getByRole("button", { name: "Badilisha Namba" }).click()
  await expectQuestion(page, WORDS.sw.phone)
  await openQuestion(page).getByLabel(WORDS.sw.phone).fill("0754 000 111")
  await openQuestion(page).getByRole("button", { name: "Endelea" }).click()
  await expectQuestion(page, WORDS.sw.haveCode)
  await expect(page.getByText("0754 000 111", { exact: true })).toBeVisible()

  await toSend(page, "sw")
  await page.getByRole("button", { name: WORDS.sw.back }).click()
  await expectQuestion(page, WORDS.sw.fee)
})

test("Start over sits on the first question, and Clear the whole form asks before emptying the form", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await expect(page.getByRole("button", { name: WORDS.sw.reset })).toBeVisible()
  await fillStudent(page, "sw", who.child, nextYear)
  await expect(page.getByRole("button", { name: WORDS.sw.reset })).toHaveCount(0)
  await expect(page.getByRole("button", { name: WORDS.sw.back })).toBeVisible()

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "Futa fomu yote" }).click()
  await expect(page.getByText("Futa majibu yote?")).toBeVisible()
  await page.getByRole("button", { name: "Ndiyo, futa" }).click()
  await expectQuestion(page, WORDS.sw.studentName)
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue("")
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)
  await page.reload()
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue("")
})

for (const width of [280, 320, 390, 1280]) {
  test(`nothing scrolls sideways at ${width}px, from the first question to the code`, async ({ page, context }) => {
    const who = family()
    await setLanguageCookie(context, "sw")
    await page.setViewportSize({ width, height: 800 })
    await page.goto("/apply")
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await sideways()).toBeLessThanOrEqual(0)
    await toCode(page, "sw", who, nextYear)
    expect(await sideways()).toBeLessThanOrEqual(0)
    await toSend(page, "sw")
    expect(await sideways()).toBeLessThanOrEqual(0)
    for (const button of await openQuestion(page).getByRole("button").all()) {
      const box = await button.boundingBox()
      if (box) expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })
}

test("a tap on Other opens its description instead of folding the question", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await fillStudent(page, "en", who.child, nextYear)
  await openQuestion(page).getByRole("button", { name: WORDS.en.noMore }).click()
  await fillParent(page, "en", who)
  await page.getByRole("button", { name: "Change Relationship" }).click()
  await tile(openQuestion(page), "Other").click()
  await expect(openQuestion(page).getByLabel(WORDS.en.otherDescription)).toBeVisible()
})
