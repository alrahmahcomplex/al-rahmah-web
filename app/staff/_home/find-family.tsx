"use client"

import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { Icon } from "@/components/icons"
import { Button, Field, FieldError } from "@/components/kit"

import { lookUpAdmissionNumber } from "../check-in/actions"

const NOT_FOUND = "No applicant with this Admission Number"
const LOST_REQUEST = "The lookup could not be completed. Check your connection and try again."

/**
 * Home's check-in bar (#323): the family's Admission Number, looked up as
 * Check-in always has. An Admission form child still waiting for its visit
 * opens check-in (#309), any other number found the student's record;
 * anything else says why under the bar. Names are searched from the top bar.
 */
export function FindFamily() {
  const router = useRouter()
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    if (typed.trim() === "") {
      inputRef.current?.focus()
      return
    }
    startTransition(async () => {
      try {
        const outcome = await lookUpAdmissionNumber(typed)
        if (outcome.status === "found") router.push(outcome.href)
        else setError(outcome.status === "not-found" ? NOT_FOUND : outcome.message)
      } catch {
        setError(LOST_REQUEST)
      }
    })
  }

  return (
    <form className="hm-find" role="search" aria-label="Check in a family" onSubmit={submit} noValidate>
      <div className="hm-find-bar">
        <span className="hm-find-l" aria-hidden="true">
          <Icon name="checkin" size={18} />
          <b>Check in a family</b>
        </span>
        <Field
          ref={inputRef}
          size="compact"
          icon="search"
          alignStart
          name="number"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value)
            setError(undefined)
          }}
          readOnly={pending}
          placeholder="Admission Number, e.g. ADMSN-90005"
          aria-label="Admission Number"
          autoComplete="off"
          invalid={!!error}
          aria-describedby="hm-find-error"
        />
        <Button type="submit" variant="ghost" size="small" pending={pending}>
          Find the family
        </Button>
      </div>
      <FieldError id="hm-find-error" message={error} alignStart />
    </form>
  )
}
