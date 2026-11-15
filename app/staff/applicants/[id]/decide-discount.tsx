"use client"

import { useId, useState, useTransition } from "react"

import { Button, Note, Sheet } from "@/components/kit"
import { DISCOUNT_TEXT_MAX } from "@/lib/services/discounts"

import { decideDiscountAction } from "./discount-actions"
import type { DiscountOutcome } from "./discount-outcome"
import { TextArea } from "./form-controls"
import "./lead.css"

const LOST_REQUEST: DiscountOutcome = {
  status: "refused",
  message: "The decision could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// What each decision does, said before it is made.
export const GRANT_EFFECT =
  "The School fee goes down at once, and the applicant becomes Enrolled if their payments now reach the line. A granted discount can't be taken back here."
export const REFUSE_EFFECT = "The School fee stays as it is. The person who asked reads your reason on the application."

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
// refreshes the page. The Discount requests screen reviews a request in one
// sheet with the same decision (useDiscountDecision, RefuseReason).
export function DecideDiscount(props: DecideDiscountProps) {
  return (
    <div className="lr-acts">
      {props.canGrant && <GrantDiscount {...props} />}
      <RefuseDiscount {...props} />
    </div>
  )
}

/**
 * Sends a grant or a refusal of one request. `refusal` is the sentence to
 * show when it did not land; `done` runs once it did.
 */
export function useDiscountDecision(leadId: string, requestId: string) {
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

  return {
    refusal,
    clearRefusal: () => setRefusal(null),
    pending,
    grant: (done: () => void) => send(() => decideDiscountAction(leadId, requestId, "grant", null), done),
    refuse: (reason: string, done: () => void) => send(() => decideDiscountAction(leadId, requestId, "refuse", reason), done),
  }
}

/** The reason a refusal needs, and whether to say it is missing. */
export function useRefuseReason() {
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  return {
    reason,
    missing,
    change: (next: string) => {
      setReason(next)
      setMissing(false)
    },
    /** True when there is a reason; otherwise shows the missing line. */
    check: () => {
      if (reason.trim() !== "") return true
      setMissing(true)
      return false
    },
    clearMissing: () => setMissing(false),
    reset: () => {
      setReason("")
      setMissing(false)
    },
  }
}

/** "Why is it refused?" with its hint, and the line when it is left empty. */
export function RefuseReason({
  reason,
  missing,
  onChange,
  autoFocus,
}: {
  reason: string
  missing: boolean
  onChange: (reason: string) => void
  autoFocus?: boolean
}) {
  const reasonId = useId()
  const hintId = useId()
  const errorId = useId()
  return (
    <>
      <div className="lr-field">
        <label htmlFor={reasonId} className="lr-label">
          Why is it refused?
        </label>
        <TextArea
          id={reasonId}
          value={reason}
          maxLength={DISCOUNT_TEXT_MAX}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
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
    </>
  )
}

function GrantDiscount({ leadId, requestId, studentName, admissionNumber, discount }: DecideDiscountProps) {
  const [open, setOpen] = useState(false)
  const { refusal, clearRefusal, pending, grant } = useDiscountDecision(leadId, requestId)
  const formId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) clearRefusal()
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
            {admissionNumber}. {discount}. {GRANT_EFFECT}
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
            grant(() => setOpen(false))
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
  const why = useRefuseReason()
  const { refusal, clearRefusal, pending, refuse } = useDiscountDecision(leadId, requestId)
  const formId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) {
      why.clearMissing()
      clearRefusal()
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!why.check()) return
    refuse(why.reason, () => {
      setOpen(false)
      why.reset()
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
            {admissionNumber}. {discount}. {REFUSE_EFFECT}
          </>
        }
        closeLabel="Close"
        foot={
          <>
            <Button type="submit" form={formId} variant="bad" size="wide" pending={pending}>
              {pending ? "Refusing…" : "Refuse request"}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => changeOpen(false)} aria-disabled={pending || undefined}>
              Cancel
            </Button>
          </>
        }
      >
        <form id={formId} className="lr-form" onSubmit={submit} noValidate>
          <RefuseReason reason={why.reason} missing={why.missing} onChange={why.change} />
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
