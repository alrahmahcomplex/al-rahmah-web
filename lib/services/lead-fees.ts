import type { SupabaseClient } from "@supabase/supabase-js"

import type { FeeDiscountKind } from "./discounts"
import type { FeeBand } from "./fees"
import type { DayOrBoarding } from "./leads"
import type { Result } from "./result"
import type { RecordedPaymentType, SeatPriority } from "./school-fee-payments"

// A lead's School fee: what the family owes, has paid, and when each
// instalment is due. The database calculates it from the Fee schedule of the
// lead's own enrollment year; this file turns its answer into a Result.

export type Instalment = { amount: number; due: string }

// What made the lead Enrolled, and the calendar date it did: the payment that
// took it over the line, as that payment counts now, or its year's
// Academic-year start.
export type Enrolment = {
  on: string
  by: { kind: "payment"; type: RecordedPaymentType; amount: number | null } | { kind: "academic-year-start" }
}

// The Pre-Form One programme (#114): its fee for the lead's Day or boarding,
// with no discount, and what has been paid toward it. Pre-Form One fee
// payments count toward neither Total paid, Seat priority nor Enrolled.
export type PreFormOne = {
  // Staff ticked the programme. A class correction off FORM 1 keeps the tick.
  ticked: boolean
  // The lead's class is FORM 1, so the tick may be set.
  offered: boolean
  // Ticked on a FORM 1 lead: only then may a Pre-Form One fee be recorded.
  applies: boolean
  // Whole TZS. Null while the lead's year has no Fee schedule.
  fee: number | null
  paid: number
  balance: number | null
}

export type LeadFee =
  | {
      kind: "fee"
      year: number
      band: FeeBand
      dayOrBoarding: DayOrBoarding
      // Whole TZS. The band fee for the class and Day or boarding, and the
      // School fee: the band fee less the discount, if any.
      bandFee: number
      schoolFee: number
      // The one discount the School fee carries, the largest the lead holds.
      discount: { kind: FeeDiscountKind; percent: number } | null
      totalPaid: number
      balance: number
      // First, second and third. They add up to the School fee exactly.
      instalments: [Instalment, Instalment, Instalment]
      // Derived from Total paid: none below the minimum Initial deposit. The
      // date is the payment date on which the lead reached it.
      priority: SeatPriority | null
      priorityReachedOn: string | null
      // Set exactly while the lead is Enrolled from its payments.
      enrolment: Enrolment | null
      preFormOne: PreFormOne
    }
  // The lead's enrollment year has no Fee schedule yet, so it has no fee.
  | { kind: "no-schedule"; year: number; preFormOne: PreFormOne }

type LeadSchoolFeeRow = {
  enrollment_year: number
  band: FeeBand
  day_or_boarding: DayOrBoarding
  has_schedule: boolean
  school_fee: number | null
  total_paid: number | null
  balance: number | null
  first_amount: number | null
  first_due: string | null
  second_amount: number | null
  second_due: string | null
  third_amount: number | null
  third_due: string | null
  priority: SeatPriority | null
  priority_reached_on: string | null
  enrolled_trigger: "payment" | "academic_year_start" | null
  enrolled_on: string | null
  enrolled_payment_type: RecordedPaymentType | null
  enrolled_payment_amount: number | null
  band_fee: number | null
  discount: FeeDiscountKind | null
  discount_percent: number | null
  pre_form_one: boolean
  pre_form_one_offered: boolean
  pre_form_one_applies: boolean
  pre_form_one_fee: number | null
  pre_form_one_paid: number
  pre_form_one_balance: number | null
}

function preFormOneOf(row: LeadSchoolFeeRow): PreFormOne {
  return {
    ticked: row.pre_form_one,
    offered: row.pre_form_one_offered,
    applies: row.pre_form_one_applies,
    fee: row.pre_form_one_fee,
    paid: row.pre_form_one_paid,
    balance: row.pre_form_one_balance,
  }
}

function enrolmentOf(row: LeadSchoolFeeRow): Enrolment | null {
  if (row.enrolled_on === null) return null
  if (row.enrolled_trigger === "academic_year_start") return { on: row.enrolled_on, by: { kind: "academic-year-start" } }
  if (row.enrolled_trigger === "payment" && row.enrolled_payment_type !== null) {
    return { on: row.enrolled_on, by: { kind: "payment", type: row.enrolled_payment_type, amount: row.enrolled_payment_amount } }
  }
  return null
}

// Needs leads.view and payments.view; anyone else, signed out included, is
// `forbidden`.
export async function getLeadFee(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadFee, "not-found" | "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("lead_school_fee", { lead_id: leadId }).single<LeadSchoolFeeRow>()
  if (error) {
    // 22P02: the id isn't a uuid, so no lead has it.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    // 42501: signed out, or the secret key, which may not call it at all.
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read a lead's School fee", error)
    return { ok: false, error: "unavailable" }
  }

  if (!data.has_schedule) return { ok: true, data: { kind: "no-schedule", year: data.enrollment_year, preFormOne: preFormOneOf(data) } }
  return {
    ok: true,
    data: {
      kind: "fee",
      year: data.enrollment_year,
      band: data.band,
      dayOrBoarding: data.day_or_boarding,
      bandFee: data.band_fee!,
      schoolFee: data.school_fee!,
      discount: data.discount === null ? null : { kind: data.discount, percent: data.discount_percent! },
      totalPaid: data.total_paid!,
      balance: data.balance!,
      instalments: [
        { amount: data.first_amount!, due: data.first_due! },
        { amount: data.second_amount!, due: data.second_due! },
        { amount: data.third_amount!, due: data.third_due! },
      ],
      priority: data.priority,
      priorityReachedOn: data.priority_reached_on,
      enrolment: enrolmentOf(data),
      preFormOne: preFormOneOf(data),
    },
  }
}
