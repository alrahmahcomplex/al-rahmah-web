import { randomInt, randomUUID } from "node:crypto"

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"

import { E2E_PORT } from "./server"

// Helpers the Admission form specs share. Every run invents its own names
// (never "Fixture", which the Leads specs count) and numbers (a leading 7 keeps them clear of the seeded 700 000 numbers), since
// the local database keeps every lead the tests make.
//
// The form asks one question at a time (concept C). Answered questions stay
// in the page, folded, so every helper works inside the open question:
// `openQuestion(page)`.

export const PHONE_WIDTH = { width: 390, height: 844 }

export function family() {
  const suffix = randomUUID().slice(0, 6)
  return {
    parent: `Mzazi Majaribio ${suffix}`,
    phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    child: `Mwanafunzi Majaribio ${suffix}`,
  }
}

export const WORDS = {
  sw: {
    studentName: "Mwanafunzi anaitwa nani?",
    secondStudentName: "Mwanafunzi wa pili anaitwa nani?",
    chooseOther: "Chagua darasa lingine",
    sheetTitle: "Chagua darasa",
    levels: { nursery: "Awali", primary: "Msingi", secondary: "Sekondari" },
    changeYear: "Badilisha Mwaka",
    day: "Kutwa",
    boarding: "Bweni",
    another: "Unaomba kwa mwanafunzi mwingine pia?",
    addStudent: "Ndiyo, ongeza mwanafunzi",
    noMore: "Hapana, endelea",
    parentName: "Jina lako kamili ni nani?",
    mother: "Mama",
    other: "Mwingine",
    otherDescription: "Eleza uhusiano wako na mwanafunzi",
    phone: "Namba yako ya simu ni ipi?",
    haveCode: "Una code ya punguzo?",
    codeLabel: "Code ya Punguzo",
    codeCheck: "Hakiki Punguzo",
    skipCode: "Ruka, sina code",
    fee: "Ada ya usaili",
    review: "Hakiki kisha utume",
    continue: "Endelea",
    back: "Rudi",
    reset: "Anza upya",
    send: "Tuma maombi",
    done: "Maombi yamepokelewa!",
    again: "Jaza fomu nyingine",
    menu: "Menyu",
  },
  en: {
    studentName: "What is the student's name?",
    secondStudentName: "What is student two's name?",
    chooseOther: "Choose another class",
    sheetTitle: "Choose a class",
    levels: { nursery: "Nursery", primary: "Primary", secondary: "Secondary" },
    changeYear: "Change Year",
    day: "Day",
    boarding: "Boarding",
    another: "Are you applying for another student too?",
    addStudent: "Yes, add a student",
    noMore: "No, continue",
    parentName: "What is your full name?",
    mother: "Mother",
    other: "Other",
    otherDescription: "Describe your relationship to the student",
    phone: "What is your phone number?",
    haveCode: "Have a discount code?",
    codeLabel: "Discount code",
    codeCheck: "Check Discount",
    skipCode: "Skip, no code",
    fee: "Interview fee",
    review: "Check, then send",
    continue: "Continue",
    back: "Back",
    reset: "Start over",
    send: "Send application",
    done: "Application received!",
    again: "Fill in another form",
    menu: "Menu",
  },
} as const

export type Lang = keyof typeof WORDS

/** The question open now. Folded answers stay in the page, so look only here. */
export function openQuestion(page: Page) {
  // A question folding away on its way out keeps its open state until it goes.
  return page.locator('li[data-state="open"]:not(.gf-leaving)')
}

/**
 * A choice tile (year, relationship) by its words. Its radio and its words
 * lie on top of each other, so the tap goes to the label holding both.
 */
export function tile(question: Locator, words: string | RegExp) {
  return question.locator("label").filter({ hasText: typeof words === "string" ? new RegExp(`^${words}$`) : words })
}

/** Waits until the open question is the one named. */
export async function expectQuestion(page: Page, name: string | RegExp) {
  await expect(openQuestion(page).getByRole("heading", { name })).toBeVisible()
}

/**
 * Sets the page language, so the first-visit language card stays away. Call
 * before the first visit to /apply.
 */
export async function setLanguageCookie(context: BrowserContext, lang: Lang) {
  await context.addCookies([{ name: "lang", value: lang, url: `http://localhost:${E2E_PORT}` }])
}

function levelOf(className: string): keyof (typeof WORDS)["sw"]["levels"] {
  if (className.startsWith("FORM")) return "secondary"
  if (className.startsWith("STD")) return "primary"
  return "nursery"
}

/**
 * Answers one student's three questions: the name, the class (from the full
 * list, after picking the year), and Boarding. Leaves "another student?"
 * open, or the custodian's name after the eighth (`last`).
 */
export async function fillStudent(
  page: Page,
  lang: Lang,
  name: string,
  year: string,
  { className = "STD 3", residence = "boarding" as "day" | "boarding", last = false } = {},
) {
  const t = WORDS[lang]
  const q = openQuestion(page)
  await q.getByRole("textbox").fill(name)
  await q.getByRole("button", { name: t.continue }).click()
  await expect(q.getByRole("button", { name: t.chooseOther })).toBeVisible()
  if (!(await q.getByText(year, { exact: true }).isVisible())) {
    await q.getByRole("button", { name: t.changeYear }).click()
    await tile(q, new RegExp(`^${year} · `)).click()
  }
  await expect(q.getByText(year, { exact: true })).toBeVisible()
  await q.getByRole("button", { name: t.chooseOther }).click()
  const sheet = page.getByRole("dialog", { name: t.sheetTitle })
  await sheet.getByRole("tab", { name: t.levels[levelOf(className)] }).click()
  await sheet.getByRole("button", { name: className, exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await q.getByText(t[residence], { exact: true }).click()
  await expectQuestion(page, last ? t.parentName : t.another)
}

/** Answers the custodian's name, Mother, and the phone. Leaves the Discount code open. */
export async function fillParent(page: Page, lang: Lang, who: Pick<ReturnType<typeof family>, "parent" | "phone">) {
  const t = WORDS[lang]
  const q = openQuestion(page)
  await expectQuestion(page, t.parentName)
  await q.getByRole("textbox").fill(who.parent)
  await q.getByRole("button", { name: t.continue }).click()
  await tile(q, t.mother).click()
  await expectQuestion(page, t.phone)
  await q.getByLabel(t.phone).fill(who.phone)
  await q.getByRole("button", { name: t.continue }).click()
  await expectQuestion(page, t.haveCode)
}

/** One student and the custodian, up to the Discount code question. */
export async function toCode(page: Page, lang: Lang, who: ReturnType<typeof family>, year: string, students = 1) {
  const t = WORDS[lang]
  for (let n = 1; n <= students; n++) {
    if (n > 1) await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
    await fillStudent(page, lang, students === 1 ? who.child : `${who.child} ${n}`, year)
  }
  await openQuestion(page).getByRole("button", { name: t.noMore }).click()
  await fillParent(page, lang, who)
}

/** From the Discount code question, as it stands, past the fee to the send question. */
export async function toSend(page: Page, lang: Lang) {
  const t = WORDS[lang]
  const q = openQuestion(page)
  await q.getByRole("button", { name: new RegExp(`^(${t.continue}|${t.skipCode})$`) }).click()
  await expectQuestion(page, t.fee)
  await q.getByRole("button", { name: t.continue }).click()
  await expectQuestion(page, t.review)
}

/** The whole form for one student with no code, up to the send question. */
export async function fillForm(page: Page, lang: Lang, who: ReturnType<typeof family>, year: string) {
  await toCode(page, lang, who, year)
  await toSend(page, lang)
}

/** Waits for the security check, sends, and waits for the confirmation. */
export async function send(page: Page, lang: Lang) {
  await waitForSecurityCheck(page)
  await openQuestion(page).getByRole("button", { name: WORDS[lang].send }).click()
}

// Turnstile's test site key passes on its own; wait for its token.
export async function waitForSecurityCheck(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
}
