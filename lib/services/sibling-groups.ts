import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// Sibling groups (#300, #301): "Sibling of" linking and the father's-name
// check. The database decides everything: whether the names are the same,
// close or different, who in the group pays full and who gets the Sibling
// 10%. This module only calls it. The screens come in #308 to #310.

// The outcome of a linked lead's father's-name check. Only `matched` and
// `typo_confirmed` count for the Sibling discount; `request_needed` waits for
// a Sibling request the Admissions Manager grants (#302).
export type SiblingBasis = "matched" | "typo_confirmed" | "request_needed"

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
