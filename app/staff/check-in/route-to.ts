import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getAdmissionFormFamily, waitingChildren } from "@/lib/services/admission-form-family"

import { checkInHref, mayCheckIn } from "./permissions"

/**
 * Where a lead opens from Home and the Applicants sheet: check-in when it is
 * an Admission form child still waiting for its visit and the staff member
 * may check in (#309), else null and the caller opens the record. A family
 * that can't be read opens the record too: nothing is lost there.
 */
export async function checkInRouteFor(supabase: SupabaseClient, leadId: string, permissions: readonly string[]): Promise<string | null> {
  if (!mayCheckIn(permissions)) return null
  const family = await getAdmissionFormFamily(supabase, leadId)
  if (!family.ok) return null
  return waitingChildren(family.data).some((c) => c.leadId === leadId) ? checkInHref(leadId) : null
}
