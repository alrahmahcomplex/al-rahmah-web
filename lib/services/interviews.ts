import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The interview module (slice 5, #26): registering a lead for interview and
// reading its interviews. Every write is a database function that checks the
// permission itself and refuses a closed lead, so these calls only translate
// what the database answers.

export type InterviewResult = "Passed" | "Failed"
export type InterviewFeeStatus = "Paid" | "Not Paid"
export type NextAction = "Complete enrollment" | "Contact the admissions office"

// ---------------------------------------------------------------------------
// Registering a lead for interview.
// ---------------------------------------------------------------------------

export type Registration = {
  interviewId: string
  // The S/N and the enrollment year it was issued in. Neither changes later.
  serialNumber: number
  enrollmentYear: number
}

export type RegisterError =
  // The lead already has an interview, or is past Visited.
  | "already_registered"
  // Declined, Inactive or Archived: read-only.
  | "lead_closed"
  | "lead_enrolled"
  | "forbidden"
  | "not_found"
  | "unavailable"

type RegistrationRow = { interview_id: string; serial_number: number; serial_year: number }

// Registers an Applied or Visited lead for its first interview and gives it
// the next S/N for its enrollment year. Needs interviews.record.
export async function registerForInterview(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<Registration, RegisterError>> {
  const { data, error } = await supabase.rpc("register_for_interview", { lead_id: leadId })
  if (error) {
    // 42501: the function isn't granted to the caller at all, as for someone
    // signed out.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // A malformed id is a missing lead, not an outage.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not_found" }
    if (error.message === "lead_closed" || error.message === "lead_enrolled" || error.message === "already_registered") {
      return { ok: false, error: error.message }
    }
    console.error("Could not register a lead for interview", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as RegistrationRow
  return { ok: true, data: { interviewId: row.interview_id, serialNumber: row.serial_number, enrollmentYear: row.serial_year } }
}

// ---------------------------------------------------------------------------
// Reading a lead's interviews.
// ---------------------------------------------------------------------------

export type LeadInterview = {
  id: string
  serialNumber: number
  // The enrollment year the S/N was issued in, which may differ from the
  // lead's after a correction.
  enrollmentYear: number
  registeredAt: string
  // The date, result and score are all set or all empty.
  interviewDate: string | null
  result: InterviewResult | null
  score: number | null
  nextAction: NextAction | null
  feeStatus: InterviewFeeStatus
  // Whole TZS: the amount locked when the fee was marked Paid, else what the
  // fee comes to now.
  amount: number
  // Whether the amount includes an Approved Referral code's discount. For a
  // locked amount, whether it was the discounted fee.
  discountApplied: boolean
}

export type LeadInterviewsError = "forbidden" | "not_found" | "unavailable"

type InterviewRow = {
  id: string
  serial_number: number
  serial_year: number
  registered_at: string
  interview_date: string | null
  result: InterviewResult | null
  score: number | string | null
  fee_status: InterviewFeeStatus
  locked_amount: number | null
}

// The standard fee before any discount. A locked amount below it was the
// discounted fee.
const FULL_INTERVIEW_FEE = 50_000

export function nextActionOf(result: InterviewResult | null): NextAction | null {
  if (result === "Passed") return "Complete enrollment"
  if (result === "Failed") return "Contact the admissions office"
  return null
}

// The lead's interviews, current (newest registration) first. Row-level
// security shows interviews only to staff who may view leads, so for anyone
// else the list is empty.
export async function getLeadInterviews(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadInterview[], LeadInterviewsError>> {
  const { data, error } = await supabase
    .from("interviews")
    .select("id, serial_number, serial_year, registered_at, interview_date, result, score, fee_status, locked_amount")
    .eq("lead", leadId)
    .order("registered_at", { ascending: false })
    .order("serial_number", { ascending: false })
    .overrideTypes<InterviewRow[], { merge: false }>()

  if (error && error.code === "22P02") return { ok: false, error: "not_found" }
  if (error) {
    console.error("Could not read a lead's interviews", error)
    return { ok: false, error: "unavailable" }
  }

  // What an unpaid fee comes to now, asked once for the lead.
  let expected: { amount: number; discount_applied: boolean } | null = null
  const rows = data ?? []
  if (rows.some((row) => row.fee_status !== "Paid")) {
    const answer = await supabase.rpc("expected_interview_amount", { lead_id: leadId }).single<{ amount: number; discount_applied: boolean }>()
    if (answer.error) {
      if (answer.error.message === "forbidden") return { ok: false, error: "forbidden" }
      if (answer.error.message === "not_found") return { ok: false, error: "not_found" }
      console.error("Could not read a lead's interview fee", answer.error)
      return { ok: false, error: "unavailable" }
    }
    expected = answer.data
  }

  return {
    ok: true,
    data: rows.map((row) => {
      // The database keeps an amount locked exactly while the fee is Paid, so
      // every other row has the expected amount read above.
      const fee =
        row.locked_amount !== null
          ? { amount: row.locked_amount, discountApplied: row.locked_amount < FULL_INTERVIEW_FEE }
          : { amount: expected?.amount ?? FULL_INTERVIEW_FEE, discountApplied: expected?.discount_applied ?? false }
      return {
        id: row.id,
        serialNumber: row.serial_number,
        enrollmentYear: row.serial_year,
        registeredAt: row.registered_at,
        interviewDate: row.interview_date,
        result: row.result,
        score: row.score === null ? null : Number(row.score),
        nextAction: nextActionOf(row.result),
        feeStatus: row.fee_status,
        amount: fee.amount,
        discountApplied: fee.discountApplied,
      }
    }),
  }
}
