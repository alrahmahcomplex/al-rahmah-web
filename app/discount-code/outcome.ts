import type { AgentField } from "@/lib/agent-registration"

// What the Discount code page is told after it sends. Small and stable: no raw
// error ever reaches the page. One status per row of the sign-up decision
// table (#193, lib/services/agent-sign-up.ts), plus the checks before it.
export type DiscountCodeState =
  | { status: "idle" }
  // A new code (or a retry of one), its Referral link and the email given.
  | { status: "registered"; code: string; link: string; email: string }
  // A claim on an existing code waits for the school (or a retry of one).
  | { status: "claimed"; code: string; link: string }
  // Messages that keep the form, each with its own words.
  | { status: "code-needed" }
  | { status: "phone-mismatch" }
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

export type DiscountCodeMessage = Exclude<DiscountCodeState["status"], "idle" | "registered" | "claimed" | "invalid">
