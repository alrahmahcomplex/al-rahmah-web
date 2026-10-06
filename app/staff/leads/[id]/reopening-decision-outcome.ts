import type { Permission } from "@/lib/permissions"
import type { LeadStatus } from "@/lib/services/leads"
import type { DecisionError } from "@/lib/services/reopening-requests"

// What the approver's Approve and Reject say (#101). The lead closure
// module's codes never reach the screen.

export function canDecideReopening(permissions: readonly Permission[]): boolean {
  return permissions.includes("reopenings.approve")
}

// The retake choice, for a lead declined from Interviewed or Enrolled.
export const RETAKE_LABELS = {
  retake: "Retake the interview",
  enrol: "Enrol without a retaken interview",
} as const

// The choice an approval recorded, in words; null when it didn't apply.
export function retakeChoiceText(enrolWithoutRetake: boolean | null): string | null {
  if (enrolWithoutRetake === null) return null
  return enrolWithoutRetake ? RETAKE_LABELS.enrol : RETAKE_LABELS.retake
}

// What approving does to the lead, shown before the approver confirms.
export function approvalConsequence(lead: {
  status: LeadStatus
  closure: string | null
  statusBefore: LeadStatus | null
  visitDate: string | null
}): string {
  const parts: string[] = []
  if (lead.status === "Declined") {
    // A lead declined before declines recorded the earlier status goes back
    // to the earliest status its Visit date allows, as the database decides.
    const before = lead.statusBefore ?? (lead.visitDate ? "Visited" : "Applied")
    parts.push(
      lead.statusBefore === "Enrolled"
        ? "The lead comes back as Interviewed, and Enrolled is worked out again from its payments."
        : `The lead goes back to ${before}.`,
    )
  }
  if (lead.closure) parts.push(`Its ${lead.closure} mark is cleared${lead.status === "Declined" ? "" : " and its status stays"}.`)
  parts.push("Staff can work on it again.")
  return parts.join(" ")
}

export type DecisionOutcome = { status: "decided" } | { status: "refused"; message: string }

function refusal(error: DecisionError, doing: "approve" | "reject"): string {
  switch (error) {
    case "forbidden":
      return "Your role can't approve or reject reopening requests. Nothing was changed."
    case "invalid":
      return doing === "approve"
        ? "Choose whether the lead retakes the interview or enrols without one, then reload the page if this repeats."
        : "Write why the request is rejected, in at most 1,000 characters."
    case "not-pending":
      return "This request is no longer waiting: someone withdrew or decided it. Reload the page."
    case "not-found":
      return "This request could not be found. Reload the page."
    case "unavailable":
      return `The request could not be ${doing === "approve" ? "approved" : "rejected"}. Nothing was changed. Try again in a moment.`
  }
}

export function approveOutcome(error: DecisionError): DecisionOutcome {
  return { status: "refused", message: refusal(error, "approve") }
}

export function rejectOutcome(error: DecisionError): DecisionOutcome {
  return { status: "refused", message: refusal(error, "reject") }
}
