"use client"

import { useId, useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import { DISCOUNT_TEXT_MAX } from "@/lib/services/discounts"

import { decideDiscountAction } from "./discount-actions"
import type { DiscountOutcome } from "./discount-outcome"
import { TextArea } from "./form-controls"

const LOST_REQUEST: DiscountOutcome = {
  status: "refused",
  message: "The decision could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

type DecideDiscountProps = {
  leadId: string
  requestId: string
  studentName: string
  admissionNumber: string
  // "Staff child (25% off)".
  discount: string
  // False on a closed lead: the request can only be refused.
  canGrant: boolean
}

// Grant and Refuse on a Pending discount request, for the Admissions
// Manager, on the lead. Each asks in a sheet first. A decision that lands
// refreshes the page. The Discount requests screen keeps its own in the old
// look until it converts (app/staff/discounts/decide-discount.tsx).
export function DecideDiscount(props: DecideDiscountProps) {
  return (
    <div className="lr-acts">
      {props.canGrant && <GrantDiscount {...props} />}
      <RefuseDiscount {...props} />
    </div>
  )
}

function useDecision() {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(decide: () => Promise<DiscountOutcome>, done: () => void) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: DiscountOutcome
      try {
        outcome = await decide()
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
      else done()
    })
  }

  return { refusal, setRefusal, pending, send }
}

function GrantDiscount({ leadId, requestId, studentName, admissionNumber, discount }: DecideDiscountProps) {
  const [open, setOpen] = useState(false)
  const { refusal, setRefusal, pending, send } = useDecision()
  const formId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) setRefusal(null)
  }

  return (
    <>
      <Button variant="ghost" size="small" onClick={() => changeOpen(true)}>
        Grant
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Grant ${studentName} the discount?`}
        hint={
          <>
            {admissionNumber}. {discount}. The School fee goes down at once, and the applicant becomes Enrolled if their payments now
            reach the line. A granted discount can&apos;t be taken back here.
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={formId} size="wide" pending={pending}>
              {pending ? "Granting…" : "Grant discount"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="lr-form"
          onSubmit={(event) => {
            event.preventDefault()
            send(() => decideDiscountAction(leadId, requestId, "grant", null), () => setOpen(false))
          }}
        >
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}

function RefuseDiscount({ leadId, requestId, studentName, admissionNumber, discount }: DecideDiscountProps) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const { refusal, setRefusal, pending, send } = useDecision()
  const reasonId = useId()
  const hintId = useId()
  const errorId = useId()
  const formId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      setMissing(false)
      setRefusal(null)
    }
  }

  function refuse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() === "") return setMissing(true)
    send(() => decideDiscountAction(leadId, requestId, "refuse", reason), () => {
      setOpen(false)
      setReason("")
    })
  }

  return (
    <>
      <Button variant="ghost" size="small" onClick={() => changeOpen(true)}>
        Refuse
      </Button>
      <Sheet
        open={open}
        onOpenChange={changeOpen}
        title={`Refuse ${studentName} the discount?`}
        hint={
          <>
            {admissionNumber}. {discount}. The School fee stays as it is. The person who asked reads your reason on the application.
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={formId} size="wide" pending={pending}>
              {pending ? "Refusing…" : "Refuse request"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={formId} className="lr-form" onSubmit={refuse} noValidate>
          <div className="lr-field">
            <label htmlFor={reasonId} className="lr-label">
              Why is it refused?
            </label>
            <TextArea
              id={reasonId}
              value={reason}
              maxLength={DISCOUNT_TEXT_MAX}
              onChange={(event) => {
                setReason(event.target.value)
                setMissing(false)
              }}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
            />
            <p id={hintId} className="lr-hint">
              Required.
            </p>
          </div>
          {missing && (
            <p id={errorId} role="alert" className="lr-error">
              Write why the discount is refused.
            </p>
          )}
          {refusal && (
            <Note tone="bad" role="alert">
              {refusal}
            </Note>
          )}
        </form>
      </Sheet>
    </>
  )
}
