import type { ReApplicationField } from "@/lib/services/re-applications"

// How the Re-applications screens word what a re-application holds.

export const FIELD_LABELS: Record<ReApplicationField, string> = {
  student_name: "Student name",
  class_name: "Class",
  enrollment_year: "Enrollment year",
  day_or_boarding: "Day or boarding",
  contact_name: "Parent or guardian name",
  relationship: "Relationship",
  relationship_description: "Relationship details",
  phone: "Phone",
  whatsapp: "WhatsApp",
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// A time in Tanzania, such as 6 Oct 2026, 09:30.
export function when(at: string): string {
  return WHEN.format(new Date(at))
}

// "Nothing differs", "1 field differs", "3 fields differ".
export function differingText(count: number): string {
  if (count === 0) return "Nothing differs"
  return count === 1 ? "1 field differs" : `${count} fields differ`
}

// A phone stored as +255700000301 shown as +255 700 000 301.
export function displayPhone(phone: string): string {
  const match = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `+255 ${match[1]} ${match[2]} ${match[3]}` : phone
}
