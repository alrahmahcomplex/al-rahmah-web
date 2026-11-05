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
import { setLeadReferralCode } from "./referral"
import type { Result } from "./result"

// Apply on a Re-application (#78): writes one value the family sent to the
// lead or its parent/guardian contact, through the lead module's ordinary
// corrections. So it needs leads.edit, is audited as the staff member's edit,
// and is refused on a closed lead like any other correction. The Discount code
// (#84) goes through the lead's Referral code rules instead, which take only
// a code a registered agent holds.

export type ApplyError =
  | CorrectionError
  | { kind: "not-differing" }
  // No agent holds the Discount code the family sent.
  | { kind: "unknown-code" }
  // Only a retired agent record holds it.
  | { kind: "retired-code" }

// The fields Apply writes as a lead or contact correction.
export type CorrectedField = Exclude<ReApplicationField, "discount_code">

export type SubmittedChange = { to: "lead"; changes: LeadDetailsChanges } | { to: "contact"; changes: ContactChanges }

// What Apply writes for one field: that field alone, except that the
// relationship and its details always travel together.
export function submittedChange(field: CorrectedField, sent: SubmittedDetails): SubmittedChange {
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
  // Refuse early for a closed lead. Both correction paths check again in
  // the database while holding the re-application's lead through the write.
  if (isClosed(lead.data)) return { ok: false, error: { kind: "closed" } }

  const sent = reApplication.data.submitted
  if (field === "discount_code") return applyDiscountCode(supabase, lead.data.id, sent.discountCode)

  // A separate WhatsApp number equal to the current phone is normalized to
  // null by the contact correction. Apply Phone first so this value can stay.
  if (field === "whatsapp" && sent.whatsapp === lead.data.contact.phone && sent.phone !== lead.data.contact.phone) {
    return { ok: false, error: { kind: "phone-first" } }
  }

  const change = submittedChange(field, reApplication.data.submitted)
  if (change.to === "lead") return updateLeadDetails(supabase, lead.data.id, change.changes)
  return updateGuardianContact(supabase, lead.data.contact.id, change.changes, expectedChildren, lead.data.id)
}

// The family's Discount code, as the lead's Referral code, through
// setLeadReferralCode: leads.edit, an open lead and a registered agent's code,
// all checked again in the database. A lead that already holds it has
// nothing left to apply, which is what Apply asked for.
async function applyDiscountCode(
  supabase: SupabaseClient,
  leadId: string,
  code: string | null,
): Promise<Result<null, ApplyError>> {
  if (code === null) return { ok: false, error: { kind: "not-differing" } }
  const set = await setLeadReferralCode(supabase, leadId, code)
  if (set.ok) return { ok: true, data: null }
  switch (set.error) {
    case "no-change":
      return { ok: true, data: null }
    case "lead-closed":
      return { ok: false, error: { kind: "closed" } }
    case "forbidden":
    case "not-found":
    case "unknown-code":
    case "retired-code":
    case "unavailable":
      return { ok: false, error: { kind: set.error } }
  }
}
