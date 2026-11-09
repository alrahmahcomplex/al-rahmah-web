import type { Permission } from "@/lib/permissions"
import {
  DISCOUNT_NAMES,
  DISCOUNT_PERCENTS,
  type DecideDiscountError,
  type DiscountKind,
  type DiscountRequestState,
  type RequestDiscountError,
} from "@/lib/services/discounts"

import { dayOf } from "./reopening-outcome"

// What the discount panel and the Discount requests screen say (#112). The
// fees module's codes never reach the screen.

export function canRequestDiscount(permissions: readonly Permission[]): boolean {
  return permissions.includes("leads.edit")
}

export function canDecideDiscount(permissions: readonly Permission[]): boolean {
  return permissions.includes("discounts.approve")
}

// "Staff child (25% off)".
export function discountLabel(kind: DiscountKind): string {
  return `${DISCOUNT_NAMES[kind]} (${DISCOUNT_PERCENTS[kind]}% off)`
}

export const DISCOUNT_STATE_LABELS: Readonly<Record<DiscountRequestState, string>> = {
  pending: "Pending",
  granted: "Granted",
  refused: "Refused",
}

// The request form's reminder: the note stays in the lead's history for good.
export const NOTE_HINT =
  "Write only what the Admissions Manager needs to decide. Supporting documents are checked outside the system; don't describe them in detail."

export type DiscountOutcome = { status: "done" } | { status: "refused"; message: string }

export function requestOutcome(error: RequestDiscountError): DiscountOutcome {
  switch (error.kind) {
    case "forbidden":
      return { status: "refused", message: "Your role can't request discounts. Nothing was sent." }
    case "invalid":
      return {
        status: "refused",
        message: error.field === "kind" ? "Choose the discount." : "Write a note for the Manager, in at most 1,000 characters.",
      }
    case "lead-closed":
      return { status: "refused", message: "This lead is closed, so it can't take a discount request. Reload the page." }
    case "already-pending": {
      const who = error.requestedBy ? ` by ${error.requestedBy}` : ""
      const when = error.requestedAt ? ` on ${dayOf(error.requestedAt)}` : ""
      return { status: "refused", message: `A discount was already requested${who}${when}. Nothing new was sent.` }
    }
    case "already-granted":
      return { status: "refused", message: "This lead already has that discount. Nothing new was sent." }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The request could not be sent. Nothing was saved. Try again in a moment." }
  }
}

export function decideOutcome(error: DecideDiscountError, doing: "grant" | "refuse"): DiscountOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't grant or refuse discounts. Nothing was changed." }
    case "invalid":
      return { status: "refused", message: "Write why the discount is refused, in at most 1,000 characters." }
    case "lead-closed":
      return {
        status: "refused",
        message: "This lead is closed, so the discount can't be granted until it is reopened. You can still refuse the request.",
      }
    case "not-pending":
      return { status: "refused", message: "This request is no longer waiting: someone already decided it. Reload the page." }
    case "not-found":
      return { status: "refused", message: "This request could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        message: `The request could not be ${doing === "grant" ? "granted" : "refused"}. Nothing was changed. Try again in a moment.`,
      }
  }
}
