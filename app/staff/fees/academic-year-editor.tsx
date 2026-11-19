"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button, DateField, Note } from "@/components/kit"
import type { AcademicYearField } from "@/lib/services/fees"

import { saveAcademicYear } from "./actions"
import type { AcademicYearOutcome } from "./outcome"

type Refused = Extract<AcademicYearOutcome, { status: "refused" }>

const LOST_REQUEST: Refused = {
  status: "refused",
  field: null,
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

// The Academic-year start for the Admissions Manager: the read-only view with
// Edit start, or the form. Seats are set in streams, on the Seats screen
// (#449).
export function AcademicYearEditor({
  year,
  start,
  children,
}: {
  year: number
  start: string | null
  children: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  if (editing) {
    return (
      <AcademicYearForm
        year={year}
        start={start}
        onSaved={() => {
          setEditing(false)
          setSaved("Start saved.")
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="fs-stack">
      <div className="fs-bar">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            setSaved(null)
            setEditing(true)
          }}
        >
          Edit start
        </Button>
        <p role="status" className="fs-saved">
          {saved}
        </p>
      </div>
      {children}
    </div>
  )
}

function AcademicYearForm({
  year,
  start,
  onSaved,
  onCancel,
}: {
  year: number
  start: string | null
  onSaved: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(start ?? "")
  const [refusal, setRefusal] = useState<Refused | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const startId = useId()
  const invalid = (field: AcademicYearField) => refusal?.field === field || undefined

  function save() {
    setRefusal(null)
    startTransition(async () => {
      let outcome: AcademicYearOutcome
      try {
        // What the form opened with, so the save is refused rather than
        // undoing a change someone else made since.
        outcome = await saveAcademicYear(year, { start: draft === "" ? null : draft }, { start })
      } catch {
        outcome = LOST_REQUEST
      }
      if (outcome.status === "saved") onSaved()
      else setRefusal(outcome)
      // Brings in the newer values, which show once the form is cancelled.
      if (outcome.status === "refused" && outcome.stale) router.refresh()
    })
  }

  return (
    <form
      aria-label={`Academic year ${year}`}
      className="fs-form"
      data-width="narrow"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="fs-field">
        <label htmlFor={startId} className="fs-label">
          Academic-year start
        </label>
        <DateField
          id={startId}
          min={`${year}-01-01`}
          max={`${year}-01-31`}
          value={draft}
          onChange={setDraft}
          invalid={invalid("academic_year_start")}
          aria-describedby={`${startId}-hint`}
        />
        <p id={`${startId}-hint`} className="fs-hint">
          A date in January {year}.
        </p>
      </div>

      {refusal && (
        <Note tone="bad" role="alert">
          {refusal.message} Nothing was saved.
        </Note>
      )}
      <div className="fs-actions">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
