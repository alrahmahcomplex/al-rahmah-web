"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { markReviewedAction } from "./actions"
import type { MarkReviewedOutcome } from "./outcome"

const LOST_REQUEST: MarkReviewedOutcome = {
  status: "refused",
  message: "The review could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// Mark reviewed, on a re-application nobody has reviewed yet. Once it lands
// the page refreshes and says who reviewed it.
export function MarkReviewed({ reApplicationId }: { reApplicationId: string }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function mark() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: MarkReviewedOutcome
      try {
        outcome = await markReviewedAction(reApplicationId)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "reviewed") toast.success(outcome.message)
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={mark} disabled={pending}>
        {pending ? "Marking reviewed…" : "Mark reviewed"}
      </Button>
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}
    </div>
  )
}
