"use client"

import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

import { setPreFormOneAction } from "./pre-form-one-actions"
import { PRE_FORM_ONE_HINT, PRE_FORM_ONE_LABEL, type PreFormOneOutcome } from "./pre-form-one-outcome"

const LOST_REQUEST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."

// The Pre-Form One tick on the School fee panel (#114). It saves as soon as
// it changes. `canTick` lets staff tick it (leads.edit, an open FORM 1 lead);
// `canClear` lets them clear it, on any class, so a tick that stopped
// applying can be taken off. Anyone else sees it without changing it.
export function PreFormOneTick({
  leadId,
  ticked,
  canTick,
  canClear,
}: {
  leadId: string
  ticked: boolean
  canTick: boolean
  canClear: boolean
}) {
  const checkboxId = useId()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const editable = ticked ? canClear : canTick

  function toggle(next: boolean) {
    setRefusal(null)
    startTransition(async () => {
      let outcome: PreFormOneOutcome
      try {
        outcome = await setPreFormOneAction(leadId, next)
      } catch {
        outcome = { status: "refused", message: LOST_REQUEST }
      }
      if (outcome.status === "refused") setRefusal(outcome.message)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id={checkboxId}
          // Base UI marks a disabled checkbox with data-disabled, not :disabled.
          className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
          checked={ticked}
          disabled={!editable || pending}
          onCheckedChange={toggle}
        />
        <span className="flex flex-col gap-0.5">
          <Label htmlFor={checkboxId} className="font-normal text-slate-900">
            {PRE_FORM_ONE_LABEL}
          </Label>
          {!ticked && <span className="text-xs text-muted-foreground">{PRE_FORM_ONE_HINT}</span>}
        </span>
      </div>
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
