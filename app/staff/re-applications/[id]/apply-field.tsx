"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { ReApplicationField } from "@/lib/services/re-applications"

import type { CorrectionOutcome } from "../../leads/[id]/correction-outcome"
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

  function apply() {
    setOutcome(null)
    startTransition(async () => {
      let answer: CorrectionOutcome
      try {
        answer = await applyAction(reApplicationId, field, contactChildren)
      } catch {
        answer = LOST_REQUEST
      }
      if (answer.status === "saved") toast.success(`${label} applied to the lead.`)
      else setOutcome(answer)
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" onClick={apply} disabled={pending} aria-label={`Apply ${label}`}>
        {pending ? "Applying…" : "Apply"}
      </Button>
      {outcome?.status === "refused" && (
        <p role="alert" className="text-xs text-destructive">
          {outcome.message}
        </p>
      )}
      {outcome?.status === "duplicate" && (
        <p role="alert" className="text-xs text-destructive">
          That would make this student match{" "}
          <Link href={outcome.href} className="font-mono underline underline-offset-4">
            {outcome.admissionNumber}
          </Link>
          , already on file. Nothing was saved.
        </p>
      )}
    </div>
  )
}
