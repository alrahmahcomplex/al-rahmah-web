import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"
import type { SiblingBasis, SiblingFeeEditReason, SiblingFeeEditValue, SiblingResult } from "./sibling-groups"

// Sibling counts and the group explanation (#306). Read-only: these show
// staff what still needs a look after the system let them go on (a typing
// mistake, "Not known yet", a manual fee edit). Each count comes with the
// rows behind it. The explanation gives reason codes and facts, never
// sentences: the screens (#310, #311) write the sentences. Every rule lives
// in the database; this module only translates what it answers.

export type CountError = "forbidden" | "unavailable"

function countError(error: { message: string; code?: string }, what: string): CountError {
  // 42501: the function isn't granted to the caller at all.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  console.error(what, error)
  return "unavailable"
}

export type StaffCount = { staffId: string | null; staffName: string | null; count: number }

type StaffCountRow = { staff_id: string | null; staff_name: string | null; count: number }

const staffCount = (row: StaffCountRow): StaffCount => ({ staffId: row.staff_id, staffName: row.staff_name, count: row.count })

// ---------------------------------------------------------------------------
// leads.view: typing mistakes confirmed at the desk, previous schools to add.
// ---------------------------------------------------------------------------

export type SiblingLeadCounts = {
  typoConfirmed: {
    count: number
    byStaff: StaffCount[]
    // The staff member is the one who last set the basis; empty when no staff
    // member did (a system write).
    members: { leadId: string; groupId: string; staffId: string | null; confirmedAt: string | null }[]
  }
  // Open leads in STD 2 and above.
  previousSchool: { count: number; notKnown: number; missing: number; notKnownLeadIds: string[]; missingLeadIds: string[] }
}

type LeadCountsRow = {
  typo_confirmed: {
    count: number
    by_staff: StaffCountRow[]
    members: { lead_id: string; group_id: string; staff_id: string | null; confirmed_at: string | null }[]
  }
  previous_school: { count: number; not_known: number; missing: number; not_known_lead_ids: string[]; missing_lead_ids: string[] }
}

// `year` is the enrollment year; leave it out for every year.
export async function getSiblingLeadCounts(
  supabase: SupabaseClient,
  year?: number,
): Promise<Result<SiblingLeadCounts, CountError>> {
  const { data, error } = await supabase.rpc("sibling_lead_counts", { year: year ?? null })
  if (error) return { ok: false, error: countError(error, "Could not read the Sibling lead counts") }
  const row = data as LeadCountsRow
  return {
    ok: true,
    data: {
      typoConfirmed: {
        count: row.typo_confirmed.count,
        byStaff: row.typo_confirmed.by_staff.map(staffCount),
        members: row.typo_confirmed.members.map((m) => ({
          leadId: m.lead_id,
          groupId: m.group_id,
          staffId: m.staff_id,
          confirmedAt: m.confirmed_at,
        })),
      },
      previousSchool: {
        count: row.previous_school.count,
        notKnown: row.previous_school.not_known,
        missing: row.previous_school.missing,
        notKnownLeadIds: row.previous_school.not_known_lead_ids,
        missingLeadIds: row.previous_school.missing_lead_ids,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// payments.view: the Accountant's counts.
// ---------------------------------------------------------------------------

export type SiblingFeeCounts = {
  feeEdits: {
    count: number
    byReason: Record<SiblingFeeEditReason, number>
    byStaff: StaffCount[]
    edits: {
      editId: string
      leadId: string
      staffId: string
      value: SiblingFeeEditValue
      reason: SiblingFeeEditReason
      createdAt: string
    }[]
  }
  // Open leads holding a 10% kept when they left the old family rule.
  keptTen: { count: number; leadIds: string[] }
  // Open Enrolled leads with the Sibling 10% whose group has nobody Enrolled
  // at full. A 10% set by hand and the prior-sibling tick are left out.
  enrolledTenNoFull: { count: number; leadIds: string[] }
  // "Granted: fee edit needed".
  feeEditNeeded: { count: number; requests: { requestId: string; leadId: string; decidedAt: string; leadOpen: boolean }[] }
}

type FeeCountsRow = {
  fee_edits: {
    count: number
    by_reason: Record<SiblingFeeEditReason, number>
    by_staff: StaffCountRow[]
    edits: {
      edit_id: string
      lead_id: string
      staff_id: string
      value: SiblingFeeEditValue
      reason: SiblingFeeEditReason
      created_at: string
    }[]
  }
  kept_ten: { count: number; lead_ids: string[] }
  enrolled_ten_no_full: { count: number; lead_ids: string[] }
  fee_edit_needed: { count: number; requests: { request_id: string; lead_id: string; decided_at: string; lead_open: boolean }[] }
}

export async function getSiblingFeeCounts(
  supabase: SupabaseClient,
  year?: number,
): Promise<Result<SiblingFeeCounts, CountError>> {
  const { data, error } = await supabase.rpc("sibling_fee_counts", { year: year ?? null })
  if (error) return { ok: false, error: countError(error, "Could not read the Sibling fee counts") }
  const row = data as FeeCountsRow
  return {
    ok: true,
    data: {
      feeEdits: {
        count: row.fee_edits.count,
        byReason: row.fee_edits.by_reason,
        byStaff: row.fee_edits.by_staff.map(staffCount),
        edits: row.fee_edits.edits.map((e) => ({
          editId: e.edit_id,
          leadId: e.lead_id,
          staffId: e.staff_id,
          value: e.value,
          reason: e.reason,
          createdAt: e.created_at,
        })),
      },
      keptTen: { count: row.kept_ten.count, leadIds: row.kept_ten.lead_ids },
      enrolledTenNoFull: { count: row.enrolled_ten_no_full.count, leadIds: row.enrolled_ten_no_full.lead_ids },
      feeEditNeeded: {
        count: row.fee_edit_needed.count,
        requests: row.fee_edit_needed.requests.map((r) => ({
          requestId: r.request_id,
          leadId: r.lead_id,
          decidedAt: r.decided_at,
          leadOpen: r.lead_open,
        })),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// discounts.approve: Sibling requests by age.
// ---------------------------------------------------------------------------

export type SiblingRequestCounts = {
  pending: {
    count: number
    oldestRequestedAt: string | null
    // Oldest first; the same requests pending_sibling_requests lists.
    requests: { requestId: string; leadId: string; requestedAt: string; daysWaiting: number; leadOpen: boolean }[]
  }
}

type RequestCountsRow = {
  pending: {
    count: number
    oldest_requested_at: string | null
    requests: { request_id: string; lead_id: string; requested_at: string; days_waiting: number; lead_open: boolean }[]
  }
}

export async function getSiblingRequestCounts(
  supabase: SupabaseClient,
  year?: number,
): Promise<Result<SiblingRequestCounts, CountError>> {
  const { data, error } = await supabase.rpc("sibling_request_counts", { year: year ?? null })
  if (error) return { ok: false, error: countError(error, "Could not read the Sibling request counts") }
  const row = data as RequestCountsRow
  return {
    ok: true,
    data: {
      pending: {
        count: row.pending.count,
        oldestRequestedAt: row.pending.oldest_requested_at,
        requests: row.pending.requests.map((r) => ({
          requestId: r.request_id,
          leadId: r.lead_id,
          requestedAt: r.requested_at,
          daysWaiting: r.days_waiting,
          leadOpen: r.lead_open,
        })),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// leads.view: why each member holds its Sibling result.
// ---------------------------------------------------------------------------

// One per member. The migration (20261218100100_sibling_counts.sql) says what
// each means.
export type SiblingReason =
  | "manual_full"
  | "manual_ten"
  | "kept_when_leaving_legacy"
  | "prior_sibling"
  | "enrolled_full"
  | "enrolled_ten_anchor"
  | "enrolled_ten_full_payer_waiting"
  | "enrolled_ten_no_full"
  | "locked_not_enrolled"
  | "enrolled_unlocked"
  | "no_family"
  | "on_own"
  | "legacy_sibling_enrolled"
  | "legacy_no_sibling_enrolled"
  | "request_pending"
  | "request_needed"
  | "request_refused"
  | "declined"
  | "closed"
  | "anchor"
  | "full_payer"
  | "full_payer_sibling"
  | "no_full_payer"

// Any number per member.
export type SiblingNote =
  | "granted"
  | "request_pending"
  | "fee_edit_needed"
  | "larger_discount"
  | "prior_sibling_tick"
  | "grants_paused"
  | "result_out_of_step"

export type SiblingMemberExplanation = {
  leadId: string
  studentName: string
  className: string
  status: string
  leadOpen: boolean
  legacy: boolean
  basis: SiblingBasis | null
  siblingOfLeadId: string | null
  fullPayer: boolean
  result: SiblingResult["result"]
  source: SiblingResult["source"]
  lockedResult: "full" | "ten" | null
  reason: SiblingReason
  notes: SiblingNote[]
  // The leads the reason names: the Enrolled sibling, the full payer, or the
  // sibling a request names.
  becauseOf: string[]
  pendingRequest: { requestId: string; siblingOfLeadId: string | null; acrossGroups: boolean; requestedAt: string } | null
  decidedRequest: {
    requestId: string
    state: "granted" | "refused" | "withdrawn"
    siblingOfLeadId: string | null
    decidedAt: string
    feeEdit: "needed" | "applied" | "dismissed" | null
  } | null
  largerDiscount: "staff_child" | "qualified_orphan" | null
  // For the full payer: whether it still has the highest fee. Null without
  // payments.view, and for every other member.
  highestFee: boolean | null
  // The latest manual fee edit; null without payments.view.
  feeEdit: {
    editId: string
    value: SiblingFeeEditValue
    reason: SiblingFeeEditReason
    createdAt: string
    staffId: string
    staffName: string
  } | null
}

export type SiblingGroupExplanation = {
  leadId: string
  // Null when the lead is in no group; `members` then holds the lead alone.
  groupId: string | null
  allLegacy: boolean | null
  fullPayerLeadId: string | null
  // Counting members Enrolled without the 10%, oldest first.
  anchors: string[]
  grantsPaused: boolean
  members: SiblingMemberExplanation[]
}

type MemberRow = {
  lead_id: string
  student_name: string
  class_name: string
  status: string
  lead_open: boolean
  legacy: boolean
  basis: SiblingBasis | null
  sibling_of_lead_id: string | null
  full_payer: boolean
  result: SiblingResult["result"]
  source: SiblingResult["source"]
  locked_result: "full" | "ten" | null
  reason: SiblingReason
  notes: SiblingNote[]
  because_of: string[]
  pending_request: { request_id: string; sibling_of_lead_id: string | null; across_groups: boolean; requested_at: string } | null
  decided_request: {
    request_id: string
    state: "granted" | "refused" | "withdrawn"
    sibling_of_lead_id: string | null
    decided_at: string
    fee_edit: "needed" | "applied" | "dismissed" | null
  } | null
  larger_discount: "staff_child" | "qualified_orphan" | null
  highest_fee: boolean | null
  fee_edit: {
    edit_id: string
    value: SiblingFeeEditValue
    reason: SiblingFeeEditReason
    created_at: string
    staff_id: string
    staff_name: string
  } | null
}

type ExplanationRow = {
  lead_id: string
  group_id: string | null
  all_legacy: boolean | null
  full_payer_lead_id: string | null
  anchors: string[]
  grants_paused: boolean
  members: MemberRow[]
}

function member(row: MemberRow): SiblingMemberExplanation {
  return {
    leadId: row.lead_id,
    studentName: row.student_name,
    className: row.class_name,
    status: row.status,
    leadOpen: row.lead_open,
    legacy: row.legacy,
    basis: row.basis,
    siblingOfLeadId: row.sibling_of_lead_id,
    fullPayer: row.full_payer,
    result: row.result,
    source: row.source,
    lockedResult: row.locked_result,
    reason: row.reason,
    notes: row.notes,
    becauseOf: row.because_of,
    pendingRequest: row.pending_request && {
      requestId: row.pending_request.request_id,
      siblingOfLeadId: row.pending_request.sibling_of_lead_id,
      acrossGroups: row.pending_request.across_groups,
      requestedAt: row.pending_request.requested_at,
    },
    decidedRequest: row.decided_request && {
      requestId: row.decided_request.request_id,
      state: row.decided_request.state,
      siblingOfLeadId: row.decided_request.sibling_of_lead_id,
      decidedAt: row.decided_request.decided_at,
      feeEdit: row.decided_request.fee_edit,
    },
    largerDiscount: row.larger_discount,
    highestFee: row.highest_fee,
    feeEdit: row.fee_edit && {
      editId: row.fee_edit.edit_id,
      value: row.fee_edit.value,
      reason: row.fee_edit.reason,
      createdAt: row.fee_edit.created_at,
      staffId: row.fee_edit.staff_id,
      staffName: row.fee_edit.staff_name,
    },
  }
}

export async function explainSiblingGroup(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<SiblingGroupExplanation, CountError | "not-found">> {
  const { data, error } = await supabase.rpc("explain_sibling_group", { lead_id: leadId })
  if (error) {
    // 22P02: an id that isn't a uuid, so no lead has it.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    return { ok: false, error: countError(error, "Could not explain a sibling group") }
  }
  const row = data as ExplanationRow
  return {
    ok: true,
    data: {
      leadId: row.lead_id,
      groupId: row.group_id,
      allLegacy: row.all_legacy,
      fullPayerLeadId: row.full_payer_lead_id,
      anchors: row.anchors,
      grantsPaused: row.grants_paused,
      members: row.members.map(member),
    },
  }
}
