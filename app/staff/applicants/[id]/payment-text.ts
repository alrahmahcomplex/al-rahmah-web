import { formatDate } from "@/lib/school-calendar"
import { PAYMENT_TYPE_NAMES, type PaymentValues } from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"

// A payment's type, amount and date in one line: "Initial deposit, TZS
// 300,000, paid 25 Sep 2026".
export function paymentSummary(values: PaymentValues): string {
  const amount = values.amount === null ? "waived" : `TZS ${formatShillings(values.amount)}`
  return `${PAYMENT_TYPE_NAMES[values.type]}, ${amount}, paid ${formatDate(values.paidOn)}`
}
