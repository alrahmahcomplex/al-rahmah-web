import type { Lead } from "@/lib/services/leads"
import type { ReApplicationField, SubmittedDetails } from "@/lib/services/re-applications"

import { displayPhone, FIELD_LABELS } from "../format"

// One field of a re-application beside the lead's value now.
export type ComparedField = {
  field: ReApplicationField
  label: string
  stored: string
  sent: string
  // The number as the family typed it, when that reads differently.
  typedAs: string | null
  // Differed from the lead when the re-application arrived: the fields the
  // queue counts, highlighted here.
  differed: boolean
  // The lead holds what the family sent, now: applied, or corrected since.
  matchesNow: boolean
}

const FIELDS: ReApplicationField[] = [
  "student_name",
  "class_name",
  "enrollment_year",
  "day_or_boarding",
  "contact_name",
  "relationship",
  "relationship_description",
  "phone",
  "whatsapp",
]

const whatsappText = (whatsapp: string | null) => (whatsapp ? displayPhone(whatsapp) : "Same as phone")

// The lead's value and the family's, raw and as shown, for one field.
function values(field: ReApplicationField, lead: Lead, sent: SubmittedDetails) {
  const contact = lead.contact
  switch (field) {
    case "student_name":
      return { stored: lead.studentName, sent: sent.studentName }
    case "class_name":
      return { stored: lead.className, sent: sent.className }
    case "enrollment_year":
      return { stored: String(lead.enrollmentYear), sent: String(sent.enrollmentYear) }
    case "day_or_boarding":
      return { stored: lead.dayOrBoarding, sent: sent.dayOrBoarding }
    case "contact_name":
      return { stored: contact.fullName, sent: sent.contactName }
    case "relationship":
      return { stored: contact.relationship, sent: sent.relationship }
    case "relationship_description":
      return {
        stored: contact.relationshipDescription ?? "None",
        sent: sent.relationshipDescription ?? "None",
        same: contact.relationshipDescription === sent.relationshipDescription,
      }
    case "phone":
      return { stored: displayPhone(contact.phone), sent: displayPhone(sent.phone), same: contact.phone === sent.phone }
    case "whatsapp":
      return {
        stored: whatsappText(contact.whatsapp),
        sent: whatsappText(sent.whatsapp),
        same: contact.whatsapp === sent.whatsapp,
        typedAs: sent.whatsappAsSent && sent.whatsappAsSent !== whatsappText(sent.whatsapp) ? sent.whatsappAsSent : null,
      }
  }
}

// Every field the Admission form sends, the lead's value beside the family's.
// The highlight follows what differed on arrival, as the queue counts it.
export function compareFields(lead: Lead, sent: SubmittedDetails, differing: ReApplicationField[]): ComparedField[] {
  const differed = new Set(differing)
  return FIELDS.map((field) => {
    const shown = values(field, lead, sent)
    const phoneTyped = field === "phone" && sent.phoneAsSent !== shown.sent ? sent.phoneAsSent : null
    return {
      field,
      label: FIELD_LABELS[field],
      stored: shown.stored,
      sent: shown.sent,
      typedAs: "typedAs" in shown ? (shown.typedAs ?? null) : phoneTyped,
      differed: differed.has(field),
      matchesNow: "same" in shown ? Boolean(shown.same) : shown.stored === shown.sent,
    }
  })
}

// Request reopening from a re-application. The link names the lead and the
// re-application, never what the family sent.
export function reopeningHref(leadId: string, reApplicationId: string): string {
  const query = new URLSearchParams({ source: "re_application", re_application: reApplicationId })
  return `/staff/leads/${encodeURIComponent(leadId)}/reopen?${query}`
}
