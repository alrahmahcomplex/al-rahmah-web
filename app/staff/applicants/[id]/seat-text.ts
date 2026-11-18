import type { LeadClass, StudentGender } from "@/lib/services/leads"
import type { SeatOutlook, SeatStream, StreamTakes } from "@/lib/services/streams"
import { streamName } from "@/lib/services/streams"

import { formatShillings } from "../../fees/format"

// The applicant page's words about a child's seat once streams are on (#449,
// prototype v42, and the lead's answers of 2026-11-18). v42 shows a boy;
// the same sentences serve a girl, and a child with no Boy or girl answer is
// named by their first name, never he or she, since nobody knows which.

export type SeatChild = { studentName: string; gender: StudentGender | null; className: LeadClass }

type Words = { he: string; He: string; him: string; his: string; His: string }

export const firstName = (child: Pick<SeatChild, "studentName">) => child.studentName.trim().split(/\s+/)[0] ?? child.studentName

/** How a sentence names the child: he or she from the answer, else the first name. */
export function words(child: Pick<SeatChild, "studentName" | "gender">): Words {
  if (child.gender === "Boy") return { he: "he", He: "He", him: "him", his: "his", His: "His" }
  if (child.gender === "Girl") return { he: "she", He: "She", him: "her", his: "her", His: "Her" }
  const first = firstName(child)
  return { he: first, He: first, him: first, his: `${first}’s`, His: `${first}’s` }
}

const forNeed = (gender: StudentGender) => (gender === "Boy" ? "boys" : "girls")

/** "a new FORM 1 stream for boys", or "a new Mixed FORM 1 stream" for a child with no answer. */
function newStream(child: SeatChild) {
  return child.gender ? `${child.className} stream for ${forNeed(child.gender)}` : `Mixed ${child.className} stream`
}

const takesChild = (takes: StreamTakes, gender: StudentGender | null) =>
  takes === "Mixed" || (takes === "Boys" && gender === "Boy") || (takes === "Girls" && gender === "Girl")

/** "A seat is booked once the deposit is paid.", or once an amount is paid; none for a waived fee. */
export function bookedSentence(outlook: Pick<SeatOutlook, "booksAt" | "booksKind">): string | null {
  if (outlook.booksKind === "deposit") return "A seat is booked once the deposit is paid."
  if ((outlook.booksKind === "first_share" || outlook.booksKind === "full") && outlook.booksAt !== null) {
    return `A seat is booked once TZS ${formatShillings(outlook.booksAt)} is paid.`
  }
  return null
}

/** Where a payment would place the child: "His seat will be in FORM 1 C (Boys), the first stream for boys with a free seat." */
export function seatWillBe(child: SeatChild, stream: SeatStream): string {
  const name = streamName(stream.className, stream.label, stream.takes)
  const which = child.gender ? `the first stream for ${forNeed(child.gender)} with a free seat` : "the first Mixed stream with a free seat"
  return `${words(child).His} seat will be in ${name}, ${which}.`
}

const list = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`)

/**
 * Why no stream can take the child, from the class's streams in order: each
 * stream that takes the child is full, each other one is for the other need.
 * "FORM 1 A (Girls) is for girls, and FORM 1 B (Boys) and FORM 1 C (Boys) are full."
 */
export function whyNoStream(child: SeatChild, streams: readonly { label: string; takes: StreamTakes; position: number }[]): string {
  const groups: { reason: string; names: string[] }[] = []
  for (const stream of streams.toSorted((a, b) => a.position - b.position)) {
    const reason = takesChild(stream.takes, child.gender) ? "full" : `for ${stream.takes.toLowerCase()}`
    const name = streamName(child.className, stream.label, stream.takes)
    const group = groups.find((g) => g.reason === reason)
    if (group) group.names.push(name)
    else groups.push({ reason, names: [name] })
  }
  const parts = groups.map((g) => `${list(g.names)} ${g.names.length === 1 ? "is" : "are"} ${g.reason}`)
  if (parts.length === 0) return ""
  const last = parts.length > 1 ? (groups.some((g) => g.names.length > 1) ? ", and " : " and ") : ""
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${last}${parts[parts.length - 1]}` : parts[0]}.`
}

/** The red note on Record payment: its bold lead and the rest. */
export function blockedNote(child: SeatChild, streams: readonly { label: string; takes: StreamTakes; position: number }[]) {
  const w = words(child)
  const why = whyNoStream(child, streams)
  const fix = child.gender
    ? `A new ${newStream(child)} must be opened before ${w.his} school fee can be recorded.`
    : `A new ${newStream(child)} must be opened, or ${firstName(child)}’s Boy or girl answer given, before ${firstName(child)}’s school fee can be recorded.`
  return { title: `No stream can take ${w.him} yet.`, text: [why, fix].filter(Boolean).join(" ") }
}

/** A child holding a Seat priority with no seat: "He will wait until a FORM 1 stream for boys opens or a seat frees. …" */
export function waitingNote(child: SeatChild) {
  const w = words(child)
  const keeps = child.gender ? `${w.He} keeps ${w.his} Seat priority` : `${w.He} keeps the Seat priority`
  return {
    title: `No stream can take ${w.him} yet.`,
    text: `${w.He} will wait until a ${child.gender ? newStream(child) : `Mixed ${child.className} stream`} opens or a seat frees. ${keeps} and can keep paying.`,
  }
}

/** After a payment that places the child: "First instalment recorded." and the stream. */
export function placedNote(priority: string, stream: SeatStream) {
  return { title: `${priority} recorded.`, stream: streamName(stream.className, stream.label, stream.takes) }
}

/**
 * After a payment below what books the seat (Q33 A): it is recorded and books
 * nothing; the next payment waits if another child takes the seat first.
 */
export function belowBookingNote(
  child: SeatChild,
  { amount, totalPaid, booksAt, booksKind, wouldTake }: { amount: number; totalPaid: number; booksAt: number; booksKind: "deposit" | "first_share" | "full"; wouldTake: SeatStream | null },
) {
  const w = words(child)
  const first = firstName(child)
  const booked = bookedSentence({ booksAt, booksKind }) ?? ""
  const of = booksKind === "deposit" ? `the ${formatShillings(booksAt)} deposit` : `the ${formatShillings(booksAt)} that books the seat`
  const other = wouldTake?.takes === "Boys" ? "boy" : wouldTake?.takes === "Girls" ? "girl" : "child"
  const pays = booksKind === "deposit" ? "pays the deposit first" : "pays first"
  return {
    title: `TZS ${formatShillings(amount)} recorded. ${booked}`.trim(),
    text:
      `${first} has paid ${formatShillings(totalPaid)} of ${of}, so ${w.he} has no seat yet. ` +
      `If another ${other} ${pays} and takes the last seat, ${first}’s next payment waits until a stream has room. ` +
      `The ${formatShillings(amount)} stays recorded either way.`,
  }
}

/** The warning before a Boy or girl correction moves a placed child. Pronouns follow the new answer. */
export function genderMoveWarning(
  child: Pick<SeatChild, "studentName" | "className">,
  gender: StudentGender,
  { placed, wouldTake }: { placed: SeatStream; wouldTake: SeatStream | null },
) {
  const w = words({ studentName: child.studentName, gender })
  const from = streamName(placed.className, placed.label, placed.takes)
  return {
    title: `This moves ${w.him} out of ${from}.`,
    text: wouldTake
      ? `${w.He} takes a seat in ${streamName(wouldTake.className, wouldTake.label, wouldTake.takes)}, the first stream for ${forNeed(gender)} with a free seat.`
      : `No ${child.className} stream for ${forNeed(gender)} has a free seat, so ${w.he} waits for a stream.`,
  }
}

/** The note under a Boy or girl answer not given yet. */
export function noAnswerNote(child: SeatChild, classStreams: readonly { takes: StreamTakes }[] | null): string {
  const first = firstName(child)
  const allMixed = classStreams !== null && classStreams.length > 0 && classStreams.every((s) => s.takes === "Mixed")
  return `Without an answer ${first} fits Mixed streams only.${allMixed ? ` Every ${child.className} stream is Mixed, so nothing changes for ${first} today.` : ""}`
}

/** The hint in the Boy or girl sheet. */
export function genderHint(child: Pick<SeatChild, "studentName" | "gender">): string {
  const where = child.gender ? `${words(child).his} record` : "the record"
  return `Saved on ${where}. A Boy or girl answer can be changed but not cleared.`
}
