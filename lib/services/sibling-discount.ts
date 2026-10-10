import type { SupabaseClient } from "@supabase/supabase-js"

import type { LeadClass } from "./leads"
import type { Result } from "./result"

// The Sibling discount (#113), part of the fees module in a file of its own.
// A child gets 10% off its School fee by itself once another child in its
// confirmed Family is Enrolled; the database works that out, and getLeadFee
// names it. What staff set by hand is the prior-sibling tick: Has a sibling
// already at Al-Rahmah, with the sibling's name and class, for a family whose
// older child enrolled before the system.

// The longest sibling's name the database keeps.
export const PRIOR_SIBLING_NAME_MAX = 200

export type PriorSibling = { name: string; className: LeadClass }

export type SetPriorSiblingError =
  // Signed out, or without leads.edit.
  | "forbidden"
  | "not-found"
  | "lead-closed"
  // A blank or over-long name, or a class that isn't one.
  | "invalid-name"
  | "invalid-class"
  | "unavailable"

function detailField(details: string | null | undefined): unknown {
  try {
    return details ? (JSON.parse(details) as { field?: unknown }).field : null
  } catch {
    return null
  }
}

// Ticks Has a sibling already at Al-Rahmah on an open lead, with the sibling's
// name and class, or clears it with null. Needs leads.edit. The lead's fee is
// recomputed at once, so the discount may enrol it. The same tick again
// changes nothing.
export async function setPriorSibling(
  supabase: SupabaseClient,
  leadId: string,
  sibling: PriorSibling | null,
): Promise<Result<null, SetPriorSiblingError>> {
  const { error } = await supabase.rpc("set_prior_sibling", {
    lead_id: leadId,
    sibling_name: sibling?.name ?? null,
    sibling_class: sibling?.className ?? null,
  })
  if (!error) return { ok: true, data: null }

  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  // 22P02: an id that isn't a uuid, so no lead has it.
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
  if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
  if (error.message === "invalid") {
    return { ok: false, error: detailField(error.details) === "class" ? "invalid-class" : "invalid-name" }
  }
  console.error("Could not set the prior-sibling tick", error)
  return { ok: false, error: "unavailable" }
}

// The lead's prior-sibling tick, null when it isn't ticked. For staff who
// may view leads; anyone else reads nothing, so null too.
export async function getPriorSibling(supabase: SupabaseClient, leadId: string): Promise<Result<PriorSibling | null, "unavailable">> {
  const { data, error } = await supabase
    .from("lead_fee_profiles")
    .select("prior_sibling, prior_sibling_name, prior_sibling_class")
    .eq("lead_id", leadId)
    .maybeSingle<{ prior_sibling: boolean; prior_sibling_name: string | null; prior_sibling_class: LeadClass | null }>()
  if (error) {
    // 22P02: an id that isn't a uuid, so no lead has it.
    if (error.code === "22P02") return { ok: true, data: null }
    console.error("Could not read the prior-sibling tick", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data?.prior_sibling || data.prior_sibling_name === null || data.prior_sibling_class === null) {
    return { ok: true, data: null }
  }
  return { ok: true, data: { name: data.prior_sibling_name, className: data.prior_sibling_class } }
}
