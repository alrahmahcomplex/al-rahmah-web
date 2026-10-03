"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { InterviewResult } from "@/lib/services/interviews"

import { visitDateToday } from "./actions"
import { recordResult } from "./interview-actions"
import type { RecordOutcome, ResultField } from "./interview-outcome"
import { Field } from "./lead-editors"

const LOST_REQUEST: RecordOutcome = {
  status: "refused",
  field: null,
  message: "The result could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

const RESULTS: readonly InterviewResult[] = ["Passed", "Failed"]

export type RecordedInterview = {
  id: string
  // The day it was registered, in Tanzania: the earliest interview date.
  registeredOn: string
  interviewDate: string | null
  result: InterviewResult | null
  score: number | null
}

// Record result on an interview with none yet, Correct result on one that
// has it. The form opens in place of the button, its date starting at today
// in Tanzania as the server sees it, or at the recorded date for a
// correction. The confirmation outlasts the refresh that follows a save.
export function InterviewResultEditor({ leadId, interview }: { leadId: string; interview: RecordedInterview }) {
  // Today in Tanzania while the form is open, else null.
  const [today, setToday] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [unopened, setUnopened] = useState(false)
  const [opening, startOpening] = useTransition()
  const recorded = interview.result !== null

  function open() {
    setSaved(null)
    setUnopened(false)
    startOpening(async () => {
      try {
        setToday(await visitDateToday())
      } catch {
        setUnopened(true)
      }
    })
  }

  if (today) {
    return (
      <ResultForm
        leadId={leadId}
        interview={interview}
        today={today}
        onDone={(message) => {
          setToday(null)
          setSaved(message)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant={recorded ? "outline" : "default"} size={recorded ? "sm" : "default"} onClick={open} disabled={opening}>
          {opening ? "Opening…" : recorded ? "Correct result" : "Record result"}
        </Button>
      </div>
      {unopened && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>The result form could not open. Check your connection and try again.</AlertDescription>
        </Alert>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          {saved}
        </p>
      )}
    </div>
  )
}

function ResultForm({
  leadId,
  interview,
  today,
  onDone,
}: {
  leadId: string
  interview: RecordedInterview
  today: string
  onDone: (saved: string | null) => void
}) {
  const correcting = interview.result !== null
  const [interviewDate, setInterviewDate] = useState(interview.interviewDate ?? today)
  const [result, setResult] = useState<InterviewResult | null>(interview.result)
  const [score, setScore] = useState(interview.score === null ? "" : String(interview.score))
  const [refusal, setRefusal] = useState<Extract<RecordOutcome, { status: "refused" }> | null>(null)
  const [pending, startTransition] = useTransition()
  const invalid = (field: ResultField) => (refusal?.field === field ? true : undefined)

  function save() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: RecordOutcome
      try {
        outcome = await recordResult(leadId, interview.id, {
          interviewDate,
          // The browser asks for both before submitting; an empty one reaches
          // the action as something it refuses as incomplete.
          result: result as InterviewResult,
          score: score.trim() === "" ? Number.NaN : Number(score),
        })
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onDone(outcome.message)
      else setRefusal(outcome)
    })
  }

  return (
    <form
      aria-label={correcting ? "Correct result" : "Record result"}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      {refusal && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{refusal.message}</AlertDescription>
        </Alert>
      )}
      <Field label="Interview date" hint="The day of the interview: today or earlier.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="date"
            required
            min={interview.registeredOn}
            max={today}
            value={interviewDate}
            onChange={(event) => setInterviewDate(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid("interview_date")}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-1.5" aria-invalid={invalid("result")}>
        <legend className="text-sm font-medium">Result</legend>
        <div className="flex gap-4">
          {RESULTS.map((choice) => (
            <label key={choice} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`interview-result-${interview.id}`}
                value={choice}
                required
                checked={result === choice}
                onChange={() => setResult(choice)}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Score (%)" hint="From 0 to 100, with one decimal place at most.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            required
            min={0}
            max={100}
            step={0.1}
            className="max-w-32"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid("score")}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : correcting ? "Save correction" : "Save result"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onDone(null)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
