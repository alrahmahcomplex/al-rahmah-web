"use client"

import Link from "next/link"
import { useId, useState, useTransition } from "react"

import { Button, FieldError, toast } from "@/components/kit"
import type { ReApplicationField } from "@/lib/services/re-applications"

import type { CorrectionOutcome } from "../../applicants/[id]/correction-outcome"
import "../re-applications.css"
import { applyAction } from "./apply-actions"

const LOST_REQUEST: CorrectionOutcome = {
  status: "refused",
  field: null,
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// Apply, on a field that differed: writes what the family sent to the lead or
// its contact. Once it lands the page refreshes and the row matches.
export function ApplyField({
  reApplicationId,
  field,
  label,
  contactChildren,
}: {
  reApplicationId: string
  field: ReApplicationField
  label: string
  contactChildren: string[]
}) {
  const [outcome, setOutcome] = useState<CorrectionOutcome | null>(null)
  const [pending, startTransition] = useTransition()
  const errorId = useId()

  function apply() {
    setOutcome(null)
    startTransition(async () => {
      let answer: CorrectionOutcome
      try {
        answer = await applyAction(reApplicationId, field, contactChildren)
      } catch {
        answer = LOST_REQUEST
      }
      if (answer.status === "saved") toast(`${label} applied to the application.`, { tone: "good" })
      else setOutcome(answer)
    })
  }

  const message =
    outcome?.status === "refused" ? (
      outcome.message
    ) : outcome?.status === "duplicate" ? (
      <>
        That would make this student match{" "}
        <Link href={outcome.href} className="ra-mono ra-error-link">
          {outcome.admissionNumber}
        </Link>
        , already on file. Nothing was saved.
      </>
    ) : undefined

  return (
    <div className="ra-apply">
      <Button
        size="small"
        variant="ghost"
        onClick={apply}
        pending={pending}
        aria-label={`Apply ${label}`}
        aria-describedby={message ? errorId : undefined}
      >
        {pending ? "Applying…" : "Apply"}
      </Button>
      {message && <FieldError id={errorId} message={message} alignStart />}
    </div>
  )
}
