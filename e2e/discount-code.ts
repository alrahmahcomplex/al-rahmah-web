import { randomInt, randomUUID } from "node:crypto"

import type { Page } from "@playwright/test"

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
    name: "Jina lako kamili",
    phone: "Namba ya simu",
    whatsapp: "Namba ya WhatsApp (si lazima)",
    email: "Barua pepe",
    hasCode: "Tayari una code?",
    code: "Code yako ya Punguzo",
    heading: "Pata Code ya Punguzo",
    send: "Pata Code ya Punguzo",
    done: "Code yako ya Punguzo",
    copy: "Nakili kiungo",
    copied: "Kiungo kimenakiliwa",
    share: "Shiriki kwenye WhatsApp",
  },
  en: {
    name: "Your full name",
    phone: "Phone number",
    whatsapp: "WhatsApp number (optional)",
    email: "Email",
    hasCode: "Already have a Discount code?",
    code: "Your Discount code",
    heading: "Get a Discount code",
    send: "Get my Discount code",
    done: "Your Discount code",
    copy: "Copy link",
    copied: "Link copied",
    share: "Share on WhatsApp",
  },
} as const

export type Lang = keyof typeof WORDS

export async function fillRegistration(page: Page, lang: Lang, who: ReturnType<typeof newcomer>, whatsapp = "") {
  const t = WORDS[lang]
  await page.getByLabel(t.name).fill(who.name)
  await page.getByLabel(t.phone, { exact: true }).fill(who.phone)
  if (whatsapp) await page.getByLabel(t.whatsapp).fill(whatsapp)
  await page.getByLabel(t.email, { exact: true }).fill(who.email)
}

// Words the public pages never use (CONTEXT.md, Discount code).
export const FORBIDDEN = /agent|referral|approv|wakala|idhini/i
