import type { Result } from "@/lib/services/result"

// The result messages families receive, and the wa.me link that carries one.
// Pure: no I/O. Callers pass the office phone (OFFICE_PHONE from lib/office.ts)
// so this module stays importable anywhere, tests included.

export type ResultChannel = "whatsapp" | "sms"
export type InterviewResult = "passed" | "failed"
export type ResultTemplateId = `${ResultChannel}_${InterviewResult}_v1`

// The four templates the human approved on #11, byte for byte. A wording
// change is a code change with the human's approval and gets a new id, so the
// id recorded with an older release still says which text it carried.
export const RESULT_TEMPLATES: Readonly<Record<ResultTemplateId, string>> = Object.freeze({
  whatsapp_passed_v1: `Assalaam Alaykum {parent_name},

*Hongera sana!* 🎉 Tuna furaha kubwa kukujulisha kwamba *{student_name}* amefaulu usaili wa kujiunga na Al-Rahmah Schools.

- *Matokeo:* Amefaulu
- *Alama:* {score}%
- *Darasa:* {class}, {enrollment_year}
- *Namba ya Udahili:* {admission_number}

*Hatua inayofuata:* Kamilisha usajili kwa kulipa ada ya shule katika ofisi yetu ya udahili.

Tunamkaribisha {student_name} kwa mikono miwili katika familia ya Al-Rahmah.

_Ofisi ya Udahili, Al-Rahmah Schools_`,

  whatsapp_failed_v1: `Assalaam Alaykum {parent_name},

Asante kwa kumleta *{student_name}* kufanya usaili wa kujiunga na Al-Rahmah Schools. Tunathamini sana imani yenu kwetu.

Kwa masikitiko, safari hii {student_name} hakufaulu usaili.

- *Matokeo:* Hakufaulu
- *Alama:* {score}%
- *Namba ya Udahili:* {admission_number}

*Hatua inayofuata:* Tafadhali wasiliana na ofisi yetu ya udahili kupitia {office_phone} ili tuzungumze pamoja kuhusu njia bora kwa {student_name}.

_Ofisi ya Udahili, Al-Rahmah Schools_`,

  sms_passed_v1:
    "Assalaam Alaykum {parent_name}. Hongera! {student_name} amefaulu usaili wa Al-Rahmah Schools kwa alama {score}%. Namba ya Udahili: {admission_number}. Hatua inayofuata: kamilisha usajili kwa kulipa ada ofisini. - Ofisi ya Udahili",

  sms_failed_v1:
    "Assalaam Alaykum {parent_name}. Asante kwa kumleta {student_name} kwenye usaili wa Al-Rahmah Schools. Kwa masikitiko, hakufaulu; alama {score}%. Namba ya Udahili: {admission_number}. Tafadhali wasiliana na ofisi ya udahili: {office_phone}. - Ofisi ya Udahili",
})

// The research budget for a wa.me message (research/whatsapp-links). The
// approved text with realistic names never comes near it.
const WHATSAPP_MAX_LENGTH = 1000

export type ResultMessageInput = {
  channel: ResultChannel
  result: InterviewResult
  parentName: string
  studentName: string
  score: number
  admissionNumber: string
  className: string
  enrollmentYear: number
  officePhone: string
}

export type ResultMessage =
  | { channel: "whatsapp"; templateId: ResultTemplateId; text: string }
  | { channel: "sms"; templateId: ResultTemplateId; text: string; gsm7: boolean; segments: number }

export function renderResultMessage(input: ResultMessageInput): Result<ResultMessage, "too_long"> {
  const templateId: ResultTemplateId = `${input.channel}_${input.result}_v1`
  const values: Record<string, string> = {
    parent_name: oneLine(input.parentName),
    student_name: oneLine(input.studentName),
    score: scoreNumber(input.score),
    admission_number: input.admissionNumber,
    class: input.className,
    enrollment_year: String(input.enrollmentYear),
    office_phone: input.officePhone,
  }
  // One pass with a function replacer, so a `$` or a `{…}` inside a name is
  // copied as typed and never read as a placeholder.
  const text = RESULT_TEMPLATES[templateId].replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

  if (input.channel === "whatsapp") {
    if (text.length > WHATSAPP_MAX_LENGTH) return { ok: false, error: "too_long" }
    return { ok: true, data: { channel: "whatsapp", templateId, text } }
  }
  return { ok: true, data: { channel: "sms", templateId, text, ...smsSegments(text) } }
}

// A name on one line, so a line break typed into it can't start a line of its
// own beside the approved text. Runs of whitespace become one space.
function oneLine(name: string): string {
  return name.replace(/\s+/g, " ").trim()
}

// A percentage as families expect it: `78%`, `78.5%`, never `78.0%`. Scores
// carry at most one decimal place; rounding to it also drops float noise.
export function formatScore(score: number): string {
  return `${scoreNumber(score)}%`
}

function scoreNumber(score: number): string {
  return String(Math.round(score * 10) / 10)
}

const TANZANIAN_MOBILE = /^255[67]\d{8}$/

// A wa.me link that opens a chat with the number and the text typed in. Only a
// Tanzanian mobile in international form without its `+` is accepted: wa.me
// doesn't validate numbers, so `0712…` would open a chat with a stranger.
// encodeURIComponent, never a hand-built query, since a raw `+` reads as a space.
export function buildWhatsAppLink(phoneDigits: string, text: string): Result<string, "invalid_number"> {
  if (!TANZANIAN_MOBILE.test(phoneDigits)) return { ok: false, error: "invalid_number" }
  return { ok: true, data: `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}` }
}

// The GSM 03.38 alphabet a basic phone shows. Extension characters cost two
// septets (an escape plus the character).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM7_EXTENSION = "\f^{}\\[~]|€"

// Whether the text is all GSM-7 and how many SMS it takes: 160 septets in one,
// 153 per part when split; otherwise UCS-2 at 70 in one, 67 per part.
function smsSegments(text: string): { gsm7: boolean; segments: number } {
  let septets = 0
  for (const char of text) {
    if (GSM7_BASIC.includes(char)) septets += 1
    else if (GSM7_EXTENSION.includes(char)) septets += 2
    else return { gsm7: false, segments: segmentCount(text.length, 70, 67) }
  }
  return { gsm7: true, segments: segmentCount(septets, 160, 153) }
}

function segmentCount(units: number, single: number, perPart: number): number {
  return units <= single ? 1 : Math.ceil(units / perPart)
}
