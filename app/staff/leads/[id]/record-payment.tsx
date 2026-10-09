"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/school-calendar"
import {
  PAYMENT_TYPE_NAMES,
  PAYMENT_TYPES,
  type PaymentInput,
  type PaymentPreview,
  type RecordablePaymentType,
} from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"
import { visitDateToday } from "./actions"
import { Field, SELECT_CLASS } from "./lead-editors"
import { previewSchoolFeePayment, recordSchoolFeePayment } from "./payment-actions"
import { overfillWarning, type PaymentField, type PaymentRefusal } from "./payment-outcome"

const LOST_REQUEST: PaymentRefusal = {
  status: "refused",
  field: null,
  message: "The payment could not be confirmed. Check your connection and press Confirm payment again; it won't be recorded twice.",
}

// Typed amounts may carry thousands separators: 1,100,000.
function parseAmount(typed: string): number {
  const plain = typed.replace(/[,\s]/g, "")
  return plain === "" ? Number.NaN : Number(plain)
}

// Record payment on the School fee panel. The form opens in place of the
// button, its date starting at today in Tanzania as the server sees it.
// Review shows what the payment would do; nothing is recorded until Confirm.
// The confirmation outlasts the refresh that follows. `canWaive` offers Fee
// waived, for a lead with a granted Qualified orphan discount.
export function RecordPayment({ leadId, canWaive = false }: { leadId: string; canWaive?: boolean }) {
  const [today, setToday] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [unopened, setUnopened] = useState(false)
  const [opening, startOpening] = useTransition()

  function open() {
    setSaved(null)
    setUnopened(false)
    startOpening(async () => {
      try {
        setToday(await visitDateToday())
      } catch {
        setUnopened(true)
      }
    })
  }

  if (today) {
    return (
      <PaymentForm
        leadId={leadId}
        today={today}
        canWaive={canWaive}
        onDone={(message) => {
          setToday(null)
          setSaved(message)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" onClick={open} disabled={opening}>
          {opening ? "Opening…" : "Record payment"}
        </Button>
      </div>
      {unopened && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>The payment form could not open. Check your connection and try again.</AlertDescription>
        </Alert>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          {saved}
        </p>
      )}
    </div>
  )
}

function PaymentForm({
  leadId,
  today,
  canWaive,
  onDone,
}: {
  leadId: string
  today: string
  canWaive: boolean
  onDone: (saved: string | null) => void
}) {
  const [type, setType] = useState<RecordablePaymentType | "">("")
  const waived = type === "fee_waived"
  const choices: readonly RecordablePaymentType[] = canWaive ? [...PAYMENT_TYPES, "fee_waived"] : PAYMENT_TYPES
  const [amount, setAmount] = useState("")
  const [paidOn, setPaidOn] = useState(today)
  // What Review answered, for the payment as it was typed then.
  // One id per reviewed payment, kept while the review shows, so a Confirm
  // retried after a lost response records it once.
  const [reviewed, setReviewed] = useState<{ input: PaymentInput; preview: PaymentPreview; requestId: string } | null>(
    null,
  )
  const [refusal, setRefusal] = useState<PaymentRefusal | null>(null)
  const [pending, startTransition] = useTransition()
  const invalid = (field: PaymentField) => (refusal?.field === field ? true : undefined)

  function review() {
    setRefusal(null)
    // The browser asks for a type before submitting; an empty one reaches the
    // action as something it refuses.
    const input: PaymentInput = { type: type as RecordablePaymentType, amount: waived ? null : parseAmount(amount), paidOn }
    startTransition(async () => {
      try {
        const outcome = await previewSchoolFeePayment(leadId, input)
        if (outcome.status === "preview") setReviewed({ input, preview: outcome.preview, requestId: crypto.randomUUID() })
        else setRefusal(outcome)
      } catch {
        setRefusal({ ...LOST_REQUEST, message: "The payment could not be checked. Check your connection and try again." })
      }
    })
  }

  function confirm(input: PaymentInput, requestId: string) {
    setRefusal(null)
    startTransition(async () => {
      try {
        const outcome = await recordSchoolFeePayment(leadId, input, requestId)
        if (outcome.status === "recorded") onDone(outcome.message)
        else {
          // Back to the form, so the Accountant can fix what was refused.
          setReviewed(null)
          setRefusal(outcome)
        }
      } catch {
        setRefusal(LOST_REQUEST)
      }
    })
  }

  const refusalAlert = refusal && (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{refusal.message}</AlertDescription>
    </Alert>
  )

  if (reviewed) {
    const { input, preview, requestId } = reviewed
    const warning = overfillWarning(preview)
    return (
      <section aria-label="Review payment" className="flex max-w-xl flex-col gap-4 rounded-lg p-3 ring-1 ring-foreground/10">
        <p className="text-sm font-medium text-slate-900">Check this payment before you confirm it. Once recorded, it can&apos;t be changed.</p>
        {refusalAlert}
        {warning && (
          <Alert aria-label="Class full" className="border-amber-300 bg-amber-50 text-amber-950">
            <AlertTitle>Class full</AlertTitle>
            <AlertDescription className="text-amber-950">{warning}</AlertDescription>
          </Alert>
        )}
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Payment</dt>
          <dd className="text-right text-slate-900">
            {input.amount === null ? PAYMENT_TYPE_NAMES[input.type] : `${PAYMENT_TYPE_NAMES[input.type]}, TZS ${formatShillings(input.amount)}`}
            <span className="block text-xs text-muted-foreground">Paid {formatDate(input.paidOn)}</span>
          </dd>
          <dt className="text-muted-foreground">Total paid after</dt>
          <dd className="text-right tabular-nums text-slate-900">
            TZS {formatShillings(preview.totalPaidAfter)}
            <span className="block text-xs text-muted-foreground">now TZS {formatShillings(preview.totalPaid)}</span>
          </dd>
          <dt className="text-muted-foreground">Balance after</dt>
          <dd className="text-right font-medium tabular-nums text-slate-900">TZS {formatShillings(preview.balanceAfter)}</dd>
          <dt className="text-muted-foreground">Seat priority after</dt>
          <dd className="text-right font-medium text-slate-900">
            {preview.priorityAfter ?? "None"}
            <span className="block text-xs font-normal text-muted-foreground">
              {preview.priorityAfter === preview.priority ? "unchanged" : `now ${preview.priority ?? "none"}`}
            </span>
          </dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => confirm(input, requestId)} disabled={pending}>
            {pending ? "Recording…" : "Confirm payment"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setReviewed(null)} disabled={pending}>
            Change
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form
      aria-label="Record payment"
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        review()
      }}
    >
      {refusalAlert}
      <Field label="Payment type">
        {({ id }) => (
          <select
            id={id}
            className={SELECT_CLASS}
            required
            value={type}
            onChange={(event) => setType(event.target.value as RecordablePaymentType)}
            aria-invalid={invalid("type")}
          >
            <option value="" disabled>
              Choose a type
            </option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {PAYMENT_TYPE_NAMES[choice]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {waived ? (
        <p className="text-sm text-muted-foreground">
          Fee waived has no amount. The Qualified orphan discount covers the whole School fee, and recording it makes the lead Full.
        </p>
      ) : (
        <Field label="Amount (TZS)" hint="Whole shillings, above zero.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              inputMode="numeric"
              required
              autoComplete="off"
              className="max-w-48"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid("amount")}
            />
          )}
        </Field>
      )}
      <Field label="Payment date" hint="The day the family paid: today or earlier.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            max={today}
            className="max-w-48"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid("paid_on")}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Review payment"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onDone(null)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
