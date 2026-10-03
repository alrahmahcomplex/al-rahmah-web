import type { AgentField } from "@/lib/agent-registration"

// What the Discount code page is told after it sends. Small and stable: no raw
// error ever reaches the page.
export type DiscountCodeState =
  | { status: "idle" }
  // The code, new or the one this phone already holds, and its Referral link.
  | { status: "registered"; code: string; link: string }
  | { status: "rate-limited" }
  | { status: "check-failed" }
  | { status: "invalid"; field: AgentField }
  | { status: "unavailable" }
