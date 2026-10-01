"use server"

import { revalidatePath } from "next/cache"

import { confirmFamilyMatch, rejectFamilyMatch, separateFromFamily } from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import type { CorrectionOutcome } from "./correction-outcome"
import { familyOutcome } from "./family-outcome"

const REFUSED_INPUT: CorrectionOutcome = {
  status: "refused",
  field: null,
  message: "Some details could not be read. Reload the page and try again.",
}

const isString = (value: unknown) => typeof value === "string"
const isIdList = (value: unknown) => Array.isArray(value) && value.every(isString)

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.
// Each change reaches other children's leads too, so every lead screen
// refreshes.

// `children` are the ids of the leads the staff member was told move.
export async function confirmMatch(leadId: string, children: string[]): Promise<CorrectionOutcome> {
  if (!isString(leadId) || !isIdList(children)) return REFUSED_INPUT

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return familyOutcome({ kind: "forbidden" })

  const result = await confirmFamilyMatch(supabase, leadId, children)
  if (!result.ok) return familyOutcome(result.error)
  revalidatePath("/staff/leads", "layout")
  return { status: "saved" }
}

// `children` are the ids of the leads the staff member was told the
// rejection reaches.
export async function rejectMatch(leadId: string, children: string[]): Promise<CorrectionOutcome> {
  if (!isString(leadId) || !isIdList(children)) return REFUSED_INPUT

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return familyOutcome({ kind: "forbidden" })

  const result = await rejectFamilyMatch(supabase, leadId, children)
  if (!result.ok) return familyOutcome(result.error)
  revalidatePath("/staff/leads", "layout")
  return { status: "saved" }
}

export async function separateLead(leadId: string): Promise<CorrectionOutcome> {
  if (!isString(leadId)) return REFUSED_INPUT

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return familyOutcome({ kind: "forbidden" })

  const result = await separateFromFamily(supabase, leadId)
  if (!result.ok) return familyOutcome(result.error)
  revalidatePath("/staff/leads", "layout")
  return { status: "saved" }
}
