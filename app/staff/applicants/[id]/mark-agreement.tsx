"use client"

import { useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"

import { markAgreement } from "./interview-actions"
import type { AgreementOutcome } from "./interview-outcome"
import { Saved } from "./lead-editors"

const LOST_REQUEST: AgreementOutcome = {
  status: "refused",
  message: "Marking could not be confirmed. Check your connection, reload the page and see whether it was marked.",
}

// Mark agreement signed, in the lead's Next step card, for the heads of
// school (prototype v7). `interviewId` is the current interview while it is
// Conditional with its agreement unmarked, else null. `offer` is "step" when
// marking is the Next step, and gets the step's orange button; "secondary"
// when something else comes first, such as an enrolment by a payment taken
// before the mark, and gets a ghost button beside it, as Record visit does.
// Mounted for everyone who may mark agreements, so its confirmation outlasts
// the refresh that moves the step on.
export function MarkAgreement({
  leadId,
  interviewId,
  offer,
}: {
  leadId: string
  interviewId: string | null
  offer: "step" | "secondary"
}) {
  const [outcome, setOutcome] = useState<AgreementOutcome | null>(null)
  const [pending, startTransition] = useTransition()

  function mark() {
    if (interviewId === null) return
    setOutcome(null)
    startTransition(async () => {
      try {
        setOutcome(await markAgreement(leadId, interviewId))
      } catch {
        setOutcome(LOST_REQUEST)
      }
    })
  }

  if (outcome?.status === "saved" || interviewId === null) {
    return outcome?.status === "saved" ? (
      <div className="basis-full">
        <Saved message={outcome.message} />
      </div>
    ) : null
  }

  return (
    <>
      <Button variant={offer === "step" ? "go" : "ghost"} chevron={offer === "step"} onClick={mark} pending={pending}>
        {pending ? "Marking…" : "Mark agreement signed"}
      </Button>
      {outcome?.status === "refused" && (
        <Note tone="bad" role="alert" className="basis-full">
          {outcome.message}
        </Note>
      )}
    </>
  )
}
