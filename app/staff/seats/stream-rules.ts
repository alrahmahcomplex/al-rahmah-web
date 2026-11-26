import { LEAD_CLASSES, type LeadClass, type StudentGender } from "@/lib/services/leads"
import type { ClassStreams, Stream, StreamRequest, StreamTakes, WaitingChild } from "@/lib/services/streams"

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
 * allocator (next_stream_label). A stream it overlaps with no label ("") reads
 * as the A, so A is skipped next to one. The database checks the label again
 * on save.
 */
export function nextLabel(streams: readonly { label: string; takes: StreamTakes }[], takes: StreamTakes): string {
  const taken = new Set(streams.filter((s) => labelsClash(s.takes, takes)).map((s) => s.label.toLowerCase()))
  if (taken.has("")) taken.add("a")
  for (let n = 0; ; n++) {
    const label = labelAt(n)
    if (!taken.has(label.toLowerCase())) return label
  }
}

/**
 * The label a sheet suggests for a new stream: none ("") while no stream of
 * the class overlaps who it takes, so a class's first stream is shown as the
 * class alone (owner 2026-11-26); otherwise the next free letter.
 */
export function suggestedLabel(streams: readonly { label: string; takes: StreamTakes }[], takes: StreamTakes): string {
  return streams.some((s) => labelsClash(s.takes, takes)) ? nextLabel(streams, takes) : ""
}

/**
 * The stream a label would clash with, if any. An empty label clashes with a
 * stream it overlaps that has none: only one may go without.
 */
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
  // The class's last stream that takes this need, which is full. Null when
  // no stream takes it: children with no Boy or girl answer in a class with
  // no Mixed stream.
  fullStream: Stream | null
  waiting: number
  // An open request for this class and need, the newest first.
  request: StreamRequest | null
  // The child other staff ask for, instead of the class: a class request for
  // any child counts Boys and Girls seats, so the database would refuse it
  // while one is free. Null where the class request is the right one.
  askFor: string | null
}

const takesNeed = (takes: StreamTakes, need: "Boys" | "Girls") => takes === "Mixed" || takes === need

// The database's stream_takes_child: a child with no Boy or girl answer fits Mixed only.
const takesChild = (takes: StreamTakes, gender: WaitingChild["gender"]) =>
  takes === "Mixed" || (takes === "Boys" && gender === "Boy") || (takes === "Girls" && gender === "Girl")

/**
 * What the children waiting leave behind once each takes their seat, in rank
 * order: the first stream by position that takes them and still has a free
 * seat. `unseated` are the children no stream has a seat for; `mixedSeatLeft`
 * is whether a Mixed stream still has one, the only kind a child with no Boy
 * or girl answer fits.
 *
 * This is the database's stream_fit, except that stream_fit serves a child
 * whose retry is pending before the others. The screen can't see retries, so
 * it may disagree with the database until the retry runs.
 */
export function afterQueue<T extends Pick<WaitingChild, "gender" | "rank">>(
  streams: readonly Stream[],
  waiting: readonly T[],
): { unseated: T[]; mixedSeatLeft: boolean; freeAfter: (stream: Stream) => number } {
  const ordered = streams.toSorted((a, b) => a.position - b.position)
  const free = new Map(ordered.map((s) => [s.id, s.seats - s.placed]))
  const freeIn = (s: Stream) => free.get(s.id) ?? 0
  const unseated: T[] = []
  for (const child of waiting.toSorted((a, b) => a.rank - b.rank)) {
    const seat = ordered.find((s) => takesChild(s.takes, child.gender) && freeIn(s) > 0)
    if (seat) free.set(seat.id, freeIn(seat) - 1)
    else unseated.push(child)
  }
  return { unseated, mixedSeatLeft: ordered.some((s) => s.takes === "Mixed" && freeIn(s) > 0), freeAfter: (s) => Math.max(0, freeIn(s)) }
}

/**
 * The notices for a year: for each class with streams, each need (boys, girls,
 * or any child when every stream is Mixed) whose streams are all full after
 * the children already waiting. A need no stream takes at all gets none: the
 * class isn't full for it, it simply has no stream for it. Children with no
 * Boy or girl answer are the exception, as only a Mixed stream takes them.
 */
export function seatNeeds(classes: readonly ClassStreams[], requests: readonly StreamRequest[]): SeatNeed[] {
  const needs: SeatNeed[] = []
  // A class of Mixed streams only takes any request for it: a request sent
  // from a child's page is recorded with the child's need, Boys or Girls.
  const openRequest = (className: LeadClass, need: "Boys" | "Girls" | null, anyNeed = false, stands: (r: StreamRequest) => boolean = () => true) =>
    requests
      .filter((r) => r.resolvedAt === null && r.className === className && (anyNeed || r.need === need) && stands(r))
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
          request: openRequest(each.className, null, true),
          askFor: null,
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
        askFor: null,
      })
    }
    // Only a Mixed stream takes a child with no Boy or girl answer, so the
    // class needs a stream for any child when the queue leaves such a child
    // without a seat, or leaves no Mixed seat for a request still open
    // (lead, 2026-11-18). Waiting, or an open request, doesn't say it alone:
    // a child whose row was busy waits for a retry, and their request stays
    // open, while a Mixed seat is free for them. Nor does `freeForAny`,
    // which counts Boys and Girls seats.
    const queue = afterQueue(ordered, each.waiting)
    const stuck = queue.unseated.filter((w) => w.gender === null)
    const seated = new Set(each.waiting.filter((w) => !queue.unseated.includes(w)).map((w) => w.leadId))
    // A request sent for a child the queue seats is about to close.
    const anyRequest = openRequest(each.className, null, false, (r) => !queue.mixedSeatLeft && !(r.leadId !== null && seated.has(r.leadId)))
    if (stuck.length > 0 || anyRequest) {
      needs.push({
        className: each.className,
        need: null,
        fullStream: ordered.filter((s) => s.takes === "Mixed").at(-1) ?? null,
        waiting: stuck.length,
        request: anyRequest,
        askFor: stuck[0]?.leadId ?? null,
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

// ---------------------------------------------------------------------------
// Changing who a stream takes (owner 2026-11-26, prototype v4): what the
// Change sheet shows before saving. The database's change_stream decides on
// save; this follows reconcile_class_seats so the sheet can say who moves
// where. It can disagree only when a payment or a retry changes the class
// while the sheet is open.
// ---------------------------------------------------------------------------

/** A child in the class with a seat or waiting for one. `rank` is their place in the class's order (null: last). */
export type SeatChild = { leadId: string; studentName: string; gender: StudentGender | null; rank: number | null }

/** The id the preview gives the stream the sheet would open. */
export const NEW_STREAM = "new"

export type TakesExtra = { kind: "open"; takes: StreamTakes; label: string; seats: number } | { kind: "raise"; streamId: string; seats: number }

export type TakesPlan = {
  // The class's streams, as they are now.
  streams: readonly Stream[]
  // The children placed in them, with their stream.
  placed: readonly (SeatChild & { streamId: string })[]
  // The children waiting for a seat in the class.
  waiting: readonly SeatChild[]
  change: { streamId: string; takes: StreamTakes; seats: number }
  extra?: TakesExtra | null
}

export type TakesPreview = {
  // Children who stay in the stream.
  staying: number
  // The children the stream no longer takes, in rank order, and where each goes (null: waits).
  leaving: { child: SeatChild; to: string | null }[]
  // Children waiting now who would take a seat, and where.
  fromWaiting: { child: SeatChild; to: string }[]
  // How many of `leaving` would have no seat.
  stranded: number
}

const byRank = (a: SeatChild, b: SeatChild) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.leadId.localeCompare(b.leadId)

/**
 * Who moves where if the stream took `change.takes`: children who still fit
 * stay; the others give their seat back; then the children already waiting,
 * and after them those moving, each in rank order, take the first stream by
 * position that takes them and has a seat.
 */
export function previewTakes(plan: TakesPlan): TakesPreview {
  const { change, extra } = plan
  const streams = plan.streams.map((s) => {
    if (s.id === change.streamId) return { ...s, takes: change.takes, seats: change.seats }
    if (extra?.kind === "raise" && s.id === extra.streamId) return { ...s, seats: extra.seats }
    return s
  })
  if (extra?.kind === "open") {
    const last = Math.max(0, ...streams.map((s) => s.position))
    streams.push({ id: NEW_STREAM, label: extra.label, takes: extra.takes, seats: extra.seats, position: last + 1, placed: 0, boys: 0, girls: 0, broughtUpFrom: null })
  }
  const ordered = streams.toSorted((a, b) => a.position - b.position)
  const free = new Map(ordered.map((s) => [s.id, s.seats]))
  const takesOf = new Map(ordered.map((s) => [s.id, s.takes]))
  const leavers: SeatChild[] = []
  let staying = 0
  for (const child of plan.placed) {
    const takes = takesOf.get(child.streamId)
    if (takes !== undefined && takesChild(takes, child.gender)) {
      free.set(child.streamId, (free.get(child.streamId) ?? 0) - 1)
      if (child.streamId === change.streamId) staying++
    } else if (child.streamId === change.streamId) leavers.push(child)
  }
  const seat = (child: SeatChild): string | null => {
    const found = ordered.find((s) => takesChild(s.takes, child.gender) && (free.get(s.id) ?? 0) > 0)
    if (!found) return null
    free.set(found.id, (free.get(found.id) ?? 0) - 1)
    return found.id
  }
  const fromWaiting: TakesPreview["fromWaiting"] = []
  for (const child of plan.waiting.toSorted(byRank)) {
    const to = seat(child)
    if (to) fromWaiting.push({ child, to })
  }
  const leaving = leavers.toSorted(byRank).map((child) => ({ child, to: seat(child) }))
  return { staying, leaving, fromWaiting, stranded: leaving.filter((m) => m.to === null).length }
}

/**
 * The fewest seats for the stream the sheet opens, or the stream it raises,
 * so nobody moving is left waiting. The children already waiting count, as
 * they take their seats first. Null when no number is enough: a child no
 * stream of that kind takes (no Boy or girl answer, outside a Mixed stream).
 */
export function seatsSoNobodyWaits(plan: TakesPlan & { extra: TakesExtra }): number | null {
  const least = plan.extra.kind === "open" ? 1 : (plan.streams.find((s) => s.id === (plan.extra as { streamId: string }).streamId)?.placed ?? 0)
  const most = least + plan.placed.length + plan.waiting.length
  for (let seats = least; seats <= most; seats++) {
    if (previewTakes({ ...plan, extra: { ...plan.extra, seats } }).stranded === 0) return seats
  }
  return null
}

/** The one Boy or girl answer every child moving shares, or null when they differ or one has none. */
export function movingGender(leaving: TakesPreview["leaving"]): StudentGender | null {
  const genders = new Set(leaving.map((m) => m.child.gender))
  if (genders.size !== 1) return null
  return leaving[0]?.child.gender ?? null
}
