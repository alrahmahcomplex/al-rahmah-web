import type { ChipTone } from "../agents/discount-fields"
import { discountRefusal, plural, tzs } from "../agents/discount-outcome"

import type { DiscountWriteError } from "@/lib/services/discount-codes"
import type { PromoEffectiveState, PromoState, PromoWriteError } from "@/lib/services/promo-codes"

// The Promo codes page's words: states, the live code check, the comparison
// with agents' amounts, and what each save answers. Database codes never
// reach the screen.

export const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,12}$/
export const PROMO_NAME_MAX = 80
export const PROMO_NOTE_MAX = 200

// The code as typed, the way the database stores it.
export function typedPromoCode(typed: string): string {
  return typed.replace(/\s/g, "").toUpperCase()
}

const STATE: Record<PromoEffectiveState, { label: string; tone: ChipTone }> = {
  active: { label: "Active", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
  expired: { label: "Expired", tone: "warn" },
  ended: { label: "Ended", tone: "bad" },
}

export function promoStateChip(state: PromoEffectiveState): { label: string; tone: ChipTone } {
  return STATE[state]
}

// An Active code past its last day reads as Expired. `today` is yyyy-mm-dd.
export function effectiveState(state: PromoState, endsOn: string | null, today: string): PromoEffectiveState {
  return state === "active" && endsOn !== null && endsOn < today ? "expired" : state
}

const DAY = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" })

// 2026-12-31 as 31 Dec 2026.
export function formatDay(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`))
}

// "TZS 25,000 · fee TZS 25,000"
export function promoAmountLine(amount: number): { off: string; fee: string } {
  return { off: tzs(amount), fee: `· fee ${tzs(50_000 - amount)}` }
}

export type CodeCheck =
  | { status: "empty" }
  | { status: "unreadable" }
  | { status: "checking" }
  | { status: "available"; code: string }
  | { status: "taken"; code: string; by: "promo-code" | "agent" }
  | { status: "unavailable" }

export const CODE_HELP = "Letters and numbers, 4 to 12."
export const CODE_FIXED = "A code cannot be changed once created."
export const CODE_INVALID = "Letters and numbers only, 4 to 12, no hyphen."

// The line under Code while it is typed, and whether it is a problem.
export function codeCheckLine(check: CodeCheck): { text: string; problem: boolean } {
  switch (check.status) {
    case "empty":
      return { text: CODE_HELP, problem: false }
    case "unreadable":
      return { text: "Letters and numbers only, 4 to 12. No hyphen, so it never looks like an agent’s ABC-123.", problem: false }
    case "checking":
      return { text: "Checking the code…", problem: false }
    case "available":
      return { text: `${check.code} is available.`, problem: false }
    case "taken":
      return { text: `${check.code} is already used by ${check.by === "agent" ? "a Marketing Agent" : "another Promo code"}.`, problem: true }
    case "unavailable":
      return { text: "The code could not be checked just now. It is checked again when you create it.", problem: false }
  }
}

// How the amount compares with the most an agent's code gives.
export function comparisonNote(amount: number, highest: number): { tone: "good" | "warn"; text: string } {
  if (amount > highest) {
    return {
      tone: "good",
      text: `More than any agent gives (${tzs(highest)}). A family with this code gains nothing by switching to an agent's code.`,
    }
  }
  if (amount === highest) {
    return { tone: "warn", text: `Same as the highest agent discount (${tzs(highest)}). An agent's code costs the family nothing extra.` }
  }
  return { tone: "warn", text: `Less than an agent can give (${tzs(highest)}). An agent could offer this family more.` }
}

export const NAME_MISSING = "Give the code a name staff will recognise."
export const NEW_PROMO_META = "Give it a name staff recognise, the code parents type, and the amount off."
export const ENDED_NOTE = "Ended. The code stays in history and on its students and can never be reused."

// Pause, Resume and End, said before they are confirmed.
export function stateVerb(to: PromoState): "Pause" | "Resume" | "End" {
  return to === "ended" ? "End" : to === "paused" ? "Pause" : "Resume"
}

export function stateEffect(to: PromoState): string {
  if (to === "ended") return "Ended for good. The code stays in history and on its students, gives nothing off, and can never be reused."
  if (to === "paused") return "Gives nothing off until resumed. Fees already Paid keep their amount."
  return "Gives its discount again on every fee not yet Paid."
}

export type PromoField = "name" | "code" | "amount" | "endsOn" | "note" | "reason"

export type PromoOutcome = { status: "saved"; message: string } | { status: "refused"; message: string; field?: PromoField }

export const PROMO_LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."

const PROMO_REFUSED: Partial<Record<PromoWriteError | "signed-out", { message: string; field?: PromoField }>> = {
  forbidden: { message: "Your role can't change Promo codes." },
  "not-found": { message: "This Promo code could not be found. Reload the page and try again." },
  "no-change": { message: "Nothing changed. Reload the page to see the code as it is now." },
  "code-taken": { message: "This code is already in use.", field: "code" },
  ended: { message: "This Promo code has ended, so nothing about it can change." },
  "invalid-code": { message: CODE_INVALID, field: "code" },
  "invalid-name": { message: `${NAME_MISSING} Up to ${PROMO_NAME_MAX} characters.`, field: "name" },
  "invalid-note": { message: `Keep the note to ${PROMO_NOTE_MAX} characters.`, field: "note" },
  "invalid-ends-on": { message: "Choose a date, or leave it empty for no end date.", field: "endsOn" },
  "invalid-state": { message: "That change can't be made. Reload the page to see the code as it is now." },
  "invalid-amount": { message: "Whole shillings between 0 and 50,000.", field: "amount" },
  "invalid-reason": { message: "A reason is required, up to 500 characters.", field: "reason" },
  uncertain: { message: PROMO_LOST },
}

export function promoRefusal(error: PromoWriteError | "signed-out"): Extract<PromoOutcome, { status: "refused" }> {
  const known = PROMO_REFUSED[error]
  if (known) return { status: "refused", ...known }
  // The rest are the shared refusals (retired, unavailable, signed-out).
  return { status: "refused", message: discountRefusal(error as DiscountWriteError | "signed-out") }
}

export function createdMessage(code: string): string {
  return `${code} created. Parents can use it now.`
}

// "INSTA26 saved. 6 unpaid fees updated." when the amount or last day moved.
export function savedMessage(code: string, moved: boolean, feeChangeCount: number): string {
  return moved ? `${code} saved. ${plural(feeChangeCount, "unpaid fee")} updated.` : `${code} saved.`
}

export function stateMessage(code: string, to: PromoState): string {
  return `${code} ${to === "active" ? "resumed" : to}.`
}
