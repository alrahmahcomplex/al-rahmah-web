import type { AgentField } from "@/lib/agent-registration"

// What the Discount code page is told after it sends. Small and stable: no raw
// error ever reaches the page. One status per row of the sign-up decision
// table (#193, lib/services/agent-sign-up.ts), plus the checks before it.
export type DiscountCodeState =
  | { status: "idle" }
  // A new code (or a retry of one), its Referral link and the email given.
  // `discount`: what the code takes off the interview fee now, in whole TZS,
  // for the share message; null names no figure (a Pending code, or a lookup
  // that didn't answer).
  | { status: "registered"; code: string; link: string; email: string; discount: number | null }
  // A claim on an existing code waits for the Marketing Office (or a retry of one).
  | { status: "claimed"; code: string; link: string; discount: number | null }
  // Self-confirm (#503 slice 3, only while it is on): code and names match;
  // the page goes on to the choice of how to sign in.
  | { status: "self-confirm"; attempt: string; mobileOnRecord: boolean; typedMatches: boolean; canText: boolean; emailOnRecord: boolean; emailOpen: boolean; email: string; phone: string }
  // Self-confirm locked for the code after too many wrong names.
  | { status: "self-confirm-locked" }
  // Messages that keep the form, each with its own words.
  | { status: "code-needed" }
  | { status: "phone-mismatch" }
  | { status: "name-mismatch" }
  | { status: "no-match" }
  | { status: "claim-waiting" }
  | { status: "invited" }
  | { status: "joined" }
  | { status: "email-unusable" }
  | { status: "access-off" }
  | { status: "rate-limited" }
  | { status: "check-failed" }
  | { status: "invalid"; field: AgentField }
  | { status: "unavailable" }

export type DiscountCodeMessage = Exclude<DiscountCodeState["status"], "idle" | "registered" | "claimed" | "invalid" | "self-confirm">
