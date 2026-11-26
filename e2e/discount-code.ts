import { randomInt, randomUUID } from "node:crypto"

import { expect, type BrowserContext, type Page } from "@playwright/test"

import { waitForSecurityCheck } from "./admission-form"
import { E2E_PORT } from "./server"

// Helpers the Discount code specs share. Every run invents its own name and
// phone (a leading 7 keeps it clear of the seeded 700 000 numbers), since the
// local database keeps every agent the tests register.

// Three names, as the three name boxes take them, in the capitals they are
// stored in. The third starts with X, so a new code starts with RMX.
export function newcomer() {
  const suffix = randomUUID().slice(0, 6)
  return {
    name: `REHEMA MAJARIBIO X${suffix.toUpperCase()}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    email: `rehema-${suffix}@example.test`,
  }
}

export const WORDS = {
  sw: {
    name: "Unaitwa nani?",
    first: "Jina la kwanza",
    middle: "Jina la kati",
    last: "Jina la mwisho",
    phone: "Namba yako ya simu?",
    whatsappToggle: "Namba yangu ya WhatsApp ni tofauti",
    whatsapp: "Namba ya WhatsApp (si lazima)",
    email: "Barua pepe yako?",
    hasCode: "Tayari una code?",
    yes: "Ndiyo",
    no: "Hapana",
    code: "Code yako ya Punguzo",
    next: "Endelea",
    title: "Code ya Punguzo",
    send: "Pata Code ya Punguzo",
    sendClaim: "Tuma",
    done: "Code yako ya Punguzo",
    claimDone: "Ombi limepokelewa",
    startOver: "Anza upya",
    back: "Rudi",
    copy: "Nakili kiungo",
    copied: "Kiungo kimenakiliwa",
    share: "Shiriki kwenye WhatsApp",
  },
  en: {
    name: "What's your name?",
    first: "First name",
    middle: "Middle name",
    last: "Last name",
    phone: "Your phone number?",
    whatsappToggle: "My WhatsApp number is different",
    whatsapp: "WhatsApp number (optional)",
    email: "Your email?",
    hasCode: "Do you already have a Discount code?",
    yes: "Yes",
    no: "No",
    code: "Your Discount code",
    next: "Continue",
    title: "Discount code",
    send: "Get Discount code",
    sendClaim: "Send",
    done: "Your Discount code",
    claimDone: "Request received",
    startOver: "Start over",
    back: "Back",
    copy: "Copy link",
    copied: "Link copied",
    share: "Share on WhatsApp",
  },
} as const

export type Lang = keyof typeof WORDS

// The pages ask a first-time visitor to pick a language before anything
// else. Specs that aren't about that card start with the language set.
export async function chooseLanguage(context: BrowserContext, lang: Lang = "sw") {
  await context.addCookies([{ name: "lang", value: lang, url: `http://localhost:${E2E_PORT}` }])
}

// The open question, the one whose controls can be used.
export function openQuestion(page: Page) {
  return page.locator("li.gf-open")
}

export async function continueFrom(page: Page, lang: Lang) {
  await openQuestion(page).getByRole("button", { name: WORDS[lang].next }).click()
}

export async function pickTile(page: Page, label: string) {
  await openQuestion(page).locator("label").filter({ has: page.getByRole("radio", { name: label, exact: true }) }).click()
}

// One of the three name boxes, named by its placeholder.
export function nameBox(page: Page, lang: Lang, which: "first" | "middle" | "last" = "first") {
  return page.getByRole("textbox", { name: WORDS[lang][which], exact: true })
}

// A whole name put into the first box spreads across the three, as a paste does.
export async function typeName(page: Page, lang: Lang, name: string) {
  await nameBox(page, lang).fill(name)
}

// Send on the review: "Get Discount code" for a new code, "Send" for a claim.
export function sendButton(page: Page, lang: Lang, claim = false) {
  return page.getByRole("button", { name: claim ? WORDS[lang].sendClaim : WORDS[lang].send, exact: true })
}

// Answers every question up to the send step. `code` answers "Tayari una
// code?" with Ndiyo and that code; otherwise Hapana, which goes straight to
// the review.
export async function fillRegistration(
  page: Page,
  lang: Lang,
  who: { name: string; phone: string; email: string },
  { whatsapp = "", code = "" }: { whatsapp?: string; code?: string } = {},
) {
  const t = WORDS[lang]
  await typeName(page, lang, who.name)
  await continueFrom(page, lang)
  await page.getByLabel(t.phone).fill(who.phone)
  if (whatsapp) {
    await page.getByRole("button", { name: t.whatsappToggle }).click()
    await page.getByLabel(t.whatsapp).fill(whatsapp)
  }
  await continueFrom(page, lang)
  // Self-confirm's order (#503 slice 4d-b, live since 20270128120100) asks no
  // email here; today's order does.
  const email = openQuestion(page).getByLabel(t.email)
  await expect(email.or(openQuestion(page).getByRole("radio", { name: t.yes }))).toBeVisible()
  if (await email.isVisible()) {
    await email.fill(who.email)
    await continueFrom(page, lang)
  }
  // The tiles are drawn over their radios, so tap the tile as a person would.
  if (code) {
    await pickTile(page, t.yes)
    await page.getByLabel(t.code, { exact: true }).fill(code)
    await continueFrom(page, lang)
  } else {
    await pickTile(page, t.no)
  }
  await expect(sendButton(page, lang, !!code)).toBeVisible()
}

// Words the public pages never use (CONTEXT.md, Discount code).
export const FORBIDDEN = /agent|referral|approv|wakala|idhini/i

const EMAIL_CHOICE = { sw: /Kwa barua pepe/, en: /With my email/ } as const
// The email choice when it is today's claim (owner, prototype v6 item 3).
const OFFICE_CHOICE = { sw: /Ofisi ya Masoko italithibitisha kwanza/, en: /The Marketing Office checks it first/ } as const
const CONTINUE = { sw: "Endelea", en: "Continue" } as const

/**
 * After Send, in self-confirm's order (#503): a new agent chooses how to sign
 * in, and this takes the email path, which asks for the email and ends on
 * today's finish. Today's claim path goes on to the choice too, by email only
 * (prototype v6 item 3), and this takes it the same way; its email step runs
 * the security check and sends by itself once it passes. A form still asking
 * for the email (self-confirm off when the page loaded) is answered before
 * sending again. Anything else (a finish, a notice, a code holder's own
 * choice) is left for the test.
 */
export async function afterSend(page: Page, lang: Lang, who: { email: string }, claim = false) {
  const t = WORDS[lang]
  const choice = page.getByRole("radio", { name: EMAIL_CHOICE[lang] })
  const formEmail = openQuestion(page).getByLabel(t.email)
  const done = page.getByRole("heading", { level: 1, name: new RegExp(`^(${t.done}|${t.claimDone})$`) })
  const notice = page.getByRole("main").getByRole("alert")
  await expect(choice.or(formEmail).or(done).or(notice).first()).toBeVisible({ timeout: 20_000 })
  if (await formEmail.isVisible()) {
    await formEmail.fill(who.email)
    await continueFrom(page, lang)
    // The first send spent the security check's token: wait for a fresh one.
    await waitForSecurityCheck(page)
    await sendButton(page, lang, claim).click()
    return afterSend(page, lang, who, claim)
  }
  const officeChoice = page.getByRole("radio", { name: OFFICE_CHOICE[lang] })
  if ((await choice.isVisible()) && (!claim || (await officeChoice.isVisible()))) {
    await choice.check({ force: true })
    await page.getByRole("button", { name: CONTINUE[lang] }).click()
    await page.getByLabel(t.email).fill(who.email)
    await page.getByRole("button", { name: CONTINUE[lang] }).click()
  }
}
