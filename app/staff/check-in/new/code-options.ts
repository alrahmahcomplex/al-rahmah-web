import type { CodeOption } from "@/components/guided-form/code-list"
import type { UsableDiscountCode } from "@/lib/services/referral"

// A listed code as the Discount code list shows it: an agent's code with the
// agent's name, a Promo code with what it takes off the interview fee.
export function codeOptionOf(code: UsableDiscountCode): CodeOption {
  return code.kind === "agent"
    ? { kind: "agent", code: code.code, detail: code.holderName }
    : { kind: "promo", code: code.code, detail: `TZS ${code.amountOff.toLocaleString("en-US")} off` }
}
