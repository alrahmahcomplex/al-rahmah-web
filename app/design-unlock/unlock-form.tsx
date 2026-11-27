"use client"

import { useRef, useState, useTransition, type FormEvent } from "react"

import { Hint, QuestionTitle, StepIcon } from "@/components/guided-form"
import { Button, FieldError, PasswordField, TaskCard } from "@/components/kit"

import { unlockDesign, type UnlockResult } from "../design/actions"
import "./unlock.css"

type Failure = Extract<UnlockResult, { ok: false }>["error"]

const MESSAGES: Record<Failure | "offline", string> = {
  empty: "Enter the password.",
  wrong: "That password isn’t right. Check it and try again.",
  tries: "Too many tries. Wait 10 minutes, then try again.",
  unset: "The design site isn’t set up yet. Ask the school office.",
  offline: "The password couldn’t be checked. Check your connection and try again.",
}

/**
 * The lock screen's task card: the lock, the title, the password field with
 * its eye, Open. Right, the browser stays open for 30 days and the page it
 * asked for opens in place; wrong, the field says what to do.
 */
export function UnlockForm() {
  const [error, setError] = useState<Failure | "offline" | null>(null)
  const [opening, startOpening] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const given = new FormData(event.currentTarget).get("password")
    startOpening(async () => {
      let result: UnlockResult | null = null
      try {
        result = await unlockDesign(typeof given === "string" ? given : "")
      } catch {
        setError("offline")
        return
      }
      if (result.ok) {
        // The same address again: now the routing layer serves the page.
        window.location.reload()
        return
      }
      setError(result.error)
      input.current?.focus()
      input.current?.select()
    })
  }

  const waiting = error === "tries" || error === "unset"
  return (
    <TaskCard className="du-card">
      <h1 className="sr-only">Al-Rahmah Complex design system</h1>
      <StepIcon name="lock" />
      <div className="du-head">
        <QuestionTitle>Design system</QuestionTitle>
        <Hint className="text-center">Enter the password to see our colours, parts and code.</Hint>
      </div>
      <form className="du-form" onSubmit={submit} noValidate>
        <div>
          <PasswordField
            ref={input}
            name="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete="current-password"
            showLabel="Show password"
            hideLabel="Hide password"
            invalid={error !== null && error !== "offline"}
            aria-describedby="du-error"
            disabled={opening}
            onChange={() => !waiting && setError(null)}
          />
          <FieldError id="du-error" message={error ? MESSAGES[error] : undefined} />
        </div>
        <Button type="submit" size="wide" pending={opening}>
          {opening ? "Opening…" : "Open"}
        </Button>
      </form>
      <p className="du-foot">Ask the school office for the password.</p>
    </TaskCard>
  )
}
