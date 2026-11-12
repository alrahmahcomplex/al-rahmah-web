"use client"

import { useState, useTransition } from "react"

import { Button, Sheet } from "@/components/kit"

import { withdrawReopeningAction } from "./reopening-actions"
import type { WithdrawOutcome } from "./reopening-outcome"

const LOST_REQUEST: WithdrawOutcome = {
  status: "refused",
  message: "The withdrawal could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// Withdraw, on the requester's own Pending request. It asks first: a
// withdrawn request can't be brought back, only replaced by a new one. A
// withdrawal that lands refreshes the panel, which then lists the request as
// Withdrawn.
export function WithdrawReopening({ leadId, requestId }: { leadId: string; requestId: string }) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function withdraw() {
    setOpen(false)
    setRefusal(null)
    startTransition(async () => {
      let outcome: WithdrawOutcome
      try {
        outcome = await withdrawReopeningAction(leadId, requestId)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="ghost" size="small" onClick={() => setOpen(true)} pending={pending}>
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {refusal && (
        <p role="alert" className="lr-error">
          {refusal}
        </p>
      )}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Withdraw your reopening request?"
        hint="The Manager won't see it any more, and the application stays closed. You can send a new request later."
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" onClick={withdraw}>
              Withdraw request
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </>
        }
      >
        {null}
      </Sheet>
    </div>
  )
}
