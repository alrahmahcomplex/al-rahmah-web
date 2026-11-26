"use server"

import { revalidatePath } from "next/cache"

import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import {
  bringUpStreams,
  changeStream,
  deleteStream,
  getSeatOutlook,
  openStream,
  requestStream,
  STREAM_TAKES,
  type StreamError,
  type StreamTakes,
} from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

// Seats, once streams are on (#449, prototype v42): open, change, bring up and
// delete streams, and ask the Admissions Manager for one. The database checks every
// permission and rule again; these turn its answers into the screen's words.

// `childCanPay`: opened from a child’s Record payment, whether a school-fee
// payment by them would now go through, as the database reads it after the
// opening (children already waiting take the new seats first).
export type StreamOutcome = { status: "done"; message: string; childCanPay?: boolean } | { status: "refused"; message: string }

// Seats, and every applicant page, whose Record payment reads the streams.
function revalidateSeats() {
  revalidatePath("/staff/seats")
  revalidatePath("/staff/applicants/[id]", "page")
}

const LOST = "The change could not be saved just now. Try again in a moment."

// A label refusal in the screen's words. An empty label is refused when a
// stream of the class it overlaps already has none (owner 2026-11-26).
function labelTaken(label: string, newStream = false): string {
  if (label.trim() === "") return `Another stream of this class already has no label, so ${newStream ? "the new stream" : "this one"} needs one.`
  return newStream ? "That label is already taken in this class. Choose another label for the new stream." : "That label is already taken in this class. Choose another label."
}

function refused(error: StreamError): StreamOutcome {
  switch (error) {
    case "forbidden":
      return {
        status: "refused",
        message: "Only the Admissions Manager can open a new stream.",
      }
    case "label_taken":
      return {
        status: "refused",
        message: "That label is already taken in this class. Choose another label.",
      }
    case "no_schedule":
      return {
        status: "refused",
        message: "This year has no fee schedule yet.",
      }
    default:
      return { status: "refused", message: LOST }
  }
}

const isClass = (value: unknown): value is LeadClass => typeof value === "string" && (LEAD_CLASSES as readonly string[]).includes(value)
const isTakes = (value: unknown): value is StreamTakes => typeof value === "string" && (STREAM_TAKES as readonly string[]).includes(value)
const isWhole = (value: unknown, least: number) => typeof value === "number" && Number.isInteger(value) && value >= least && value <= 100_000

export async function openStreamAction(input: {
  year: number
  className: string
  label: string
  takes: string
  seats: number
  requestId: string
  name: string
  forLeadId?: string
}): Promise<StreamOutcome> {
  if (!isWhole(input.year, 2000) || !isClass(input.className) || !isTakes(input.takes) || !isWhole(input.seats, 1) || typeof input.label !== "string") {
    return { status: "refused", message: LOST }
  }
  const supabase = await createClient()
  const opened = await openStream(supabase, {
    year: input.year,
    className: input.className,
    label: input.label.trim(),
    takes: input.takes,
    seats: input.seats,
    requestId: input.requestId,
  })
  if (!opened.ok) return opened.error === "label_taken" ? { status: "refused", message: labelTaken(input.label) } : refused(opened.error)
  revalidateSeats()
  const message = `${input.name} is open with ${opened.data.seats} seats.`
  if (typeof input.forLeadId !== "string") return { status: "done", message }
  const outlook = await getSeatOutlook(supabase, input.forLeadId)
  return { status: "done", message, childCanPay: outlook.ok && !outlook.data.blocked }
}

// What a saved change did, for the sheet's message: the stream as saved, the
// stream opened with it, each child the stream no longer takes and where they
// sit now (null: waiting), and how many waiting children took a seat.
export type ChangeOutcome =
  | {
      status: "done"
      stream: { label: string; takes: StreamTakes; seats: number }
      opened: { id: string; label: string; takes: StreamTakes } | null
      moved: { leadId: string; streamId: string | null }[]
      seatedFromWaiting: number
    }
  | { status: "refused"; message: string }

export async function changeStreamAction(input: {
  streamId: string
  label: string
  seats: number
  takes: string
  // Names for the refusals: the stream (as it would be saved) and the stream being raised.
  name: string
  raiseName?: string
  open?: { takes: string; label: string; seats: number; requestId: string }
  raise?: { streamId: string; seats: number }
}): Promise<ChangeOutcome> {
  const open = input.open
  const raise = input.raise
  if (
    typeof input.streamId !== "string" ||
    typeof input.label !== "string" ||
    !isWhole(input.seats, 0) ||
    !isTakes(input.takes) ||
    (open && (!isTakes(open.takes) || typeof open.label !== "string" || !isWhole(open.seats, 1) || typeof open.requestId !== "string")) ||
    (raise && (typeof raise.streamId !== "string" || !isWhole(raise.seats, 0))) ||
    (open && raise)
  ) {
    return { status: "refused", message: LOST }
  }
  const supabase = await createClient()
  const changed = await changeStream(supabase, {
    streamId: input.streamId,
    label: input.label.trim(),
    seats: input.seats,
    takes: input.takes,
    open: open && isTakes(open.takes) ? { takes: open.takes, label: open.label.trim(), seats: open.seats, requestId: open.requestId } : undefined,
    raise,
  })
  if (!changed.ok) {
    if (changed.error === "below_placed") {
      // The database's count: a payment may have placed a child since the sheet opened.
      revalidateSeats()
      const placed = changed.placed
      if (changed.raised) {
        const n = placed ?? raise?.seats ?? 0
        return {
          status: "refused",
          message: `${input.raiseName ?? "That stream"} has ${n} ${n === 1 ? "child" : "children"} placed. The seats can’t go below ${n}.`,
        }
      }
      return {
        status: "refused",
        message:
          placed === null
            ? "More children stay in this stream than those seats. Type more seats."
            : `${placed} ${placed === 1 ? "child stays" : "children stay"} in ${input.name}, so the seats can’t go below ${placed}.`,
      }
    }
    if (changed.error === "label_taken") {
      return {
        status: "refused",
        message: changed.opening ? labelTaken(open?.label ?? "", true) : labelTaken(input.label),
      }
    }
    if (changed.error === "forbidden") return { status: "refused", message: "Only the Admissions Manager can change a stream." }
    return { status: "refused", message: refused(changed.error).message }
  }
  revalidateSeats()
  const { stream, opened, moved, seatedFromWaiting } = changed.data
  return {
    status: "done",
    stream: { label: stream.label, takes: stream.takes, seats: stream.seats },
    opened: opened ? { id: opened.id, label: opened.label, takes: opened.takes } : null,
    moved,
    seatedFromWaiting,
  }
}

/** Deletes a stream nobody is placed in, for good (owner 2026-11-26). */
export async function deleteStreamAction(input: { streamId: string; name: string }): Promise<StreamOutcome> {
  if (typeof input.streamId !== "string" || typeof input.name !== "string") return { status: "refused", message: LOST }
  const supabase = await createClient()
  const deleted = await deleteStream(supabase, input.streamId)
  if (!deleted.ok) {
    if (deleted.error === "not_empty") {
      // A payment may have placed a child since the sheet opened.
      revalidateSeats()
      const n = deleted.placed
      return {
        status: "refused",
        message:
          n === null
            ? `A child is placed in ${input.name} now, so it can’t be deleted.`
            : `${n} ${n === 1 ? "child is" : "children are"} placed in ${input.name} now, so it can’t be deleted.`,
      }
    }
    if (deleted.error === "not_found") {
      revalidateSeats()
      return { status: "refused", message: `${input.name} is already deleted.` }
    }
    if (deleted.error === "forbidden") return { status: "refused", message: "Only the Admissions Manager can delete a stream." }
    return refused(deleted.error)
  }
  revalidateSeats()
  return { status: "done", message: `${input.name} is deleted.` }
}

export async function bringUpAction(input: { year: number; sources: string[] }): Promise<StreamOutcome> {
  if (!isWhole(input.year, 2000) || !Array.isArray(input.sources) || input.sources.some((id) => typeof id !== "string")) {
    return { status: "refused", message: LOST }
  }
  const supabase = await createClient()
  const brought = await bringUpStreams(supabase, input.year, input.sources)
  if (!brought.ok) return refused(brought.error)
  revalidateSeats()
  const n = brought.data.length
  return {
    status: "done",
    message: `${n} ${n === 1 ? "stream" : "streams"} brought up into ${input.year} with 0 seats. Type the places for each.`,
  }
}

export async function requestStreamAction(input: { leadId: string } | { year: number; className: string; need: string | null }): Promise<StreamOutcome> {
  const supabase = await createClient()
  let target: Parameters<typeof requestStream>[1]
  if ("leadId" in input) {
    if (typeof input.leadId !== "string") return { status: "refused", message: LOST }
    target = { leadId: input.leadId }
  } else {
    if (!isWhole(input.year, 2000) || !isClass(input.className) || !(input.need === null || input.need === "Boys" || input.need === "Girls")) {
      return { status: "refused", message: LOST }
    }
    target = { year: input.year, className: input.className, need: input.need }
  }
  const sent = await requestStream(supabase, target)
  if (!sent.ok) {
    if (sent.error === "not_full")
      return {
        status: "refused",
        message: "A seat is free now. You can record the payment.",
      }
    if (sent.error === "forbidden")
      return {
        status: "refused",
        message: "Your role can’t send this request.",
      }
    return { status: "refused", message: LOST }
  }
  revalidateSeats()
  return { status: "done", message: "Request sent to the Admissions Manager." }
}
