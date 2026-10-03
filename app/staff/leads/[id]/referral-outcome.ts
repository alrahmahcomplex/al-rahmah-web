import type { ReferralAgent, SetReferralCodeError } from "@/lib/services/referral"

// The Referral code panel's words: the fee, what Save and Clear answer, and
// the note under the input that names the agent as the code is typed.

export function formatTzs(amount: number): string {
  return `TZS ${amount.toLocaleString("en-US")}`
}

export type ReferralOutcome = { status: "saved"; message: string } | { status: "refused"; message: string }

export type ReferralAction = "set" | "clear"

const REFUSED: Record<Exclude<SetReferralCodeError, "no-change"> | "signed-out", string> = {
  forbidden: "Your role can't change the referral code.",
  "not-found": "This lead could not be found. Reload the page.",
  "lead-closed": "This lead is closed, so its referral code can't be changed.",
  "unknown-code": "No Marketing Agent has this code. Check it and try again.",
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
