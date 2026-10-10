"use server"

import { revalidatePath } from "next/cache"

import { setPreFormOne } from "@/lib/services/pre-form-one"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { preFormOneOutcome, type PreFormOneOutcome } from "./pre-form-one-outcome"

// Ticking or clearing the Pre-Form One programme (#114). Server Actions take
// input from anyone who can post to them, so the shape is checked here, and
// the database then checks leads.edit and the FORM 1 rule.
export async function setPreFormOneAction(leadId: string, ticked: boolean): Promise<PreFormOneOutcome> {
  if (typeof leadId !== "string") return preFormOneOutcome("not-found")
  if (typeof ticked !== "boolean") return preFormOneOutcome("unavailable")

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("leads.edit")) return preFormOneOutcome("forbidden")

  const result = await setPreFormOne(supabase, leadId, ticked)
  if (!result.ok) return preFormOneOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "done" }
}
