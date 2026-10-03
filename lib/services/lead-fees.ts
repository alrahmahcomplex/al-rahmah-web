import type { SupabaseClient } from "@supabase/supabase-js"

import type { FeeBand } from "./fees"
import type { DayOrBoarding } from "./leads"
import type { Result } from "./result"

// A lead's School fee: what the family owes, has paid, and when each
// instalment is due. The database calculates it from the Fee schedule of the
// lead's own enrollment year; this file turns its answer into a Result.

export type Instalment = { amount: number; due: string }

export type LeadFee =
  | {
      kind: "fee"
      year: number
      band: FeeBand
      dayOrBoarding: DayOrBoarding
      // Whole TZS.
      schoolFee: number
      totalPaid: number
      balance: number
      // First, second and third. They add up to the School fee exactly.
      instalments: [Instalment, Instalment, Instalment]
    }
  // The lead's enrollment year has no Fee schedule yet, so it has no fee.
  | { kind: "no-schedule"; year: number }

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

  if (!data.has_schedule) return { ok: true, data: { kind: "no-schedule", year: data.enrollment_year } }
  return {
    ok: true,
    data: {
      kind: "fee",
      year: data.enrollment_year,
      band: data.band,
      dayOrBoarding: data.day_or_boarding,
      schoolFee: data.school_fee!,
      totalPaid: data.total_paid!,
      balance: data.balance!,
      instalments: [
        { amount: data.first_amount!, due: data.first_due! },
        { amount: data.second_amount!, due: data.second_due! },
        { amount: data.third_amount!, due: data.third_due! },
      ],
    },
  }
}
