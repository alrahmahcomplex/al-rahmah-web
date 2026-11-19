import type { SupabaseClient } from "@supabase/supabase-js"

import type { LeadClass, StudentGender } from "./leads"
import type { Result } from "./result"
import type { SeatPriority } from "./school-fee-payments"

// Streams (#449): groups inside a class and Enrollment year, such as FORM 1 A
// (Boys), each with its own seats for new students. A child holding a Seat
// priority is placed automatically in the first stream of their class, in
// order, that takes them and has a free seat. Every rule lives in the
// database (supabase/migrations/20270104100100_streams.sql and
// 20270107100100_streams_block.sql, ADR 0008); this file turns its answers
// into Results.

export const STREAM_TAKES = ["Boys", "Girls", "Mixed"] as const
export type StreamTakes = (typeof STREAM_TAKES)[number]

export type Stream = {
  id: string
  label: string
  takes: StreamTakes
  // Places for new students that year, not the stream's size.
  seats: number
  // The order the class's streams fill in, from 1.
  position: number
  placed: number
  broughtUpFrom: string | null
}

export type WaitingChild = {
  leadId: string
  admissionNumber: string
  studentName: string
  gender: StudentGender | null
  priority: SeatPriority
  // YYYY-MM-DD.
  reachedOn: string
  rank: number
}

export type ClassStreams = {
  className: LeadClass
  streams: Stream[]
  // Whether a boy, a girl and any child could take a seat now, after the
  // children already waiting take theirs.
  freeForBoy: boolean
  freeForGirl: boolean
  freeForAny: boolean
  waiting: WaitingChild[]
}

export type StreamRequest = {
  id: string
  className: LeadClass
  // Boys or Girls; null for any child.
  need: StreamTakes | null
  leadId: string | null
  studentName: string | null
  requestedByName: string
  requestedByRole: string | null
  requestedAt: string
  resolvedAt: string | null
  resolvedByStreamId: string | null
}

export type YearStreams = {
  year: number
  // Only the classes that have streams; a class with none has no limit.
  classes: ClassStreams[]
  // Open requests first.
  requests: StreamRequest[]
}

export type StreamError =
  "forbidden" | "not_found" | "seat_mode_legacy" | "no_schedule" | "label_taken" | "below_placed" | "not_full" | "invalid" | "unavailable"

type RpcError = { message: string; code?: string }

const KNOWN: ReadonlySet<string> = new Set<StreamError>(["seat_mode_legacy", "no_schedule", "label_taken", "below_placed", "not_full", "invalid", "not_found"])

function streamError(error: RpcError, doing: string): StreamError {
  if (error.message === "not_permitted" || error.message === "forbidden" || error.code === "42501") return "forbidden"
  if (error.code === "22P02") return "not_found"
  if (KNOWN.has(error.message)) return error.message as StreamError
  console.error(`Could not ${doing}`, error)
  return "unavailable"
}

type StreamRow = {
  id: string
  label: string
  takes: StreamTakes
  seats: number
  position: number
  placed: number
  brought_up_from: string | null
}

const toStream = (row: StreamRow): Stream => ({
  id: row.id,
  label: row.label,
  takes: row.takes,
  seats: row.seats,
  position: row.position,
  placed: Number(row.placed),
  broughtUpFrom: row.brought_up_from,
})

type YearStreamsRow = {
  enrollment_year: number
  classes: {
    class_name: LeadClass
    streams: StreamRow[]
    free_for_boy: boolean
    free_for_girl: boolean
    free_for_any: boolean
    waiting: {
      lead_id: string
      admission_number: string
      student_name: string
      gender: StudentGender | null
      priority: SeatPriority
      reached_on: string
      rank: number
    }[]
  }[]
  requests: {
    id: string
    class_name: LeadClass
    need: StreamTakes | null
    lead_id: string | null
    student_name: string | null
    requested_by_name: string
    requested_by_role: string | null
    requested_at: string
    resolved_at: string | null
    resolved_by_stream_id: string | null
  }[]
}

/** A year's streams, waiting children and requests. Needs payments.view. */
export async function getYearStreams(supabase: SupabaseClient, year: number): Promise<Result<YearStreams, StreamError>> {
  const { data, error } = await supabase.rpc("year_streams", {
    schedule_year: year,
  })
  if (error) return { ok: false, error: streamError(error, "read the streams") }
  const row = data as YearStreamsRow
  return {
    ok: true,
    data: {
      year: row.enrollment_year,
      classes: row.classes.map((each) => ({
        className: each.class_name,
        streams: each.streams.map(toStream),
        freeForBoy: each.free_for_boy,
        freeForGirl: each.free_for_girl,
        freeForAny: each.free_for_any,
        waiting: each.waiting.map((child) => ({
          leadId: child.lead_id,
          admissionNumber: child.admission_number,
          studentName: child.student_name,
          gender: child.gender,
          priority: child.priority,
          reachedOn: child.reached_on,
          rank: Number(child.rank),
        })),
      })),
      requests: row.requests.map((request) => ({
        id: request.id,
        className: request.class_name,
        need: request.need,
        leadId: request.lead_id,
        studentName: request.student_name,
        requestedByName: request.requested_by_name,
        requestedByRole: request.requested_by_role,
        requestedAt: request.requested_at,
        resolvedAt: request.resolved_at,
        resolvedByStreamId: request.resolved_by_stream_id,
      })),
    },
  }
}

export type NewStream = {
  year: number
  className: LeadClass
  label: string
  takes: StreamTakes
  seats: number
  // The form's own id: a retry hands back the stream already opened.
  requestId: string
}

/** Opens a stream at the end of its class's order. Needs academic_years.manage. */
export async function openStream(supabase: SupabaseClient, stream: NewStream): Promise<Result<Stream, StreamError>> {
  const { data, error } = await supabase.rpc("open_stream", {
    schedule_year: stream.year,
    class: stream.className,
    label: stream.label,
    takes: stream.takes,
    seats: stream.seats,
    request_id: stream.requestId,
  })
  if (error) return { ok: false, error: streamError(error, "open a stream") }
  return { ok: true, data: toStream(data as StreamRow) }
}

/** The database's count when it refuses seats below the children placed, read from the refusal's detail; null when absent. */
function placedFromDetail(details: unknown): number | null {
  if (typeof details !== "string") return null
  try {
    const placed = (JSON.parse(details) as { placed?: unknown }).placed
    return typeof placed === "number" && Number.isInteger(placed) && placed >= 0 ? placed : null
  } catch {
    return null
  }
}

/**
 * Corrects a stream's label and seats, never below the children placed. Needs
 * academic_years.manage. A `below_placed` refusal carries the database's count
 * at that moment, which may be higher than the screen showed.
 */
export async function editStream(
  supabase: SupabaseClient,
  change: { streamId: string; label: string; seats: number },
): Promise<Result<Stream, StreamError> | { ok: false; error: "below_placed"; placed: number | null }> {
  const { data, error } = await supabase.rpc("edit_stream", {
    stream_id: change.streamId,
    label: change.label,
    seats: change.seats,
  })
  if (error) {
    const code = streamError(error, "change a stream")
    if (code === "below_placed") return { ok: false, error: code, placed: placedFromDetail((error as { details?: unknown }).details) }
    return { ok: false, error: code }
  }
  return { ok: true, data: toStream(data as StreamRow) }
}

/** Brings the year before's streams up one class into `year`, with 0 seats. Needs academic_years.manage. */
export async function bringUpStreams(supabase: SupabaseClient, year: number, sources: string[]): Promise<Result<Stream[], StreamError>> {
  const { data, error } = await supabase.rpc("bring_up_streams", {
    schedule_year: year,
    sources,
  })
  if (error) return { ok: false, error: streamError(error, "bring up streams") }
  return { ok: true, data: (data as StreamRow[]).map(toStream) }
}

/**
 * Asks the Admissions Manager to open a new stream: for a child (their class,
 * year and need come from their record) or for a class and need. Needs
 * payments.view, and leads.view too for a child. Asking again hands back the
 * open request.
 */
export async function requestStream(
  supabase: SupabaseClient,
  target: { leadId: string } | { year: number; className: LeadClass; need: StreamTakes | null },
): Promise<Result<{ id: string; requestedAt: string }, StreamError>> {
  const args =
    "leadId" in target
      ? { lead_id: target.leadId, schedule_year: null, class: null, need: null }
      : {
          lead_id: null,
          schedule_year: target.year,
          class: target.className,
          need: target.need,
        }
  const { data, error } = await supabase.rpc("request_stream", args)
  if (error) return { ok: false, error: streamError(error, "send a stream request") }
  const row = data as { id: string; requested_at: string }
  return { ok: true, data: { id: row.id, requestedAt: row.requested_at } }
}

type StreamRef = {
  id: string
  class_name: LeadClass
  label: string
  takes: StreamTakes
}

export type SeatOutlook = {
  hasStreams: boolean
  gender: StudentGender | null
  priority: SeatPriority | null
  totalPaid: number
  placed: {
    id: string
    className: LeadClass
    label: string
    takes: StreamTakes
  } | null
  waiting: boolean
  // The stream a payment would place the child in now.
  wouldTake: {
    id: string
    className: LeadClass
    label: string
    takes: StreamTakes
  } | null
  // A school-fee payment is refused (no_class) until a stream can take them.
  blocked: boolean
  // What the child's payments must reach to book the seat (Q33 A), and why:
  // the deposit normally, the first share on a discounted fee, nothing on a
  // waived one. Null without a Fee schedule.
  booksAt: number | null
  booksKind: "deposit" | "first_share" | "full" | "waived" | null
  request: {
    id: string
    need: StreamTakes | null
    requestedByName: string
    requestedAt: string
    resolvedAt: string | null
  } | null
}

const toRef = (row: StreamRef | null) =>
  row
    ? {
        id: row.id,
        className: row.class_name,
        label: row.label,
        takes: row.takes,
      }
    : null

/** What Record payment shows about a child's seat. Needs leads.view and payments.view. */
export async function getSeatOutlook(supabase: SupabaseClient, leadId: string): Promise<Result<SeatOutlook, StreamError>> {
  const { data, error } = await supabase.rpc("lead_seat_outlook", {
    lead_id: leadId,
  })
  if (error) return { ok: false, error: streamError(error, "read a child's seat") }
  const row = data as {
    has_streams: boolean
    gender: StudentGender | null
    priority: SeatPriority | null
    total_paid: number | null
    placed: StreamRef | null
    waiting: boolean
    would_take: StreamRef | null
    blocked: boolean
    books_at: number | null
    books_kind: SeatOutlook["booksKind"]
    request: {
      id: string
      need: StreamTakes | null
      requested_by_name: string
      requested_at: string
      resolved_at: string | null
    } | null
  }
  return {
    ok: true,
    data: {
      hasStreams: row.has_streams,
      gender: row.gender,
      priority: row.priority,
      totalPaid: Number(row.total_paid ?? 0),
      placed: toRef(row.placed),
      waiting: row.waiting,
      wouldTake: toRef(row.would_take),
      blocked: row.blocked,
      booksAt: row.books_at === null ? null : Number(row.books_at),
      booksKind: row.books_kind,
      request: row.request
        ? {
            id: row.request.id,
            need: row.request.need,
            requestedByName: row.request.requested_by_name,
            requestedAt: row.request.requested_at,
            resolvedAt: row.request.resolved_at,
          }
        : null,
    },
  }
}

export type SeatStream = NonNullable<SeatOutlook["placed"]>

// Before streams are on this is always: not placed, nothing moves.
export type GenderOutlook = {
  // The stream the child is placed in now; null when not placed, or before streams are on.
  placed: SeatStream | null
  // The other answer takes them out of it.
  moves: boolean
  // Where they would move: null when no stream for the new answer has a free seat, so they would wait.
  wouldTake: SeatStream | null
}

/** What correcting a child's Boy or girl answer would do to their seat. Needs leads.view and leads.edit. */
export async function getGenderOutlook(supabase: SupabaseClient, leadId: string, gender: StudentGender): Promise<Result<GenderOutlook, StreamError>> {
  const { data, error } = await supabase.rpc("lead_gender_outlook", { lead_id: leadId, gender })
  if (error) return { ok: false, error: streamError(error, "read what a Boy or girl correction does") }
  const row = data as { placed: StreamRef | null; moves: boolean; would_take: StreamRef | null }
  return { ok: true, data: { placed: toRef(row.placed), moves: row.moves, wouldTake: toRef(row.would_take) } }
}

/** A stream as screens name it: its class, its label, and who it takes when it isn't Mixed ("FORM 1 B (Boys)"). */
export function streamName(className: LeadClass, label: string, takes: StreamTakes): string {
  return `${className} ${label}${takes === "Mixed" ? "" : ` (${takes})`}`
}
