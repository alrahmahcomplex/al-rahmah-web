"use server"

import { revalidatePath } from "next/cache"

import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"
import { setPriorSibling } from "@/lib/services/sibling-discount"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { priorSiblingOutcome, type PriorSiblingOutcome } from "./prior-sibling-outcome"

// Ticking or clearing Has a sibling already at Al-Rahmah (#113). Server
// Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks leads.edit and every rule.
export async function setPriorSiblingAction(
  leadId: string,
  sibling: { name: string; className: string } | null,
): Promise<PriorSiblingOutcome> {
  if (typeof leadId !== "string") return priorSiblingOutcome("not-found")
  if (sibling !== null) {
    if (typeof sibling !== "object" || typeof sibling.name !== "string") return priorSiblingOutcome("invalid-name")
    if (!(LEAD_CLASSES as readonly string[]).includes(sibling.className)) return priorSiblingOutcome("invalid-class")
  }

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !staff.data.permissions.includes("leads.edit")) return priorSiblingOutcome("forbidden")

  const result = await setPriorSibling(
    supabase,
    leadId,
    sibling === null ? null : { name: sibling.name, className: sibling.className as LeadClass },
  )
  if (!result.ok) return priorSiblingOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "done" }
}
