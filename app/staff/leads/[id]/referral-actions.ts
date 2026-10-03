"use server"

import { revalidatePath } from "next/cache"

import { findReferralAgent, setLeadReferralCode } from "@/lib/services/referral"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { referralOutcome, type ReferralLookup, type ReferralOutcome } from "./referral-outcome"

// The Referral code panel's Save and Clear, and the lookup that names the
// agent as a code is typed. Server Actions take input from anyone who can
// post to them, so the shape is checked here; the database then checks the
// permission, the code and whether the lead is open.

export async function saveLeadReferralCode(leadId: string, code: string | null): Promise<ReferralOutcome> {
  const action = code === null ? "clear" : "set"
  if (typeof leadId !== "string") return referralOutcome({ ok: false, error: "not-found" }, action)
  if (code !== null && typeof code !== "string") return referralOutcome({ ok: false, error: "unknown-code" }, action)

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) {
    const error = allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
    return referralOutcome({ ok: false, error }, action)
  }

  const result = await setLeadReferralCode(supabase, leadId, code)
  if (result.ok) revalidatePath(`/staff/leads/${leadId}`)
  return referralOutcome(result, action)
}

// The agent a typed code belongs to, for staff who may edit the code.
export async function lookUpReferralCode(code: string): Promise<ReferralLookup> {
  if (typeof code !== "string" || code.trim() === "") return { status: "empty" }
  // No code is longer than 20 characters, spaces aside.
  if (code.length > 60) return { status: "none" }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return { status: "unavailable" }

  const found = await findReferralAgent(supabase, code)
  if (!found.ok) return { status: "unavailable" }
  return found.data ? { status: "found", agent: found.data } : { status: "none" }
}
