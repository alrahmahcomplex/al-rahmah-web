"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { lookUpAdmissionNumber } from "./actions"
import type { LookupOutcome } from "./outcome"

const LOST_REQUEST_MESSAGE = "The lookup could not be completed. Check your connection and try again."

// The first question at check-in: the family's Admission Number. A match opens
// the lead; no match offers another try or, for staff who may register, New
// Student.
export function AdmissionNumberLookup({ canRegister }: { canRegister: boolean }) {
  const router = useRouter()
  const [typed, setTyped] = useState("")
  const [outcome, setOutcome] = useState<Exclude<LookupOutcome, { status: "found" }> | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOutcome(null)
    startTransition(async () => {
      let result: LookupOutcome
      try {
        result = await lookUpAdmissionNumber(typed)
      } catch {
        setOutcome({ status: "refused", message: LOST_REQUEST_MESSAGE })
        return
      }
      if (result.status === "found") {
        router.push(result.href)
        return
      }
      setOutcome(result)
    })
  }

  function tryAgain() {
    setTyped("")
    setOutcome(null)
    inputRef.current?.focus()
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <Label htmlFor="admission-number">Admission Number</Label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id="admission-number"
            name="admissionNumber"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setOutcome(null)
            }}
            autoComplete="off"
            spellCheck={false}
            required
            aria-describedby="admission-number-hint"
            aria-invalid={outcome?.status === "not-found" || undefined}
          />
          <Button type="submit" disabled={pending}>
            Continue
          </Button>
        </div>
        <p id="admission-number-hint" className="text-xs text-muted-foreground">
          With or without ADMSN-, for example 40719.
        </p>
      </form>

      {outcome?.status === "not-found" && (
        <Alert variant="destructive" role="alert" className="gap-3 p-3">
          <AlertTitle>No lead with this Admission Number</AlertTitle>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={tryAgain}>
              Try again
            </Button>
            {canRegister && (
              <Link href="/staff/check-in/new" className={buttonVariants()}>
                New Student
              </Link>
            )}
          </div>
        </Alert>
      )}
      {outcome?.status === "refused" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      )}

      {/* The alert above offers New Student itself when nothing matched. */}
      {canRegister && outcome?.status !== "not-found" && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">A family who has never registered this child:</p>
          <div>
            <Link href="/staff/check-in/new" className={buttonVariants({ size: "lg" })}>
              New Student
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
