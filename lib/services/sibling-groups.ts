import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// Sibling groups (#300, #301): "Sibling of" linking and the father's-name
// check. The database decides everything: whether the names are the same,
// close or different, who in the group pays full and who gets the Sibling
// 10%. This module only calls it. The screens come in #308 to #310.

// Why a linked lead is in its group. `matched`, `typo_confirmed` and
// `granted` count for the Sibling discount; `request_needed` waits for a
// Sibling request the Admissions Manager grants, and `refused` stays so until
// a new request is granted (#302).
export type SiblingBasis = "matched" | "typo_confirmed" | "request_needed" | "granted" | "refused"

export type LinkSiblingInput = {
  leadId: string
  siblingOfLeadId: string
  // The lead's own father's full name, when the database asks for it.
  fatherFullName?: string
  // The other lead's, when it is a member of a Family from before the check
  // (a legacy member) or starts a group with a name nobody confirmed.
  siblingFatherFullName?: string
  // The staff member's answer to the typing-mistake question.
  answer?: "typo" | "different"
  // With `typo`: the right spelling, one of the two names.
  spelling?: string
}

export type LinkSiblingOutcome =
  | { kind: "linked"; basis: SiblingBasis; groupId: string }
  | { kind: "father-name-needed"; leadId: string }
  | { kind: "sibling-father-name-needed"; leadId: string }
  // The fathers' names are close. Nothing was saved: call again with an answer.
  | { kind: "name-question"; fatherFullName: string; siblingLeadId: string; siblingFatherFullName: string }

export type LinkSiblingError =
  // Signed out, or without leads.edit.
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "lead-closed" }
  // `family_match`: a contact still waits on a Family match. `sibling_of`: the
  // same lead twice, or a merge whose names don't match.
  | { kind: "invalid"; field: string | null }
  | { kind: "unavailable" }

type LinkRow =
  | { result: "linked"; basis: SiblingBasis; group_id: string }
  | { result: "father_name_needed" | "sibling_father_name_needed"; lead_id: string }
  | { result: "name_question"; father_full_name: string; sibling_lead_id: string; sibling_father_full_name: string }

function detailField(details: string | null | undefined): string | null {
  try {
    const field = details ? (JSON.parse(details) as { field?: unknown }).field : null
    return typeof field === "string" ? field : null
  } catch {
    return null
  }
}

// Links an open lead as "Sibling of" another open lead and runs the
// father's-name check. Needs leads.edit.
export async function linkSibling(
  supabase: SupabaseClient,
  input: LinkSiblingInput,
): Promise<Result<LinkSiblingOutcome, LinkSiblingError>> {
  const { data, error } = await supabase.rpc("link_sibling", {
    lead_id: input.leadId,
    sibling_of_lead_id: input.siblingOfLeadId,
    father_full_name: input.fatherFullName ?? null,
    sibling_father_full_name: input.siblingFatherFullName ?? null,
    answer: input.answer ?? null,
    spelling: input.spelling ?? null,
  })
  if (error) {
    // 42501: the function isn't granted to the caller at all.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    // 22P02: an id that isn't a uuid, so no lead has it.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
    if (error.message === "lead_closed") return { ok: false, error: { kind: "lead-closed" } }
    if (error.message === "invalid") return { ok: false, error: { kind: "invalid", field: detailField(error.details) } }
    console.error("Could not link a sibling", error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  const row = data as LinkRow
  switch (row.result) {
    case "linked":
      return { ok: true, data: { kind: "linked", basis: row.basis, groupId: row.group_id } }
    case "father_name_needed":
      return { ok: true, data: { kind: "father-name-needed", leadId: row.lead_id } }
    case "sibling_father_name_needed":
      return { ok: true, data: { kind: "sibling-father-name-needed", leadId: row.lead_id } }
    case "name_question":
      return {
        ok: true,
        data: {
          kind: "name-question",
          fatherFullName: row.father_full_name,
          siblingLeadId: row.sibling_lead_id,
          siblingFatherFullName: row.sibling_father_full_name,
        },
      }
  }
}

// The manual Sibling fee edit (#303). Only staff with payments.record (the
// Accountant) may preview or save one. The screen is #311.

// Full fee, 10% or Back to automatic.
export type SiblingFeeEditValue = "full" | "ten" | "automatic"

export type SiblingFeeEditReason = "full_fee_sibling_not_enrolled" | "sibling_proof_after_enrolment" | "data_entry_correction"

export type SiblingResult = { result: "full" | "ten" | "none"; source: "auto" | "locked" | "manual" | "legacy" | "prior_sibling" }

export type SiblingFeeFigures = {
  status: string
  schoolFee: number | null
  discount: string | null
  discountPercent: number | null
  firstAmount: number | null
  secondAmount: number | null
  thirdAmount: number | null
  priority: string | null
}

// A lead whose fee the edit moves: the edited lead or a sibling.
export type SiblingFeeChange = {
  leadId: string
  edited: boolean
  // After minus before; negative when the fee goes down.
  schoolFeeChange: number | null
  before: SiblingFeeFigures
  after: SiblingFeeFigures
}

export type SiblingFeeEditOutcome = {
  leadId: string
  value: SiblingFeeEditValue
  old: SiblingResult
  new: SiblingResult
  changes: SiblingFeeChange[]
}

export type SiblingFeeEditError =
  // Signed out, or without payments.record.
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "lead-closed" }
  // The same manual value again, or Back to automatic on an automatic result.
  | { kind: "unchanged" }
  // `value`, `reason` or `note`.
  | { kind: "invalid"; field: string | null }
  // The request id was used before for another edit.
  | { kind: "request-reused" }
  | { kind: "unavailable" }

type FiguresRow = {
  status: string
  school_fee: number | null
  discount: string | null
  discount_percent: number | null
  first_amount: number | null
  second_amount: number | null
  third_amount: number | null
  priority: string | null
}

type EditRow = {
  edit_id?: string
  lead_id: string
  value: SiblingFeeEditValue
  old: SiblingResult
  new: SiblingResult
  changes: { lead_id: string; edited: boolean; school_fee_change: number | null; before: FiguresRow; after: FiguresRow }[]
}

function figures(row: FiguresRow): SiblingFeeFigures {
  return {
    status: row.status,
    schoolFee: row.school_fee,
    discount: row.discount,
    discountPercent: row.discount_percent,
    firstAmount: row.first_amount,
    secondAmount: row.second_amount,
    thirdAmount: row.third_amount,
    priority: row.priority,
  }
}

function outcome(row: EditRow): SiblingFeeEditOutcome {
  return {
    leadId: row.lead_id,
    value: row.value,
    old: row.old,
    new: row.new,
    changes: row.changes.map((c) => ({
      leadId: c.lead_id,
      edited: c.edited,
      schoolFeeChange: c.school_fee_change,
      before: figures(c.before),
      after: figures(c.after),
    })),
  }
}

function feeEditError(error: { message: string; code?: string; details?: string | null }, what: string): SiblingFeeEditError {
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  if (error.message === "not_found" || error.code === "22P02") return { kind: "not-found" }
  if (error.message === "lead_closed") return { kind: "lead-closed" }
  if (error.message === "unchanged") return { kind: "unchanged" }
  if (error.message === "invalid") return { kind: "invalid", field: detailField(error.details) }
  if (error.message === "request_reused") return { kind: "request-reused" }
  console.error(what, error)
  return { kind: "unavailable" }
}

// Which fees an edit would move, and by how much. Saves nothing.
export async function previewSiblingFeeEdit(
  supabase: SupabaseClient,
  leadId: string,
  value: SiblingFeeEditValue,
): Promise<Result<SiblingFeeEditOutcome, SiblingFeeEditError>> {
  const { data, error } = await supabase.rpc("preview_sibling_fee_edit", { lead_id: leadId, value })
  if (error) return { ok: false, error: feeEditError(error, "Could not preview a Sibling fee edit") }
  return { ok: true, data: outcome(data as EditRow) }
}

// Saves the edit with its reason. `requestId` is the caller's id for this
// edit: a retry with the same id returns the first answer and saves nothing.
export async function editSiblingFee(
  supabase: SupabaseClient,
  input: { leadId: string; value: SiblingFeeEditValue; reason: SiblingFeeEditReason; note?: string },
  requestId: string,
): Promise<Result<SiblingFeeEditOutcome & { editId: string }, SiblingFeeEditError>> {
  const { data, error } = await supabase.rpc("edit_sibling_fee", {
    lead_id: input.leadId,
    value: input.value,
    reason: input.reason,
    note: input.note ?? null,
    request_id: requestId,
  })
  if (error) return { ok: false, error: feeEditError(error, "Could not save a Sibling fee edit") }
  const row = data as EditRow
  return { ok: true, data: { ...outcome(row), editId: row.edit_id as string } }
}
