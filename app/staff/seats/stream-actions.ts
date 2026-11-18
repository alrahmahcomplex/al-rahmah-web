"use server"

import { revalidatePath } from "next/cache"

import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import { bringUpStreams, editStream, openStream, requestStream, STREAM_TAKES, type StreamError, type StreamTakes } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

// Seats, once streams are on (#449, prototype v42): open, change and bring up
// streams, and ask the Admissions Manager for one. The database checks every
// permission and rule again; these turn its answers into the screen's words.

export type StreamOutcome = { status: "done"; message: string } | { status: "refused"; message: string }

const LOST = "The change could not be saved just now. Try again in a moment."

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
  if (!opened.ok) return refused(opened.error)
  revalidatePath("/staff/seats")
  return {
    status: "done",
    message: `${input.name} is open with ${opened.data.seats} seats.`,
  }
}

export async function editStreamAction(input: { streamId: string; label: string; seats: number; name: string; placed: number }): Promise<StreamOutcome> {
  if (typeof input.streamId !== "string" || typeof input.label !== "string" || !isWhole(input.seats, 0)) return { status: "refused", message: LOST }
  const supabase = await createClient()
  const edited = await editStream(supabase, {
    streamId: input.streamId,
    label: input.label.trim(),
    seats: input.seats,
  })
  if (!edited.ok) {
    if (edited.error === "below_placed") {
      return {
        status: "refused",
        message: `${input.name} has ${input.placed} ${input.placed === 1 ? "child" : "children"} placed. The seats can’t go below ${input.placed}.`,
      }
    }
    return refused(edited.error)
  }
  revalidatePath("/staff/seats")
  return {
    status: "done",
    message: `${input.name} saved: ${edited.data.seats} seats.`,
  }
}

export async function bringUpAction(input: { year: number; sources: string[] }): Promise<StreamOutcome> {
  if (!isWhole(input.year, 2000) || !Array.isArray(input.sources) || input.sources.some((id) => typeof id !== "string")) {
    return { status: "refused", message: LOST }
  }
  const supabase = await createClient()
  const brought = await bringUpStreams(supabase, input.year, input.sources)
  if (!brought.ok) return refused(brought.error)
  revalidatePath("/staff/seats")
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
  revalidatePath("/staff/seats")
  revalidatePath("/staff/applicants/[id]", "page")
  return { status: "done", message: "Request sent to the Admissions Manager." }
}
