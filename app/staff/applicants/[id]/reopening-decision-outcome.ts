import type { Permission } from "@/lib/permissions"
import type { LeadStatus } from "@/lib/services/leads"
import type { DecisionError } from "@/lib/services/reopening-requests"
import type { Result } from "@/lib/services/result"
import type { SeatPriority } from "@/lib/services/school-fee-payments"
import type { SeatCheck } from "@/lib/services/seats"

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
        ? "The lead comes back as Interviewed, and is Enrolled again at once if its payments still qualify."
        : `The lead goes back to ${before}.`,
    )
  }
  if (lead.closure) parts.push(`Its ${lead.closure} mark is cleared${lead.status === "Declined" ? "" : " and its status stays"}.`)
  parts.push("Staff can work on it again.")
  return parts.join(" ")
}

// One lead in the ranking the approver sees, with this lead marked and the
// leads ranked past the last seat flagged.
export type ApprovalSeatHolder = {
  leadId: string
  admissionNumber: string
  studentName: string
  priority: SeatPriority
  rank: number
  thisLead: boolean
  pastLastSeat: boolean
}

// What the approval dialog says about seats (#103), from slice 9's
// seat_check. The check only advises: a full class shows the warning and,
// for staff who may view payments, the ranking; a failed check shows a quiet
// note. Neither stops Approve.
export type ApprovalSeats =
  | { kind: "room" }
  | { kind: "unchecked"; message: string }
  | { kind: "full"; message: string; seats: number; ranked: ApprovalSeatHolder[] | null }

export function approvalSeats(check: Result<SeatCheck, string>): ApprovalSeats {
  if (!check.ok) {
    return {
      kind: "unchecked",
      message: "The seats couldn't be checked, so this can't say whether the class is full. You can still approve.",
    }
  }
  const { wouldOverfill, seats, seatsTaken, priority, ranked } = check.data
  if (!wouldOverfill || seats === null) return { kind: "room" }
  const name = `${check.data.className} ${check.data.dayOrBoarding} ${check.data.enrollmentYear}`
  const withPriority = priority === null ? "," : ` with its Seat priority, ${priority},`
  return {
    kind: "full",
    message:
      `${name} is full: ${seats} ${seats === 1 ? "seat" : "seats"}, ${seatsTaken} taken. Approving gives this lead its seat ` +
      `back${withPriority} so the class will have more leads than seats. You can still approve.`,
    seats,
    ranked:
      ranked === null
        ? null
        : ranked.map((holder) => ({
            leadId: holder.leadId,
            admissionNumber: holder.admissionNumber,
            studentName: holder.studentName,
            priority: holder.priority,
            rank: holder.rank,
            thisLead: holder.thisLead,
            pastLastSeat: holder.rank > seats,
          })),
  }
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
