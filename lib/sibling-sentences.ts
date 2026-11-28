import type { SiblingNote, SiblingReason } from "./services/sibling-counts"
import type { SiblingFeeEditReason } from "./services/sibling-groups"

// "Why this fee": one plain sentence per reason code explain_sibling_group
// gives (#306), and one line per note, in English and Swahili (#310). The
// owner approved the words in the Sibling fee screens prototype
// (https://claude.ai/artifact/P6NEbzyxA9JpdKjFzu6z6U); the Swahili ships as
// written there. The database decides the code; these only say it.

export type SentenceLanguage = "en" | "sw"

export type LargerDiscount = "staff_child" | "qualified_orphan"

// What a sentence may name. Names are first names, as the group shows them.
export type SentenceFacts = {
  // The siblings the reason names (because_of), or for `prior_sibling` the
  // ticked sibling as "Name, CLASS".
  siblings: string[]
  // The sibling who pays the full fee.
  fullPayer: string
  // The latest fee edit, for staff who may view payments; empty otherwise.
  staff: string
  date: string
  reason: SiblingFeeEditReason | null
  closure: "Inactive" | "Archived" | null
  // The result fixed at enrolment.
  kept: "full" | "ten" | null
  larger: LargerDiscount | null
  // For the full payer, with payments.view: whether it has the highest fee,
  // and whether another sibling's fee is the same. Null without payments.view.
  highest: boolean | null
  equal: boolean
  // Whether any other member counts as a sibling.
  others: boolean
  // When the Admissions Manager granted the Sibling request.
  grantedOn: string
}

export const NO_FACTS: SentenceFacts = {
  siblings: [],
  fullPayer: "",
  staff: "",
  date: "",
  reason: null,
  closure: null,
  kept: null,
  larger: null,
  highest: null,
  equal: false,
  others: false,
  grantedOn: "",
}

export const list = (names: string[], and: string) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`

export const FEE_EDIT_REASONS: Record<SiblingFeeEditReason, Record<SentenceLanguage, string>> = {
  full_fee_sibling_not_enrolled: { en: "Full-fee sibling did not enrol", sw: "Ndugu wa ada kamili hakusajiliwa" },
  sibling_proof_after_enrolment: { en: "Sibling proof after enrolment", sw: "Uthibitisho wa undugu baada ya kusajiliwa" },
  data_entry_correction: { en: "Data-entry correction", sw: "Marekebisho ya taarifa zilizoingizwa" },
}

export const LARGER_DISCOUNTS: Record<LargerDiscount, Record<SentenceLanguage, string>> = {
  staff_child: { en: "Staff child 25%", sw: "Punguzo la mtoto wa mfanyakazi 25%" },
  qualified_orphan: { en: "Qualified orphan 100%", sw: "Punguzo la yatima 100%" },
}

// "by Example Staff Two on 18 Nov 2026", or the role when the name isn't shown.
const setBy = (f: SentenceFacts, lang: SentenceLanguage) =>
  f.staff
    ? lang === "sw"
      ? ` na ${f.staff} tarehe ${f.date}`
      : ` by ${f.staff} on ${f.date}`
    : lang === "sw"
      ? " na anayerekodi malipo"
      : " by staff who record payments"

const because = (f: SentenceFacts, lang: SentenceLanguage) =>
  f.reason ? (lang === "sw" ? ` Sababu: ${FEE_EDIT_REASONS[f.reason].sw}.` : ` Reason: ${FEE_EDIT_REASONS[f.reason].en}.`) : ""

type Say = (f: SentenceFacts) => string

export const REASON_SENTENCES: Record<SiblingReason, Record<SentenceLanguage, Say>> = {
  manual_full: {
    en: (f) => `Full fee, set by hand${setBy(f, "en")}.${because(f, "en")}`,
    sw: (f) => `Ada kamili, imewekwa kwa mkono${setBy(f, "sw")}.${because(f, "sw")}`,
  },
  manual_ten: {
    en: (f) => `Sibling 10%, set by hand${setBy(f, "en")}.${because(f, "en")}`,
    sw: (f) => `Punguzo la ndugu 10%, limewekwa kwa mkono${setBy(f, "sw")}.${because(f, "sw")}`,
  },
  kept_when_leaving_legacy: {
    en: () => "Keeps the 10% from the old family rule, because a fee never goes up by itself.",
    sw: () => "Anabaki na punguzo la 10% la utaratibu wa zamani wa familia, kwa sababu ada haipandi yenyewe.",
  },
  prior_sibling: {
    en: (f) => `Sibling 10%: has a sibling already at Al-Rahmah${f.siblings[0] ? ` (${f.siblings[0]})` : ""}.`,
    sw: (f) => `Punguzo la ndugu 10%: ana ndugu ambaye tayari yuko Al-Rahmah${f.siblings[0] ? ` (${f.siblings[0]})` : ""}.`,
  },
  enrolled_full: {
    en: () => "Enrolled at the full fee. It stays as it is.",
    sw: () => "Amesajiliwa kwa ada kamili. Itabaki hivyo.",
  },
  enrolled_ten_anchor: {
    en: (f) => `Enrolled with the 10%, because ${list(f.siblings, "and")} is already Enrolled.`,
    sw: (f) => `Amesajiliwa na punguzo la 10%, kwa sababu ${list(f.siblings, "na")} ameshasajiliwa.`,
  },
  enrolled_ten_full_payer_waiting: {
    en: (f) => `Enrolled with the 10%. ${f.fullPayer} pays the full fee and has not enrolled yet.`,
    sw: (f) => `Amesajiliwa na punguzo la 10%. ${f.fullPayer} analipa ada kamili na bado hajasajiliwa.`,
  },
  enrolled_ten_no_full: {
    en: () => "Enrolled with the 10%, but no sibling pays the full fee.",
    sw: () => "Amesajiliwa na punguzo la 10%, lakini hakuna ndugu anayelipa ada kamili.",
  },
  locked_not_enrolled: {
    en: (f) => `Keeps ${f.kept === "ten" ? "the 10%" : "the full fee"} fixed at enrolment, after a payment correction.`,
    sw: (f) => `Anabaki na ${f.kept === "ten" ? "punguzo la 10%" : "ada kamili"} aliyopata aliposajiliwa, baada ya marekebisho ya malipo.`,
  },
  enrolled_unlocked: {
    en: () => "Enrolled, but the sibling result was not fixed at enrolment. Tell the Super Admin.",
    sw: () => "Amesajiliwa, lakini matokeo ya punguzo la ndugu hayakuhifadhiwa wakati wa kusajiliwa. Mjulishe Super Admin.",
  },
  no_family: {
    en: () => "No sibling discount until the custodian’s Family is confirmed.",
    sw: () => "Hakuna punguzo la ndugu mpaka familia ya msimamizi ithibitishwe.",
  },
  on_own: {
    en: () => "On their own. No sibling discount.",
    sw: () => "Yuko peke yake. Hakuna punguzo la ndugu.",
  },
  legacy_sibling_enrolled: {
    en: (f) => `Sibling 10% under the old family rule, because ${list(f.siblings, "and")} is Enrolled.`,
    sw: (f) => `Punguzo la ndugu 10% kwa utaratibu wa zamani wa familia, kwa sababu ${list(f.siblings, "na")} amesajiliwa.`,
  },
  legacy_no_sibling_enrolled: {
    en: () => "Full fee for now, under the old family rule. The 10% starts when a sibling is Enrolled.",
    sw: () => "Ada kamili kwa sasa, kwa utaratibu wa zamani wa familia. Punguzo la 10% linaanza ndugu akisajiliwa.",
  },
  request_pending: {
    en: (f) => `Full fee for now. A Sibling request${f.siblings[0] ? ` with ${f.siblings[0]}` : ""} waits for the Admissions Manager.`,
    sw: (f) =>
      `Ada kamili kwa sasa. Ombi la punguzo la ndugu${f.siblings[0] ? ` pamoja na ${f.siblings[0]}` : ""} linasubiri uamuzi wa Meneja wa Udahili.`,
  },
  request_needed: {
    en: () => "Full fee: the fathers’ names don’t match, and no Sibling request has been sent.",
    sw: () => "Ada kamili: majina ya baba hayalingani, na hakuna ombi la punguzo la ndugu lililotumwa.",
  },
  request_refused: {
    en: (f) => `Full fee: the Admissions Manager refused the Sibling request${f.siblings[0] ? ` with ${f.siblings[0]}` : ""}.`,
    sw: (f) => `Ada kamili: Meneja wa Udahili alikataa ombi la punguzo la ndugu${f.siblings[0] ? ` pamoja na ${f.siblings[0]}` : ""}.`,
  },
  declined: {
    en: () => "Declined, so not counted as a sibling.",
    sw: () => "Ameondolewa (Declined), kwa hiyo hahesabiwi kama ndugu.",
  },
  closed: {
    en: (f) => `Marked ${f.closure ?? "Inactive"}, so not counted as a sibling.`,
    sw: (f) => `Amewekwa ${f.closure ?? "Inactive"}, kwa hiyo hahesabiwi kama ndugu.`,
  },
  anchor: {
    en: (f) => `Sibling 10%, because ${list(f.siblings, "and")} is already Enrolled.`,
    sw: (f) => `Punguzo la ndugu 10%, kwa sababu ${list(f.siblings, "na")} ameshasajiliwa.`,
  },
  full_payer: {
    en: (f) =>
      f.highest === true && f.equal
        ? "Pays the full fee. The fees are equal, and this student came first."
        : f.highest === true
          ? "Pays the full fee: the highest fee in the group."
          : f.highest === false
            ? "Pays the full fee. A sibling who joined later has a higher fee and gets the 10%."
            : "Pays the full fee for the group.",
    sw: (f) =>
      f.highest === true && f.equal
        ? "Analipa ada kamili. Ada zinalingana, na mwanafunzi huyu alitangulia."
        : f.highest === true
          ? "Analipa ada kamili: ada ya juu kuliko zote kwenye kundi."
          : f.highest === false
            ? "Analipa ada kamili. Ndugu aliyejiunga baadaye ana ada ya juu zaidi na anapata punguzo la 10%."
            : "Analipa ada kamili kwa ajili ya kundi.",
  },
  full_payer_sibling: {
    en: (f) => `Sibling 10%, because ${f.fullPayer} pays the full fee.`,
    sw: (f) => `Punguzo la ndugu 10%, kwa sababu ${f.fullPayer} analipa ada kamili.`,
  },
  no_full_payer: {
    en: (f) =>
      f.others ? "Full fee for now: no sibling is Enrolled at the full fee or set to pay it." : "Full fee for now: no other sibling counts yet.",
    sw: (f) =>
      f.others
        ? "Ada kamili kwa sasa: hakuna ndugu aliyesajiliwa kwa ada kamili wala aliyepangiwa kuilipa."
        : "Ada kamili kwa sasa: hakuna ndugu mwingine anayehesabiwa bado.",
  },
}

export const NOTE_LINES: Record<SiblingNote, Record<SentenceLanguage, Say>> = {
  granted: {
    en: (f) => `Counted as a sibling: the Admissions Manager granted the Sibling request on ${f.grantedOn}.`,
    sw: (f) => `Anahesabiwa kama ndugu: Meneja wa Udahili alikubali ombi la punguzo la ndugu tarehe ${f.grantedOn}.`,
  },
  request_pending: {
    en: () => "A Sibling request waits for the Admissions Manager.",
    sw: () => "Ombi la punguzo la ndugu linasubiri uamuzi wa Meneja wa Udahili.",
  },
  fee_edit_needed: {
    en: () => "Granted after enrolment, so the fee has not changed. Staff who record payments can apply the 10%.",
    sw: () => "Limekubaliwa baada ya kusajiliwa, kwa hiyo ada haijabadilika. Wanaorekodi malipo wanaweza kuweka punguzo la 10%.",
  },
  larger_discount: {
    en: (f) => `${LARGER_DISCOUNTS[f.larger ?? "staff_child"].en} is larger, so it replaces the 10%.`,
    sw: (f) => `${LARGER_DISCOUNTS[f.larger ?? "staff_child"].sw} ni kubwa zaidi, kwa hiyo linachukua nafasi ya 10%.`,
  },
  prior_sibling_tick: {
    en: () => "Has a sibling already at Al-Rahmah is selected.",
    sw: () => "Imewekwa alama: ana ndugu ambaye tayari yuko Al-Rahmah.",
  },
  grants_paused: {
    en: () => "New Sibling 10% grants are paused, so this student pays the full fee for now.",
    sw: () => "Punguzo jipya la ndugu 10% limesimamishwa, kwa hiyo mwanafunzi huyu analipa ada kamili kwa sasa.",
  },
  result_out_of_step: {
    en: () => "This fee doesn’t match the sibling rule. Tell the Super Admin.",
    sw: () => "Ada hii hailingani na kanuni ya punguzo la ndugu. Mjulishe Super Admin.",
  },
}

export function reasonSentence(reason: SiblingReason, facts: SentenceFacts, lang: SentenceLanguage): string {
  return REASON_SENTENCES[reason][lang](facts)
}

// A note the reason already says is left out: the prior-sibling tick under
// `prior_sibling`, a waiting request under `request_pending`.
export function noteLines(
  reason: SiblingReason,
  notes: SiblingNote[],
  facts: SentenceFacts,
  lang: SentenceLanguage,
): { note: SiblingNote; text: string }[] {
  return notes
    .filter((note) => !(note === "prior_sibling_tick" && reason === "prior_sibling") && !(note === "request_pending" && reason === "request_pending"))
    .map((note) => ({ note, text: NOTE_LINES[note][lang](facts) }))
}

// What the fee chip on a member says.
export type FeeChip = { text: string; tone: "ok" | "wait" | "line" }

const FULL_FOR_NOW: readonly SiblingReason[] = [
  "request_pending",
  "request_needed",
  "request_refused",
  "legacy_no_sibling_enrolled",
  "no_full_payer",
]

export function feeChip(
  member: { reason: SiblingReason; result: "full" | "ten" | "none"; status: string; largerDiscount: LargerDiscount | null },
  lang: SentenceLanguage,
): FeeChip {
  if (member.largerDiscount) return { text: LARGER_DISCOUNTS[member.largerDiscount][lang], tone: "ok" }
  if (FULL_FOR_NOW.includes(member.reason) && member.status !== "Enrolled") {
    return { text: lang === "sw" ? "Ada kamili kwa sasa" : "Full fee for now", tone: "wait" }
  }
  if (member.reason === "declined" || member.reason === "closed") return { text: lang === "sw" ? "Hahesabiwi" : "Not counted", tone: "line" }
  if (member.result === "ten") return { text: lang === "sw" ? "Punguzo la ndugu 10%" : "Sibling 10%", tone: "ok" }
  return { text: lang === "sw" ? "Ada kamili" : "Full fee", tone: "line" }
}
