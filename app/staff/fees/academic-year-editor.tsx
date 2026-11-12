"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button, Field, Note } from "@/components/kit"
import type { AcademicYearField, AcademicYearSettings, SeatSetting } from "@/lib/services/fees"
import { DAY_OR_BOARDING, LEAD_CLASSES, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"

import { saveAcademicYear } from "./actions"
import { DateInput } from "./date-input"
import type { AcademicYearOutcome } from "./outcome"

type Refused = Extract<AcademicYearOutcome, { status: "refused" }>

const LOST_REQUEST: Refused = {
  status: "refused",
  field: null,
  message: "The change could not be confirmed. Check your connection, reload the page and see whether it was saved.",
}

const cellKey = (className: LeadClass, dayOrBoarding: DayOrBoarding) => `${className}.${dayOrBoarding}` as const

// The form's values, as typed: the start date, and each cell's seats.
type Draft = { start: string; seats: Record<string, string> }

function draftOf(start: string | null, seats: SeatSetting[]): Draft {
  return {
    start: start ?? "",
    seats: Object.fromEntries(seats.map((seat) => [cellKey(seat.className, seat.dayOrBoarding), String(seat.seats)])),
  }
}

// A blank cell stays not set. Anything that isn't a whole number becomes NaN,
// which the database refuses by name.
function seatCount(typed: string | undefined): number | null {
  const digits = (typed ?? "").replace(/[\s,]/g, "")
  if (digits === "") return null
  return /^-?\d+(\.\d+)?$/.test(digits) ? Number(digits) : Number.NaN
}

function settingsOf(draft: Draft): AcademicYearSettings {
  return {
    start: draft.start === "" ? null : draft.start,
    seats: LEAD_CLASSES.flatMap((className) =>
      DAY_OR_BOARDING.map((dayOrBoarding) => ({
        className,
        dayOrBoarding,
        seats: seatCount(draft.seats[cellKey(className, dayOrBoarding)]),
      })),
    ),
  }
}

// The start and seats for the Admissions Manager: the read-only view with
// Edit start and seats, or the form.
export function AcademicYearEditor({
  year,
  start,
  seats,
  children,
}: {
  year: number
  start: string | null
  seats: SeatSetting[]
  children: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  if (editing) {
    return (
      <AcademicYearForm
        year={year}
        start={start}
        seats={seats}
        onSaved={() => {
          setEditing(false)
          setSaved("Start and seats saved.")
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
          Edit start and seats
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
  seats,
  onSaved,
  onCancel,
}: {
  year: number
  start: string | null
  seats: SeatSetting[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(() => draftOf(start, seats))
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
        outcome = await saveAcademicYear(year, settingsOf(draft), { start, seats })
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
        <DateInput
          id={startId}
          min={`${year}-01-01`}
          max={`${year}-01-31`}
          value={draft.start}
          onChange={(start) => setDraft({ ...draft, start })}
          invalid={invalid("academic_year_start")}
          aria-describedby={`${startId}-hint`}
        />
        <p id={`${startId}-hint`} className="fs-hint">
          A date in January {year}.
        </p>
      </div>

      <fieldset>
        <legend className="fs-legend">Seats in each class</legend>
        <p className="fs-hint">Leave a class blank while its seats are not set. 0 means no seats.</p>
        <div className="fs-seats">
          <span aria-hidden className="fs-seats-head">
            Class
          </span>
          {DAY_OR_BOARDING.map((choice) => (
            <span key={choice} aria-hidden className="fs-seats-head">
              {choice}
            </span>
          ))}
          {LEAD_CLASSES.map((className) => (
            <SeatRow
              key={className}
              leadClass={className}
              draft={draft}
              invalid={invalid}
              onChange={(key, value) => setDraft({ ...draft, seats: { ...draft.seats, [key]: value } })}
            />
          ))}
        </div>
      </fieldset>

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

function SeatRow({
  leadClass,
  draft,
  invalid,
  onChange,
}: {
  leadClass: LeadClass
  draft: Draft
  invalid: (field: AcademicYearField) => true | undefined
  onChange: (key: string, value: string) => void
}) {
  const id = useId()
  return (
    <>
      <span className="fs-seats-class">{leadClass}</span>
      {DAY_OR_BOARDING.map((choice) => {
        const key = cellKey(leadClass, choice)
        return (
          <div key={choice}>
            <label htmlFor={`${id}-${choice}`} className="sr-only">
              {leadClass} {choice} seats
            </label>
            <Field
              id={`${id}-${choice}`}
              size="compact"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Not set"
              className="fs-money"
              value={draft.seats[key] ?? ""}
              onChange={(event) => onChange(key, event.target.value)}
              invalid={invalid(`seats.${key}`)}
            />
          </div>
        )
      })}
    </>
  )
}
