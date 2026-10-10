import { Badge } from "@/components/ui/badge"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { PaymentAdjustment } from "@/lib/services/payment-adjustments"
import { PAYMENT_TYPE_NAMES, type SchoolFeePayment } from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"
import { AdjustPayment } from "./adjust-payment"
import { paymentSummary } from "./payment-text"

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

function by(name: string | null, at: string) {
  return `${name ?? "a former staff member"}, ${WHEN.format(new Date(at))}`
}

function adjustmentText(adjustment: PaymentAdjustment): string {
  if (adjustment.voided || adjustment.type === null || adjustment.paidOn === null) return `${adjustment.reason}: voided.`
  return `${adjustment.reason}: ${paymentSummary({ type: adjustment.type, amount: adjustment.amount, paidOn: adjustment.paidOn })}.`
}

// A lead's payments, newest first, each as it counts now. A payment that was
// adjusted lists its original entry and every adjustment beneath it, oldest
// first, with who made each and when. Adjust shows only when `canAdjust`:
// for staff who may record payments, on an open or a closed lead alike.
export function PaymentList({ leadId, payments, canAdjust }: { leadId: string; payments: SchoolFeePayment[]; canAdjust: boolean }) {
  const today = tanzaniaToday()
  return (
    <ul aria-label="Payments" className="flex flex-col divide-y rounded-lg text-sm ring-1 ring-foreground/10">
      {payments.map((payment) => {
        const shown = payment.effective ?? payment
        const adjusted = payment.adjustments.length > 0
        return (
          <li key={payment.id} className="flex flex-col gap-2 px-3 py-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {PAYMENT_TYPE_NAMES[shown.type]}
                  {payment.effective === null && <Badge variant="destructive">Void</Badge>}
                  {payment.effective !== null && adjusted && <Badge variant="secondary">Adjusted</Badge>}
                </p>
                {adjusted ? (
                  <p className="text-xs text-muted-foreground">
                    {payment.effective === null
                      ? `No longer counts toward ${payment.type === "pre_form_one_fee" ? "the Pre-Form One fee" : "Total paid"}.`
                      : `Paid ${formatDate(shown.paidOn)}.`}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Paid {formatDate(payment.paidOn)}. Recorded by {by(payment.recordedBy, payment.recordedAt)}.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className={`text-right tabular-nums ${payment.effective === null ? "text-muted-foreground line-through" : "text-slate-900"}`}>
                  {shown.amount === null ? "Waived" : `TZS ${formatShillings(shown.amount)}`}
                </p>
                {canAdjust && (
                  <AdjustPayment
                    leadId={leadId}
                    paymentId={payment.id}
                    original={{ type: payment.type, amount: payment.amount, paidOn: payment.paidOn }}
                    effective={payment.effective}
                    today={today}
                  />
                )}
              </div>
            </div>
            {adjusted && (
              <ol aria-label="Original entry and adjustments" className="flex flex-col gap-1 border-l-2 pl-3 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-slate-900">Original entry: </span>
                  {paymentSummary(payment)}. Recorded by {by(payment.recordedBy, payment.recordedAt)}.
                </li>
                {payment.adjustments.map((adjustment) => (
                  <li key={adjustment.id}>
                    <span className="font-medium text-slate-900">{adjustmentText(adjustment)}</span> Adjusted by{" "}
                    {by(adjustment.recordedBy, adjustment.recordedAt)}.
                    {adjustment.note && <span className="block whitespace-pre-line">Note: {adjustment.note}</span>}
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}
