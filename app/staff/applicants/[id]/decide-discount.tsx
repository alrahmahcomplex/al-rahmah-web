"use client"

import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DISCOUNT_TEXT_MAX } from "@/lib/services/discounts"

import { decideDiscountAction } from "./discount-actions"
import type { DiscountOutcome } from "./discount-outcome"

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
// Manager, on the lead and on the Discount requests screen. Each asks in a
// dialog first. A decision that lands refreshes the page.
export function DecideDiscount(props: DecideDiscountProps) {
  return (
    <div className="flex flex-wrap gap-2">
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

  function changeOpen(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) setRefusal(null)
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => changeOpen(true)}>
        Grant
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              send(() => decideDiscountAction(leadId, requestId, "grant", null), () => setOpen(false))
            }}
          >
            <DialogHeader>
              <DialogTitle>Grant {studentName} the discount?</DialogTitle>
              <DialogDescription>
                {admissionNumber}. {discount}. The School fee goes down at once, and the lead becomes Enrolled if its payments now
                reach the line. A granted discount can&apos;t be taken back here.
              </DialogDescription>
            </DialogHeader>
            {refusal && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Granting…" : "Grant discount"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
      <Button type="button" size="sm" variant="outline" onClick={() => changeOpen(true)}>
        Refuse
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={refuse} noValidate>
            <DialogHeader>
              <DialogTitle>Refuse {studentName} the discount?</DialogTitle>
              <DialogDescription>
                {admissionNumber}. {discount}. The School fee stays as it is. The person who asked reads your reason on the lead.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={reasonId}>Why is it refused?</Label>
              <Textarea
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
              <p id={hintId} className="text-xs text-muted-foreground">
                Required.
              </p>
            </div>
            {missing && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                Write why the discount is refused.
              </p>
            )}
            {refusal && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Refusing…" : "Refuse request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
