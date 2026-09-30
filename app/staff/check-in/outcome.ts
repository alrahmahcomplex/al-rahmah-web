import type { CreateLeadError, FamilyMatch, FindFamilyError, InvalidField } from "@/lib/services/leads"

export type Step = "parent" | "student" | "review"

// What the New Student form is told after it submits.
export type RegisterOutcome =
  | { status: "created"; leadId: string; admissionNumber: string }
  // Where staff go to see the lead that already exists: the lead itself, or
  // the Reopening request hand-off when it is closed.
  | { status: "duplicate"; admissionNumber: string; href: string }
  | { status: "refused"; step: Step; field: InvalidField | null; message: string }

// What the Admission Number lookup is told. A match opens the lead itself,
// whatever its status or closure mark.
export type LookupOutcome =
  | { status: "found"; href: string }
  | { status: "not-found" }
  | { status: "refused"; message: string }

// The step each refused field belongs to, so staff land where they can fix it.
const STEP_OF: Record<InvalidField, Step> = {
  start: "review",
  contact: "parent",
  contact_name: "parent",
  relationship: "parent",
  relationship_description: "parent",
  phone: "parent",
  whatsapp: "parent",
  student_name: "student",
  class_name: "student",
  enrollment_year: "student",
  day_or_boarding: "student",
  visit_date: "student",
}

const MESSAGE_OF: Record<InvalidField, string> = {
  start: "This registration could not be started. Try again.",
  contact: "That parent or guardian could not be found. Enter their details again.",
  contact_name: "Enter the parent or guardian's full name.",
  relationship: "Choose how the parent or guardian is related to the student.",
  relationship_description: "Say how the parent or guardian is related to the student.",
  phone: "That phone number can't be read. Enter a Tanzanian number such as 0712 345 678, or an international number starting with +.",
  whatsapp: "That WhatsApp number can't be read. Enter a Tanzanian number such as 0712 345 678, or an international number starting with +. Leave it empty if it is the same as the phone.",
  student_name: "Enter the student's full name.",
  class_name: "Choose the student's class.",
  enrollment_year: "Choose the year the student will enroll.",
  day_or_boarding: "Choose day or boarding.",
  visit_date: "Choose today or an earlier date for the visit.",
}

// Turns what the lead module refused into what the form shows.
export function refusalOutcome(error: CreateLeadError): RegisterOutcome {
  switch (error.kind) {
    case "duplicate": {
      const { id, admissionNumber, status, closure } = error.lead
      const closed = status === "Declined" || closure !== null
      return {
        status: "duplicate",
        admissionNumber,
        href: closed ? `/staff/leads/${id}/reopen?source=duplicate_match` : `/staff/leads/${id}`,
      }
    }
    case "invalid": {
      const field = error.field
      return {
        status: "refused",
        step: field ? STEP_OF[field] : "review",
        field,
        message: field ? MESSAGE_OF[field] : "Some details could not be accepted. Check them and try again.",
      }
    }
    case "forbidden":
      return {
        status: "refused",
        step: "review",
        field: null,
        message: "Your role can't register new students.",
      }
    case "unavailable":
      return {
        status: "refused",
        step: "review",
        field: null,
        message: "The registration could not be saved. Nothing was created. Try again in a moment.",
      }
  }
}

// What the parent step is told after looking for a known Family.
export type FamilyOutcome =
  | { status: "found"; match: FamilyMatch }
  // The staff member may not view leads, so no Family is looked for.
  | { status: "skipped" }
  | { status: "refused"; field: "phone" | "whatsapp" | null; message: string }

// Turns what the Family lookup refused into what the parent step shows.
export function familyRefusal(error: FindFamilyError): FamilyOutcome {
  switch (error.kind) {
    case "invalid":
      return {
        status: "refused",
        field: error.field,
        message: error.field ? MESSAGE_OF[error.field] : "Some details could not be read. Check them and try again.",
      }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't look up families." }
    case "unavailable":
      return {
        status: "refused",
        field: null,
        message: "The check for a known family could not be completed. Try again in a moment.",
      }
  }
}
