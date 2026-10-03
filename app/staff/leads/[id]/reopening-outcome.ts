import type { Permission } from "@/lib/permissions"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { RaiseError, ReopeningSource, ReopeningState, WithdrawError } from "@/lib/services/reopening-requests"

// What the reopening screens say. The lead closure module's codes never reach
// the screen.

// Where a request was raised, in words.
export const SOURCE_LABELS: Readonly<Record<ReopeningSource, string>> = {
  lead: "Lead screen",
  duplicate_match: "Duplicate match at the front desk",
  re_application: "Re-application",
}

export const STATE_LABELS: Readonly<Record<ReopeningState, string>> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
}

// Raising a request needs either permission: leads.create covers the
// duplicate path, leads.edit the lead screen and re-application review.
export function canRaiseReopening(permissions: readonly Permission[]): boolean {
  return permissions.includes("leads.create") || permissions.includes("leads.edit")
}

// Where the reopen page was reached from. Anything else is the duplicate
// refusal or the front desk's hand-off, the page's first callers.
export function reopeningSourceOf(value: unknown): ReopeningSource {
  return value === "lead" || value === "re_application" ? value : "duplicate_match"
}

// A timestamp as the day it fell on in Tanzania.
export function dayOf(timestamp: string): string {
  return formatDate(tanzaniaToday(new Date(timestamp)))
}

export function alreadyRequested(requestedBy: string | null, requestedAt: string | null): string {
  const who = requestedBy ? ` by ${requestedBy}` : ""
  const when = requestedAt ? ` on ${dayOf(requestedAt)}` : ""
  return `Reopening already requested${who}${when}.`
}

export type RaiseOutcome = { status: "raised" } | { status: "refused"; message: string }

export function raiseOutcome(error: RaiseError): RaiseOutcome {
  switch (error.kind) {
    case "forbidden":
      return { status: "refused", message: "Your role can't request reopening. Nothing was sent." }
    case "invalid":
      return { status: "refused", message: "Write why the family is back, in at most 1,000 characters." }
    case "lead-open":
      return { status: "refused", message: "This lead is open, so there is nothing to reopen. Reload the page." }
    case "already-pending":
      return { status: "refused", message: `${alreadyRequested(error.requestedBy, error.requestedAt)} Nothing new was sent.` }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The request could not be sent. Try again in a moment." }
  }
}

export type WithdrawOutcome = { status: "withdrawn" } | { status: "refused"; message: string }

export function withdrawOutcome(error: WithdrawError): WithdrawOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't withdraw reopening requests. Nothing was changed." }
    case "not-requester":
      return { status: "refused", message: "Only the person who asked can withdraw this request. Nothing was changed." }
    case "not-pending":
      return { status: "refused", message: "This request is no longer waiting, so it can't be withdrawn. Reload the page." }
    case "not-found":
      return { status: "refused", message: "This request could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The request could not be withdrawn. Nothing was changed. Try again in a moment." }
  }
}
