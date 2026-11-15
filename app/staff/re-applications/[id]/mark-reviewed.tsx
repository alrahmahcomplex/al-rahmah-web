"use client"

import { useId, useState, useTransition } from "react"

import { Button, FieldError, toast } from "@/components/kit"

import "../re-applications.css"
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
  const errorId = useId()

  function mark() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: MarkReviewedOutcome
      try {
        outcome = await markReviewedAction(reApplicationId)
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "reviewed") toast(outcome.message, { tone: "good" })
      else setRefusal(outcome.message)
    })
  }

  return (
    <div className="ra-act">
      <Button onClick={mark} pending={pending} aria-describedby={refusal ? errorId : undefined}>
        {pending ? "Marking reviewed…" : "Mark reviewed"}
      </Button>
      {refusal && <FieldError id={errorId} message={refusal} alignStart />}
    </div>
  )
}
