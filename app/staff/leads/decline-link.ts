import { isDeclinedReason, type DeclinedReason } from "@/lib/services/lead-closure"

// A link straight into a lead's Decline with a reason already chosen (#115):
// the Seats screen sends the Admissions Manager here with No seat available.
// The lead screen opens Decline with that reason only when the staff member
// may pick it; the database checks the permission again on the decline.

export const DECLINE_PARAM = "decline"

export function declineHref(leadId: string, reason: DeclinedReason): string {
  return `/staff/leads/${leadId}?${new URLSearchParams({ [DECLINE_PARAM]: reason })}`
}

// The reason a link asked for, when it is one this staff member may pick.
export function linkedDeclineReason(value: string | null, reasons: readonly DeclinedReason[]): DeclinedReason | null {
  return isDeclinedReason(value) && reasons.includes(value) ? value : null
}
