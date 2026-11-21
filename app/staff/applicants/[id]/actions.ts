"use server"

import { revalidatePath } from "next/cache"

import { LAST_NAME_FROM, type LastNameFrom } from "@/lib/names"
import { tanzaniaToday } from "@/lib/school-calendar"
import {
  correctVisitDate,
  DAY_OR_BOARDING,
  LEAD_CLASSES,
  recordVisit,
  RELATIONSHIPS,
  updateGuardianContact,
  updateLeadDetails,
  type ContactChanges,
  type LeadDetailsChanges,
} from "@/lib/services/leads"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { correctionOutcome, type CorrectionOutcome } from "./correction-outcome"
import { recordVisitOutcome } from "./record-visit-outcome"

const REFUSED_INPUT: CorrectionOutcome = {
  status: "refused",
  field: null,
  message: "Some details could not be read. Reload the page and try again.",
}

const isString = (value: unknown) => typeof value === "string"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

// A field left out keeps its value, so a screen that changes one answer (the
// Family page, #512) sends only that one and never overwrites the others with
// what it read earlier. At least one field is sent. A last-name choice must
// come inside `nameParts` with all four parts; sent without them it is refused.
export async function correctStudent(leadId: string, changes: LeadDetailsChanges): Promise<CorrectionOutcome> {
  const absent = (value: unknown) => value === undefined
  const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
  const raw = changes && typeof changes === "object" ? (changes as Record<string, unknown>) : null
  const parts = raw ? changes.nameParts : undefined
  const partsValid =
    parts === undefined ||
    (parts !== null &&
      typeof parts === "object" &&
      nonEmpty(parts.firstName) &&
      nonEmpty(parts.fatherFirst) &&
      nonEmpty(parts.fatherMiddle) &&
      nonEmpty(parts.fatherLast) &&
      (absent(parts.lastNameFrom) || (LAST_NAME_FROM as readonly unknown[]).includes(parts.lastNameFrom)))
  if (
    !isString(leadId) ||
    !raw ||
    // A last-name choice without the four name parts is refused before the database.
    !absent(raw.lastNameFrom) ||
    !absent(raw.last_name_from) ||
    !partsValid ||
    (parts !== undefined && !absent(changes.fullName)) ||
    !(absent(changes.fullName) || isString(changes.fullName)) ||
    !(absent(changes.className) || (LEAD_CLASSES as readonly unknown[]).includes(changes.className)) ||
    !(absent(changes.enrollmentYear) || Number.isInteger(changes.enrollmentYear)) ||
    !(absent(changes.dayOrBoarding) || (DAY_OR_BOARDING as readonly unknown[]).includes(changes.dayOrBoarding)) ||
    [changes.fullName, parts, changes.className, changes.enrollmentYear, changes.dayOrBoarding].every(absent)
  ) {
    return REFUSED_INPUT
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await updateLeadDetails(supabase, leadId, {
    fullName: changes.fullName,
    ...(parts
      ? {
          nameParts: {
            firstName: parts.firstName,
            fatherFirst: parts.fatherFirst,
            fatherMiddle: parts.fatherMiddle,
            fatherLast: parts.fatherLast,
            ...(parts.lastNameFrom !== undefined ? { lastNameFrom: parts.lastNameFrom as LastNameFrom } : {}),
          },
        }
      : {}),
    className: changes.className,
    enrollmentYear: changes.enrollmentYear,
    dayOrBoarding: changes.dayOrBoarding,
  })
  if (!result.ok) return correctionOutcome(result.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  return { status: "saved" }
}

// Corrects the contact of every child on it, so every lead screen refreshes.
// `children` are the ids of every lead on the contact when the form opened:
// the ones the staff member was told the change reaches. `leadId` is the
// child whose page the form is on: its relationship is the one edited (#312).
export async function correctContact(
  contactId: string,
  changes: ContactChanges,
  children: string[],
  leadId: string,
): Promise<CorrectionOutcome> {
  // As with correctStudent, a field left out keeps its value (the Family page
  // sends only what changed). The record's form sends them all.
  const absent = (value: unknown) => value === undefined
  if (
    !isString(contactId) ||
    !isString(leadId) ||
    !Array.isArray(children) ||
    !children.every(isString) ||
    !changes ||
    typeof changes !== "object" ||
    !(absent(changes.fullName) || isString(changes.fullName)) ||
    !(absent(changes.relationship) || (RELATIONSHIPS as readonly unknown[]).includes(changes.relationship)) ||
    !(changes.relationshipDescription == null || isString(changes.relationshipDescription)) ||
    !(absent(changes.phone) || isString(changes.phone)) ||
    !(changes.whatsapp == null || isString(changes.whatsapp)) ||
    [changes.fullName, changes.relationship, changes.phone, changes.whatsapp].every(absent)
  ) {
    return REFUSED_INPUT
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.edit")
  if (!allowed.ok) return correctionOutcome({ kind: "forbidden" })

  const result = await updateGuardianContact(supabase, contactId, {
    fullName: changes.fullName,
    relationship: changes.relationship,
    // The description goes with its relationship, never on its own.
    relationshipDescription: absent(changes.relationship) ? undefined : (changes.relationshipDescription ?? null),
    phone: changes.phone,
    // Left out keeps the number; null clears it.
    whatsapp: absent(changes.whatsapp) ? undefined : (changes.whatsapp ?? null),
  }, children, undefined, leadId)
  if (!result.ok) return correctionOutcome(result.error)
  revalidatePath("/staff/applicants", "layout")
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
  revalidatePath(`/staff/applicants/${leadId}`)
  return { status: "saved" }
}

// Today in Tanzania by the server's clock, which the database's date check
// shares, for the Record visit form to start from as it opens.
export async function visitDateToday(): Promise<string> {
  return tanzaniaToday()
}

// Records the visit of an Applied family, which moves the lead to Visited.
export async function recordArrival(leadId: string, visitDate: string): Promise<CorrectionOutcome> {
  if (!isString(leadId) || !isString(visitDate) || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    return recordVisitOutcome({ kind: "invalid", field: "visit_date" })
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "visits.record")
  if (!allowed.ok) return recordVisitOutcome({ kind: "forbidden" })

  const result = await recordVisit(supabase, leadId, visitDate)
  if (!result.ok) return recordVisitOutcome(result.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  return { status: "saved" }
}
