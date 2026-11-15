import type { SupabaseClient } from "@supabase/supabase-js"

import type { NextStepInput } from "@/lib/lead-next-step"
import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"

import type { InterviewFeeStatus, InterviewResult } from "./interviews"
import type { LeadClosure, LeadStatus } from "./leads"
import type { ReleaseBlocker } from "./result-release"
import type { Result } from "./result"
import type { SeatPriority } from "./school-fee-payments"

// What the next step of each lead on an Applicants page is worked out from,
// in one call (#415). It gives what readNextStepInput (lib/lead-next-step.ts)
// gathers from six reads per lead, from the same SQL: see
// supabase/migrations/20261224100100_lead_next_step_inputs.sql.

// The most leads one call takes, as the database refuses more.
export const NEXT_STEP_INPUTS_PER_REQUEST = 200

// Everything nextStep needs but today's date.
export type NextStepFacts = Omit<NextStepInput, "today">

type InputRow = {
  lead_id: string
  status: LeadStatus
  closure: LeadClosure | null
  interview_fee_status: InterviewFeeStatus | null
  interview_amount: number | null
  interview_result: InterviewResult | null
  registration: string | null
  enrol_without_retake: boolean
  release_blocked: ReleaseBlocker | null
  release_sent: boolean
  release_changed: boolean
  fee_readable: boolean
  seat_priority: SeatPriority | null
  follow_up_due_on: string | null
  follow_up_needs_date: boolean
}

// By lead id. Ids that match no lead are left out. Needs leads.view; the
// School fee is read only for staff who also hold payments.view, as the
// record's own read is, and is null for everyone else.
export async function listNextStepFacts(
  supabase: SupabaseClient,
  leadIds: readonly string[],
): Promise<Result<Map<string, NextStepFacts>, "forbidden" | "unavailable">> {
  if (leadIds.length === 0) return { ok: true, data: new Map() }
  if (leadIds.length > NEXT_STEP_INPUTS_PER_REQUEST) throw new Error("Too many leads for one next step request")
  const { data, error } = await supabase.rpc("lead_next_step_inputs", { lead_ids: leadIds })
  if (error) {
    // 42501: the function isn't granted to the caller at all, as for someone
    // signed out.
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the leads' next steps", error)
    return { ok: false, error: "unavailable" }
  }

  return {
    ok: true,
    data: new Map(
      ((data ?? []) as InputRow[]).map((row): [string, NextStepFacts] => [
        row.lead_id,
        {
          status: row.status,
          closure: row.closure,
          interview:
            row.interview_fee_status === null
              ? null
              : { feeStatus: row.interview_fee_status, amount: row.interview_amount ?? STANDARD_INTERVIEW_FEE, result: row.interview_result },
          registration: row.registration === "first" || row.registration === "retake" ? row.registration : null,
          enrolWithoutRetake: row.enrol_without_retake,
          release: { blocked: row.release_blocked, sent: row.release_sent, changedSinceSent: row.release_changed },
          fee: row.fee_readable ? { priority: row.seat_priority } : null,
          followUps: { dueOn: row.follow_up_due_on, needsDate: row.follow_up_needs_date },
        },
      ]),
    ),
  }
}
