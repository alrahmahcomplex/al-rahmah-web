import type { DiscountImpactError, DiscountWriteError } from "@/lib/services/discount-codes"
import type { FeeImpactFamily } from "@/lib/services/marketing-agents"

// The words of the discount sheets on Marketing Agents and Promo codes:
// amounts, the fee-impact disclosure, what Save answers. Every amount is
// whole TZS off the standard interview fee.

export const INTERVIEW_FEE = 50_000
export const DISCOUNT_REASON_MAX = 500

export function tzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

// A typed amount as whole shillings, or null when it is not 0 to 50,000.
export function parseAmount(typed: string): number | null {
  const text = typed.trim()
  if (!/^\d{1,6}$/.test(text)) return null
  const amount = Number(text)
  return amount <= INTERVIEW_FEE ? amount : null
}

export const AMOUNT_HINT = "Whole shillings between 0 and 50,000."

export function feeBecomes(amount: number): string {
  return `Fee becomes ${tzs(INTERVIEW_FEE - amount)}`
}

// The help line under the standard amount.
export function standardHelp(amount: number, agentsOnStandard: number): string {
  return `${feeBecomes(amount)} for ${plural(agentsOnStandard, "agent")} on the standard amount. The agent sign-up page quotes this figure.`
}

// "TZS 10,000 off · 3 approved agents on it"
export function standardLine(agentsOnStandard: number): string {
  return `· ${plural(agentsOnStandard, "approved agent")} on it`
}

// The fee-impact disclosure: "3 unpaid interview fees will change".
export function impactSummary(count: number): string {
  return `${plural(count, "unpaid interview fee")} will change`
}

export const NO_IMPACT = "No interview fee changes."

export const PAID_KEEP = "Fees already marked Paid keep their amount."

// The line staff read to each family whose fee moved. Every family on one
// list gets the same new amount.
export function familyNotice(families: readonly Pick<FeeImpactFamily, "feeAfter">[]): string {
  const after = families[0]?.feeAfter
  return after === undefined
    ? "Ada ya usaili imebadilika kutokana na code yako."
    : `Ada ya usaili imebadilika kutokana na code yako. Kiasi kipya ni ${tzs(after)} kwa kila mtoto.`
}

export const IMPACT_LOST = "The families could not be listed just now. Try again in a moment."

const IMPACT_REFUSED: Record<DiscountImpactError | "signed-out", string> = {
  forbidden: "Your role can't change discount amounts.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This agent is retired, so nothing about them can change.",
  "invalid-amount": AMOUNT_HINT,
  unavailable: IMPACT_LOST,
  "signed-out": "Your session has ended. Sign in again, then try again.",
}

export function impactRefusal(error: DiscountImpactError | "signed-out"): string {
  return IMPACT_REFUSED[error]
}

export const DISCOUNT_LOST =
  "The change could not be confirmed. Check your connection, reload the page and see whether the amount changed."

const WRITE_REFUSED: Record<DiscountWriteError | "signed-out", string> = {
  forbidden: "Your role can't change discount amounts.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This agent is retired, so nothing about them can change.",
  "no-change": "The amount is already that. Reload the page to see it as it is now.",
  "invalid-amount": AMOUNT_HINT,
  "invalid-reason": `Write a reason, up to ${DISCOUNT_REASON_MAX} characters.`,
  unavailable: "The change could not be saved just now. Nothing was changed. Try again in a moment.",
  uncertain: DISCOUNT_LOST,
  "signed-out": "Your session has ended. Sign in again, then try again.",
}

export function discountRefusal(error: DiscountWriteError | "signed-out"): string {
  return WRITE_REFUSED[error]
}

export type DiscountOutcome = { status: "saved"; message: string } | { status: "refused"; message: string }

type Written = { ok: true; data: { feeChangeCount: number } } | { ok: false; error: DiscountWriteError | "signed-out" }

// "AJM-407 now gives TZS 15,000 off. 3 unpaid fees updated."
export function agentDiscountOutcome(result: Written, code: string, amount: number): DiscountOutcome {
  if (!result.ok) return { status: "refused", message: discountRefusal(result.error) }
  return {
    status: "saved",
    message: `${code} now gives ${tzs(amount)} off. ${plural(result.data.feeChangeCount, "unpaid fee")} updated.`,
  }
}

// "Standard discount is now TZS 12,000 off."
export function standardDiscountOutcome(result: Written, amount: number): DiscountOutcome {
  if (!result.ok) return { status: "refused", message: discountRefusal(result.error) }
  return { status: "saved", message: `Standard discount is now ${tzs(amount)} off.` }
}

export const AGENT_REASON_MISSING = "A reason is required, like every agent change."
export const REASON_MISSING = "A reason is required."

export const LOCKED_NOTE = "Only a role with “Set discount amounts and Promo codes” can change this."
