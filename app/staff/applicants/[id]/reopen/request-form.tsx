"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button, Note, TextArea } from "@/components/kit"
import { REOPENING_REASON_MAX, type ReopeningSource } from "@/lib/services/reopening-requests"

import { raiseReopeningAction } from "../reopening-actions"
import type { RaiseOutcome } from "../reopening-outcome"

const LOST_REQUEST: RaiseOutcome = {
  status: "refused",
  message: "The request could not be confirmed. Check your connection, then open the application to see whether it was sent.",
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
      else router.push(`/staff/applicants/${leadId}`)
    })
  }

  return (
    <form onSubmit={send} noValidate className="lr-form">
      <div className="lr-field">
        <label htmlFor={reasonId} className="lr-label">
          Why is the family back?
        </label>
        <TextArea
          id={reasonId}
          value={reason}
          maxLength={REOPENING_REASON_MAX}
          rows={4}
          onChange={(event) => {
            setReason(event.target.value)
            setMissing(false)
          }}
          invalid={missing}
          aria-describedby={missing ? `${hintId} ${errorId}` : hintId}
        />
        <p id={hintId} className="lr-hint">
          Required. A Manager reads this before deciding.
        </p>
        {missing && (
          <p id={errorId} role="alert" className="lr-error">
            Write why the family is back.
          </p>
        )}
      </div>
      {refusal && (
        <Note tone="bad" role="alert">
          {refusal}
        </Note>
      )}
      <div>
        <Button type="submit" pending={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  )
}
