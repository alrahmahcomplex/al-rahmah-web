"use server"

import { findLeadByAdmissionNumber } from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import type { LookupOutcome } from "./outcome"

// Finds the lead a family's Admission Number belongs to, for anyone who may
// view leads. Registering a family is on Register students (./new/actions.ts).
export async function lookUpAdmissionNumber(typed: string): Promise<LookupOutcome> {
  if (typeof typed !== "string") return { status: "not-found" }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok) return { status: "refused", message: "Your role can't look up applicants." }

  const result = await findLeadByAdmissionNumber(supabase, typed)
  if (result.ok) return { status: "found", href: `/staff/applicants/${result.data}` }
  if (result.error === "not-found") return { status: "not-found" }
  return { status: "refused", message: "The lookup could not be completed. Try again in a moment." }
}
