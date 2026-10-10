import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getLead,
  isClosed,
  updateGuardianContact,
  updateLeadDetails,
  type ContactChanges,
  type CorrectionError,
  type LeadDetailsChanges,
} from "./leads"
import { getReApplication, type ReApplicationField, type SubmittedDetails } from "./re-applications"
import type { Result } from "./result"

// Apply on a Re-application (#78): writes one value the family sent to the
// lead or its parent/guardian contact, through the lead module's ordinary
// corrections. So it needs leads.edit, is audited as the staff member's edit,
// and is refused on a closed lead like any other correction.

export type ApplyError = CorrectionError | { kind: "not-differing" }

export type SubmittedChange = { to: "lead"; changes: LeadDetailsChanges } | { to: "contact"; changes: ContactChanges }

// What Apply writes for one field: that field alone, except that the
// relationship and its details always travel together.
export function submittedChange(field: ReApplicationField, sent: SubmittedDetails): SubmittedChange {
  switch (field) {
    case "student_name":
      return { to: "lead", changes: { fullName: sent.studentName } }
    case "class_name":
      return { to: "lead", changes: { className: sent.className } }
    case "enrollment_year":
      return { to: "lead", changes: { enrollmentYear: sent.enrollmentYear } }
    case "day_or_boarding":
      return { to: "lead", changes: { dayOrBoarding: sent.dayOrBoarding } }
    case "contact_name":
      return { to: "contact", changes: { fullName: sent.contactName } }
    case "relationship":
    case "relationship_description":
      return {
        to: "contact",
        changes: { relationship: sent.relationship, relationshipDescription: sent.relationshipDescription },
      }
    case "phone":
      return { to: "contact", changes: { phone: sent.phone } }
    case "whatsapp":
      return { to: "contact", changes: { whatsapp: sent.whatsapp } }
  }
}

// Applies one field that differed when the re-application arrived. The value
// is read from the re-application, never taken from the caller. A contact
// change reaches every child on the contact; with `expectedChildren`, the ids
// of the leads the staff member was told it reaches, it is refused as
// `children-changed` if they differ by then.
export async function applyReApplicationField(
  supabase: SupabaseClient,
  reApplicationId: string,
  field: ReApplicationField,
  expectedChildren?: string[],
): Promise<Result<null, ApplyError>> {
  const reApplication = await getReApplication(supabase, reApplicationId)
  if (!reApplication.ok) return { ok: false, error: { kind: reApplication.error } }
  if (!reApplication.data.differingFields.includes(field)) return { ok: false, error: { kind: "not-differing" } }

  const lead = await getLead(supabase, reApplication.data.leadId)
  if (!lead.ok) return { ok: false, error: { kind: lead.error } }
  // A closed lead is read-only. The lead's own corrections refuse it in the
  // database; a contact one only once every child on it is closed, so the
  // re-application's lead is checked here too.
  if (isClosed(lead.data)) return { ok: false, error: { kind: "closed" } }

  const change = submittedChange(field, reApplication.data.submitted)
  if (change.to === "lead") return updateLeadDetails(supabase, lead.data.id, change.changes)
  return updateGuardianContact(supabase, lead.data.contact.id, change.changes, expectedChildren)
}
