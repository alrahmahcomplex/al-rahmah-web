"use client"

import { useState, useTransition } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw your reopening request?</AlertDialogTitle>
            <AlertDialogDescription>
              The Manager won&apos;t see it any more, and the lead stays closed. You can send a new request later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={withdraw}>Withdraw request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
