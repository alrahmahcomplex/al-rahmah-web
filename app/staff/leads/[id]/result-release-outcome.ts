import type { ReleaseBlocker, ReleaseError, ResultReleaseRecord } from "@/lib/services/result-release"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"

import { tzs } from "./interview-outcome"

// The Result release section's words. Codes never reach the screen.

// Why the result can't be sent yet, in a sentence that says what to do.
export function blockedText(blocked: ReleaseBlocker, amountOwed: number | null): string {
  switch (blocked) {
    case "no_interview":
      return "There is no interview yet, so there is no result to send."
    case "lead_closed":
      return "This lead is closed, so its result can't be sent."
    case "no_result":
      return "No result is recorded yet, so there is nothing to send."
    case "not_paid":
      return amountOwed === null
        ? "The result can't be sent until the interview fee is Paid."
        : `The result can't be sent until the interview fee is Paid. The family owes ${tzs(amountOwed)}.`
  }
}

const CHANNELS = { whatsapp: "WhatsApp", sms: "SMS" } as const

// "Sent by WhatsApp on 3 Oct 2026 by Amina", for the last release.
export function releaseLine(release: Pick<ResultReleaseRecord, "channel" | "releasedAt" | "releasedBy">): string {
  const on = formatDate(tanzaniaToday(new Date(release.releasedAt)))
  return `Sent by ${CHANNELS[release.channel]} on ${on} by ${release.releasedBy}`
}

// A stored number as staff read it aloud: +255 700 000 602.
export function spacedPhone(phone: string): string {
  const tanzanian = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return tanzanian ? `+255 ${tanzanian[1]} ${tanzanian[2]} ${tanzanian[3]}` : phone
}

// A note beside the SMS text when it would cost more than the two messages
// the templates are written for: past two, or with a character outside GSM-7,
// which a name can bring and which makes every message shorter.
export function smsNote({ gsm7, segments }: { gsm7: boolean; segments: number }): string | null {
  if (!gsm7) {
    return `A name has a character basic phones may not show, so this text takes ${segments} SMS messages and may cost more than usual.`
  }
  if (segments > 2) return `This text takes ${segments} SMS messages, more than the usual two.`
  return null
}

export type ReleaseRefusal = { status: "refused"; message: string }

// What Send through WhatsApp is told. The link goes only to the tab the click
// opened; it is never put in the page's own address.
export type ReleaseOutcome = { status: "released"; link: string } | ReleaseRefusal

// What Send SMS is told: the text and the number to send it to, once the
// release is recorded.
export type SmsReleaseOutcome = { status: "released"; text: string; phone: string; note: string | null } | ReleaseRefusal

export function releaseRefusal(error: ReleaseError): ReleaseRefusal {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't send interview results." }
    case "not-found":
      return { status: "refused", message: "This interview could not be found. Reload the page." }
    case "lead_closed":
      return { status: "refused", message: "This lead is closed, so its result can't be sent. Nothing was sent." }
    case "not_current":
      return {
        status: "refused",
        message: "This is no longer the lead's current interview, so nothing was sent. Reload the page to see the current result.",
      }
    case "no_result":
      return { status: "refused", message: "This interview has no result to send, so nothing was sent. Reload the page." }
    case "not_paid":
      return {
        status: "refused",
        message: "The interview fee is no longer Paid, so the result can't be sent. Nothing was sent. Reload the page to see the fee.",
      }
    case "no_whatsapp_number":
      return {
        status: "refused",
        message: "None of the parent's numbers can take a WhatsApp link, so nothing was sent. Reload the page.",
      }
    case "too_long":
      return {
        status: "refused",
        message: "The names on this lead make the message too long for WhatsApp, so nothing was sent. Check the names.",
      }
    case "unavailable":
      return { status: "refused", message: "The result could not be sent. Try again in a moment." }
  }
}
