import type { InterviewFeeStatus } from "@/lib/services/interviews"
import type { DiscountCodeKind, DiscountCodeState, FoundDiscountCode, ReferralState, SetReferralCodeError } from "@/lib/services/referral"

// The Referral code panel's words: the fee, what Save and Clear answer, and
// the note under the input that names the agent or Promo code as the code
// is typed.

export function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// What the fee line adds when the code brought the fee down: the amount the
// code itself takes off, as the database resolves it.
export function discountNote(discountApplied: boolean, amountOff: number): string | null {
  if (!discountApplied || amountOff <= 0) return null
  return `includes ${formatTzs(amountOff)} discount`
}

// A Promo code's state as the panel and the lookups say it.
const PROMO_STATE: Partial<Record<DiscountCodeState, string>> = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  expired: "Expired",
}

export function promoStateLabel(state: DiscountCodeState): string {
  return PROMO_STATE[state] ?? "Unrecognised"
}

// Said wherever a Promo code shows on an application.
export const PROMO_NO_AGENT = "No Marketing Agent. No commission."

export type ReferralFeeLine = { label: string; amount: string; note: string | null; pending: boolean }

// A day in East Africa Time, such as 4 Nov 2026.
const DAY = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Dar_es_Salaam" })

// The panel's fee line. Once the current interview's fee is Paid, the amount
// locked then is what the family paid, so the panel shows that instead of
// the live expected fee, which may have changed since.
export function referralFeeLine(
  referral: {
    amount: number
    discountApplied: boolean
    state: ReferralState | null
    switchedOffAt?: string | null
    kind?: DiscountCodeKind
    discountState?: DiscountCodeState | null
    amountOff?: number
  },
  current: { feeStatus: InterviewFeeStatus; amount: number; discountApplied: boolean } | null,
): ReferralFeeLine {
  if (current?.feeStatus === "Paid") {
    return {
      label: "Interview fee paid",
      amount: formatTzs(current.amount),
      note: current.discountApplied ? "includes the Referral code discount" : null,
      pending: false,
    }
  }
  return {
    label: "Expected interview fee",
    amount: formatTzs(referral.amount),
    note:
      referral.kind === "promo" && referral.discountState && referral.discountState !== "active"
        ? `No discount: Promo code ${promoStateLabel(referral.discountState).toLowerCase()}`
        : referral.state === "switched_off"
          ? `No discount: code switched off${referral.switchedOffAt ? ` on ${DAY.format(new Date(referral.switchedOffAt))}` : ""}`
          : discountNote(referral.discountApplied, referral.amountOff ?? 0),
    pending: referral.state === "pending",
  }
}

export type ReferralOutcome = { status: "saved"; message: string } | { status: "refused"; message: string }

export type ReferralAction = "set" | "clear"

const REFUSED: Record<Exclude<SetReferralCodeError, "no-change"> | "signed-out", string> = {
  forbidden: "Your role can't change the referral code.",
  "not-found": "This lead could not be found. Reload the page.",
  "lead-closed": "This lead is closed, so its referral code can't be changed.",
  "unknown-code": "No Marketing Agent or Promo code has this code. Check it and try again.",
  "retired-code": "This code belongs to a retired Marketing Agent record, so it can't be used. Check it and try again.",
  unavailable: "The referral code could not be saved. Nothing was changed. Try again in a moment.",
  "signed-out": "Your session has ended. Sign in again, then change the referral code.",
}

// Turns what the referral module answered into a plain sentence. The codes
// never reach the screen.
export function referralOutcome(
  result: { ok: true; data: { code: string | null } } | { ok: false; error: SetReferralCodeError | "signed-out" },
  action: ReferralAction,
): ReferralOutcome {
  if (result.ok) {
    return { status: "saved", message: result.data.code ? `Referral code set to ${result.data.code}.` : "Referral code cleared." }
  }
  if (result.error === "no-change") {
    return {
      status: "refused",
      message: action === "set" ? "The lead already has this referral code." : "This lead has no referral code to clear. Reload the page.",
    }
  }
  return { status: "refused", message: REFUSED[result.error] }
}

// Where the lookup of a typed code stands.
export type ReferralLookup =
  | { status: "empty" }
  | { status: "checking" }
  | { status: "found"; code: FoundDiscountCode }
  | { status: "none" }
  | { status: "unavailable" }

// A code a Save can put on an application: anything but a retired agent
// record's.
export function usableCode(lookup: ReferralLookup): FoundDiscountCode | null {
  return lookup.status === "found" && lookup.code.state !== "retired" ? lookup.code : null
}

// Whether the code takes something off the fee now.
export function givesDiscount(lookup: ReferralLookup): boolean {
  return usableCode(lookup) !== null && lookup.status === "found" && lookup.code.amountOff > 0
}

export const RETIRED_CODE_NOTE = "This code belongs to a retired Marketing Agent record, so it can't be used."

// What a found Promo code says: "Instagram ad · Promo code, Active ·
// TZS 25,000 off. No Marketing Agent. No commission."
export function promoCodeNote(code: Pick<FoundDiscountCode, "holderName" | "state" | "amountOff">): string {
  const off = code.amountOff > 0 ? `${formatTzs(code.amountOff)} off` : "no discount"
  return `${code.holderName} · Promo code, ${promoStateLabel(code.state)} · ${off}. ${PROMO_NO_AGENT}`
}

export function referralLookupNote(lookup: ReferralLookup): string {
  switch (lookup.status) {
    case "empty":
      return "Type the agent's code, such as ABC-123, or a Promo code."
    case "checking":
      return "Checking the code…"
    case "found": {
      const code = lookup.code
      if (code.kind === "promo") return promoCodeNote(code)
      if (code.state === "retired") return RETIRED_CODE_NOTE
      if (code.state === "switched_off") return `${code.holderName} · This code is switched off. No discount.`
      return code.state === "approved"
        ? `${code.holderName} · Approved`
        : `${code.holderName} · Pending: no discount until the Manager approves the agent`
    }
    case "none":
      return "No Marketing Agent or Promo code has this code."
    case "unavailable":
      return "The code could not be checked just now. Try again in a moment."
  }
}
