"use server"

import { revalidatePath } from "next/cache"

import { STUDENT_GENDERS, updateLeadDetails, type StudentGender } from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { getGenderOutlook, type GenderOutlook } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

import { correctionOutcome, type CorrectionOutcome } from "./correction-outcome"

// The Boy or girl answer on Student details (#449, v42): give or change it,
// and, before saving, what the change would do to a placed child's seat.
// The database checks the permission and the rules again.

const isGender = (value: unknown): value is StudentGender => typeof value === "string" && (STUDENT_GENDERS as readonly string[]).includes(value)

export async function correctGender(leadId: string, gender: StudentGender): Promise<CorrectionOutcome> {
  if (typeof leadId !== "string" || !isGender(gender)) {
    return { status: "refused", field: null, message: "Some details could not be read. Reload the page and try again." }
  }
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })
  const result = await updateLeadDetails(supabase, leadId, { gender })
  if (!result.ok) return correctionOutcome(result.error)
  // A correction can move the child's seat, so Seats changes too.
  revalidatePath(`/staff/applicants/${leadId}`)
  revalidatePath("/staff/seats")
  return { status: "saved" }
}

/**
 * What the other answer would do to the child's seat; null when it can't be
 * read, so the sheet saves nothing. The save checks the permission and the
 * rules itself.
 */
export async function genderOutlookAction(leadId: string, gender: StudentGender): Promise<GenderOutlook | null> {
  if (typeof leadId !== "string" || !isGender(gender)) return null
  const supabase = await createClient()
  const outlook = await getGenderOutlook(supabase, leadId, gender)
  return outlook.ok ? outlook.data : null
}
