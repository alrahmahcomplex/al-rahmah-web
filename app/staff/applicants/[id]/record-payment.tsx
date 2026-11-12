"use client"

import { useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"
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
import { Select } from "./form-controls"
import { Field, Input, Saved } from "./lead-editors"
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
// waived, for a lead with a granted Qualified orphan discount, and
// `canPayPreFormOne` the Pre-Form One fee, for a lead whose Pre-Form One tick
// applies.
export function RecordPayment({
  leadId,
  canWaive = false,
  canPayPreFormOne = false,
}: {
  leadId: string
  canWaive?: boolean
  canPayPreFormOne?: boolean
}) {
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
        canPayPreFormOne={canPayPreFormOne}
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
        <Button variant="ghost" size="small" onClick={open} pending={opening}>
          {opening ? "Opening…" : "Record payment"}
        </Button>
      </div>
      {unopened && (
        <Note tone="bad" role="alert">
          The payment form could not open. Check your connection and try again.
        </Note>
      )}
      {saved && <Saved message={saved} />}
    </div>
  )
}

function PaymentForm({
  leadId,
  today,
  canWaive,
  canPayPreFormOne,
  onDone,
}: {
  leadId: string
  today: string
  canWaive: boolean
  canPayPreFormOne: boolean
  onDone: (saved: string | null) => void
}) {
  const [type, setType] = useState<RecordablePaymentType | "">("")
  const waived = type === "fee_waived"
  const choices: readonly RecordablePaymentType[] = [
    ...PAYMENT_TYPES,
    ...(canWaive ? (["fee_waived"] as const) : []),
    ...(canPayPreFormOne ? (["pre_form_one_fee"] as const) : []),
  ]
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
    <Note tone="bad" role="alert">
      {refusal.message}
    </Note>
  )

  if (reviewed) {
    const { input, preview, requestId } = reviewed
    const warning = overfillWarning(preview)
    return (
      <section aria-label="Review payment" className="lr-form lr-inline">
        <p className="lr-text font-semibold">Check this payment before you confirm it. Once recorded, it can&apos;t be changed.</p>
        {refusalAlert}
        {warning && (
          <div role="alert" aria-label="Class full">
            <Note tone="wait">
              <b className="block">Class full</b>
              {warning}
            </Note>
          </div>
        )}
        <dl className="kit-kv">
          <dt>Payment</dt>
          <dd>
            {input.amount === null ? PAYMENT_TYPE_NAMES[input.type] : `${PAYMENT_TYPE_NAMES[input.type]}, TZS ${formatShillings(input.amount)}`}
            <small>Paid {formatDate(input.paidOn)}</small>
          </dd>
          {input.type === "pre_form_one_fee" ? (
            <>
              <dt>Pre-Form One paid after</dt>
              <dd className="kit-num">
                TZS {formatShillings(preview.preFormOne.paidAfter)}
                <small>now TZS {formatShillings(preview.preFormOne.paid)}</small>
              </dd>
              {preview.preFormOne.balanceAfter !== null && (
                <>
                  <dt>Pre-Form One balance after</dt>
                  <dd className="kit-num">
                    TZS {formatShillings(preview.preFormOne.balanceAfter)}
                  </dd>
                </>
              )}
              <dt>School fee</dt>
              <dd>
                Unchanged
                <small>
                  Total paid TZS {formatShillings(preview.totalPaid)}, Seat priority {preview.priority ?? "none"}
                </small>
              </dd>
            </>
          ) : (
            <>
              <dt>Total paid after</dt>
              <dd className="kit-num">
                TZS {formatShillings(preview.totalPaidAfter)}
                <small>now TZS {formatShillings(preview.totalPaid)}</small>
              </dd>
              <dt>Balance after</dt>
              <dd className="kit-num">TZS {formatShillings(preview.balanceAfter)}</dd>
              <dt>Seat priority after</dt>
              <dd>
                {preview.priorityAfter ?? "None"}
                <small>
                  {preview.priorityAfter === preview.priority ? "unchanged" : `now ${preview.priority ?? "none"}`}
                </small>
              </dd>
            </>
          )}
        </dl>
        <div className="lr-acts">
          <Button size="small" onClick={() => confirm(input, requestId)} pending={pending}>
            {pending ? "Recording…" : "Confirm payment"}
          </Button>
          <Button variant="ghost" size="small" onClick={() => setReviewed(null)} aria-disabled={pending || undefined}>
            Change
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form
      aria-label="Record payment"
      className="lr-form lr-inline"
      onSubmit={(event) => {
        event.preventDefault()
        review()
      }}
    >
      {refusalAlert}
      <Field label="Payment type">
        {({ id }) => (
          <Select
            id={id}
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
          </Select>
        )}
      </Field>
      {waived ? (
        <p className="lr-quiet">
          Fee waived has no amount. The Qualified orphan discount covers the whole School fee, and recording it makes the applicant Full.
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
      <div className="lr-acts">
        <Button type="submit" size="small" pending={pending}>
          {pending ? "Checking…" : "Review payment"}
        </Button>
        <Button variant="ghost" size="small" onClick={() => onDone(null)} aria-disabled={pending || undefined}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
