import type { Result } from "@/lib/services/result"
import { WHATSAPP_TEXT_MAX_LENGTH } from "@/lib/whatsapp"

// The admissions WhatsApp group invitation families receive (slice 11, #186).
// Pure: no I/O. lib/whatsapp.ts picks the number and builds the link.

// The owner approved this wording on 2026-11-03, with the v2 line
// "wamejisajili kujiunga". It is copied byte for byte. A wording change is a
// code change with the owner's approval and gets a new version, so the
// version recorded with an earlier invitation still says which text it carried.
export const GROUP_INVITATION_TEMPLATE_VERSION = "group_invitation_v2"

export const GROUP_INVITATION_TEMPLATE = `Mpendwa Mzazi/Mlezi,

🎉 Hongera na Karibu Al-Rahmah Schools!

Tunayo furaha kukukaribisha katika familia ya Al-Rahmah.

📢 MWALIKO WA KUJIUNGA NA KUNDI LA WHATSAPP – *AL-RAHMAH ADMISSIONS {year}*

Tumeanzisha kundi rasmi la WhatsApp kwa ajili ya wazazi na walezi ambao watoto wao wamejisajili kujiunga na Al-Rahmah Schools kwa mwaka *{year}*.

Kupitia kundi hili, utapata taarifa muhimu kuhusu matokeo ya usaili, nafasi za udahili, ada, ofa maalum, tarehe za kuripoti, sare na mahitaji mengine ya shule.

✅ TAFADHALI JIUNGE NA KUNDI SASA!

Bonyeza kiungo hapa chini 👇🏼 ili kujiunga na kuhakikisha hupitwi na taarifa muhimu za udahili wa mtoto wako.

{link}

Kwa maswali au ufafanuzi zaidi, tafadhali wasiliana na Ofisi ya Udahili.

Asante kwa kuichagua na kuiamini Al-Rahmah Schools!

🔮 AL-RAHMAH SCHOOLS 🔮
🔅 Always The Best 🔅`

// The link is long enough to take the message past WhatsApp's text budget.
export type GroupInvitationError = "too_long"

// The invitation for an Enrollment year, carrying the year's group link: the
// one saved for the year, which the database has checked is a
// chat.whatsapp.com invite link.
export function renderGroupInvitation(year: number, link: string): Result<string, GroupInvitationError> {
  const values: Record<string, string> = { year: String(year), link }
  // One pass with a function replacer, so nothing in a value is read as a
  // placeholder or a replacement pattern.
  const text = GROUP_INVITATION_TEMPLATE.replace(/\{(year|link)\}/g, (_, key: string) => values[key])
  if (text.length > WHATSAPP_TEXT_MAX_LENGTH) return { ok: false, error: "too_long" }
  return { ok: true, data: text }
}
