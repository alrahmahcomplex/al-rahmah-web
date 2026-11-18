import {
  feeChip,
  NO_FACTS,
  NOTE_LINES,
  noteLines,
  reasonSentence,
  type FeeChip,
  type SentenceFacts,
  type SentenceLanguage,
} from "./sibling-sentences"
import type { SiblingGroupExplanation, SiblingMemberExplanation, SiblingNote } from "./services/sibling-counts"
import type { SiblingBasis } from "./services/sibling-groups"

// The sibling group on a lead's record (#310): each member with its fee chip
// and the sentence saying why, in English and Swahili, from what
// explain_sibling_group answers. Plain data, so a server read builds it and
// a client card shows it.

type Both<T> = Record<SentenceLanguage, T>

export type SiblingMemberView = {
  leadId: string
  studentName: string
  firstName: string
  status: string
  // The lead the record is about.
  here: boolean
  // "STD 4 · Enrolled · same father’s name".
  meta: string
  chip: Both<FeeChip>
  sentence: Both<string>
  notes: { note: SiblingNote; text: Both<string> }[]
}

// What the explanation doesn't hold, read beside it.
export type SiblingViewExtras = {
  // Student names of leads the reasons name from outside the group, such as
  // the sibling a request across groups names.
  names: Readonly<Record<string, string>>
  // Inactive or Archived, for members with a closure mark.
  closures: Readonly<Record<string, "Inactive" | "Archived">>
  // The ticked sibling, "Name, CLASS", for members with the prior-sibling tick.
  priorSiblings: Readonly<Record<string, string>>
  // Whether the full payer's fee ties with a sibling's (sibling_full_payer_tie).
  fullPayerTie: boolean | null
  // "18 Nov 2026" for a timestamp.
  formatDate: (at: string) => string
}

export const firstName = (studentName: string) => studentName.trim().split(/\s+/)[0] ?? studentName

const BASIS_WORDS: Record<SiblingBasis, string> = {
  matched: "same father’s name",
  typo_confirmed: "typing mistake confirmed",
  request_needed: "fathers’ names don’t match",
  granted: "proof granted by the Manager",
  refused: "Sibling request refused",
}

// Whether a member counts as a sibling: legacy, or by its name or a grant,
// and open.
export const counts = (m: SiblingMemberExplanation) =>
  m.leadOpen && (m.legacy || m.basis === "matched" || m.basis === "typo_confirmed" || m.basis === "granted")

export function factsFor(m: SiblingMemberExplanation, group: SiblingGroupExplanation, extras: SiblingViewExtras): SentenceFacts {
  const nameOf = (id: string) => firstName(group.members.find((x) => x.leadId === id)?.studentName ?? extras.names[id] ?? "")
  const payerId =
    m.reason === "full_payer_sibling" || m.reason === "enrolled_ten_full_payer_waiting" ? (m.becauseOf[0] ?? null) : group.fullPayerLeadId
  return {
    ...NO_FACTS,
    siblings:
      m.reason === "prior_sibling"
        ? extras.priorSiblings[m.leadId]
          ? [extras.priorSiblings[m.leadId]]
          : []
        : m.becauseOf.map(nameOf).filter(Boolean),
    fullPayer: payerId ? nameOf(payerId) : "",
    staff: m.feeEdit?.staffName ?? "",
    date: m.feeEdit ? extras.formatDate(m.feeEdit.createdAt) : "",
    reason: m.feeEdit?.reason ?? null,
    closure: extras.closures[m.leadId] ?? null,
    kept: m.lockedResult,
    larger: m.largerDiscount,
    highest: m.highestFee,
    equal: m.fullPayer && m.highestFee === true && extras.fullPayerTie === true,
    others: group.members.some((o) => o.leadId !== m.leadId && counts(o)),
    grantedOn: m.decidedRequest?.state === "granted" ? extras.formatDate(m.decidedRequest.decidedAt) : "",
  }
}

export function describeSiblingGroup(
  group: SiblingGroupExplanation,
  extras: SiblingViewExtras,
  // The lead whose record shows the group.
  hereLeadId: string,
): SiblingMemberView[] {
  return group.members.map((m) => {
    const facts = factsFor(m, group, extras)
    const here = m.leadId === hereLeadId
    const basis = group.groupId ? (m.legacy ? "old family rule" : m.basis ? BASIS_WORDS[m.basis] : "") : ""
    const meta = [m.className, m.status, basis].filter(Boolean).join(" · ") + (here && group.groupId ? " · this student" : "")
    // While new grants are paused, the rule's 10% is held back: the pause is
    // the reason the student pays what the tag says, so it says why.
    const paused = m.notes.includes("grants_paused")
    const notes = paused ? m.notes.filter((n) => n !== "grants_paused") : m.notes
    const en = noteLines(m.reason, notes, facts, "en")
    const sw = noteLines(m.reason, notes, facts, "sw")
    const heldBack = (lang: "en" | "sw") =>
      paused && m.status !== "Enrolled" && !m.largerDiscount
        ? { text: lang === "sw" ? "Ada kamili kwa sasa" : "Full fee for now", tone: "wait" as const }
        : feeChip(m, lang)
    return {
      leadId: m.leadId,
      studentName: m.studentName,
      firstName: firstName(m.studentName),
      status: m.status,
      here,
      meta,
      chip: { en: heldBack("en"), sw: heldBack("sw") },
      sentence: paused
        ? { en: NOTE_LINES.grants_paused.en(facts), sw: NOTE_LINES.grants_paused.sw(facts) }
        : { en: reasonSentence(m.reason, facts, "en"), sw: reasonSentence(m.reason, facts, "sw") },
      notes: en.map((line, i) => ({ note: line.note, text: { en: line.text, sw: sw[i].text } })),
    }
  })
}

// The lead ids a group's reasons name that the group itself doesn't hold.
export function outsideNames(group: SiblingGroupExplanation): string[] {
  const inside = new Set(group.members.map((m) => m.leadId))
  return [...new Set(group.members.flatMap((m) => m.becauseOf).filter((id) => !inside.has(id)))]
}
