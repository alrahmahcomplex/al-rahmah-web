import type { InterviewFeeStatus } from "@/lib/services/interviews"
import type { ReferralAgent, ReferralState, SetReferralCodeError } from "@/lib/services/referral"

// The Referral code panel's words: the fee, what Save and Clear answer, and
// the note under the input that names the agent as the code is typed.

export function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// What the fee line adds when an Approved agent's code brought the fee down:
// the discount as interview_discount() gives it, or no figure when that read
// failed, so the panel never states an amount the database doesn't hold.
export function discountNote(discountApplied: boolean, discount: number | null): string | null {
  if (!discountApplied) return null
  return discount === null ? "includes the agent discount" : `includes ${formatTzs(discount)} discount`
}

export type ReferralFeeLine = { label: string; amount: string; note: string | null; pending: boolean }

// The panel's fee line. Once the current interview's fee is Paid, the amount
// locked then is what the family paid, so the panel shows that instead of
// the live expected fee, which may have changed since.
export function referralFeeLine(
  referral: { amount: number; discountApplied: boolean; state: ReferralState | null },
  discount: number | null,
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
    note: discountNote(referral.discountApplied, discount),
    pending: referral.state === "pending",
  }
}

export type ReferralOutcome = { status: "saved"; message: string } | { status: "refused"; message: string }

export type ReferralAction = "set" | "clear"

const REFUSED: Record<Exclude<SetReferralCodeError, "no-change"> | "signed-out", string> = {
  forbidden: "Your role can't change the referral code.",
  "not-found": "This lead could not be found. Reload the page.",
  "lead-closed": "This lead is closed, so its referral code can't be changed.",
  "unknown-code": "No Marketing Agent has this code. Check it and try again.",
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
  | { status: "found"; agent: ReferralAgent }
  | { status: "none" }
  | { status: "unavailable" }

export function referralLookupNote(lookup: ReferralLookup): string {
  switch (lookup.status) {
    case "empty":
      return "Type the agent's code, such as ABC-123."
    case "checking":
      return "Checking the code…"
    case "found":
      return lookup.agent.state === "approved"
        ? `${lookup.agent.fullName} · Approved`
        : `${lookup.agent.fullName} · Pending: no discount until the Manager approves the agent`
    case "none":
      return "No Marketing Agent has this code."
    case "unavailable":
      return "The code could not be checked just now. Try again in a moment."
  }
}
