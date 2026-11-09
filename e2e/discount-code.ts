import { randomInt, randomUUID } from "node:crypto"

import { expect, type BrowserContext, type Page } from "@playwright/test"

import { E2E_PORT } from "./server"

// Helpers the Discount code specs share. Every run invents its own name and
// phone (a leading 7 keeps it clear of the seeded 700 000 numbers), since the
// local database keeps every agent the tests register.

export function newcomer() {
  const suffix = randomUUID().slice(0, 6)
  return {
    name: `Rehema Majaribio ${suffix}`,
    phone: `07${String(randomInt(10_000_000, 100_000_000))}`,
    email: `rehema-${suffix}@example.test`,
  }
}

export const WORDS = {
  sw: {
    name: "Unaitwa nani?",
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
    done: "Code yako ya Punguzo",
    copy: "Nakili kiungo",
    copied: "Kiungo kimenakiliwa",
    share: "Shiriki kwenye WhatsApp",
  },
  en: {
    name: "What's your name?",
    phone: "Your phone number?",
    whatsappToggle: "My WhatsApp number is different",
    whatsapp: "WhatsApp number (optional)",
    email: "Your email?",
    hasCode: "Already have a Discount code?",
    yes: "Yes",
    no: "No",
    code: "Your Discount code",
    next: "Continue",
    title: "Discount code",
    send: "Get my Discount code",
    done: "Your Discount code",
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
  await expect(openQuestion(page).getByRole("radio", { name: label, exact: true })).toBeChecked()
}

// Answers every question up to the send step. `code` answers "Tayari una
// code?" with Ndiyo and that code; otherwise Hapana.
export async function fillRegistration(
  page: Page,
  lang: Lang,
  who: { name: string; phone: string; email: string },
  { whatsapp = "", code = "" }: { whatsapp?: string; code?: string } = {},
) {
  const t = WORDS[lang]
  await page.getByLabel(t.name).fill(who.name)
  await continueFrom(page, lang)
  await page.getByLabel(t.phone).fill(who.phone)
  if (whatsapp) {
    await page.getByRole("button", { name: t.whatsappToggle }).click()
    await page.getByLabel(t.whatsapp).fill(whatsapp)
  }
  await continueFrom(page, lang)
  await page.getByLabel(t.email).fill(who.email)
  await continueFrom(page, lang)
  // The tiles are drawn over their radios, so tap the tile as a person would.
  if (code) {
    await pickTile(page, t.yes)
    await page.getByLabel(t.code, { exact: true }).fill(code)
  } else {
    await pickTile(page, t.no)
  }
  await continueFrom(page, lang)
  await expect(page.getByRole("button", { name: t.send })).toBeVisible()
}

// Words the public pages never use (CONTEXT.md, Discount code).
export const FORBIDDEN = /agent|referral|approv|wakala|idhini/i
