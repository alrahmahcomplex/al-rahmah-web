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
  // "": no label; the stream is shown as its class alone (owner 2026-11-26).
  label: string
  takes: StreamTakes
  // Places for new students that year, not the stream's size.
  seats: number
  // The order the class's streams fill in, from 1.
  position: number
  placed: number
  // The boys and girls among them; the rest have no Boy or girl answer.
  // Only year_streams counts them; null from any other read, or from a
  // database without the count yet.
  boys: number | null
  girls: number | null
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
  | "forbidden"
  | "not_found"
  | "seat_mode_legacy"
  | "no_schedule"
  | "label_taken"
  | "below_placed"
  | "not_full"
  | "not_empty"
  | "invalid"
  | "unavailable"

type RpcError = { message: string; code?: string }

const KNOWN: ReadonlySet<string> = new Set<StreamError>([
  "seat_mode_legacy",
  "no_schedule",
  "label_taken",
  "below_placed",
  "not_full",
  "not_empty",
  "invalid",
  "not_found",
])

function streamError(error: RpcError, doing: string): StreamError {
  if (error.message === "not_permitted" || error.message === "forbidden" || error.code === "42501") return "forbidden"
  if (error.code === "22P02") return "not_found"
  if (KNOWN.has(error.message)) return error.message as StreamError
  console.error(`Could not ${doing}`, error)
  return "unavailable"
}

type StreamRow = {
  id: string
  // Null: no label.
  label: string | null
  takes: StreamTakes
  seats: number
  position: number
  placed: number
  boys?: number
  girls?: number
  brought_up_from: string | null
}

const toStream = (row: StreamRow): Stream => ({
  id: row.id,
  label: row.label ?? "",
  takes: row.takes,
  seats: row.seats,
  position: row.position,
  placed: Number(row.placed),
  boys: row.boys == null ? null : Number(row.boys),
  girls: row.girls == null ? null : Number(row.girls),
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
  // Empty: no label, allowed while no stream it overlaps has none.
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
    label: stream.label.trim() || null,
    takes: stream.takes,
    seats: stream.seats,
    request_id: stream.requestId,
  })
  if (error) return { ok: false, error: streamError(error, "open a stream") }
  return { ok: true, data: toStream(data as StreamRow) }
}

/** A refusal's detail as an object; empty when absent or unreadable. */
function detailOf(error: unknown): Record<string, unknown> {
  const details = (error as { details?: unknown }).details
  if (typeof details !== "string") return {}
  try {
    const parsed: unknown = JSON.parse(details)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The database's count when it refuses seats below the children placed, read from the refusal's detail; null when absent. */
function placedFromDetail(detail: Record<string, unknown>): number | null {
  const placed = detail.placed
  return typeof placed === "number" && Number.isInteger(placed) && placed >= 0 ? placed : null
}

export type StreamChange = {
  streamId: string
  label: string
  seats: number
  takes: StreamTakes
  // In the same save, for the children the stream no longer takes: open one
  // new stream in the class, or raise another stream's seats. Never both.
  open?: { takes: StreamTakes; label: string; seats: number; requestId: string }
  raise?: { streamId: string; seats: number }
}

export type StreamChanged = {
  stream: Stream
  opened: Stream | null
  // Each child the stream no longer takes, and the stream they sit in now (null: they wait).
  moved: { leadId: string; streamId: string | null }[]
  // Children who were waiting for a seat in the class and now have one.
  seatedFromWaiting: number
}

export type StreamChangeRefusal =
  | { ok: false; error: Exclude<StreamError, "below_placed" | "label_taken"> }
  // `placed`: the database's count at that moment, which may be higher than
  // the screen showed. `raised`: the refusal is about the stream being raised.
  | { ok: false; error: "below_placed"; placed: number | null; raised: boolean }
  // `opening`: the clash is the new stream's label.
  | { ok: false; error: "label_taken"; opening: boolean }

/**
 * Changes a stream's label, seats and who it takes, and in the same save opens
 * one new stream or raises another's seats (change_stream). Children the
 * stream no longer takes move to the first stream that takes them and has a
 * seat, after the children already waiting; with none, they wait. The seats
 * never go below the children who stay. Needs academic_years.manage.
 */
export async function changeStream(supabase: SupabaseClient, change: StreamChange): Promise<{ ok: true; data: StreamChanged } | StreamChangeRefusal> {
  const { data, error } = await supabase.rpc("change_stream", {
    stream_id: change.streamId,
    label: change.label.trim() || null,
    seats: change.seats,
    takes: change.takes,
    open_takes: change.open?.takes ?? null,
    open_label: change.open ? change.open.label.trim() || null : null,
    open_seats: change.open?.seats ?? null,
    open_request: change.open?.requestId ?? null,
    raise_stream: change.raise?.streamId ?? null,
    raise_seats: change.raise?.seats ?? null,
  })
  if (error) {
    const code = streamError(error, "change a stream")
    const detail = detailOf(error)
    if (code === "below_placed") return { ok: false, error: code, placed: placedFromDetail(detail), raised: detail.stream === "raise" }
    if (code === "label_taken") return { ok: false, error: code, opening: detail.field === "open_label" }
    return { ok: false, error: code }
  }
  const row = data as {
    stream: StreamRow
    opened: StreamRow | null
    moved: { lead_id: string; stream_id: string | null }[]
    seated_from_waiting: number
  }
  return {
    ok: true,
    data: {
      stream: toStream(row.stream),
      opened: row.opened ? toStream(row.opened) : null,
      moved: row.moved.map((m) => ({ leadId: m.lead_id, streamId: m.stream_id })),
      seatedFromWaiting: Number(row.seated_from_waiting),
    },
  }
}

export type PlacedChild = {
  leadId: string
  studentName: string
  gender: StudentGender | null
  className: LeadClass
  streamId: string
  // Their place in the class's order (1 first); null for a child the sync is about to release.
  rank: number | null
}

/** Every child placed in a stream of `year`, for the change sheet's preview. Needs academic_years.manage. */
export async function getYearStreamChildren(supabase: SupabaseClient, year: number): Promise<Result<PlacedChild[], StreamError>> {
  const { data, error } = await supabase.rpc("year_stream_children", { schedule_year: year })
  if (error) return { ok: false, error: streamError(error, "read the children in the streams") }
  return {
    ok: true,
    data: (data as { lead_id: string; student_name: string; gender: StudentGender | null; class_name: LeadClass; stream_id: string; rank: number | null }[]).map(
      (row) => ({
        leadId: row.lead_id,
        studentName: row.student_name,
        gender: row.gender,
        className: row.class_name,
        streamId: row.stream_id,
        rank: row.rank === null ? null : Number(row.rank),
      }),
    ),
  }
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

export type StreamDeleteRefusal =
  | { ok: false; error: Exclude<StreamError, "not_empty"> }
  // `placed`: the children in it at that moment, which the screen may not have shown.
  | { ok: false; error: "not_empty"; placed: number | null }

/**
 * Deletes a stream nobody is placed in, for good (delete_stream); the streams
 * after it move up one place. Needs academic_years.manage.
 */
export async function deleteStream(supabase: SupabaseClient, streamId: string): Promise<{ ok: true; data: Stream } | StreamDeleteRefusal> {
  const { data, error } = await supabase.rpc("delete_stream", { stream_id: streamId })
  if (error) {
    const code = streamError(error, "delete a stream")
    if (code === "not_empty") return { ok: false, error: code, placed: placedFromDetail(detailOf(error)) }
    return { ok: false, error: code }
  }
  return { ok: true, data: toStream(data as StreamRow) }
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
  label: string | null
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
        label: row.label ?? "",
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

/**
 * A stream as screens name it: its class, its label, and who it takes when it
 * isn't Mixed ("FORM 1 B (Boys)"). With no label, the class alone ("STD 1",
 * "FORM 1 (Girls)").
 */
export function streamName(className: LeadClass, label: string, takes: StreamTakes): string {
  return `${className}${label ? ` ${label}` : ""}${takes === "Mixed" ? "" : ` (${takes})`}`
}
