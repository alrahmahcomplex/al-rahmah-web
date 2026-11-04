import { describe, expect, it } from "vitest"

import {
  WHATSAPP_TEXT_MAX_LENGTH,
  WHATSAPP_URL_MAX_LENGTH,
  buildWhatsAppLink,
  pickWhatsAppNumber,
} from "@/lib/whatsapp"

// Invented numbers only.

describe("pickWhatsAppNumber", () => {
  it("picks the WhatsApp contact first", () => {
    expect(pickWhatsAppNumber({ whatsapp: "+255712345678", phone: "+255698765432" })).toEqual({
      channel: "whatsapp",
      digits: "255712345678",
    })
  })

  it("falls back to the direct phone when there is no WhatsApp contact", () => {
    expect(pickWhatsAppNumber({ whatsapp: null, phone: "+255698765432" })).toEqual({
      channel: "phone",
      digits: "255698765432",
    })
  })

  it("falls back to the direct phone when the WhatsApp contact isn't a Tanzanian mobile", () => {
    expect(pickWhatsAppNumber({ whatsapp: "+255223456789", phone: "+255698765432" })).toEqual({
      channel: "phone",
      digits: "255698765432",
    })
  })

  it("falls back to the direct phone when the WhatsApp contact is empty", () => {
    expect(pickWhatsAppNumber({ whatsapp: "", phone: "+255698765432" })).toEqual({
      channel: "phone",
      digits: "255698765432",
    })
  })

  it("accepts any object with the two fields, such as a whole contact row", () => {
    const contact = { id: "c1", full_name: "Mwanaisha Mfano", whatsapp: undefined, phone: "+255612345678" }
    expect(pickWhatsAppNumber(contact)).toEqual({ channel: "phone", digits: "255612345678" })
  })

  it("returns null when both numbers are missing", () => {
    expect(pickWhatsAppNumber({ whatsapp: null, phone: null })).toBeNull()
    expect(pickWhatsAppNumber({})).toBeNull()
    expect(pickWhatsAppNumber({ whatsapp: "", phone: "" })).toBeNull()
  })

  // Numbers are stored as `+255` and nine digits; anything else is refused
  // rather than guessed at, so a link never opens a chat with a stranger.
  it.each([
    ["0712345678"],
    ["255712345678"],
    ["+255 712 345 678"],
    ["+255223456789"],
    ["+25571234567"],
    ["+2557123456789"],
    ["+254712345678"],
    ["+447712345678"],
    [" +255712345678"],
    ["+255712345678\n"],
  ])("refuses %j in either field", (number) => {
    expect(pickWhatsAppNumber({ whatsapp: number, phone: number })).toBeNull()
  })
})

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the text percent-encoded", () => {
    expect(buildWhatsAppLink("Habari yako", "255712345678")).toEqual({
      ok: true,
      data: "https://wa.me/255712345678?text=Habari%20yako",
    })
  })

  it("builds a share link with no number, so the sender picks the chat", () => {
    expect(buildWhatsAppLink("Habari yako")).toEqual({ ok: true, data: "https://wa.me/?text=Habari%20yako" })
  })

  it("takes the digits pickWhatsAppNumber returns", () => {
    const picked = pickWhatsAppNumber({ whatsapp: "+255712345678", phone: null })
    if (!picked) throw new Error("no number")
    expect(buildWhatsAppLink("Habari", picked.digits)).toEqual({ ok: true, data: "https://wa.me/255712345678?text=Habari" })
  })

  it("round-trips awkward characters and the emoji unchanged", () => {
    const text = "Mama O'Neil & Baba #1: 50% + 🎉\n*Hongera*"
    const link = buildWhatsAppLink(text, "255612345678")
    if (!link.ok) throw new Error("refused")
    const url = new URL(link.data)
    expect(url.origin + url.pathname).toBe("https://wa.me/255612345678")
    // A raw `+` would arrive as a space, and a raw `&` or `#` would cut the text.
    expect(link.data.split("?text=")[1]).not.toMatch(/[ +&#\n]/)
    expect(decodeURIComponent(link.data.split("?text=")[1])).toBe(text)
    expect(url.searchParams.get("text")).toBe(text)
  })

  it.each([
    ["0712345678"],
    ["+255712345678"],
    ["255223456789"],
    ["25571234567"],
    ["2557123456789"],
    ["254712345678"],
    ["447712345678"],
    [" 255712345678"],
    ["255712345678\n"],
    [""],
  ])("refuses the number %j", (digits) => {
    expect(buildWhatsAppLink("Habari", digits)).toEqual({ ok: false, error: "invalid_number" })
  })

  it("encodes a long Swahili message with line breaks and * to a known length", () => {
    const line = "*Hongera sana!* Mwanafunzi amefaulu usaili wa kujiunga na Al-Rahmah Schools."
    const text = Array.from({ length: 12 }, () => line).join("\n")
    expect(text.length).toBeLessThanOrEqual(WHATSAPP_TEXT_MAX_LENGTH)

    const link = buildWhatsAppLink(text, "255712345678")
    if (!link.ok) throw new Error("refused")
    // `*` stays literal; each space and line break becomes three characters.
    const spaces = (line.match(/ /g) ?? []).length * 12
    const breaks = 11
    expect(link.data.length).toBe("https://wa.me/255712345678?text=".length + text.length + 2 * (spaces + breaks))
    expect(link.data).toContain("*Hongera%20sana!*")
    expect(link.data.length).toBeLessThanOrEqual(WHATSAPP_URL_MAX_LENGTH)
  })

  it("refuses a link whose encoded URL is over the URL limit", () => {
    // `€` encodes to nine characters, so a text within the text limit can
    // still make a URL over the URL limit.
    const text = "€".repeat(WHATSAPP_TEXT_MAX_LENGTH)
    expect(text.length).toBe(WHATSAPP_TEXT_MAX_LENGTH)
    expect(buildWhatsAppLink(text, "255712345678")).toEqual({ ok: false, error: "too_long" })
    expect(buildWhatsAppLink(text)).toEqual({ ok: false, error: "too_long" })
  })

  it("accepts a URL of exactly the URL limit and refuses one character more", () => {
    const prefix = "https://wa.me/?text=".length
    const atLimit = "a".repeat(WHATSAPP_URL_MAX_LENGTH - prefix)
    const link = buildWhatsAppLink(atLimit)
    if (!link.ok) throw new Error("refused")
    expect(link.data.length).toBe(WHATSAPP_URL_MAX_LENGTH)
    expect(buildWhatsAppLink(atLimit + "a")).toEqual({ ok: false, error: "too_long" })
  })

  it("refuses text with a lone surrogate instead of throwing", () => {
    // Half an emoji, as `.slice()` can leave one; encodeURIComponent throws on it.
    expect(buildWhatsAppLink("Hongera \uD83C", "255712345678")).toEqual({ ok: false, error: "invalid_text" })
  })

  it("keeps the text limit and the URL limit as separate limits", () => {
    expect(WHATSAPP_TEXT_MAX_LENGTH).toBe(1000)
    expect(WHATSAPP_URL_MAX_LENGTH).toBeGreaterThan(WHATSAPP_TEXT_MAX_LENGTH)
  })
})
