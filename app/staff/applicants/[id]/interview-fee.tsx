"use client"

import { useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"
import type { InterviewFeeStatus } from "@/lib/services/interviews"

import { setFeeStatus } from "./interview-actions"
import type { FeeOutcome } from "./interview-outcome"

const LOST_REQUEST: FeeOutcome = {
  status: "refused",
  message: "The fee status could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// Mark paid on an unpaid fee, Mark not paid on a paid one, for the
// Accountant. There is no amount to type: marking it Paid locks the amount
// the panel shows. The confirmation outlasts the refresh that follows.
export function InterviewFeeControl({
  leadId,
  interviewId,
  feeStatus,
}: {
  leadId: string
  interviewId: string
  feeStatus: InterviewFeeStatus
}) {
  const [outcome, setOutcome] = useState<FeeOutcome | null>(null)
  const [pending, startTransition] = useTransition()
  const paid = feeStatus === "Paid"

  function mark() {
    setOutcome(null)
    startTransition(async () => {
      try {
        setOutcome(await setFeeStatus(leadId, interviewId, paid ? "not_paid" : "paid"))
      } catch {
        setOutcome(LOST_REQUEST)
      }
    })
  }

  return (
    <div className="lr-card">
      <div>
        <Button variant="ghost" size="small" onClick={mark} pending={pending}>
          {pending ? "Saving…" : paid ? "Mark not paid" : "Mark paid"}
        </Button>
      </div>
      {outcome?.status === "saved" && (
        <p role="status" className="lr-saved">
          {outcome.message}
        </p>
      )}
      {outcome?.status === "refused" && (
        <Note tone="bad" role="alert">{outcome.message}</Note>
      )}
    </div>
  )
}
