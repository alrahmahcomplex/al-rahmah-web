import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { inRolledBackTransaction } from "../tests/support/db"
import {
  expectQuestion,
  family,
  fillForm,
  answerGender,
  custodianTile,
  fillParent,
  fillStudent,
  nameBox,
  openQuestion,
  pickSomeoneElse,
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
    await expect(nameBox(page, lang)).toHaveValue("")
  })
}

test("the names go in boxes: Space moves on, a paste spreads, Backspace goes back, and the full name shows as it is typed", async ({ page, context }) => {
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  const q = openQuestion(page)
  const box = (name: string) => q.getByRole("textbox", { name, exact: true })

  await box("Student's name").pressSequentially("neema salim")
  await expect(box("Student's name")).toHaveValue("NEEMA")
  await expect(box("First name")).toHaveValue("SALIM")
  await expect(box("First name")).toBeFocused()
  await box("First name").press("Space")
  await box("Middle name").pressSequentially("omari mfano")
  await expect(box("Last name")).toHaveValue("MFANO")
  await expect(q.getByText("Student's full name:")).toContainText("NEEMA SALIM MFANO")
  await box("Last name").fill("")
  await box("Last name").press("Backspace")
  await expect(box("Middle name")).toBeFocused()

  await q.getByRole("button", { name: "Continue" }).click()
  await expect(q.getByText("Type the student's name and all three of the father's names.")).toBeVisible()
  await expect(box("Last name")).toHaveAttribute("aria-invalid", "true")
  await expect(box("Last name")).toBeFocused()
})

test("The father is the custodian: the relationship is Father, the phone question names him, and he is sent as the custodian", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await fillStudent(page, "en", who.childTyped, nextYear)
  await openQuestion(page).getByRole("button", { name: WORDS.en.noMore }).click()
  await expectQuestion(page, WORDS.en.parentName)

  await expect(openQuestion(page).getByText(who.father, { exact: true })).toBeVisible()
  await custodianTile(page, "en", "father").click()
  await expectQuestion(page, `What is ${who.father.split(" ")[0]}'s phone number?`)
  await expect(openQuestion(page).getByText(`Custodian: ${who.father}, the father. The relationship is set to Father.`)).toBeVisible()
  await expect(page.getByRole("button", { name: "Change Relationship" })).toHaveCount(0)
  await expect(page.getByText(`${who.father} · Father`)).toBeVisible()

  await openQuestion(page).getByLabel(/phone number/).fill(who.phone)
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await toSend(page, "en")
  await send(page, "en")
  await expect(page.getByRole("heading", { name: WORDS.en.done })).toBeVisible()
  await expect(page.getByText(who.child, { exact: true })).toBeVisible()
})

test("Start over on the first question: nothing to clear on an empty form, and with answers it asks first", async ({ page, context }) => {
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await page.getByRole("button", { name: WORDS.sw.reset }).click()
  await expect(page.getByText("Hakuna cha kufuta bado. Fomu iko tupu.")).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  await nameBox(page, "sw").fill("NEEMA")
  await page.getByRole("button", { name: WORDS.sw.reset }).click()
  const sheet = page.getByRole("dialog", { name: "Uanze upya?" })
  await expect(sheet.getByText("Hili haliwezi kurudishwa. Utaanza tena kutoka swali la kwanza.")).toBeVisible()
  await sheet.getByRole("button", { name: "Hapana, acha majibu yangu" }).click()
  await expect(sheet).toHaveCount(0)
  await expect(nameBox(page, "sw")).toHaveValue("NEEMA")

  await page.getByRole("button", { name: WORDS.sw.reset }).click()
  await page.getByRole("dialog", { name: "Uanze upya?" }).getByRole("button", { name: "Ndiyo, futa fomu" }).click()
  await expect(page.getByText("Fomu imeanza upya.")).toBeVisible()
  await expect(nameBox(page, "sw")).toHaveValue("")
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)
})

test("Start over from a later question asks first and opens the form on the first question, empty", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await toCode(page, "en", who, nextYear)
  await page.getByRole("button", { name: WORDS.en.reset }).click()
  const sheet = page.getByRole("dialog", { name: "Start over?" })
  await sheet.getByRole("button", { name: "No, keep my answers" }).click()
  await expect(sheet).toHaveCount(0)
  await expectQuestion(page, WORDS.en.haveCode)

  await page.getByRole("button", { name: WORDS.en.reset }).click()
  await page.getByRole("dialog", { name: "Start over?" }).getByRole("button", { name: "Yes, clear the form" }).click()
  await expectQuestion(page, WORDS.en.studentName)
  await expect(nameBox(page, "en")).toHaveValue("")
  await expect(page.getByRole("button", { name: WORDS.en.back })).toHaveCount(0)
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)
})

test("The family's choice of the father's middle name ends the student's name, and the school keeps it", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  const q = openQuestion(page)
  await nameBox(page, "en").fill(who.childTyped)
  // MWANAFUNZI MAJARIBIO BABA <suffix>: the father's middle name is BABA.
  await tile(q, /^Father's middle name/).click()
  await expect(q.getByRole("radio", { name: /^Father's middle name/ })).toBeChecked()
  await expect(q.getByText("Student's full name:")).toContainText("MWANAFUNZI MAJARIBIO BABA")
  await q.getByRole("button", { name: WORDS.en.continue }).click()
  await answerGender(page, "en")
  await q.getByRole("button", { name: WORDS.en.chooseOther }).click()
  await page.getByRole("dialog", { name: WORDS.en.sheetTitle }).getByRole("tab", { name: WORDS.en.levels.primary }).click()
  await page.getByRole("dialog", { name: WORDS.en.sheetTitle }).getByRole("button", { name: "STD 3", exact: true }).click()
  await q.getByText(WORDS.en.day, { exact: true }).click()
  await expectQuestion(page, WORDS.en.another)
  await q.getByRole("button", { name: WORDS.en.noMore }).click()
  await fillParent(page, "en", who)
  await toSend(page, "en")
  await send(page, "en")
  await expect(page.getByRole("heading", { name: WORDS.en.done })).toBeVisible()
  await expect(page.getByText("MWANAFUNZI MAJARIBIO BABA", { exact: false })).toBeVisible()
  // The lead holds the name the database built from the choice, and the choice.
  const number = await page.getByText(/^ADMSN-\d{5}$/).textContent()
  const row = await inRolledBackTransaction(
    async (sql) => (await sql.query("select student_name, last_name_from::text from public.leads where admission_number = $1", [number])).rows[0],
  )
  expect(row).toEqual({ student_name: `MWANAFUNZI MAJARIBIO BABA`, last_name_from: "father_middle" })
})

test("Start over on the finished screen opens a new form at once", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await fillForm(page, "en", who, nextYear)
  await send(page, "en")
  await expect(page.getByRole("heading", { name: WORDS.en.done })).toBeVisible()

  await page.getByRole("button", { name: WORDS.en.reset }).click()
  await expect(page.getByText("A new form is ready.")).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expectQuestion(page, WORDS.en.studentName)
  await expect(nameBox(page, "en")).toHaveValue("")
})

test("switching language mid-form keeps every entry", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await fillStudent(page, "sw", who.childTyped, nextYear)
  await openQuestion(page).getByRole("button", { name: WORDS.sw.noMore }).click()
  await pickSomeoneElse(page, "sw")
  await nameBox(page, "sw", "first").fill(who.parent)

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("main")).toHaveAttribute("lang", "en")
  await expectQuestion(page, WORDS.en.parentName)
  await expect(nameBox(page, "en", "first")).toHaveValue(who.parent.split(" ")[0])
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
  await expect(q.getByText("Andika jina la mwanafunzi na majina yote matatu ya baba.")).toBeVisible()
  await expect(nameBox(page, "sw")).toBeFocused()

  await fillStudent(page, "sw", who.childTyped, nextYear)
  await q.getByRole("button", { name: WORDS.sw.noMore }).click()
  await expectQuestion(page, WORDS.sw.parentName)
  // Nobody picked yet (#513): Enter on the buttons says to choose.
  await q.getByRole("radio", { name: new RegExp(`^${WORDS.sw.father}`) }).focus()
  await page.keyboard.press("Enter")
  await expect(q.getByText("Chagua msimamizi ni nani.")).toBeVisible()
  await pickSomeoneElse(page, "sw")
  await q.getByRole("button", { name: "Endelea" }).click()
  await expect(q.getByText("Andika majina yote matatu ya msimamizi.")).toBeVisible()
  await expect(nameBox(page, "sw", "first")).toBeFocused()
  await nameBox(page, "sw", "first").fill(who.parent)
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

test("Start over sits on the first question, stays beside Back after, and Clear the whole form asks before emptying the form", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  await expect(page.getByRole("button", { name: WORDS.sw.reset })).toBeVisible()
  await fillStudent(page, "sw", who.childTyped, nextYear)
  // #513: from the second question on, Start over stays on the bar with Back.
  await expect(page.getByRole("button", { name: WORDS.sw.reset })).toBeVisible()
  await expect(page.getByRole("button", { name: WORDS.sw.back })).toBeVisible()
  // Back on the first question again: Start over comes back, with the answers kept.
  await page.getByRole("button", { name: "Badilisha Jina" }).click()
  await expectQuestion(page, WORDS.sw.studentName)
  await expect(page.getByRole("button", { name: WORDS.sw.reset })).toBeVisible()
  await expect(page.getByRole("button", { name: WORDS.sw.back })).toHaveCount(0)

  await page.getByRole("button", { name: "Menyu" }).click()
  await page.getByRole("button", { name: "Futa fomu yote" }).click()
  await expect(page.getByText("Futa majibu yote?")).toBeVisible()
  await page.getByRole("button", { name: "Ndiyo, futa" }).click()
  await expectQuestion(page, WORDS.sw.studentName)
  await expect(nameBox(page, "sw")).toHaveValue("")
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)
  await page.reload()
  await expect(nameBox(page, "sw")).toHaveValue("")
})

test("a tap on Other opens its description instead of folding the question", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await fillStudent(page, "en", who.childTyped, nextYear)
  await openQuestion(page).getByRole("button", { name: WORDS.en.noMore }).click()
  await fillParent(page, "en", who)
  await page.getByRole("button", { name: "Change Relationship" }).click()
  await tile(openQuestion(page), "Other").click()
  await expect(openQuestion(page).getByLabel(WORDS.en.otherDescription)).toBeVisible()
})
