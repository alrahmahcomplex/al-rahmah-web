import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The interview module (slice 5, #26): registering a lead for interview,
// recording and correcting its result, marking its fee Paid or Not Paid, and
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
// Recording and correcting an interview result.
// ---------------------------------------------------------------------------

export type InterviewResultInput = {
  // YYYY-MM-DD, today in Tanzania or earlier, and not before registration.
  interviewDate: string
  result: InterviewResult
  // A percentage from 0 to 100, to one decimal place at most.
  score: number
}

export type RecordedResult = {
  // True when this set the interview's first result, false for a correction.
  firstRecording: boolean
  // False when a correction matched what was already recorded, so nothing
  // was written.
  changed: boolean
}

export type RecordResultError =
  // The date, result or score is missing.
  | "incomplete"
  | "score_out_of_range"
  | "score_too_precise"
  // Later than today in Tanzania time.
  | "date_in_future"
  | "date_before_registration"
  | "lead_closed"
  | "forbidden"
  | "not_found"
  | "unavailable"

const RECORD_REFUSALS: ReadonlySet<string> = new Set<RecordResultError>([
  "incomplete",
  "score_out_of_range",
  "score_too_precise",
  "date_in_future",
  "date_before_registration",
  "lead_closed",
])

type RecordedRow = { first_recording: boolean; changed: boolean }

// Records the interview's date, result and score, or corrects them. The first
// recording on the lead's current interview moves the lead to Interviewed,
// recording its visit on the interview date first if it was still Applied.
// A correction changes only the interview. Needs interviews.record, and
// visits.record for an Applied lead.
export async function recordInterviewResult(
  supabase: SupabaseClient,
  interviewId: string,
  { interviewDate, result, score }: InterviewResultInput,
): Promise<Result<RecordedResult, RecordResultError>> {
  const { data, error } = await supabase.rpc("record_interview_result", {
    interview_id: interviewId,
    interviewed_on: interviewDate,
    outcome: result,
    score,
  })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not_found" }
    if (RECORD_REFUSALS.has(error.message)) return { ok: false, error: error.message as RecordResultError }
    // 22007/22008: a date the database can't read.
    if (error.code === "22007" || error.code === "22008") return { ok: false, error: "incomplete" }
    console.error("Could not record an interview result", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as RecordedRow
  return { ok: true, data: { firstRecording: row.first_recording, changed: row.changed } }
}

// ---------------------------------------------------------------------------
// Marking the interview fee Paid or Not Paid.
// ---------------------------------------------------------------------------

export type FeeStatusInput = "paid" | "not_paid"

export type FeeStatusChange = {
  feeStatus: InterviewFeeStatus
  // Whole TZS, locked by marking it Paid; null once it is Not Paid again.
  lockedAmount: number | null
  // Whether the locked amount includes an Approved Referral code's discount.
  discountApplied: boolean
}

export type FeeStatusError =
  // The fee already has that status.
  | "no_change"
  | "lead_closed"
  | "forbidden"
  | "not_found"
  | "unavailable"

const FEE_STATUSES: Readonly<Record<FeeStatusInput, InterviewFeeStatus>> = { paid: "Paid", not_paid: "Not Paid" }

type FeeStatusRow = { fee_status: InterviewFeeStatus; locked_amount: number | null; discount_applied: boolean }

// Marks the interview fee Paid, locking the amount the fee comes to now, or
// Not Paid, releasing the lock. Nobody gives an amount: the database works it
// out. Needs interview_payments.record, which only the Accountant holds.
export async function setInterviewFeeStatus(
  supabase: SupabaseClient,
  interviewId: string,
  status: FeeStatusInput,
): Promise<Result<FeeStatusChange, FeeStatusError>> {
  const { data, error } = await supabase.rpc("set_interview_fee_status", {
    interview_id: interviewId,
    // Anything but the two statuses reaches the database as null, which it
    // refuses without changing anything.
    fee_status: Object.hasOwn(FEE_STATUSES, status) ? FEE_STATUSES[status] : null,
  })
  if (error) {
    // `forbidden`: the amount is read with leads.view, which a role allowed
    // to mark the fee might lack.
    if (error.message === "not_permitted" || error.message === "forbidden" || error.code === "42501") {
      return { ok: false, error: "forbidden" }
    }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not_found" }
    if (error.message === "no_change" || error.message === "lead_closed") return { ok: false, error: error.message }
    console.error("Could not set an interview fee status", error)
    return { ok: false, error: "unavailable" }
  }

  const row = data as FeeStatusRow
  return { ok: true, data: { feeStatus: row.fee_status, lockedAmount: row.locked_amount, discountApplied: row.discount_applied } }
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
