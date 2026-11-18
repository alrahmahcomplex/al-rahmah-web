import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import type { ClassStreams, Stream, StreamRequest, StreamTakes } from "@/lib/services/streams"

// The Seats screen's own reading of a year's streams (#449, prototype v42).
// The database decides every seat (ADR 0008); these only shape what the
// screen suggests and which notices it shows.

/** Whether two streams of one class may not share a label: Mixed clashes with every stream, Boys with Boys, Girls with Girls. */
export function labelsClash(a: StreamTakes, b: StreamTakes): boolean {
  return a === "Mixed" || b === "Mixed" || a === b
}

/** The n-th label from 0: A … Z, then AA, AB … AZ, BA … */
export function labelAt(n: number): string {
  let label = ""
  for (let rest = n + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    label = String.fromCharCode(65 + ((rest - 1) % 26)) + label
  }
  return label
}

/**
 * The first free label for a new stream that takes `takes`: the database's
 * allocator (next_stream_label), as the open sheet's suggestion. The
 * database checks the label again on save.
 */
export function nextLabel(streams: readonly { label: string; takes: StreamTakes }[], takes: StreamTakes): string {
  const taken = new Set(streams.filter((s) => labelsClash(s.takes, takes)).map((s) => s.label.toLowerCase()))
  for (let n = 0; ; n++) {
    const label = labelAt(n)
    if (!taken.has(label.toLowerCase())) return label
  }
}

/** The stream a new label would clash with, if any. */
export function clashingStream<T extends { label: string; takes: StreamTakes }>(streams: readonly T[], label: string, takes: StreamTakes): T | null {
  const wanted = label.trim().toLowerCase()
  return streams.find((s) => s.label.toLowerCase() === wanted && labelsClash(s.takes, takes)) ?? null
}

/** The faint seats for a new stream: the seats of the class's latest stream with places, or none. */
export function placeholderSeats(streams: readonly Stream[]): number | null {
  const withPlaces = streams.filter((s) => s.seats > 0).toSorted((a, b) => b.position - a.position)
  return withPlaces[0]?.seats ?? null
}

/** A class and need with no free seat now, for a notice on Seats. `need` null is any child (a class of Mixed streams only). */
export type SeatNeed = {
  className: LeadClass
  need: "Boys" | "Girls" | null
  // The class's last stream that takes this need, which is full.
  fullStream: Stream
  waiting: number
  // An open request for this class and need, the newest first.
  request: StreamRequest | null
}

const takesNeed = (takes: StreamTakes, need: "Boys" | "Girls") => takes === "Mixed" || takes === need

/**
 * The notices for a year: for each class with streams, each need (boys, girls,
 * or any child when every stream is Mixed) whose streams are all full after
 * the children already waiting. A need no stream takes at all gets none: the
 * class isn't full for it, it simply has no stream for it.
 */
export function seatNeeds(classes: readonly ClassStreams[], requests: readonly StreamRequest[]): SeatNeed[] {
  const needs: SeatNeed[] = []
  const openRequest = (className: LeadClass, need: "Boys" | "Girls" | null) =>
    requests
      .filter((r) => r.resolvedAt === null && r.className === className && r.need === need)
      .toSorted((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null
  for (const each of classes) {
    const ordered = each.streams.toSorted((a, b) => a.position - b.position)
    if (ordered.length === 0) continue
    if (ordered.every((s) => s.takes === "Mixed")) {
      if (!each.freeForAny) {
        needs.push({
          className: each.className,
          need: null,
          fullStream: ordered[ordered.length - 1],
          waiting: each.waiting.length,
          request: openRequest(each.className, null),
        })
      }
      continue
    }
    for (const need of ["Boys", "Girls"] as const) {
      const taking = ordered.filter((s) => takesNeed(s.takes, need))
      const free = need === "Boys" ? each.freeForBoy : each.freeForGirl
      if (taking.length === 0 || free) continue
      const waiting = each.waiting.filter((w) => (need === "Boys" ? w.gender === "Boy" : w.gender === "Girl")).length
      needs.push({
        className: each.className,
        need,
        fullStream: taking[taking.length - 1],
        waiting,
        request: openRequest(each.className, need),
      })
    }
  }
  return needs
}

/** The class a stream of the year before comes up into, or null for FORM 4 (there is no FORM 5). */
export function nextClass(className: LeadClass): LeadClass | null {
  const at = LEAD_CLASSES.indexOf(className)
  return at < 0 || at + 1 >= LEAD_CLASSES.length ? null : LEAD_CLASSES[at + 1]
}

export type BringUpRow = {
  source: Stream & { className: LeadClass }
  toClass: LeadClass
  label: string
  renamed: boolean
}

/**
 * What Bring up would do, for the list the Manager checks before saving: each
 * stream of the year before not yet brought up and not FORM 4, in class and
 * position order, moving up one class with its label, or the next free one
 * when the new class already has it. The database does the same on save.
 */
export function bringUpPlan(previous: readonly ClassStreams[], current: readonly ClassStreams[]): BringUpRow[] {
  const broughtUp = new Set(current.flatMap((c) => c.streams.map((s) => s.broughtUpFrom)).filter(Boolean))
  const taken = new Map<LeadClass, { label: string; takes: StreamTakes }[]>(
    current.map((c) => [c.className, c.streams.map((s) => ({ label: s.label, takes: s.takes }))]),
  )
  const rows: BringUpRow[] = []
  const sources = previous
    .toSorted((a, b) => LEAD_CLASSES.indexOf(a.className) - LEAD_CLASSES.indexOf(b.className))
    .flatMap((c) => c.streams.toSorted((a, b) => a.position - b.position).map((s) => ({ ...s, className: c.className })))
  for (const source of sources) {
    const toClass = nextClass(source.className)
    if (!toClass || broughtUp.has(source.id)) continue
    const there = taken.get(toClass) ?? []
    const renamed = clashingStream(there, source.label, source.takes) !== null
    const label = renamed ? nextLabel(there, source.takes) : source.label
    taken.set(toClass, [...there, { label, takes: source.takes }])
    rows.push({ source, toClass, label, renamed })
  }
  return rows
}

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Africa/Dar_es_Salaam",
})

/** A moment as Tanzania's clock shows it: "09:40". */
export function tanzaniaTime(iso: string): string {
  return TIME.format(new Date(iso))
}
