import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The Pre-Form One programme (#114), part of the fees module in a file of its
// own. Staff tick it on a FORM 1 lead when the family takes it up. Its fee
// and what has been paid toward it come with getLeadFee; this file sets the
// tick.

export type SetPreFormOneError =
  // Signed out, or without leads.edit.
  | "forbidden"
  | "not-found"
  | "lead-closed"
  // Ticking a lead whose class isn't FORM 1.
  | "not-form-one"
  | "unavailable"

// Ticks or clears the Pre-Form One programme on an open lead. Needs
// leads.edit. Ticking needs a FORM 1 lead; clearing works on any class, so a
// tick that stopped applying after a class correction can be taken off. The
// same choice again changes nothing.
export async function setPreFormOne(
  supabase: SupabaseClient,
  leadId: string,
  ticked: boolean,
): Promise<Result<null, SetPreFormOneError>> {
  const { error } = await supabase.rpc("set_pre_form_one", { lead_id: leadId, ticked })
  if (!error) return { ok: true, data: null }

  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  // 22P02: an id that isn't a uuid, so no lead has it.
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
  if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
  if (error.message === "not_form_one") return { ok: false, error: "not-form-one" }
  console.error("Could not set the Pre-Form One tick", error)
  return { ok: false, error: "unavailable" }
}
