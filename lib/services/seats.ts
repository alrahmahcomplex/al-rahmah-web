import type { SupabaseClient } from "@supabase/supabase-js"

import type { DayOrBoarding, LeadClass, LeadClosure } from "./leads"
import type { Result } from "./result"
import type { SeatPriority } from "./school-fee-payments"

// Seats: how full each class is, and who keeps a place when a class has more
// leads with a Seat priority than seats. A lead takes a seat in its class,
// year and Day or boarding when it has a Seat priority and isn't Declined;
// Inactive and Archived leads keep theirs. Every rule lives in the database;
// this file turns its answers into a Result.

// One lead holding a seat, as the ranking lists it. The ranking is Full, then
// First instalment, then Deposit; then the date the lead reached its
// priority, oldest first; then Admission Number. `rank` counts from 1.
export type SeatHolder = {
  leadId: string
  admissionNumber: string
  studentName: string
  closure: LeadClosure | null
  priority: SeatPriority
  // YYYY-MM-DD.
  reachedOn: string
  rank: number
}

export type ClassSeats = {
  className: LeadClass
  dayOrBoarding: DayOrBoarding
  // Null when the Admissions Manager hasn't set them.
  seats: number | null
  taken: number
  full: number
  firstInstalment: number
  deposit: number
  // The class's leads ranked, only while seats taken exceed seats set.
  ranked: SeatHolder[] | null
}

type HolderRow = {
  lead_id: string
  admission_number: string
  student_name: string
  closure: LeadClosure | null
  priority: SeatPriority
  reached_on: string
  rank: number
}

type ClassSeatsRow = {
  class_name: LeadClass
  day_or_boarding: DayOrBoarding
  seats: number | null
  taken: number
  full_count: number
  first_instalment_count: number
  deposit_count: number
  ranked: HolderRow[] | null
}

function holderFrom(row: HolderRow): SeatHolder {
  return {
    leadId: row.lead_id,
    admissionNumber: row.admission_number,
    studentName: row.student_name,
    closure: row.closure,
    priority: row.priority,
    reachedOn: row.reached_on,
    rank: row.rank,
  }
}

type RpcError = { message: string; code?: string }

// 42501: the role may not call the function at all (signed out).
function isForbidden(error: RpcError): boolean {
  return error.message === "forbidden" || error.code === "42501"
}

// Every class in the year, in class order with Day before Boarding: its seats
// set, its seats taken split by Seat priority, and its ranked leads when it
// is over capacity. Needs payments.view.
export async function getSeats(
  supabase: SupabaseClient,
  year: number,
): Promise<Result<ClassSeats[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("year_seats", { schedule_year: year })
  if (error) {
    if (isForbidden(error)) return { ok: false, error: "forbidden" }
    console.error("Could not read the seats", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as ClassSeatsRow[]).map((row) => ({
      className: row.class_name,
      dayOrBoarding: row.day_or_boarding,
      seats: row.seats,
      taken: row.taken,
      full: row.full_count,
      firstInstalment: row.first_instalment_count,
      deposit: row.deposit_count,
      ranked: row.ranked === null ? null : row.ranked.map(holderFrom),
    })),
  }
}

export type SeatCheck = {
  enrollmentYear: number
  className: LeadClass
  dayOrBoarding: DayOrBoarding
  seats: number | null
  // Not counting this lead.
  seatsTaken: number
  // The priority the lead's payments give it, Declined or not. Null too
  // for staff who may not view payments.
  priority: SeatPriority | null
  holdsSeat: boolean
  // The lead holds no seat yet, would take one with its priority, and the
  // seats taken already reach the seats set.
  wouldOverfill: boolean
  // Only when it would overfill, and only for staff who may view payments:
  // the class's holders with this lead among them, marked.
  ranked: (SeatHolder & { thisLead: boolean })[] | null
}

type SeatCheckRow = {
  enrollment_year: number
  class_name: LeadClass
  day_or_boarding: DayOrBoarding
  seats: number | null
  seats_taken: number
  priority: SeatPriority | null
  holds_seat: boolean
  would_overfill: boolean
  ranked: (HolderRow & { this_lead: boolean })[] | null
}

// Whether this lead, holding no seat yet, would take one in a full class,
// with the ranking it would join. For slice 8's reopening approval. Reads
// only. Needs a signed-in staff member with leads.view; the priority and the
// ranking also need payments.view.
export async function seatCheck(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<SeatCheck, "forbidden" | "not_found" | "unavailable">> {
  const { data, error } = await supabase.rpc("seat_check", { lead_id: leadId })
  if (error) {
    if (isForbidden(error)) return { ok: false, error: "forbidden" }
    // 22P02: the lead id isn't a uuid, so no lead has it.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not_found" }
    console.error("Could not check a lead's seat", error)
    return { ok: false, error: "unavailable" }
  }
  const row = data as SeatCheckRow
  return {
    ok: true,
    data: {
      enrollmentYear: row.enrollment_year,
      className: row.class_name,
      dayOrBoarding: row.day_or_boarding,
      seats: row.seats,
      seatsTaken: row.seats_taken,
      priority: row.priority,
      holdsSeat: row.holds_seat,
      wouldOverfill: row.would_overfill,
      ranked: row.ranked === null ? null : row.ranked.map((entry) => ({ ...holderFrom(entry), thisLead: entry.this_lead })),
    },
  }
}
