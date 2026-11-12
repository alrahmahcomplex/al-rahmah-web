import { Tag } from "@/components/kit"
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
    <ul aria-label="Payments" className="lr-list">
      {payments.map((payment) => {
        const shown = payment.effective ?? payment
        const adjusted = payment.adjustments.length > 0
        return (
          <li key={payment.id} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="lr-strong flex flex-wrap items-center gap-2">
                  {PAYMENT_TYPE_NAMES[shown.type]}
                  {payment.effective === null && <Tag tone="bad">Void</Tag>}
                  {payment.effective !== null && adjusted && <Tag tone="line">Adjusted</Tag>}
                </p>
                {adjusted ? (
                  <p className="lr-hint">
                    {payment.effective === null
                      ? `No longer counts toward ${payment.type === "pre_form_one_fee" ? "the Pre-Form One fee" : "Total paid"}.`
                      : `Paid ${formatDate(shown.paidOn)}.`}
                  </p>
                ) : (
                  <p className="lr-hint">
                    Paid {formatDate(payment.paidOn)}. Recorded by {by(payment.recordedBy, payment.recordedAt)}.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className={`lr-num text-right ${payment.effective === null ? "lr-quiet line-through" : "lr-strong"}`}>
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
              <ol aria-label="Original entry and adjustments" className="lr-trail">
                <li>
                  <span className="lr-strong">Original entry: </span>
                  {paymentSummary(payment)}. Recorded by {by(payment.recordedBy, payment.recordedAt)}.
                </li>
                {payment.adjustments.map((adjustment) => (
                  <li key={adjustment.id}>
                    <span className="lr-strong">{adjustmentText(adjustment)}</span> Adjusted by{" "}
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
