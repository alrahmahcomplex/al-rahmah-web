import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getLead } from "@/lib/services/leads"
import type { RecordablePaymentType } from "@/lib/services/school-fee-payments"
import { getSeatMode, getSeatOutlook, getYearStreams, type SeatOutlook, type Stream } from "@/lib/services/streams"

import { paymentRefusal, type PaymentRefusal, type SeatNote } from "./payment-outcome"
import { belowBookingNote, blockedNote, placedNote, type SeatChild } from "./seat-text"

// What Record payment reads about a child's seat once streams are on (#449,
// v42): the child and their class's streams for the red note, and the seat
// before and after a payment for the note that follows it.

/** The child and their class's streams this year, or null when either can't be read. */
export async function seatChild(supabase: SupabaseClient, leadId: string): Promise<{ child: SeatChild; year: number; streams: Stream[] } | null> {
  const lead = await getLead(supabase, leadId)
  if (!lead.ok) return null
  const year = await getYearStreams(supabase, lead.data.enrollmentYear)
  if (!year.ok) return null
  return {
    child: { studentName: lead.data.studentName, gender: lead.data.gender, className: lead.data.className },
    year: lead.data.enrollmentYear,
    streams: year.data.classes.find((c) => c.className === lead.data.className)?.streams ?? [],
  }
}

/** A payment refused because no stream can take the child: v42's red note, read now. */
export async function noClassRefusal(supabase: SupabaseClient, leadId: string, doing: "checked" | "recorded"): Promise<PaymentRefusal> {
  const read = await seatChild(supabase, leadId)
  if (!read) return paymentRefusal("no_class", doing)
  const note = blockedNote(read.child, read.streams)
  return { status: "refused", field: null, message: `${note.title} ${note.text}` }
}

/** The seat before a school-fee payment, once streams are on; null otherwise or when unread. */
export async function seatBefore(supabase: SupabaseClient, leadId: string, type: RecordablePaymentType): Promise<SeatOutlook | null> {
  if (type === "pre_form_one_fee" || (await getSeatMode(supabase)) !== "named") return null
  const outlook = await getSeatOutlook(supabase, leadId)
  return outlook.ok && outlook.data.mode === "named" && outlook.data.hasStreams ? outlook.data : null
}

/**
 * The note after a school-fee payment: the stream it placed the child in, or,
 * for a payment below what books the seat, that it booked nothing. Null for
 * any other payment, so the plain message shows.
 */
export async function seatAfter(supabase: SupabaseClient, leadId: string, before: SeatOutlook | null, amount: number | null): Promise<SeatNote | null> {
  if (!before) return null
  const after = await getSeatOutlook(supabase, leadId)
  if (!after.ok) return null
  const now = after.data
  if (now.placed && !before.placed && now.priority) {
    const placed = placedNote(now.priority, now.placed)
    return { tone: "good", title: placed.title, text: "Placed automatically in", stream: placed.stream }
  }
  if (!now.placed && now.priority === null && amount !== null && now.booksAt !== null && now.booksKind !== null && now.booksKind !== "waived") {
    const read = await seatChild(supabase, leadId)
    if (!read) return null
    const below = belowBookingNote(read.child, {
      amount,
      totalPaid: now.totalPaid,
      booksAt: now.booksAt,
      booksKind: now.booksKind,
      wouldTake: now.wouldTake,
    })
    return { tone: "info", title: below.title, text: below.text }
  }
  return null
}
