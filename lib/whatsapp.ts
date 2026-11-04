import type { Result } from "@/lib/services/result"

// The family number a WhatsApp message goes to, and the wa.me link that
// carries it. Shared by result messages, the group invitation and the agent
// share link. Pure: no I/O.

// The research budget for the message text (research/whatsapp-links). Callers
// that render a template check it, so an overlong message is refused by name.
export const WHATSAPP_TEXT_MAX_LENGTH = 1000

// The longest wa.me URL the builder hands out: RFC 9110's recommended minimum
// URI length every sender and recipient should support. wa.me itself took
// about 14 KB when tested.
export const WHATSAPP_URL_MAX_LENGTH = 8000

// How numbers are stored: `+255`, then 6 or 7, then eight digits. The database
// uses the same pattern to offer WhatsApp, so the two never disagree.
const STORED_TANZANIAN_MOBILE = /^\+255[67]\d{8}$/
// The same number as wa.me takes it: international form without the `+`.
const TANZANIAN_MOBILE_DIGITS = /^255[67]\d{8}$/

export type WhatsAppNumber = { channel: "whatsapp" | "phone"; digits: string }

// The number to message: the separate WhatsApp contact first, otherwise the
// direct phone, otherwise null. Only a stored Tanzanian mobile counts; wa.me
// doesn't validate numbers, so `0712…` would open a chat with a stranger.
export function pickWhatsAppNumber(contact: { whatsapp?: string | null; phone?: string | null }): WhatsAppNumber | null {
  if (contact.whatsapp && STORED_TANZANIAN_MOBILE.test(contact.whatsapp)) {
    return { channel: "whatsapp", digits: contact.whatsapp.slice(1) }
  }
  if (contact.phone && STORED_TANZANIAN_MOBILE.test(contact.phone)) {
    return { channel: "phone", digits: contact.phone.slice(1) }
  }
  return null
}

export type WhatsAppLinkError = "invalid_number" | "invalid_text" | "too_long"

// A wa.me link with the text typed in. With digits (from pickWhatsAppNumber)
// it opens that chat; without, the sender picks the chat. encodeURIComponent,
// never a hand-built query, since a raw `+` reads as a space.
export function buildWhatsAppLink(text: string, digits?: string): Result<string, WhatsAppLinkError> {
  if (digits !== undefined && !TANZANIAN_MOBILE_DIGITS.test(digits)) return { ok: false, error: "invalid_number" }
  let encoded: string
  try {
    encoded = encodeURIComponent(text)
  } catch {
    // Half an emoji, as a `.slice()` can leave one, throws URIError.
    return { ok: false, error: "invalid_text" }
  }
  const url = `https://wa.me/${digits ?? ""}?text=${encoded}`
  if (url.length > WHATSAPP_URL_MAX_LENGTH) return { ok: false, error: "too_long" }
  return { ok: true, data: url }
}
