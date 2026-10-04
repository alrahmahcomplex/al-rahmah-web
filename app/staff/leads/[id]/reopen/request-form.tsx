"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { REOPENING_REASON_MAX, type ReopeningSource } from "@/lib/services/reopening-requests"

import { raiseReopeningAction } from "../reopening-actions"
import type { RaiseOutcome } from "../reopening-outcome"

const LOST_REQUEST: RaiseOutcome = {
  status: "refused",
  message: "The request could not be confirmed. Check your connection, then open the lead to see whether it was sent.",
}

// The Reopening request form: why the family is back, required. A request
// that lands goes back to the lead, where it shows as Pending.
export function RequestReopeningForm({ leadId, source }: { leadId: string; source: ReopeningSource }) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = useId()
  const hintId = useId()
  const errorId = useId()

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim() === "") return setMissing(true)
    setMissing(false)
    setRefusal(null)
    startTransition(async () => {
      let outcome: RaiseOutcome
      try {
        outcome = await raiseReopeningAction(leadId, reason, source)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
      else router.push(`/staff/leads/${leadId}`)
    })
  }

  return (
    <form onSubmit={send} noValidate className="flex max-w-xl flex-col gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
      <div className="grid gap-1.5">
        <Label htmlFor={reasonId}>Why is the family back?</Label>
        <Textarea
          id={reasonId}
          value={reason}
          maxLength={REOPENING_REASON_MAX}
          rows={4}
          onChange={(event) => {
            setReason(event.target.value)
            setMissing(false)
          }}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          Required. A Manager reads this before deciding.
        </p>
        {missing && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            Write why the family is back.
          </p>
        )}
      </div>
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  )
}
