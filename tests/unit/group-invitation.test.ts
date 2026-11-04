import { describe, expect, it } from "vitest"

import { GROUP_INVITATION_TEMPLATE_VERSION, renderGroupInvitation } from "@/lib/group-invitation"
import { buildWhatsAppLink, WHATSAPP_TEXT_MAX_LENGTH, WHATSAPP_URL_MAX_LENGTH } from "@/lib/whatsapp"

// An invented invite link of the length WhatsApp hands out: 22 characters.
const LINK = "https://chat.whatsapp.com/Hk3QmZ8rT2pL9wXc4VbN7a"

// The owner's approved v2 template, filled in by hand for 2027 and LINK.
const FILLED = `Mpendwa Mzazi/Mlezi,

🎉 Hongera na Karibu Al-Rahmah Schools!

Tunayo furaha kukukaribisha katika familia ya Al-Rahmah.

📢 MWALIKO WA KUJIUNGA NA KUNDI LA WHATSAPP – *AL-RAHMAH ADMISSIONS 2027*

Tumeanzisha kundi rasmi la WhatsApp kwa ajili ya wazazi na walezi ambao watoto wao wamejisajili kujiunga na Al-Rahmah Schools kwa mwaka *2027*.

Kupitia kundi hili, utapata taarifa muhimu kuhusu matokeo ya usaili, nafasi za udahili, ada, ofa maalum, tarehe za kuripoti, sare na mahitaji mengine ya shule.

✅ TAFADHALI JIUNGE NA KUNDI SASA!

Bonyeza kiungo hapa chini 👇🏼 ili kujiunga na kuhakikisha hupitwi na taarifa muhimu za udahili wa mtoto wako.

https://chat.whatsapp.com/Hk3QmZ8rT2pL9wXc4VbN7a

Kwa maswali au ufafanuzi zaidi, tafadhali wasiliana na Ofisi ya Udahili.

Asante kwa kuichagua na kuiamini Al-Rahmah Schools!

🔮 AL-RAHMAH SCHOOLS 🔮
🔅 Always The Best 🔅`

describe("the group invitation", () => {
  it("is the approved v2 wording with the year and the link filled in", () => {
    expect(renderGroupInvitation(2027, LINK)).toEqual({ ok: true, data: FILLED })
    expect(GROUP_INVITATION_TEMPLATE_VERSION).toBe("group_invitation_v2")
  })

  it("with a realistic link, stays within the text budget and the wa.me URL limit", () => {
    // WhatsApp's own query string makes the longest link staff are likely to paste.
    const rendered = renderGroupInvitation(2027, `${LINK}?mode=ems_copy_t`)
    if (!rendered.ok) throw new Error(rendered.error)
    expect(rendered.data.length).toBeLessThanOrEqual(WHATSAPP_TEXT_MAX_LENGTH)

    const link = buildWhatsAppLink(rendered.data, "255712345678")
    if (!link.ok) throw new Error(link.error)
    expect(link.data.length).toBeLessThanOrEqual(WHATSAPP_URL_MAX_LENGTH)
    expect(decodeURIComponent(new URL(link.data).searchParams.get("text") ?? "")).toBe(rendered.data)
    // The copy fallback has no number: the sender picks the chat.
    expect(buildWhatsAppLink(rendered.data).ok).toBe(true)
  })

  it("refuses a link long enough to take the message past the text budget", () => {
    // The database allows links up to 200 characters.
    const long = `https://chat.whatsapp.com/${"A".repeat(174)}`
    expect(renderGroupInvitation(2027, long)).toEqual({ ok: false, error: "too_long" })
  })

  it("copies the values as they are, never reading them as patterns", () => {
    const rendered = renderGroupInvitation(2027, "https://chat.whatsapp.com/A?x=$&")
    expect(rendered.ok && rendered.data).toContain("https://chat.whatsapp.com/A?x=$&\n")
  })
})
