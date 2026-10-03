"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

import { registerInterview } from "./interview-actions"
import type { RegisterOutcome } from "./interview-outcome"

const LOST_REQUEST: RegisterOutcome = {
  status: "refused",
  message: "The registration could not be sent. Check your connection and try again.",
}

// Register for interview. Rendered for every lead the staff member could
// register, so the confirmation outlasts the refresh that replaces the button
// with the S/N.
export function RegisterInterview({ leadId, canRegister }: { leadId: string; canRegister: boolean }) {
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null)
  const [pending, startTransition] = useTransition()

  function register() {
    setOutcome(null)
    startTransition(async () => {
      try {
        setOutcome(await registerInterview(leadId))
      } catch {
        setOutcome(LOST_REQUEST)
      }
    })
  }

  return (
    <>
      {canRegister && (
        <div className="flex max-w-xl flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
          <p className="text-sm text-slate-900">
            Not registered for interview yet. Registering puts the child on the interview list for their enrollment
            year and gives them the next S/N.
          </p>
          <div>
            <Button type="button" onClick={register} disabled={pending}>
              {pending ? "Registering…" : "Register for interview"}
            </Button>
          </div>
        </div>
      )}
      {outcome?.status === "registered" && (
        <p role="status" className="text-sm text-emerald-700">
          {outcome.message}
        </p>
      )}
      {outcome?.status === "refused" && (
        <Alert variant="destructive" role="alert" className="max-w-xl">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
