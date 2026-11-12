import { formatDate } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"

// The lead's student and parent or guardian as read-only rows, for the lead
// page's Overview cards and the reopening hand-off.

export function studentRows(lead: Lead): [string, string][] {
  return [
    ["Class", lead.className],
    ["Enrollment year", String(lead.enrollmentYear)],
    ["Day or boarding", lead.dayOrBoarding],
    ["Status", lead.status],
    ["Visit date", lead.visitDate ? formatDate(lead.visitDate) : "Not visited yet"],
  ]
}

export function parentRows(lead: Lead): [string, string][] {
  const relationship =
    lead.contact.relationship === "Other" && lead.contact.relationshipDescription
      ? `Other: ${lead.contact.relationshipDescription}`
      : lead.contact.relationship
  return [
    ["Full name", lead.contact.fullName],
    ["Relationship", relationship],
    ["Phone", lead.contact.phone],
    ["WhatsApp", lead.contact.whatsapp ?? "Same as phone"],
  ]
}
