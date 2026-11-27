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
// school (prototype v7). `interviewId` is the Conditional interview whose
// agreement is unmarked while that is the step, else null. Mounted for
// everyone who may mark agreements, so its confirmation outlasts the refresh
// that moves the step on to the School fee.
export function MarkAgreement({ leadId, interviewId }: { leadId: string; interviewId: string | null }) {
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
      <Button variant="go" chevron onClick={mark} pending={pending}>
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
