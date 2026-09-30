"use server"

import { revalidatePath } from "next/cache"

import {
  correctVisitDate,
  DAY_OR_BOARDING,
  LEAD_CLASSES,
  RELATIONSHIPS,
  updateGuardianContact,
  updateLeadDetails,
  type ContactChanges,
  type LeadDetailsChanges,
} from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { correctionOutcome, type CorrectionOutcome } from "./correction-outcome"

const REFUSED_INPUT: CorrectionOutcome = {
  status: "refused",
  field: null,
  message: "Some details could not be read. Reload the page and try again.",
}

const isString = (value: unknown) => typeof value === "string"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

export async function correctStudent(leadId: string, changes: LeadDetailsChanges): Promise<CorrectionOutcome> {
  if (
    !isString(leadId) ||
    !isString(changes?.fullName) ||
    !(LEAD_CLASSES as readonly unknown[]).includes(changes.className) ||
    !Number.isInteger(changes.enrollmentYear) ||
    !(DAY_OR_BOARDING as readonly unknown[]).includes(changes.dayOrBoarding)
  ) {
    return REFUSED_INPUT
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await updateLeadDetails(supabase, leadId, {
    fullName: changes.fullName,
    className: changes.className,
    enrollmentYear: changes.enrollmentYear,
    dayOrBoarding: changes.dayOrBoarding,
  })
  if (!result.ok) return correctionOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "saved" }
}

// Corrects the contact of every child on it, so every lead screen refreshes.
export async function correctContact(contactId: string, changes: ContactChanges): Promise<CorrectionOutcome> {
  if (
    !isString(contactId) ||
    !isString(changes?.fullName) ||
    !(RELATIONSHIPS as readonly unknown[]).includes(changes.relationship) ||
    !(changes.relationshipDescription == null || isString(changes.relationshipDescription)) ||
    !isString(changes.phone) ||
    !(changes.whatsapp == null || isString(changes.whatsapp))
  ) {
    return REFUSED_INPUT
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await updateGuardianContact(supabase, contactId, {
    fullName: changes.fullName,
    relationship: changes.relationship,
    relationshipDescription: changes.relationshipDescription ?? null,
    phone: changes.phone,
    whatsapp: changes.whatsapp ?? null,
  })
  if (!result.ok) return correctionOutcome(result.error)
  revalidatePath("/staff/leads", "layout")
  return { status: "saved" }
}

export async function correctVisit(leadId: string, visitDate: string): Promise<CorrectionOutcome> {
  if (!isString(leadId) || !isString(visitDate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    return { status: "refused", field: "visit_date", message: "Choose today or an earlier date for the visit." }
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "visits.record")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await correctVisitDate(supabase, leadId, visitDate)
  if (!result.ok) return correctionOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "saved" }
}
