import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"

// The ready messages staff send parents with a Promo code's link (Share promo
// code, approved 28 Nov 2026). The one-parent message is the owner's own
// wording in both languages; the group and short messages follow its shape.
// Parents see these words, so they say "Al-Rahmah Schools" and write amounts
// the way parents write them: 20,000/=.

export type ShareKind = "parent" | "group" | "short"
export type ShareLanguage = "en" | "sw"

export const SHARE_KINDS: { value: ShareKind; label: string }[] = [
  { value: "parent", label: "For one parent" },
  { value: "group", label: "For a group" },
  { value: "short", label: "Short" },
]

export const SHARE_LANGUAGES: { value: ShareLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
]

// 20000 as 20,000/=
export function shillings(amount: number): string {
  return `${amount.toLocaleString("en-US")}/=`
}

const MONTHS: Record<ShareLanguage, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  sw: ["Januari", "Februari", "Machi", "Aprili", "Mei", "Juni", "Julai", "Agosti", "Septemba", "Oktoba", "Novemba", "Desemba"],
}

// "2026-12-31" as 31 Dec 2026, or 31 Desemba 2026 in Kiswahili.
export function shareDay(day: string, language: ShareLanguage): string {
  const [year, month, date] = day.split("-").map(Number)
  return `${date} ${MONTHS[language][month - 1]} ${year}`
}

type Words = { code: string; link: string; off: string; pay: string; full: string; end: string | null }

const MESSAGES: Record<ShareLanguage, Record<ShareKind, (words: Words) => string>> = {
  en: {
    parent: ({ code, link, off, pay, full, end }) =>
      `Apply today using the link below to get ${off} off your child's interview fee at Al-Rahmah Schools. Instead of paying ${full} you pay only ${pay} if you use this link. If the link doesn't open, just type the Discount code ${code} on the form.\n\n` +
      (end
        ? `Remember, this discount ends on ${end}, so apply today before it ends: ${link}`
        : `Remember, this discount is for a limited time, so apply today before it ends: ${link}`),
    group: ({ code, link, off, pay, full, end }) =>
      `Parents, admissions at Al-Rahmah Schools are open! Apply today using the link below to get ${off} off your child's interview fee. Instead of paying ${full} you pay only ${pay} if you use this link. If the link doesn't open, just type the Discount code ${code} on the form.\n\n` +
      (end
        ? `Remember, this discount ends on ${end}, so apply today before it ends: ${link}`
        : `Remember, this discount is for a limited time, so apply today before it ends: ${link}`),
    short: ({ code, link, pay, full, end }) =>
      `Al-Rahmah Schools: pay only ${pay} instead of ${full} for your child's interview when you apply with this link (code ${code}). ${end ? `Ends ${end}` : "Limited time only"}, apply today: ${link}`,
  },
  sw: {
    parent: ({ code, link, off, pay, full, end }) =>
      `Omba nafasi leo kwa kutumia kiungo kilicho hapa chini ili kupata punguzo la ${off} kwenye ada ya usaili ya mtoto wako katika Shule za Al-Rahmah. Badala ya kulipa ${full}, utalipa ${pay} pekee ikiwa utatumia kiungo hiki. Kiungo kisipofunguka, andika tu Code ya Punguzo ${code} kwenye fomu.\n\n` +
      (end
        ? `Kumbuka, punguzo hili linaisha tarehe ${end}; hivyo, fanya ombi lako leo kabla muda haujaisha: ${link}`
        : `Kumbuka, punguzo hili linapatikana kwa muda mfupi tu; hivyo, fanya ombi lako leo kabla muda haujaisha: ${link}`),
    group: ({ code, link, off, pay, full, end }) =>
      `Wazazi, nafasi za kujiunga na Shule za Al-Rahmah ziko wazi! Ombeni nafasi leo kwa kutumia kiungo kilicho hapa chini ili kupata punguzo la ${off} kwenye ada ya usaili ya mtoto wenu. Badala ya kulipa ${full}, mtalipa ${pay} pekee mkitumia kiungo hiki. Kiungo kisipofunguka, andikeni tu Code ya Punguzo ${code} kwenye fomu.\n\n` +
      (end
        ? `Kumbukeni, punguzo hili linaisha tarehe ${end}; hivyo, fanyeni ombi lenu leo kabla muda haujaisha: ${link}`
        : `Kumbukeni, punguzo hili linapatikana kwa muda mfupi tu; hivyo, fanyeni ombi lenu leo kabla muda haujaisha: ${link}`),
    short: ({ code, link, pay, full, end }) =>
      `Shule za Al-Rahmah: lipa ${pay} pekee badala ya ${full} kwa usaili wa mtoto wako ukiomba kupitia kiungo hiki (code ${code}). ${end ? `Hadi tarehe ${end}` : "Ni kwa muda mfupi tu"}, hivyo omba leo: ${link}`,
  },
}

// The suggested message for a code: its amount off, the fee it leaves, and
// its last day when it has one.
export function shareMessage({
  kind,
  language,
  code,
  link,
  amount,
  endsOn,
}: {
  kind: ShareKind
  language: ShareLanguage
  code: string
  link: string
  amount: number
  // "YYYY-MM-DD", or null for no end date.
  endsOn: string | null
}): string {
  return MESSAGES[language][kind]({
    code,
    link,
    off: shillings(amount),
    pay: shillings(STANDARD_INTERVIEW_FEE - amount),
    full: shillings(STANDARD_INTERVIEW_FEE),
    end: endsOn ? shareDay(endsOn, language) : null,
  })
}

// The message with the link put back at its end, after a space.
export function withLink(message: string, link: string): string {
  const kept = message.trimEnd()
  return kept === "" ? link : `${kept} ${link}`
}

export function whatsAppHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
