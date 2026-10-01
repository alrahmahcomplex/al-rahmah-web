import { isClosed, type CorrectionError, type InvalidField } from "@/lib/services/leads"

// What a correction form on the lead screen is told after it saves.
export type CorrectionOutcome =
  | { status: "saved" }
  // The lead the correction would have duplicated, and where staff open it:
  // the lead itself, or the Reopening request hand-off when it is closed.
  | { status: "duplicate"; admissionNumber: string; href: string }
  | { status: "refused"; field: InvalidField | null; message: string }

const MESSAGE_OF: Partial<Record<InvalidField, string>> = {
  contact_name: "Enter the parent or guardian's full name.",
  relationship: "Choose how the parent or guardian is related to the student.",
  relationship_description: "Say how the parent or guardian is related to the student.",
  phone: "That phone number can't be read. Enter a Tanzanian number such as 0712 345 678, or an international number starting with +.",
  whatsapp: "That WhatsApp number can't be read. Enter a Tanzanian number such as 0712 345 678, or an international number starting with +. Leave it empty if it is the same as the phone.",
  student_name: "Enter the student's full name.",
  class_name: "Choose the student's class.",
  enrollment_year: "Choose this year or one of the next two.",
  day_or_boarding: "Choose day or boarding.",
  visit_date: "Choose today or an earlier date for the visit.",
}

// Turns what the lead module refused into what the form shows.
export function correctionOutcome(error: CorrectionError): CorrectionOutcome {
  switch (error.kind) {
    case "duplicate": {
      const { lead } = error
      return {
        status: "duplicate",
        admissionNumber: lead.admissionNumber,
        href: isClosed(lead) ? `/staff/leads/${lead.id}/reopen?source=duplicate_match` : `/staff/leads/${lead.id}`,
      }
    }
    case "invalid":
      return {
        status: "refused",
        field: error.field,
        message: (error.field && MESSAGE_OF[error.field]) ?? "Some details could not be accepted. Check them and try again.",
      }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't make this change." }
    case "not-found":
      return { status: "refused", field: null, message: "This lead could not be found. Reload the page." }
    case "closed":
      return {
        status: "refused",
        field: null,
        message: "This lead has been closed, so it can't be changed. Reload the page.",
      }
    case "children-changed":
      return {
        status: "refused",
        field: null,
        message:
          "The children who share this parent or guardian have changed since you opened the form. Nothing was saved. Reload the page to see who the change reaches.",
      }
    case "not-visited":
      return { status: "refused", field: null, message: "This lead has no visit yet, so there is no Visit date to correct." }
    case "unavailable":
      return { status: "refused", field: null, message: "The change could not be saved. Nothing was changed. Try again in a moment." }
  }
}
