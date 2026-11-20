import type { LeadHistoryEntry } from "@/lib/services/audit"

import { becauseText } from "./because"

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

// A request for any stream has no need; a new request still says so.
export function seatKeepsEmpty(record: string | null, field: string): boolean {
  return record === REQUEST && field === "need"
}

export function seatValue(record: string | null, field: string, value: unknown, streamNames: Readonly<Record<string, string>>): string | null {
  if (record === REQUEST && field === "need") return value === null || value === undefined ? "Any stream" : (NEEDS[String(value)] ?? null)
  if (value === null || value === undefined) return null
  if (record === SEAT && field === "cause") return becauseText("seat", value)
  if (record === REQUEST && field === "resolved_by_stream_id") return streamNames[String(value)] ?? null
  return null
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
