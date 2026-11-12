"use client"

import { useEffect, useId, useRef, useState, useTransition, type RefObject } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import {
  ADJUSTMENT_REASONS,
  RESTORE_REASON,
  VOID_REASON,
  type AdjustmentInput,
  type AdjustmentReason,
} from "@/lib/services/payment-adjustments"
import {
  PAYMENT_TYPE_NAMES,
  PAYMENT_TYPES,
  type PaymentValues,
  type RecordedPaymentType,
} from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"
import { adjustSchoolFeePayment } from "./adjustment-actions"
import type { AdjustmentField, AdjustmentRefusal } from "./adjustment-outcome"
import { Select, TextArea } from "./form-controls"
import { Field, Input, Saved } from "./lead-editors"
import { paymentSummary } from "./payment-text"

const LOST_REQUEST: AdjustmentRefusal = {
  status: "refused",
  field: null,
  message: "The adjustment could not be confirmed. Check your connection and press Save again; it won't be saved twice.",
}

// Typed amounts may carry thousands separators: 1,100,000.
function parseAmount(typed: string): number {
  const plain = typed.replace(/[,\s]/g, "")
  return plain === "" ? Number.NaN : Number(plain)
}

// The later of two YYYY-MM-DD dates: a browser clock running behind never
// offers dates earlier than the server's today.
function laterOf(a: string, b: string) {
  return a > b ? a : b
}

// The types a payment may be adjusted to: a school-fee payment stays among
// the school-fee types, and a Pre-Form One fee or a Fee waived payment keeps
// its type.
function typeChoices(original: RecordedPaymentType): readonly RecordedPaymentType[] {
  if (original === "fee_waived" || original === "pre_form_one_fee") return [original]
  return PAYMENT_TYPES
}

// Adjust on one payment in the Payments list. Opens a sheet holding the
// payment as it counts now; Save adds an adjustment and the list shows it
// under the original entry.
export function AdjustPayment({
  leadId,
  paymentId,
  original,
  effective,
  today,
}: {
  leadId: string
  paymentId: string
  original: PaymentValues
  // How the payment counts now; null once voided.
  effective: PaymentValues | null
  // Today in Tanzania, as the server rendered the panel.
  today: string
}) {
  const [open, setOpen] = useState(false)
  const [openedOn, setOpenedOn] = useState(today)
  const [saved, setSaved] = useState<string | null>(null)
  // Kept here rather than in the form, so closing and reopening the dialog
  // after a lost response still retries with the same id, and the dialog
  // can't be closed while a Save is on its way.
  const sentRef = useRef<SentAdjustment | null>(null)
  const [saving, setSaving] = useState(false)
  // A fresh form each time the sheet opens, as when it mounted on opening.
  const [opening, setOpening] = useState(0)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="small"
        onClick={() => {
          setSaved(null)
          setOpenedOn(laterOf(today, tanzaniaToday()))
          setOpening((count) => count + 1)
          setOpen(true)
        }}
      >
        Adjust
      </Button>
      {/* Only once there is something to say: every payment has its own. */}
      {saved && <Saved message={saved} />}
      <AdjustForm
        key={opening}
        open={open}
        onOpenChange={(next) => (next || !saving) && setOpen(next)}
        leadId={leadId}
        paymentId={paymentId}
        original={original}
        effective={effective}
        today={openedOn}
        sentRef={sentRef}
        onSaving={setSaving}
        onDone={(message) => {
          sentRef.current = null
          setOpen(false)
          setSaved(message)
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}

// One id per adjustment as typed, so a Save retried after a lost response
// saves it once, and a changed adjustment gets an id of its own.
type SentAdjustment = { key: string; requestId: string }

function AdjustForm({
  open,
  onOpenChange,
  leadId,
  paymentId,
  original,
  effective,
  today,
  sentRef,
  onSaving,
  onDone,
  onCancel,
}: {
  leadId: string
  paymentId: string
  original: PaymentValues
  effective: PaymentValues | null
  today: string
  sentRef: RefObject<SentAdjustment | null>
  onSaving: (saving: boolean) => void
  onDone: (message: string) => void
  onCancel: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const formId = useId()
  const voided = effective === null
  const start = effective ?? original
  // A voided payment comes back only with Data-entry correction.
  const reasons: readonly AdjustmentReason[] = voided ? [RESTORE_REASON] : ADJUSTMENT_REASONS
  const [reason, setReason] = useState<AdjustmentReason | "">(voided ? RESTORE_REASON : "")
  const [type, setType] = useState<RecordedPaymentType>(start.type)
  const [amount, setAmount] = useState(start.amount === null ? "" : formatShillings(start.amount))
  const [paidOn, setPaidOn] = useState(start.paidOn > today ? today : start.paidOn)
  const [note, setNote] = useState("")
  const [refusal, setRefusal] = useState<AdjustmentRefusal | null>(null)
  const [pending, startTransition] = useTransition()
  useEffect(() => onSaving(pending), [pending, onSaving])
  const invalid = (field: AdjustmentField) => (refusal?.field === field ? true : undefined)
  const voiding = reason === VOID_REASON
  const waived = type === "fee_waived"

  function save() {
    setRefusal(null)
    const input: AdjustmentInput = voiding
      ? { reason, void: true, note: note.trim() || null }
      : {
          // The browser asks for a reason before submitting; an empty one
          // reaches the action as something it refuses.
          reason: reason as AdjustmentReason,
          void: false,
          type,
          amount: waived ? null : parseAmount(amount),
          paidOn,
          note: note.trim() || null,
        }
    const key = JSON.stringify(input)
    if (sentRef.current?.key !== key) sentRef.current = { key, requestId: crypto.randomUUID() }
    const { requestId } = sentRef.current
    startTransition(async () => {
      try {
        const outcome = await adjustSchoolFeePayment(leadId, paymentId, input, requestId)
        if (outcome.status === "adjusted") onDone(outcome.message)
        else setRefusal(outcome)
      } catch {
        setRefusal(LOST_REQUEST)
      }
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={voided ? "Restore payment" : "Adjust payment"}
      hint={
        voided
          ? `This payment is void. Recorded as: ${paymentSummary(original)}.`
          : `Counts now as: ${paymentSummary(start)}. State what the payment should have said. The original entry stays visible.`
      }
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={formId} size="wide" pending={pending}>
            {pending ? "Saving…" : voiding ? "Void payment" : "Save adjustment"}
          </Button>
          <Button variant="ghost" size="wide" onClick={onCancel} aria-disabled={pending || undefined}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id={formId}
        aria-label="Adjust payment"
        className="lr-form"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        {refusal && (
          <Note tone="bad" role="alert">
            {refusal.message}
          </Note>
        )}
        <Field label="Reason">
          {({ id }) => (
            <Select
              id={id}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value as AdjustmentReason)}
              aria-invalid={invalid("reason")}
            >
              <option value="" disabled>
                Choose a reason
              </option>
              {reasons.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {voiding ? (
          <p className="lr-text">
            Duplicate entry voids this payment: it stops counting toward Total paid. Its entry stays in the list, and Data-entry
            correction can bring it back.
          </p>
        ) : (
          <>
            <Field label="Payment type">
              {({ id }) => (
                <Select
                  id={id}
                  required
                  value={type}
                  onChange={(event) => setType(event.target.value as RecordedPaymentType)}
                  aria-invalid={invalid("type")}
                >
                  {typeChoices(original.type).map((choice) => (
                    <option key={choice} value={choice}>
                      {PAYMENT_TYPE_NAMES[choice]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {!waived && (
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
          </>
        )}
        <Field label="Note (optional)" hint="What was wrong, for whoever reads this later.">
          {({ id, describedBy }) => (
            <TextArea
              id={id}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid("note")}
            />
          )}
        </Field>
      </form>
    </Sheet>
  )
}
