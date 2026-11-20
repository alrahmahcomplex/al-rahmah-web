import type { LeadHistoryEntry } from "@/lib/services/audit"

import { becauseText } from "./because"
import { collapseSaves } from "./row-sequence"

// A lead's seat in a stream and its requests for a new stream in its history
// (#428), for describe.ts. The owner approved these words in the History
// wording prototype (https://claude.ai/artifact/JM7ytTjshMVquXW7N7QPub).
// Streams are named by `streamNames`, which the history reads alongside; a
// stream it couldn't name shows its id.

const SEAT = "seat_placements"
const REQUEST = "stream_requests"

// Each table's fields in the order an entry lists them, with their labels.
const LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // The stream itself is named in the summary.
  [SEAT]: { cause: "Because" },
  [REQUEST]: { class_name: "Class", enrollment_year: "Enrollment year", need: "Needs", resolved_by_stream_id: "Stream opened" },
}

// The waiting fields keep the queue's order and the class and year the lead
// already shows; the entry's own time and staff name say the rest.
const HIDDEN: Readonly<Record<string, ReadonlySet<string>>> = {
  [SEAT]: new Set(["lead_id", "stream_id", "waiting_since", "waiting_xid", "waiting_year", "waiting_class", "changed_at"]),
  [REQUEST]: new Set(["lead_id", "requested_by", "requested_at", "resolved_at"]),
}

const NEEDS: Readonly<Record<string, string>> = {
  Boys: "A stream for boys",
  Girls: "A stream for girls",
}

export function seatLabel(record: string | null, field: string): string | null {
  return LABELS[record ?? ""]?.[field] ?? null
}

export function seatHidden(record: string | null, field: string): boolean {
  return HIDDEN[record ?? ""]?.has(field) ?? false
}

export function seatOrder(record: string | null): readonly string[] | null {
  const labels = LABELS[record ?? ""]
  return labels ? Object.keys(labels) : null
}

// A request for the whole class with no need is for any stream; a new
// request still says so. A child's request takes its need from the child's
// Boy or girl answer. With no answer only a Mixed stream takes the child, so
// "Any stream" would be untrue, and the line is left out.
export function seatKeepsEmpty(entry: LeadHistoryEntry, field: string): boolean {
  const forChild = entry.changes.some((c) => c.field === "lead_id" && c.to !== null && c.to !== undefined)
  return entry.record === REQUEST && field === "need" && !forChild
}

export function seatValue(record: string | null, field: string, value: unknown, streamNames: Readonly<Record<string, string>>): string | null {
  if (record === REQUEST && field === "need") return value === null || value === undefined ? "Any stream" : (NEEDS[String(value)] ?? null)
  if (value === null || value === undefined) return null
  if (record === SEAT && field === "cause") return becauseText("seat", value)
  if (record === REQUEST && field === "resolved_by_stream_id") return streamNames[String(value)] ?? null
  return null
}

// A database time as microseconds since 1970, or null for anything else.
// The database keeps microseconds, which Date.parse drops, and writes one
// instant several ways: with the fraction's trailing zeros trimmed, and with
// Z, +00:00 or the offset of the session that wrote it.
const TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/

function microseconds(time: unknown): number | null {
  const parts = typeof time === "string" ? TIME.exec(time) : null
  if (!parts) return null
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number)
  const fraction = parts[7] ?? ""
  const sign = parts[8]
  const offsetHours = Number(parts[9] ?? 0)
  const offsetMinutes = Number(parts[10] ?? 0)
  // Date.UTC rolls a part that is too large over into the next month, day or
  // hour, so 31 November would read as 1 December. Such a time is unreadable.
  // Day 0 of the next month is this month's last day.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > lastDay) return null
  if (hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59) return null
  const offset = (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes)
  const wholeSeconds = Date.UTC(year, month - 1, day, hour, minute, second) / 1000 - offset * 60
  return wholeSeconds * 1_000_000 + Number(fraction.padEnd(6, "0"))
}

// A request closes when a seat that fits comes up: in a stream opened just
// then, or in one that was already there (its seats were raised, or a child
// left it). "Stream opened" is true only of the first. Opening a stream
// closes the requests it answers in the same save, and the database gives
// both rows that save's time (now() in open_stream and
// resolve_stream_requests). So the line shows only when the stream's opening
// time and the request's closing time are the same instant, to the
// microsecond. A stream opened after the request was sent proves nothing: it
// may have filled, and closed the request days later when a seat was added.
// The line is hidden when either time isn't here, and for a request the
// database closed in a later save because its child's row was busy; the
// summary already says the request closed.
export type StreamOpenings = ReadonlySet<number>

// The entries that close a request in the save that opened their stream.
export function streamOpenings(entries: readonly LeadHistoryEntry[], openedAt: Readonly<Record<string, string>>): StreamOpenings {
  const openings = new Set<number>()
  for (const entry of entries) {
    if (entry.record !== REQUEST) continue
    const stream = entry.changes.find((c) => c.field === "resolved_by_stream_id")?.to
    const opened = typeof stream === "string" ? microseconds(openedAt[stream]) : null
    const closed = microseconds(entry.changes.find((c) => c.field === "resolved_at")?.to)
    if (opened !== null && opened === closed) openings.add(entry.id)
  }
  return openings
}

export function unprovenOpening(entry: LeadHistoryEntry, field: string, openings: StreamOpenings): boolean {
  return entry.record === REQUEST && field === "resolved_by_stream_id" && !openings.has(entry.id)
}

// A move between streams is saved as a release and then a placement (the
// gender or class reconciliation): one save reads as one move, saying why
// the child left the old stream.
export function collapseSeatSaves(entries: readonly LeadHistoryEntry[]): LeadHistoryEntry[] {
  return collapseSaves(entries, SEAT, "changed_at", "first")
}

export function seatSummary(entry: LeadHistoryEntry, streamNames: Readonly<Record<string, string>>): string | null {
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  const name = (id: unknown) => streamNames[String(id)] ?? String(id)

  if (entry.record === SEAT) {
    if (entry.action !== "insert" && entry.action !== "update") return entry.action
    const stream = changed.get("stream_id")
    const waiting = changed.get("waiting_since")
    if (stream?.to) return stream.from ? `moved the applicant from ${name(stream.from)} to ${name(stream.to)}` : `placed the applicant in ${name(stream.to)}`
    // A new row holds a stream or a place in the queue. A change that joins
    // the queue, or moves in it, writes a new waiting time; any other change
    // with no stream releases the seat.
    if (entry.action === "insert" || waiting?.to) return "put the applicant on Waiting for a stream"
    return "released the applicant’s seat"
  }

  if (entry.record === REQUEST) {
    if (entry.action === "insert") return "sent a request to open a new stream"
    if (entry.action === "update" && changed.get("resolved_at")?.to) return "closed the request for a new stream"
    return entry.action
  }
  return null
}
