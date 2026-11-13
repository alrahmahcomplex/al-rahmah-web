import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { expectQuestion, family, fillForm, fillParent, fillStudent, openQuestion, PHONE_WIDTH, send, toCode, toSend, setLanguageCookie, WORDS } from "./admission-form"

// The Admission form's history entries and its sessionStorage draft (#255):
// the phone's Back and Forward move between questions, a reload keeps the
// entries and reopens the question the parent was on, and a confirmed send
// leaves nothing behind. Also the top bar with the phone's text made large.

test.use({ viewport: PHONE_WIDTH })

const t = WORDS.sw
const nextYear = String(admissionYears()[1])

test.beforeEach(async ({ context }) => {
  await setLanguageCookie(context, "sw")
})

test("Back, Forward and reload keep every entry, and a confirmed send clears them", async ({ page }) => {
  const who = family()
  const ref = `MJ-${who.phone.slice(-6)}`
  await page.goto(`/apply?ref=${ref}`)
  await openQuestion(page).getByRole("textbox").fill(who.child)
  await openQuestion(page).getByRole("button", { name: t.continue }).click()
  await expect(openQuestion(page).getByRole("button", { name: t.chooseOther })).toBeVisible()
  await expect(page).toHaveURL(`/apply?ref=${ref}&q=class-1`)

  await page.goBack()
  await expectQuestion(page, t.studentName)
  await expect(page).toHaveURL(`/apply?ref=${ref}`)
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue(who.child)

  await page.goForward()
  await expect(openQuestion(page).getByRole("button", { name: t.chooseOther })).toBeVisible()

  await page.reload()
  await expect(openQuestion(page).getByRole("button", { name: t.chooseOther })).toBeVisible()
  await expect(page.getByText(who.child, { exact: true })).toBeVisible()

  // The form's own Back steps back through history, so Forward still works.
  await page.getByRole("button", { name: t.back }).click()
  await expectQuestion(page, t.studentName)
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue(who.child)
  await page.goForward()
  await expect(openQuestion(page).getByRole("button", { name: t.chooseOther })).toBeVisible()

  await page.getByRole("button", { name: t.back }).click()
  await openQuestion(page).getByRole("button", { name: t.continue }).click()
  await openQuestion(page).getByRole("button", { name: t.chooseOther }).click()
  await page.getByRole("dialog", { name: t.sheetTitle }).getByRole("button", { name: "STD 3", exact: true }).click()
  await openQuestion(page).getByText(t.boarding, { exact: true }).click()
  await openQuestion(page).getByRole("button", { name: t.noMore }).click()
  await fillParent(page, "sw", who)

  // The parent clears the link's code; a reload of the same link keeps that.
  const code = openQuestion(page).getByLabel(t.codeLabel)
  await expect(code).toHaveValue(ref)
  await code.fill("")
  await page.reload()
  await expectQuestion(page, t.haveCode)
  await expect(openQuestion(page).getByLabel(t.codeLabel)).toHaveValue("")

  await toSend(page, "sw")
  await send(page, "sw")
  await expect(page.getByRole("heading", { name: t.done })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)

  await page.reload()
  await expectQuestion(page, t.studentName)
  await expect(openQuestion(page).getByRole("textbox")).toHaveValue("")
})

test("switching language on a later question keeps the form's Back in history", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillStudent(page, "sw", who.child, nextYear)
  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expectQuestion(page, WORDS.en.another)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: WORDS.en.back }).click()
  await expect(openQuestion(page).getByRole("radio", { name: /Boarding/ })).toBeChecked()
  await page.goForward()
  await expectQuestion(page, WORDS.en.another)
})

for (const url of ["/apply?q=send", "/apply?step=3"]) {
  test(`a later question opened directly with no draft (${url}) opens the first question instead`, async ({ page }) => {
    await page.goto(url)
    await expectQuestion(page, t.studentName)
    await expect(page).toHaveURL(/\/apply$/)
  })
}

test("with storage blocked, the form still sends", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError")
      },
    })
  })
  const who = family()
  await page.goto("/apply")
  await fillForm(page, "sw", who, nextYear)
  await send(page, "sw")
  await expect(page.getByRole("heading", { name: t.done })).toBeVisible()
  await expect(page.getByText(/^ADMSN-\d{5}$/)).toBeVisible()
})

for (const lang of ["sw", "en"] as const) {
  test(`the document language is ${lang} when the page is`, async ({ page, context }) => {
    await setLanguageCookie(context, lang)
    await page.goto("/apply")
    await expect(page.locator("html")).toHaveAttribute("lang", lang)
  })
}

// #259: sent back to an earlier question, the form goes back to that
// question's own history entry rather than replacing the later one, so no
// later question's entry is left behind it.
test("a phone the server can't read opens the phone question on its own history entry", async ({ page }) => {
  // The server reads the phone's format; the form only checks one is there.
  const who = { ...family(), phone: "12" }
  await page.goto("/")
  await page.goto("/apply")
  await fillForm(page, "sw", who, nextYear)
  await send(page, "sw")

  await expectQuestion(page, t.phone)
  await expect(page).toHaveURL("/apply?q=phone")
  await expect(openQuestion(page).getByText("Hatukuweza kusoma namba hii ya simu.", { exact: false })).toBeVisible()
  const phone = openQuestion(page).getByLabel(t.phone)
  await expect(phone).toBeFocused()
  // Typing clears the server's problem and leaves the parent in the field.
  await phone.press("End")
  await phone.pressSequentially("34")
  await expect(phone).toBeFocused()
  await expect(phone).toHaveValue("1234")
  await expect(openQuestion(page).getByText("Hatukuweza kusoma namba hii ya simu.", { exact: false })).toHaveCount(0)

  await page.goBack()
  await expect(page).toHaveURL("/apply?q=rel")
  await page.goForward()
  await expectQuestion(page, t.phone)
  await expect(openQuestion(page).getByLabel(t.phone)).toHaveValue("1234")
})

test("Forward to a question the answers no longer allow stays put, and the form's Back then opens the one before", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await toCode(page, "sw", who, nextYear)

  await page.goBack()
  await expectQuestion(page, t.phone)
  await openQuestion(page).getByLabel(t.phone).fill("")
  await page.goForward()
  await expectQuestion(page, t.phone)
  await expect(page).toHaveURL("/apply?q=phone")

  await page.getByRole("button", { name: t.back }).click()
  await expect(openQuestion(page).getByRole("radio", { name: t.mother })).toBeChecked()
})
