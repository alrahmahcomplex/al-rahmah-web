"use server"

import { revalidatePath } from "next/cache"

import { markReApplicationReviewed } from "@/lib/services/re-applications"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { markReviewedOutcome, type MarkReviewedOutcome } from "./outcome"

// Marks a re-application reviewed by the signed-in staff member. The database
// checks leads.edit itself and records the review once.
export async function markReviewedAction(reApplicationId: string): Promise<MarkReviewedOutcome> {
  if (typeof reApplicationId !== "string") return markReviewedOutcome({ ok: false, error: "not-found" })

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) {
    const error = allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
    return markReviewedOutcome({ ok: false, error })
  }

  const result = await markReApplicationReviewed(supabase, reApplicationId)
  // The re-application, its lead's list, the queue and the count in the
  // navigation all change.
  if (result.ok || result.error === "no-change") revalidatePath("/staff", "layout")
  return markReviewedOutcome(result.ok ? { ok: true } : result)
}
