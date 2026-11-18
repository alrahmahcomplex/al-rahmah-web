import type { DetailCorrectionError, DetailField } from "@/lib/services/lead-details"
import type { DecideSiblingRequestError, RequestSiblingDiscountError } from "@/lib/services/sibling-requests"

import { dayOf } from "./reopening-outcome"

// What the father's-name, previous-school and Sibling request screens say
// when the database refuses (#310). The service codes never reach the screen.

export type Refused = { status: "refused"; message: string; field?: DetailField | "note" | null }

const FIELD_MESSAGES: Partial<Record<DetailField, string>> = {
  father_full_name: "Type all three of the father’s names.",
  father_name_answer: "Choose one of the answers.",
  father_name_spelling: "Choose which spelling is right.",
  previous_school_name: "Type the school’s name.",
  previous_school_type: "Choose private or public, and the region.",
  previous_school_region: "Choose private or public, and the region.",
}

export function detailRefusal(error: DetailCorrectionError): Refused {
  switch (error.kind) {
    case "invalid":
      return {
        status: "refused",
        field: error.field,
        message: (error.field && FIELD_MESSAGES[error.field]) ?? "Some details could not be accepted. Check them and try again.",
      }
    case "forbidden":
      return { status: "refused", message: "Your role can't make this change." }
    case "not-found":
      return { status: "refused", message: "This application could not be found. Reload the page." }
    case "closed":
      return { status: "refused", message: "This application has been closed, so it can't be changed. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The change could not be saved. Nothing was changed. Try again in a moment." }
  }
}

export function requestRefusal(error: RequestSiblingDiscountError): Refused {
  switch (error.kind) {
    case "invalid":
      return error.field === "note"
        ? { status: "refused", field: "note", message: "Write what proof the family will bring, in at most 1,000 characters." }
        : { status: "refused", message: "This student can't ask for the Sibling discount now. Reload the page to see the group." }
    case "already-counts":
      return { status: "refused", message: "This student already counts as a sibling. Nothing was sent." }
    case "already-pending": {
      const who = error.requestedBy ? ` by ${error.requestedBy}` : ""
      const when = error.requestedAt ? ` on ${dayOf(error.requestedAt)}` : ""
      return { status: "refused", message: `A Sibling request was already sent${who}${when}. Nothing new was sent.` }
    }
    case "lead-closed":
      return { status: "refused", message: "This application is closed, so it can't take a Sibling request. Reload the page." }
    case "forbidden":
      return { status: "refused", message: "Your role can't request discounts. Nothing was sent." }
    case "not-found":
      return { status: "refused", message: "This application could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The request could not be sent. Nothing was sent. Try again in a moment." }
  }
}

export function decideRefusal(error: DecideSiblingRequestError, doing: "grant" | "refuse" | "preview"): Refused {
  const nothing = doing === "preview" ? "" : " Nothing was changed."
  switch (error) {
    case "stale":
      return {
        status: "refused",
        message: `This student has moved to another group since the request was sent, so it can only be refused.${nothing}`,
      }
    case "refused-request":
      return { status: "refused", message: `An earlier refusal stands between these two groups, so it can only be refused.${nothing}` }
    case "not-pending":
      return { status: "refused", message: "This request was already decided. Reload the page." }
    case "lead-closed":
      return { status: "refused", message: `This application is closed. It can be granted only after it is reopened.${nothing}` }
    case "invalid":
      return { status: "refused", message: "Write why it is refused, in at most 1,000 characters." }
    case "forbidden":
      return { status: "refused", message: "Your role can't decide discounts." }
    case "not-found":
      return { status: "refused", message: "This request could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        message: doing === "preview" ? "What a grant would change could not be worked out. Try again in a moment." : "The decision could not be saved. Try again in a moment.",
      }
  }
}
